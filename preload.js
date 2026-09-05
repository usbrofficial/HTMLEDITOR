'use strict';
// Bridge between the sandboxed renderer and the main process.
// Only the functions listed here are reachable from the UI.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('htmlEditor', {
  // Files
  openFile: () => ipcRenderer.invoke('file:open'),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('file:save', filePath, content),
  pickImage: (docPath) => ipcRenderer.invoke('file:pick-image', docPath),
  previewInBrowser: (content, docPath) => ipcRenderer.invoke('file:preview', content, docPath),
  writePreview: (content, docPath) => ipcRenderer.invoke('file:write-preview', content, docPath),
  removePreview: (previewPath) => ipcRenderer.invoke('file:remove-preview', previewPath),

  // App state
  setDirty: (dirty, fileName) => ipcRenderer.invoke('app:set-dirty', dirty, fileName),
  setTitle: (fileName) => ipcRenderer.invoke('app:set-title', fileName),
  closeNow: () => ipcRenderer.invoke('app:close-now'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  showMessage: (options) => ipcRenderer.invoke('app:message', options),
  rendererReady: () => ipcRenderer.invoke('app:renderer-ready'),

  // Events from the main process
  onMenuAction: (cb) => ipcRenderer.on('menu:action', (_e, action, payload) => cb(action, payload)),
  onSaveAndClose: (cb) => ipcRenderer.on('menu:save-and-close', () => cb()),
  onFileOpenedExternally: (cb) => ipcRenderer.on('file:opened-externally', (_e, doc) => cb(doc)),

  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
});
