// Electron entry point for the smoke test: boots the real app with a sample
// page, then drives the renderer through window.__he and the IPC layer.
'use strict';
const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const tmp = path.join(__dirname, 'tmp');
const samplePath = process.env.HE_EXPECTED_PATH || path.join(tmp, 'sample.html');
// The second pass only checks that a file:// URL argument opens the page;
// the full suite already ran in the first pass.
const QUICK = process.env.HE_QUICK === '1';
const outPath = path.join(tmp, 'out.html');

require('../main.js');

const consoleErrors = [];

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (ev) => {
    const level = typeof ev === 'object' && ev.level ? ev.level : arguments[1];
    const msg = typeof ev === 'object' && ev.message ? ev.message : arguments[2];
    // The sandbox refusing to run the page's own scripts is expected and desired.
    if ((level === 'error' || level === 3) && !/Blocked script execution in 'about:srcdoc'/.test(String(msg))) consoleErrors.push(String(msg));
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      await runTests(win);
      console.log('\nALL TESTS PASSED');
      app.exit(0);
    } catch (err) {
      console.error('\nTEST FAILED:', err && err.stack ? err.stack : err);
      app.exit(1);
    }
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stepNo = 0;
function step(name) { stepNo += 1; console.log(`  ${stepNo}. ${name}`); }

async function runTests(win) {
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const waitFor = async (code, label, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await js(code)) return; await sleep(50); }
    throw new Error('Timed out waiting for: ' + label);
  };

  step('opens the file given on the command line');
  await waitFor(`window.__he && __he.state.path === ${JSON.stringify(samplePath)} && !!document.getElementById('page').contentDocument.querySelector('body[contenteditable]')`, 'sample page loaded');
  if (QUICK) return;

  step('page scripts do not run inside the editor');
  const title = await js(`document.getElementById('page').contentDocument.title`);
  assert.strictEqual(title, 'Sample page', 'the inline script must not have executed');
  assert.strictEqual(await js(`document.getElementById('page').contentWindow.__pageScriptRan`), undefined);

  step('relative images resolve against the file location');
  await waitFor(`(function(){ const i = document.getElementById('page').contentDocument.querySelector('img'); return i && i.complete && i.naturalWidth === 1; })()`, 'image loaded');

  step('embedded videos are neutralised while editing');
  assert.strictEqual(await js(`document.getElementById('page').contentDocument.querySelector('iframe').getAttribute('src')`), null);

  step('serialised HTML contains no editor artefacts and restores the original parts');
  let html = await js('__he.getHtml()');
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'doctype kept');
  assert.ok(!/data-he-/.test(html), 'no data-he attributes');
  assert.ok(!/contenteditable/.test(html), 'no contenteditable');
  assert.ok(!/<base /.test(html), 'injected base removed');
  assert.ok(html.includes("window.__pageScriptRan = true"), 'head script preserved');
  assert.ok(html.includes('.note { color: rebeccapurple; }'), 'stylesheet preserved');
  assert.ok(html.includes('src="https://www.youtube.com/embed/dQw4w9WgXcQ"'), 'iframe src restored');
  assert.ok(html.includes('<img src="dot.png"'), 'image path untouched');
  assert.strictEqual(await js('__he.state.dirty'), false, 'freshly opened file is not dirty');

  step('inserting a block, undo and redo');
  assert.strictEqual(await js(`__he.insertBlock('<h2>Inserted</h2>') && document.getElementById('page').contentDocument.querySelectorAll('h2').length`), 1);
  assert.strictEqual(await js('__he.state.dirty'), true);
  assert.strictEqual(await js(`__he.state.selected && __he.state.selected.tagName`), 'H2');
  assert.strictEqual(await js(`document.getElementById('props-label').textContent`), 'Heading 2');
  await js('__he.undo()');
  assert.strictEqual(await js(`document.getElementById('page').contentDocument.querySelectorAll('h2').length`), 0);
  await js('__he.redo()');
  assert.strictEqual(await js(`document.getElementById('page').contentDocument.querySelectorAll('h2').length`), 1);

  step('inserting after the selected element, not at the end');
  await js(`__he.selectElement(document.getElementById('page').contentDocument.getElementById('title'))`);
  await js(`__he.insertBlock('<p id="after-title">after</p>')`);
  assert.strictEqual(await js(`document.getElementById('page').contentDocument.getElementById('title').nextElementSibling.id`), 'after-title');

  step('inserting next to a table cell goes after the table');
  await js(`__he.selectElement(document.getElementById('page').contentDocument.querySelector('td'))`);
  await js(`__he.insertBlock('<p id="after-table">x</p>')`);
  assert.strictEqual(await js(`document.getElementById('page').contentDocument.querySelector('table').nextElementSibling.id`), 'after-table');

  step('changing an element tag keeps content and attributes');
  await js(`__he.changeTag(document.getElementById('page').contentDocument.getElementById('title'), 'h3')`);
  assert.strictEqual(await js(`document.getElementById('page').contentDocument.getElementById('title').tagName`), 'H3');
  assert.strictEqual(await js(`document.getElementById('page').contentDocument.getElementById('title').textContent`), 'Hello world');

  step('properties panel renders image fields');
  await js(`__he.selectElement(document.getElementById('page').contentDocument.querySelector('img'))`);
  assert.strictEqual(await js(`document.getElementById('props-label').textContent`), 'Image');
  assert.ok(await js(`!!Array.from(document.querySelectorAll('#props-fields label')).find(l => l.textContent === 'Description (alt text)')`), 'alt field present');
  assert.ok(await js(`document.getElementById('breadcrumb').textContent.includes('Image')`), 'breadcrumb shows Image');

  step('deleting the selected element');
  await js('__he.deleteSelected()');
  assert.strictEqual(await js(`document.getElementById('page').contentDocument.querySelectorAll('img').length`), 0);

  step('video link parsing');
  assert.strictEqual(await js(`__he.embedUrl('https://www.youtube.com/watch?v=abc123XYZ_-')`), 'https://www.youtube.com/embed/abc123XYZ_-');
  assert.strictEqual(await js(`__he.embedUrl('https://youtu.be/abc123XYZ_-?t=5')`), 'https://www.youtube.com/embed/abc123XYZ_-');
  assert.strictEqual(await js(`__he.embedUrl('https://vimeo.com/123456')`), 'https://player.vimeo.com/video/123456');
  assert.strictEqual(await js(`__he.embedUrl('not a url')`), null);

  step('code view round-trip applies edits');
  await js('__he.showCode(true)');
  assert.strictEqual(await js(`document.getElementById('code-view').value === __he.getHtml()`), true);
  await js(`(function(){ const t = document.getElementById('code-view'); t.value = t.value.replace('Hello world', 'Hello code'); })()`);
  await js('__he.showCode(false)');
  await waitFor(`document.getElementById('page').contentDocument.getElementById('title').textContent === 'Hello code'`, 'code edit applied');
  await js('__he.undo()');
  assert.strictEqual(await js(`document.getElementById('page').contentDocument.getElementById('title').textContent`), 'Hello world', 'code edit is undoable');

  step('saving writes a clean file through the main process');
  await js(`__he.state.path = ${JSON.stringify(outPath)}`);
  const saved = await js('__he.save(false)');
  assert.strictEqual(saved, true);
  await waitFor(`__he.state.dirty === false`, 'dirty cleared after save');
  const out = fs.readFileSync(outPath, 'utf8');
  assert.ok(out.startsWith('<!DOCTYPE html>'));
  assert.ok(!/data-he-|contenteditable|<base /.test(out), 'saved file has no editor artefacts');
  assert.ok(out.includes('<title>Sample page</title>'));
  assert.ok(out.includes('id="after-title"'));
  assert.ok(out.includes('<style>'), 'style block kept');
  assert.ok(out.includes('<h3 id="title">Hello world</h3>'));

  step('saving from code view keeps the code edits');
  await js('__he.showCode(true)');
  await js(`(function(){ const t = document.getElementById('code-view'); t.value = t.value.replace('Hello world', 'Hello saved code'); })()`);
  await js('__he.save(false)');
  await waitFor(`__he.state.dirty === false && __he.state.codeMode === true`, 'saved and back in code view');
  assert.ok(fs.readFileSync(outPath, 'utf8').includes('Hello saved code'));
  await js('__he.showCode(false)');

  step('loading a template creates an untitled page');
  await js(`__he.loadDocument(HE_TEMPLATES[1].html, null)`);
  await waitFor(`__he.state.path === null && document.getElementById('page').contentDocument.querySelector('.hero')`, 'template loaded');
  assert.strictEqual(await js(`document.getElementById('page').contentDocument.querySelector('base')`), null, 'no base for untitled pages');

  step('video embeds show a thumbnail while editing, without touching the page');
  await js(`__he.loadDocument(${JSON.stringify(fs.readFileSync(samplePath, 'utf8'))}, ${JSON.stringify(samplePath)})`);
  await waitFor(`document.getElementById('page').contentDocument.getElementById('he-embed-styles') !== null`, 'embed style injected');
  assert.ok(await js(`document.getElementById('page').contentDocument.getElementById('he-embed-styles').textContent.includes('img.youtube.com/vi/dQw4w9WgXcQ/')`), 'thumbnail rule present');
  assert.ok(!(await js('__he.getHtml()')).includes('he-embed-styles'), 'thumbnail rules are not saved');

  step('preview mode renders the page for real, then returns to editing');
  await js('__he.setPreview(true)');
  await waitFor(`__he.state.previewing === true && !document.getElementById('preview-wrap').hidden`, 'preview shown');
  const previewPath = await js('__he.state.previewPath');
  assert.ok(previewPath && previewPath.endsWith('.sample.preview.html'), 'preview written next to the file: ' + previewPath);
  assert.ok(fs.existsSync(previewPath), 'preview file exists');
  assert.ok(fs.readFileSync(previewPath, 'utf8').includes('src="https://www.youtube.com/embed/'), 'preview has the real embed');
  let previewFrame = null;
  for (let i = 0; i < 100 && !previewFrame; i++) {
    previewFrame = win.webContents.mainFrame.frames.find((f) => f.url.startsWith('he-preview://'));
    if (!previewFrame) await sleep(50);
  }
  assert.ok(previewFrame, 'preview frame found');
  let ran = false;
  for (let i = 0; i < 100 && !ran; i++) { ran = await previewFrame.executeJavaScript('window.__pageScriptRan === true').catch(() => false); if (!ran) await sleep(50); }
  assert.strictEqual(ran, true, 'page scripts run in the preview');
  const isolated = await previewFrame.executeJavaScript('(function(){ try { return window.parent.document ? "reachable" : "isolated"; } catch (e) { return "isolated"; } })()');
  assert.strictEqual(isolated, 'isolated', 'preview page cannot touch the editor UI');
  let imgOk = false;
  for (let i = 0; i < 100 && !imgOk; i++) { imgOk = await previewFrame.executeJavaScript('(function(){ const i = document.querySelector("img"); return !!(i && i.complete && i.naturalWidth === 1); })()').catch(() => false); if (!imgOk) await sleep(50); }
  assert.strictEqual(imgOk, true, 'relative images load in the preview');
  const outside = await previewFrame.executeJavaScript('fetch("../package.json").then(r => r.status).catch(() => "error")');
  assert.notStrictEqual(outside, 200, 'preview cannot read files outside the page folder');
  assert.strictEqual(await js(`document.getElementById('blocks-panel').hidden`), true, 'panels hidden while previewing');
  await js('__he.setPreview(false)');
  await waitFor(`__he.state.previewing === false && document.getElementById('preview-wrap').hidden && !document.getElementById('blocks-panel').hidden`, 'back to edit mode');
  for (let i = 0; i < 40 && fs.existsSync(previewPath); i++) await sleep(50);
  assert.ok(!fs.existsSync(previewPath), 'preview file removed');
  assert.ok(await js(`document.getElementById('page').contentDocument.querySelector('body[contenteditable]') !== null`), 'still editable');

  step('no console errors in the renderer');
  if (consoleErrors.length) throw new Error('Renderer console errors:\n' + consoleErrors.join('\n'));
}
