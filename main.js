'use strict';
// HTML Editor - Electron main process.
// Owns the window, the application menu and everything that touches the
// filesystem. The renderer (src/) never gets direct Node access; it talks to
// this process through the small API exposed in preload.js.

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeImage, protocol, net } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { fileURLToPath } = require('url');

const APP_NAME = 'HTML Editor';
const isDev = !app.isPackaged;

let mainWindow = null;
let isDirty = false;
let forceClose = false;
let pendingOpenPath = null; // file passed on the command line before the window is ready
let rendererReady = false;

app.setName(APP_NAME);

// The live preview is served through its own URL scheme so that it gets an
// origin of its own: scripts in the previewed page cannot reach the editor UI
// (all file:// pages would otherwise count as the same origin).
const PREVIEW_SCHEME = 'he-preview';
protocol.registerSchemesAsPrivileged([
  { scheme: PREVIEW_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } },
]);
let previewRoot = null; // folder the preview may read files from (the page's folder)

const PREVIEW_MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
};

function registerPreviewProtocol() {
  protocol.handle(PREVIEW_SCHEME, async (request) => {
    if (!previewRoot) return new Response('No preview', { status: 404 });
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname);
    const file = path.resolve(previewRoot, '.' + (rel.startsWith('/') ? rel : '/' + rel));
    // Only files inside the page's folder are reachable.
    if (file !== previewRoot && !file.startsWith(previewRoot + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const data = await fsp.readFile(file);
      const type = PREVIEW_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// File managers launch us through the .desktop entry, which passes the file
// either as a plain path or as a file:// URL. Accept both.
function pathFromArg(arg) {
  if (/^file:\/\//i.test(arg)) {
    try { return fileURLToPath(arg); } catch { return null; }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) return null; // some other protocol: not a local file
  return path.resolve(arg);
}

function htmlFileFromArgv(argv) {
  // Drop Chromium/Electron switches, then skip the executable (and the script
  // path when running unpackaged) to find the page the user wants to open.
  const args = argv.filter((a) => !a.startsWith('--')).slice(isDev ? 2 : 1);
  for (const arg of args) {
    if (!/\.(x?html?)$/i.test(arg)) continue;
    const resolved = pathFromArg(arg);
    if (resolved) return resolved;
  }
  return null;
}

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

function updateTitle(fileName) {
  if (!mainWindow) return;
  const name = fileName || 'Untitled page';
  mainWindow.setTitle(`${isDirty ? '● ' : ''}${name} — ${APP_NAME}`);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    icon: fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined,
    backgroundColor: '#f4f5f7',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Links clicked inside the app (e.g. the About dialog) open in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (forceClose || !isDirty) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved changes',
      message: 'This page has unsaved changes.',
      detail: 'Do you want to save them before closing?',
    });
    if (choice === 0) {
      // Renderer saves, then tells us to close for real.
      sendToRenderer('menu:save-and-close');
    } else if (choice === 1) {
      forceClose = true;
      mainWindow.close();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  buildMenu();
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function menuAction(action, payload) {
  return () => sendToRenderer('menu:action', action, payload);
}

function buildMenu() {
  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'New Page…', accelerator: 'CmdOrCtrl+N', click: menuAction('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: menuAction('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: menuAction('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: menuAction('save-as') },
        { type: 'separator' },
        { label: 'Preview', accelerator: 'CmdOrCtrl+P', click: menuAction('toggle-preview') },
        { label: 'Open in Browser', accelerator: 'F5', click: menuAction('preview') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: menuAction('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', registerAccelerator: false, click: menuAction('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { label: 'Paste as Plain Text', accelerator: 'CmdOrCtrl+Shift+V', role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: menuAction('find') },
        { type: 'separator' },
        { label: 'Page Settings…', accelerator: 'CmdOrCtrl+,', click: menuAction('page-settings') },
      ],
    },
    {
      label: '&Insert',
      submenu: [
        { label: 'Heading', click: menuAction('insert', 'heading') },
        { label: 'Paragraph', click: menuAction('insert', 'paragraph') },
        { label: 'Image…', accelerator: 'CmdOrCtrl+Shift+I', click: menuAction('insert', 'image') },
        { label: 'Link…', accelerator: 'CmdOrCtrl+K', click: menuAction('insert', 'link') },
        { label: 'Button', click: menuAction('insert', 'button') },
        { label: 'Bulleted List', click: menuAction('insert', 'ul') },
        { label: 'Numbered List', click: menuAction('insert', 'ol') },
        { label: 'Table…', click: menuAction('insert', 'table') },
        { label: 'Quote', click: menuAction('insert', 'quote') },
        { label: 'Divider', click: menuAction('insert', 'hr') },
        { label: 'Video (YouTube)…', click: menuAction('insert', 'video') },
        { label: 'Two Columns', click: menuAction('insert', 'columns') },
        { label: 'Section / Box', click: menuAction('insert', 'section') },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Blocks Panel', accelerator: 'CmdOrCtrl+1', click: menuAction('toggle-blocks') },
        { label: 'Properties Panel', accelerator: 'CmdOrCtrl+2', click: menuAction('toggle-props') },
        { label: 'HTML Code View', accelerator: 'CmdOrCtrl+E', click: menuAction('toggle-code') },
        { type: 'separator' },
        { label: 'Show Element Outlines', accelerator: 'CmdOrCtrl+Shift+O', click: menuAction('toggle-outlines') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: menuAction('zoom', 1) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: menuAction('zoom', -1) },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: menuAction('zoom', 0) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Getting Started', accelerator: 'F1', click: menuAction('help') },
        { label: 'Keyboard Shortcuts', click: menuAction('shortcuts') },
        { type: 'separator' },
        {
          label: 'About HTML Editor',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About HTML Editor',
              message: `${APP_NAME} ${app.getVersion()}`,
              detail:
                'A visual editor for HTML pages. Open a page, click on anything to edit it, ' +
                'add blocks from the left panel and tweak them on the right. No coding needed.\n\n' +
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC: file operations requested by the renderer
// ---------------------------------------------------------------------------

const HTML_FILTERS = [
  { name: 'HTML pages', extensions: ['html', 'htm', 'xhtml'] },
  { name: 'All files', extensions: ['*'] },
];

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] },
];

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif',
};

async function readHtml(filePath) {
  const content = await fsp.readFile(filePath, 'utf8');
  app.addRecentDocument(filePath);
  return { path: filePath, content };
}

ipcMain.handle('file:open', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open HTML page',
    properties: ['openFile'],
    filters: HTML_FILTERS,
  });
  if (canceled || !filePaths.length) return null;
  return readHtml(filePaths[0]);
});

ipcMain.handle('file:read', async (_e, filePath) => readHtml(filePath));

ipcMain.handle('file:save', async (_e, filePath, content) => {
  let target = filePath;
  if (!target) {
    const { canceled, filePath: chosen } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save HTML page',
      defaultPath: path.join(app.getPath('documents'), 'index.html'),
      filters: HTML_FILTERS,
    });
    if (canceled || !chosen) return null;
    target = chosen;
    if (!path.extname(target)) target += '.html';
  }
  await fsp.writeFile(target, content, 'utf8');
  app.addRecentDocument(target);
  return { path: target };
});

// Lets the user pick an image. If the page has been saved we return a path
// relative to the page (portable). If the page is still untitled we embed the
// image as a data URL so nothing breaks when the page is saved elsewhere.
ipcMain.handle('file:pick-image', async (_e, docPath) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an image',
    properties: ['openFile'],
    filters: IMAGE_FILTERS,
  });
  if (canceled || !filePaths.length) return null;
  const imgPath = filePaths[0];
  const name = path.basename(imgPath);
  if (docPath) {
    const rel = path.relative(path.dirname(docPath), imgPath).split(path.sep).join('/');
    return { src: rel, name, embedded: false };
  }
  const buf = await fsp.readFile(imgPath);
  const mime = MIME[path.extname(imgPath).toLowerCase()] || 'application/octet-stream';
  return { src: `data:${mime};base64,${buf.toString('base64')}`, name, embedded: true };
});

// Preview copies are written next to the real file so relative images and
// stylesheets keep working. They are removed when no longer needed.
const previewFiles = new Set();

function previewPathFor(docPath) {
  if (docPath) {
    const dir = path.dirname(docPath);
    const base = path.basename(docPath, path.extname(docPath));
    return path.join(dir, `.${base}.preview.html`);
  }
  return path.join(os.tmpdir(), `htmleditor-preview-${process.pid}.html`);
}

async function writePreview(content, docPath) {
  const previewPath = previewPathFor(docPath);
  await fsp.writeFile(previewPath, content, 'utf8');
  previewFiles.add(previewPath);
  return previewPath;
}

async function removePreview(previewPath) {
  if (!previewPath || !previewFiles.has(previewPath)) return;
  previewFiles.delete(previewPath);
  await fsp.unlink(previewPath).catch(() => {});
}

// Open the page in the user's default browser.
ipcMain.handle('file:preview', async (_e, content, docPath) => {
  const previewPath = await writePreview(content, docPath);
  await shell.openPath(previewPath);
  return { path: previewPath };
});

// In-app live preview: write the file and hand back a URL the renderer can load.
ipcMain.handle('file:write-preview', async (_e, content, docPath) => {
  const previewPath = await writePreview(content, docPath);
  previewRoot = path.dirname(previewPath);
  const url = `${PREVIEW_SCHEME}://page/${encodeURIComponent(path.basename(previewPath))}`;
  return { path: previewPath, url };
});

ipcMain.handle('file:remove-preview', async (_e, previewPath) => removePreview(previewPath));

app.on('will-quit', () => {
  for (const f of previewFiles) { try { fs.unlinkSync(f); } catch {} }
});

ipcMain.handle('app:set-dirty', (_e, dirty, fileName) => {
  isDirty = !!dirty;
  updateTitle(fileName);
});

ipcMain.handle('app:set-title', (_e, fileName) => updateTitle(fileName));

ipcMain.handle('app:close-now', () => {
  forceClose = true;
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('app:open-external', (_e, url) => {
  if (/^https?:/i.test(url)) return shell.openExternal(url);
  return false;
});

ipcMain.handle('app:message', async (_e, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result.response;
});

ipcMain.handle('app:renderer-ready', () => {
  rendererReady = true;
  if (pendingOpenPath) {
    const p = pendingOpenPath;
    pendingOpenPath = null;
    return readHtml(p).catch(() => null);
  }
  return null;
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const p = htmlFileFromArgv(argv);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      if (p) readHtml(p).then((doc) => sendToRenderer('file:opened-externally', doc)).catch(() => {});
    }
  });

  app.on('open-file', (event, urlOrPath) => {
    event.preventDefault();
    const filePath = pathFromArg(urlOrPath);
    if (!filePath) return;
    if (rendererReady) {
      readHtml(filePath).then((doc) => sendToRenderer('file:opened-externally', doc)).catch(() => {});
    } else {
      pendingOpenPath = filePath;
    }
  });

  app.whenReady().then(() => {
    registerPreviewProtocol();
    pendingOpenPath = htmlFileFromArgv(process.argv);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
