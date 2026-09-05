/* HTML Editor — renderer logic.
 *
 * The page being edited lives in a sandboxed <iframe> (#page). Scripts inside
 * the user's page never run; we simply turn the body into an editable surface
 * and manipulate the DOM directly. Nothing here requires Node access — all file
 * I/O goes through the tiny `window.htmlEditor` API from preload.js.
 */
'use strict';

(() => {
  const api = window.htmlEditor;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  const state = {
    path: null,          // absolute path of the open file, or null when untitled
    doctype: '<!DOCTYPE html>',
    dirty: false,
    selected: null,      // currently selected element inside the iframe
    hovered: null,
    undo: [],
    redo: [],
    snapshot: '',        // body HTML of the last committed state
    zoom: 1,
    codeMode: false,
    codeSnapshot: '',
    outlines: false,
    pendingInsert: null, // { parent, before } set by drag & drop before a dialog opens
    loadOpts: null,
    loadResolve: null,
  };

  const frame = $('#page');
  const codeView = $('#code-view');
  const codeWrap = $('#code-wrap');
  const propsPanel = $('#props-panel');
  const blocksPanel = $('#blocks-panel');
  const propsEl = $('#props');
  const propsEmpty = $('#props-empty');
  const propsFields = $('#props-fields');
  const propsLabel = $('#props-label');
  const elActions = $('#el-actions');
  const breadcrumb = $('#breadcrumb');
  const statusMsg = $('#status-msg');
  const canvas = $('#canvas');

  const doc = () => frame.contentDocument;
  const win = () => frame.contentWindow;
  const body = () => frame.contentDocument && frame.contentDocument.body;

  const INLINE_TAGS = new Set(['SPAN', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'SUB', 'SUP', 'SMALL', 'MARK', 'CODE', 'ABBR', 'FONT', 'BR', 'WBR']);
  const VOID_LIKE = new Set(['IMG', 'HR', 'IFRAME', 'VIDEO', 'AUDIO', 'TABLE', 'SVG', 'CANVAS', 'OBJECT', 'EMBED']);
  const TEXT_BLOCKS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'div'];

  const LABELS = {
    H1: 'Heading 1', H2: 'Heading 2', H3: 'Heading 3', H4: 'Heading 4', H5: 'Heading 5', H6: 'Heading 6',
    P: 'Paragraph', A: 'Link', IMG: 'Image', UL: 'Bulleted list', OL: 'Numbered list', LI: 'List item',
    TABLE: 'Table', TR: 'Table row', TD: 'Table cell', TH: 'Header cell', THEAD: 'Table header', TBODY: 'Table body',
    BLOCKQUOTE: 'Quote', HR: 'Divider', DIV: 'Box', SECTION: 'Section', HEADER: 'Header', FOOTER: 'Footer',
    NAV: 'Navigation', MAIN: 'Main content', ARTICLE: 'Article', ASIDE: 'Sidebar', SPAN: 'Text', STRONG: 'Bold text',
    B: 'Bold text', EM: 'Italic text', I: 'Italic text', U: 'Underlined text', BUTTON: 'Button', IFRAME: 'Video / embed',
    VIDEO: 'Video', AUDIO: 'Audio', FIGURE: 'Figure', FIGCAPTION: 'Caption', PRE: 'Code block', CODE: 'Code',
    FORM: 'Form', INPUT: 'Input field', TEXTAREA: 'Text area', SELECT: 'Dropdown', LABEL: 'Label', BODY: 'Page',
  };
  const labelFor = (el) => LABELS[el.tagName] || el.tagName.charAt(0) + el.tagName.slice(1).toLowerCase();

  // -------------------------------------------------------------------------
  // Blocks that can be added to the page
  // -------------------------------------------------------------------------
  const BLOCKS = [
    { id: 'heading', label: 'Heading', icon: 'heading', html: '<h2>Your heading</h2>' },
    { id: 'paragraph', label: 'Text', icon: 'text', html: '<p>Write your text here.</p>' },
    { id: 'image', label: 'Image', icon: 'image', dialog: 'image' },
    { id: 'button', label: 'Button', icon: 'button', html: '<p><a href="#" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600">Click me</a></p>' },
    { id: 'link', label: 'Link', icon: 'link', dialog: 'link' },
    { id: 'ul', label: 'Bulleted list', icon: 'ul', html: '<ul><li>First item</li><li>Second item</li><li>Third item</li></ul>' },
    { id: 'ol', label: 'Numbered list', icon: 'ol', html: '<ol><li>First step</li><li>Second step</li><li>Third step</li></ol>' },
    { id: 'table', label: 'Table', icon: 'table', dialog: 'table' },
    { id: 'quote', label: 'Quote', icon: 'quote', html: '<blockquote style="border-left:4px solid #cbd5e1;margin:16px 0;padding:8px 20px;color:#475569;font-style:italic">“A memorable quote goes here.”</blockquote>' },
    { id: 'hr', label: 'Divider', icon: 'hr', html: '<hr>' },
    { id: 'video', label: 'Video', icon: 'video', dialog: 'video' },
    { id: 'columns', label: 'Two columns', icon: 'columns', html: '<div style="display:flex;gap:24px;flex-wrap:wrap;margin:16px 0"><div style="flex:1;min-width:200px"><h3>Column one</h3><p>Text for the first column.</p></div><div style="flex:1;min-width:200px"><h3>Column two</h3><p>Text for the second column.</p></div></div>' },
    { id: 'section', label: 'Section / box', icon: 'section', html: '<section style="padding:32px;background:#f3f4f6;border-radius:12px;margin:24px 0"><h2>Section title</h2><p>Text inside the box.</p></section>' },
    { id: 'spacer', label: 'Spacer', icon: 'spacer', html: '<div style="height:48px"></div>' },
  ];

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------
  let statusTimer = null;
  function status(msg, ms = 3000) {
    statusMsg.textContent = msg;
    statusMsg.style.opacity = '1';
    clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(() => (statusMsg.style.opacity = '0'), ms);
  }

  const fileName = () => (state.path ? state.path.split('/').pop() : '');
  const dirUrl = () => {
    if (!state.path) return null;
    const dir = state.path.slice(0, state.path.lastIndexOf('/') + 1);
    return 'file://' + dir.split('/').map(encodeURIComponent).join('/');
  };

  function setDirty(dirty) {
    state.dirty = dirty;
    api.setDirty(dirty, fileName());
  }

  function iconBtn(icon, title, onClick, extraClass = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-btn ' + extraClass;
    b.title = title;
    b.innerHTML = HE_ICONS[icon] || '';
    // Don't steal focus/selection from the page when clicking toolbar buttons.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', onClick);
    return b;
  }

  const isInline = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (INLINE_TAGS.has(el.tagName)) return true;
    try {
      const d = win().getComputedStyle(el).display;
      return d.startsWith('inline') && el.tagName !== 'IMG' && el.tagName !== 'IFRAME' && el.tagName !== 'BUTTON';
    } catch { return false; }
  };

  // Resolve the element the user "means" when clicking: skip pure formatting
  // wrappers like <strong> and climb to the enclosing block (but stop at links).
  function resolveTarget(node) {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    if (!el || el.nodeType !== 1) return null;
    const b = body();
    if (!b || !b.contains(el) || el === b) return null;
    while (el && el !== b && INLINE_TAGS.has(el.tagName) && el.parentElement !== b) el = el.parentElement;
    if (el === b) return null;
    return el;
  }

  function elementFromSelection() {
    const d = doc();
    if (!d) return null;
    const sel = d.getSelection();
    if (!sel || !sel.rangeCount) return null;
    return resolveTarget(sel.anchorNode);
  }

  // -------------------------------------------------------------------------
  // Loading & serializing the document
  // -------------------------------------------------------------------------
  const EDITOR_CSS = `
    body[data-he-editing] { min-height: 100vh; box-sizing: border-box; cursor: text; }
    body[data-he-editing]:focus { outline: none; }
    [data-he-selected] { outline: 2px solid #2563eb !important; outline-offset: 2px !important; }
    [data-he-hover]:not([data-he-selected]) { outline: 1px dashed #60a5fa !important; outline-offset: 1px !important; }
    body[data-he-outlines] *:not(br):not(script):not(style):not([data-he-injected]) { outline: 1px dashed rgba(100,116,139,.4); outline-offset: -1px; }
    body[data-he-editing] iframe[data-he-src] { background: #0f172a url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='1.5'%3E%3Cpolygon points='10 8 16 12 10 16 10 8'/%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3C/svg%3E") center / 64px no-repeat; pointer-events: auto; }
    body[data-he-editing] [data-he-injected] { pointer-events: none; }
    body[data-he-editing] a { cursor: text; }
    body[data-he-editing] img, body[data-he-editing] hr, body[data-he-editing] table { cursor: pointer; }
    #he-drop { position: absolute; height: 3px; background: #2563eb; border-radius: 2px; box-shadow: 0 0 0 2px rgba(37,99,235,.25); z-index: 2147483647; }
  `;

  function loadDocument(html, filePath, opts = {}) {
    state.path = filePath || null;
    const m = html.match(/^\s*<!doctype[^>]*>/i);
    state.doctype = m ? m[0].trim() : '<!DOCTYPE html>';
    state.selected = null;
    state.hovered = null;
    state.loadOpts = opts;
    if (!opts.keepHistory) { state.undo = []; state.redo = []; }
    if (state.codeMode) showCode(false, { skipApply: true });
    return new Promise((resolve) => {
      state.loadResolve = resolve;
      frame.srcdoc = prepareForEditing(html);
    });
  }

  // Adjust the raw HTML before the browser parses it: resolve relative paths
  // against the file's folder and stop embeds (YouTube etc.) from loading.
  function prepareForEditing(html) {
    let out = html.replace(/<iframe\b([^>]*?)\ssrc=/gi, '<iframe$1 data-he-src=');
    if (state.path && !/<base\b/i.test(out)) {
      const base = `<base href="${esc(dirUrl())}" data-he-injected>`;
      if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => m + base);
      else out = out.replace(/^(\s*<!doctype[^>]*>)?/i, (m) => m + base);
    }
    return out;
  }

  frame.addEventListener('load', () => {
    const d = doc();
    if (!d || !d.body) return;
    const opts = state.loadOpts || {};
    state.loadOpts = null;

    // Resolve relative images/CSS against the file's folder (normally already
    // done in prepareForEditing; kept as a safety net).
    if (state.path && !d.querySelector('base[href]')) {
      const base = d.createElement('base');
      base.href = dirUrl();
      base.setAttribute('data-he-injected', '');
      d.head.insertBefore(base, d.head.firstChild);
    }
    const style = d.createElement('style');
    style.setAttribute('data-he-injected', '');
    style.textContent = EDITOR_CSS;
    d.head.appendChild(style);

    // Neutralise embeds so nothing loads from the network while editing.
    $$('iframe', d.body).forEach((f) => {
      if (f.hasAttribute('src')) { f.setAttribute('data-he-src', f.getAttribute('src')); f.removeAttribute('src'); }
    });

    const b = d.body;
    if (!b.firstElementChild && !b.textContent.trim()) b.innerHTML = '<p><br></p>';
    b.setAttribute('contenteditable', 'true');
    b.setAttribute('spellcheck', 'true');
    b.setAttribute('data-he-editing', '');
    if (state.outlines) b.setAttribute('data-he-outlines', '');
    try { d.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}

    wireFrame(d);

    const snap = bodyHtml();
    if (opts.keepHistory && snap !== state.snapshot) {
      state.undo.push(state.snapshot);
      state.redo = [];
      state.snapshot = snap;
      setDirty(true);
    } else if (!opts.keepHistory) {
      state.snapshot = snap;
      setDirty(!!opts.dirty);
    }
    api.setTitle(fileName());
    updateHistoryButtons();
    renderProps();
    renderBreadcrumb();
    applyZoom();
    if (state.loadResolve) { const r = state.loadResolve; state.loadResolve = null; r(); }
  });

  // Body HTML without any editor artefacts — used for undo snapshots.
  function bodyHtml() {
    const b = body();
    if (!b) return '';
    const clone = b.cloneNode(true);
    stripEditorArtifacts(clone);
    return clone.innerHTML;
  }

  // `restoreEmbeds` puts the real src back on iframes; undo snapshots keep
  // them neutralised so restoring a snapshot never loads anything remote.
  function stripEditorArtifacts(root, { restoreEmbeds = false } = {}) {
    $$('[data-he-injected]', root).forEach((n) => n.remove());
    $$('[data-he-selected],[data-he-hover]', root).forEach((n) => { n.removeAttribute('data-he-selected'); n.removeAttribute('data-he-hover'); });
    if (restoreEmbeds) $$('iframe[data-he-src]', root).forEach((f) => { f.setAttribute('src', f.getAttribute('data-he-src')); f.removeAttribute('data-he-src'); });
  }

  // The full HTML document as it should be written to disk.
  function getHtml() {
    const d = doc();
    if (!d || !d.documentElement) return '';
    const root = d.documentElement.cloneNode(true);
    stripEditorArtifacts(root, { restoreEmbeds: true });
    const b = root.querySelector('body');
    if (b) ['contenteditable', 'spellcheck', 'data-he-editing', 'data-he-outlines'].forEach((a) => b.removeAttribute(a));
    return state.doctype + '\n' + root.outerHTML + '\n';
  }

  // -------------------------------------------------------------------------
  // Undo / redo (snapshot based, so structural edits and typing share one stack)
  // -------------------------------------------------------------------------
  let inputTimer = null;
  function commit() {
    clearTimeout(inputTimer);
    const now = bodyHtml();
    if (now === state.snapshot) return;
    state.undo.push(state.snapshot);
    if (state.undo.length > 200) state.undo.shift();
    state.redo = [];
    state.snapshot = now;
    if (!state.dirty) setDirty(true);
    updateHistoryButtons();
  }
  const scheduleCommit = () => { clearTimeout(inputTimer); inputTimer = setTimeout(commit, 500); };

  function restoreBody(html) {
    const b = body();
    b.innerHTML = html;
    state.selected = null;
    state.hovered = null;
    state.snapshot = html;
    setDirty(true);
    updateHistoryButtons();
    renderProps();
    renderBreadcrumb();
  }
  function undo() { commit(); if (!state.undo.length) return; state.redo.push(state.snapshot); restoreBody(state.undo.pop()); status('Undo'); }
  function redo() { commit(); if (!state.redo.length) return; state.undo.push(state.snapshot); restoreBody(state.redo.pop()); status('Redo'); }
  function updateHistoryButtons() {
    const u = $('#btn-undo'), r = $('#btn-redo');
    if (u) u.disabled = !state.undo.length && bodyHtml() === state.snapshot;
    if (r) r.disabled = !state.redo.length;
  }

  // -------------------------------------------------------------------------
  // Selection handling inside the frame
  // -------------------------------------------------------------------------
  let suppressSelection = false;
  let ignoreSelectionUntil = 0;

  function selectElement(el, { placeCaret = false, scroll = false } = {}) {
    const b = body();
    if (state.selected && state.selected !== el) state.selected.removeAttribute('data-he-selected');
    if (!el || el === b || !b.contains(el)) {
      state.selected = null;
    } else {
      state.selected = el;
      el.setAttribute('data-he-selected', '');
      if (placeCaret && !VOID_LIKE.has(el.tagName)) {
        const d = doc();
        const range = d.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        suppressSelection = true;
        const sel = d.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        win().focus();
        setTimeout(() => (suppressSelection = false), 0);
      }
      if (scroll) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    renderProps();
    renderBreadcrumb();
    updateToolbarState();
  }

  function setHover(el) {
    if (state.hovered === el) return;
    if (state.hovered) state.hovered.removeAttribute('data-he-hover');
    state.hovered = el;
    if (el) el.setAttribute('data-he-hover', '');
  }

  function wireFrame(d) {
    d.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a');
      if (a) e.preventDefault(); // never navigate away while editing
      const t = resolveTarget(e.target);
      if (t) { selectElement(t); if (VOID_LIKE.has(t.tagName)) ignoreSelectionUntil = Date.now() + 200; }
      else selectElement(elementFromSelection());
    });
    d.addEventListener('dblclick', (e) => {
      if (e.target.tagName === 'IMG') { e.preventDefault(); openImageDialog(e.target); }
      if (e.target.tagName === 'IFRAME') { e.preventDefault(); openVideoDialog(e.target); }
    });
    d.addEventListener('mouseover', (e) => setHover(resolveTarget(e.target)));
    d.documentElement.addEventListener('mouseleave', () => setHover(null));
    d.addEventListener('input', () => { scheduleCommit(); updateHistoryButtons(); });
    d.addEventListener('selectionchange', () => {
      if (suppressSelection) return;
      updateToolbarState();
      if (Date.now() < ignoreSelectionUntil) return;
      const el = elementFromSelection();
      if (el && el !== state.selected) selectElement(el);
    });
    d.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((mod && e.shiftKey && e.key.toLowerCase() === 'z') || (mod && e.key.toLowerCase() === 'y')) { e.preventDefault(); redo(); return; }
      if (e.key === 'Escape') {
        const p = state.selected && state.selected.parentElement;
        if (p && p !== body()) selectElement(p);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected && VOID_LIKE.has(state.selected.tagName)) {
        const sel = d.getSelection();
        if (!sel.rangeCount || sel.isCollapsed) { e.preventDefault(); deleteSelected(); }
      }
      if (e.key === 'Tab') {
        // Keep focus on the page; indent/outdent list items instead.
        e.preventDefault();
        exec(e.shiftKey ? 'outdent' : 'indent');
      }
    });
    d.addEventListener('paste', (e) => {
      // Keep basic formatting from pasted HTML, but drop scripts, stylesheets
      // and class names that would only make sense on the page it came from.
      const html = e.clipboardData && e.clipboardData.getData('text/html');
      if (!html) return; // plain text: the browser's default behaviour is fine
      e.preventDefault();
      d.execCommand('insertHTML', false, cleanPastedHtml(html));
      scheduleCommit();
    });

    // Drag & drop from the Blocks panel (and image files from the desktop).
    d.addEventListener('dragover', (e) => {
      const types = Array.from(e.dataTransfer.types || []);
      if (!types.includes('text/he-block') && !types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      showDropIndicator(e.clientX, e.clientY);
    });
    d.addEventListener('dragleave', (e) => { if (!e.relatedTarget) hideDropIndicator(); });
    d.addEventListener('drop', (e) => {
      const types = Array.from(e.dataTransfer.types || []);
      const pos = dropPosition(e.clientX, e.clientY);
      hideDropIndicator();
      if (types.includes('text/he-block')) {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/he-block');
        state.pendingInsert = pos;
        addBlock(id);
      } else if (types.includes('Files')) {
        const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'));
        if (!file) return;
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = () => { state.pendingInsert = pos; insertBlock(`<p><img src="${reader.result}" alt="${escapeAttr(file.name)}" style="max-width:100%;height:auto"></p>`); status('Image added (embedded in the page)'); };
        reader.readAsDataURL(file);
      }
    });
  }

  function cleanPastedHtml(html) {
    const t = document.implementation.createHTMLDocument('');
    t.body.innerHTML = html;
    $$('script, style, link, meta, title, iframe, object, embed, form, input, button, textarea, select', t.body).forEach((n) => n.remove());
    $$('*', t.body).forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        if (/^on/i.test(a.name) || a.name === 'class' || a.name === 'id' || /^data-/.test(a.name)) el.removeAttribute(a.name);
      });
    });
    return t.body.innerHTML;
  }

  // -------------------------------------------------------------------------
  // Toolbar
  // -------------------------------------------------------------------------
  function exec(cmd, value = null, useCss = false) {
    const d = doc();
    if (!d) return;
    win().focus();
    try {
      d.execCommand('styleWithCSS', false, useCss);
      d.execCommand(cmd, false, value);
    } catch (err) { console.warn('execCommand failed', cmd, err); }
    scheduleCommit();
    updateToolbarState();
  }

  function buildToolbar() {
    const file = $('#tb-file');
    const bNew = iconBtn('new', 'New page (Ctrl+N)', newPage); bNew.innerHTML += '<span class="lbl">New</span>'; file.append(bNew);
    const bOpen = iconBtn('open', 'Open (Ctrl+O)', openFile); bOpen.innerHTML += '<span class="lbl">Open</span>'; file.append(bOpen);
    const bSave = iconBtn('save', 'Save (Ctrl+S)', () => save(false)); bSave.innerHTML += '<span class="lbl">Save</span>'; file.append(bSave);

    const hist = $('#tb-history');
    const bu = iconBtn('undo', 'Undo (Ctrl+Z)', undo); bu.id = 'btn-undo'; hist.append(bu);
    const br = iconBtn('redo', 'Redo (Ctrl+Shift+Z)', redo); br.id = 'btn-redo'; hist.append(br);

    const fmt = $('#tb-format');
    const fmtBtns = [
      ['bold', 'Bold (Ctrl+B)', 'bold'], ['italic', 'Italic (Ctrl+I)', 'italic'],
      ['underline', 'Underline (Ctrl+U)', 'underline'], ['strike', 'Strikethrough', 'strikeThrough'],
    ];
    fmtBtns.forEach(([icon, title, cmd]) => { const b = iconBtn(icon, title, () => exec(cmd)); b.dataset.cmd = cmd; fmt.append(b); });
    fmt.append(iconBtn('clear', 'Remove formatting', () => { exec('removeFormat'); exec('unlink'); }));

    const align = $('#tb-align');
    [['alignLeft', 'Align left', 'justifyLeft'], ['alignCenter', 'Center', 'justifyCenter'], ['alignRight', 'Align right', 'justifyRight'], ['alignJustify', 'Justify', 'justifyFull']]
      .forEach(([icon, title, cmd]) => { const b = iconBtn(icon, title, () => exec(cmd)); b.dataset.cmd = cmd; align.append(b); });

    const lists = $('#tb-lists');
    [['ul', 'Bulleted list', 'insertUnorderedList'], ['ol', 'Numbered list', 'insertOrderedList'], ['outdent', 'Decrease indent', 'outdent'], ['indent', 'Increase indent', 'indent']]
      .forEach(([icon, title, cmd]) => { const b = iconBtn(icon, title, () => exec(cmd)); b.dataset.cmd = cmd; lists.append(b); });

    const ins = $('#tb-insert');
    ins.append(iconBtn('link', 'Add link (Ctrl+K)', () => openLinkDialog()));
    ins.append(iconBtn('image', 'Add image (Ctrl+Shift+I)', () => openImageDialog()));
    ins.append(iconBtn('table', 'Add table', () => openTableDialog()));
    ins.append(iconBtn('hr', 'Add divider', () => addBlock('hr')));

    const view = $('#tb-view');
    const bPrev = iconBtn('eye', 'Preview in browser (F5)', preview); bPrev.innerHTML += '<span class="lbl">Preview</span>'; view.append(bPrev);
    const bCode = iconBtn('code', 'Show HTML code (Ctrl+E)', () => showCode(!state.codeMode)); bCode.id = 'btn-code'; bCode.innerHTML += '<span class="lbl">Code</span>'; view.append(bCode);
    const bOut = iconBtn('outlines', 'Show element outlines (Ctrl+Shift+O)', toggleOutlines); bOut.id = 'btn-outlines'; view.append(bOut);
    view.append(iconBtn('panelLeft', 'Show/hide blocks panel (Ctrl+1)', () => togglePanel(blocksPanel)));
    view.append(iconBtn('panelRight', 'Show/hide properties panel (Ctrl+2)', () => togglePanel(propsPanel)));
    view.append(iconBtn('help', 'How does this work? (F1)', () => $('#dlg-help').showModal()));

    $('#ic-color').innerHTML = HE_ICONS.color;
    $('#ic-highlight').innerHTML = HE_ICONS.highlight;
    $('#text-color').addEventListener('input', (e) => exec('foreColor', e.target.value, true));
    $('#hilite-color').addEventListener('input', (e) => exec('hiliteColor', e.target.value, true));
    $$('.tb-color').forEach((l) => l.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }));

    $('#block-format').addEventListener('change', (e) => {
      const v = e.target.value;
      if (state.selected && TEXT_BLOCKS.includes(state.selected.tagName.toLowerCase()) && !VOID_LIKE.has(state.selected.tagName)) {
        changeTag(state.selected, v);
      } else {
        exec('formatBlock', '<' + v + '>');
      }
    });
    $('#font-size').addEventListener('change', (e) => {
      if (!e.target.value) return;
      exec('fontSize', e.target.value, true);
      e.target.value = '';
    });
  }

  function updateToolbarState() {
    const d = doc();
    if (!d) return;
    $$('#toolbar [data-cmd]').forEach((b) => {
      let on = false;
      try { on = d.queryCommandState(b.dataset.cmd); } catch {}
      b.classList.toggle('active', !!on);
    });
    const el = state.selected || elementFromSelection();
    const sel = $('#block-format');
    let block = el;
    while (block && block !== body() && !TEXT_BLOCKS.includes(block.tagName.toLowerCase())) block = block.parentElement;
    sel.value = block && block !== body() ? block.tagName.toLowerCase() : 'p';
    if (!sel.value) sel.value = 'p';
  }

  function togglePanel(panel) { panel.hidden = !panel.hidden; }

  function toggleOutlines() {
    state.outlines = !state.outlines;
    const b = body();
    if (b) b.toggleAttribute('data-he-outlines', state.outlines);
    $('#btn-outlines').classList.toggle('active', state.outlines);
  }

  function applyZoom() {
    frame.style.zoom = state.zoom;
    frame.style.width = (100 / state.zoom) + '%';
    frame.style.height = (100 / state.zoom) + '%';
    canvas.classList.toggle('zoomed', state.zoom !== 1);
  }
  function zoom(dir) {
    state.zoom = dir === 0 ? 1 : Math.min(3, Math.max(0.3, +(state.zoom + dir * 0.1).toFixed(2)));
    applyZoom();
    status(`Zoom ${Math.round(state.zoom * 100)}%`);
  }

  function showCode(on, { skipApply = false } = {}) {
    if (on === state.codeMode) return;
    state.codeMode = on;
    $('#btn-code').classList.toggle('active', on);
    codeWrap.hidden = !on;
    if (on) {
      state.codeSnapshot = getHtml();
      codeView.value = state.codeSnapshot;
      codeView.focus();
      codeView.setSelectionRange(0, 0);
      codeView.scrollTop = 0;
    } else if (!skipApply && codeView.value !== state.codeSnapshot) {
      status('Code changes applied');
      return loadDocument(codeView.value, state.path, { keepHistory: true, dirty: true });
    }
    return Promise.resolve();
  }

  // -------------------------------------------------------------------------
  // Inserting blocks
  // -------------------------------------------------------------------------
  function insertionPoint() {
    const b = body();
    if (state.pendingInsert) { const p = state.pendingInsert; state.pendingInsert = null; return p; }
    let ref = state.selected || elementFromSelection();
    if (!ref || ref === b) return { parent: b, before: null };
    while (ref.parentElement && ref.parentElement !== b && isInline(ref)) ref = ref.parentElement;
    const inside = ref.closest('td, th, li');
    if (inside && ref !== inside) ref = inside;
    // Never split table structure or lists: insert after the whole table / list.
    const wrap = ref.closest('table, ul, ol');
    if (wrap) ref = wrap;
    if (!ref.parentElement) return { parent: b, before: null };
    return { parent: ref.parentElement, before: ref.nextSibling };
  }

  function insertBlock(html) {
    const d = doc();
    if (!d) return null;
    const tpl = d.createElement('template');
    tpl.innerHTML = html.trim();
    const node = tpl.content.firstElementChild;
    if (!node) return null;
    const { parent, before } = insertionPoint();
    parent.insertBefore(node, before);
    // Select the most useful element: the inner link/image for wrapped blocks.
    let target = node;
    if (node.tagName === 'P' && node.children.length === 1 && ['A', 'IMG'].includes(node.children[0].tagName)) target = node.children[0];
    commit();
    selectElement(target, { placeCaret: !VOID_LIKE.has(target.tagName), scroll: true });
    return node;
  }

  function addBlock(id) {
    const blk = BLOCKS.find((b) => b.id === id);
    if (!blk) return;
    if (blk.dialog === 'image') return openImageDialog();
    if (blk.dialog === 'link') return openLinkDialog();
    if (blk.dialog === 'table') return openTableDialog();
    if (blk.dialog === 'video') return openVideoDialog();
    insertBlock(blk.html);
    status(`${blk.label} added`);
  }

  function buildBlocksPanel() {
    const list = $('#blocks-list');
    BLOCKS.forEach((blk) => {
      const card = document.createElement('div');
      card.className = 'block-card';
      card.draggable = true;
      card.innerHTML = `${HE_ICONS[blk.icon] || ''}<span>${blk.label}</span>`;
      card.title = `Click to add, or drag onto the page`;
      card.addEventListener('click', () => addBlock(blk.id));
      card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/he-block', blk.id); e.dataTransfer.effectAllowed = 'copy'; });
      list.append(card);
    });
    $('#btn-page-settings').addEventListener('click', openPageSettings);
    $('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
  }

  // Drop position: which top-level-ish block the pointer is over, and whether
  // we're above or below its middle.
  function dropPosition(x, y) {
    const d = doc();
    const b = body();
    let el = d.elementFromPoint(x, y);
    if (!el || el === d.documentElement || el === b) {
      // Below all content: append at the end of the body.
      return { parent: b, before: null, rect: null };
    }
    while (el.parentElement && el.parentElement !== b && (isInline(el) || /^(TD|TH|TR|TBODY|THEAD|TFOOT|LI)$/.test(el.tagName))) el = el.parentElement;
    const wrap = el.closest('table, ul, ol');
    if (wrap) el = wrap;
    const r = el.getBoundingClientRect();
    const after = y > r.top + r.height / 2;
    return { parent: el.parentElement, before: after ? el.nextSibling : el, rect: r, after };
  }

  function showDropIndicator(x, y) {
    const d = doc();
    const pos = dropPosition(x, y);
    let ind = d.getElementById('he-drop');
    if (!ind) { ind = d.createElement('div'); ind.id = 'he-drop'; ind.setAttribute('data-he-injected', ''); d.body.appendChild(ind); }
    if (pos.rect) {
      const sx = win().scrollX, sy = win().scrollY;
      ind.style.left = (pos.rect.left + sx) + 'px';
      ind.style.width = pos.rect.width + 'px';
      ind.style.top = ((pos.after ? pos.rect.bottom : pos.rect.top) + sy - 2) + 'px';
    } else {
      const last = body().lastElementChild;
      const r = last && last.id !== 'he-drop' ? last.getBoundingClientRect() : { left: 0, width: body().clientWidth, bottom: body().clientHeight };
      ind.style.left = (r.left + win().scrollX) + 'px';
      ind.style.width = r.width + 'px';
      ind.style.top = (r.bottom + win().scrollY + 4) + 'px';
    }
  }
  function hideDropIndicator() { const d = doc(); const ind = d && d.getElementById('he-drop'); if (ind) ind.remove(); }

  // -------------------------------------------------------------------------
  // Element operations
  // -------------------------------------------------------------------------
  function changeTag(el, tag) {
    const d = doc();
    const n = d.createElement(tag);
    Array.from(el.attributes).forEach((a) => n.setAttribute(a.name, a.value));
    while (el.firstChild) n.appendChild(el.firstChild);
    el.replaceWith(n);
    if (state.selected === el) state.selected = n;
    commit();
    selectElement(n);
    return n;
  }
  function deleteSelected() {
    const el = state.selected;
    if (!el) return;
    const next = el.nextElementSibling || el.previousElementSibling || (el.parentElement !== body() ? el.parentElement : null);
    el.remove();
    state.selected = null;
    if (!body().firstElementChild && !body().textContent.trim()) body().innerHTML = '<p><br></p>';
    commit();
    selectElement(next);
    status('Deleted');
  }
  function duplicateSelected() {
    const el = state.selected;
    if (!el) return;
    const copy = el.cloneNode(true);
    copy.removeAttribute('data-he-selected');
    el.after(copy);
    commit();
    selectElement(copy, { scroll: true });
    status('Duplicated');
  }
  function moveSelected(dir) {
    const el = state.selected;
    if (!el) return;
    const sib = dir < 0 ? el.previousElementSibling : el.nextElementSibling;
    if (!sib || sib.hasAttribute('data-he-injected')) return status('Nothing to swap with');
    if (dir < 0) sib.before(el); else sib.after(el);
    commit();
    selectElement(el, { scroll: true });
  }
  function selectParent() {
    const p = state.selected && state.selected.parentElement;
    if (p && p !== body()) selectElement(p);
  }

  // -------------------------------------------------------------------------
  // Properties panel
  // -------------------------------------------------------------------------
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const escapeAttr = esc;
  const normLen = (v) => (v && /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() + 'px' : v.trim());

  function makeField(label, control) {
    const f = document.createElement('div');
    f.className = 'field';
    if (label) { const l = document.createElement('label'); l.textContent = label; f.append(l); }
    f.append(control);
    return f;
  }
  function textField(label, value, onApply, { placeholder = '', type = 'text', number = false } = {}) {
    const i = document.createElement('input');
    i.type = number ? 'number' : type;
    i.value = value || '';
    i.placeholder = placeholder;
    i.addEventListener('input', () => onApply(i.value, false));
    i.addEventListener('change', () => { onApply(i.value, true); commit(); });
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); i.blur(); } });
    return makeField(label, i);
  }
  function styleField(label, prop, { placeholder = '' } = {}, transform = normLen, target = null) {
    const el = target || state.selected;
    const computed = (() => { try { return win().getComputedStyle(el)[prop]; } catch { return ''; } })();
    return textField(label, el.style[prop], (v) => { el.style[prop] = transform(v); }, { placeholder: placeholder || computed || '' });
  }
  function colorField(label, prop, target = null) {
    const el = target || state.selected;
    const wrap = document.createElement('div');
    wrap.className = 'color-field';
    const c = document.createElement('input'); c.type = 'color';
    const t = document.createElement('input'); t.type = 'text'; t.placeholder = 'e.g. #ff0000 or red';
    const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'btn small clear-btn'; clear.textContent = 'Clear'; clear.title = 'Remove this color';
    const cur = el.style[prop];
    t.value = cur;
    c.value = toHex(cur || (() => { try { return win().getComputedStyle(el)[prop]; } catch { return ''; } })());
    c.addEventListener('input', () => { el.style[prop] = c.value; t.value = c.value; });
    c.addEventListener('change', commit);
    t.addEventListener('change', () => { el.style[prop] = t.value; c.value = toHex(t.value); commit(); });
    clear.addEventListener('click', () => { el.style[prop] = ''; t.value = ''; commit(); });
    wrap.append(c, t, clear);
    return makeField(label, wrap);
  }
  function toHex(color) {
    if (!color) return '#000000';
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
    const m = String(color).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) return '#' + [m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('');
    try { const cv = document.createElement('canvas').getContext('2d'); cv.fillStyle = color; return /^#/.test(cv.fillStyle) ? cv.fillStyle : '#000000'; } catch { return '#000000'; }
  }
  function selectField(label, options, value, onChange) {
    const s = document.createElement('select');
    options.forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; s.append(o); });
    s.value = value;
    s.addEventListener('change', () => { onChange(s.value); commit(); });
    return makeField(label, s);
  }
  function checkField(label, checked, onChange) {
    const l = document.createElement('label'); l.className = 'check';
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = checked;
    c.addEventListener('change', () => { onChange(c.checked); commit(); });
    l.append(c, document.createTextNode(' ' + label));
    const f = document.createElement('div'); f.className = 'field'; f.append(l);
    return f;
  }
  function segField(label, options, current, onChange) {
    const seg = document.createElement('div'); seg.className = 'seg';
    options.forEach(([v, icon, title]) => {
      const b = document.createElement('button'); b.type = 'button'; b.title = title; b.innerHTML = HE_ICONS[icon] || v;
      b.classList.toggle('active', v === current);
      b.addEventListener('click', () => { onChange(v); commit(); renderProps(); });
      seg.append(b);
    });
    return makeField(label, seg);
  }
  function section(title, open = true) {
    const d = document.createElement('details'); d.className = 'props-section'; d.open = open;
    const s = document.createElement('summary'); s.textContent = title; d.append(s);
    return d;
  }
  function btnRow(buttons) {
    const r = document.createElement('div'); r.className = 'btn-row';
    buttons.forEach(([label, fn, cls = '']) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small ' + cls; b.textContent = label; b.addEventListener('click', () => { fn(); commit(); renderProps(); }); r.append(b); });
    return r;
  }

  function renderProps() {
    const el = state.selected;
    propsFields.innerHTML = '';
    elActions.innerHTML = '';
    if (!el || !body() || !body().contains(el)) { propsEl.hidden = true; propsEmpty.hidden = false; return; }
    propsEl.hidden = false; propsEmpty.hidden = true;
    propsLabel.textContent = labelFor(el);

    [['parent', 'Select the item around this one (Esc)', selectParent], ['up', 'Move up', () => moveSelected(-1)], ['down', 'Move down', () => moveSelected(1)],
     ['duplicate', 'Duplicate', duplicateSelected], ['trash', 'Delete', deleteSelected, 'danger']]
      .forEach(([icon, title, fn, cls]) => { const b = iconBtn(icon, title, fn, 'icon-btn ' + (cls || '')); b.classList.remove('tb-btn'); elActions.append(b); });

    const tag = el.tagName;
    const F = propsFields;

    // --- Element specific ----------------------------------------------------
    if (TEXT_BLOCKS.includes(tag.toLowerCase()) && tag !== 'DIV') {
      F.append(selectField('Text style', TEXT_BLOCKS.filter((t) => t !== 'div').map((t) => [t, LABELS[t.toUpperCase()]]), tag.toLowerCase(), (v) => changeTag(el, v)));
    }
    if (tag === 'A') {
      F.append(textField('Link address (URL)', el.getAttribute('href') || '', (v) => el.setAttribute('href', v), { placeholder: 'https://… or page.html or #section' }));
      F.append(checkField('Open in a new tab', el.target === '_blank', (on) => { if (on) { el.target = '_blank'; el.rel = 'noopener'; } else { el.removeAttribute('target'); el.removeAttribute('rel'); } }));
      if (!el.children.length) F.append(textField('Text', el.textContent, (v) => { el.textContent = v; }));
      F.append(btnRow([['Remove link (keep text)', () => { const p = el.parentElement; while (el.firstChild) el.before(el.firstChild); el.remove(); state.selected = null; selectElement(p !== body() ? p : null); }]]));
    }
    if (tag === 'BUTTON' && !el.children.length) F.append(textField('Text', el.textContent, (v) => { el.textContent = v; }));
    if (tag === 'IMG') {
      const wrap = document.createElement('div'); wrap.className = 'with-btn';
      const i = document.createElement('input'); i.type = 'text'; i.value = el.getAttribute('src') || ''; i.placeholder = 'picture.jpg or https://…';
      i.addEventListener('change', () => { el.setAttribute('src', i.value); commit(); });
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = 'Choose…';
      b.addEventListener('click', async () => { const r = await api.pickImage(state.path); if (r) { el.setAttribute('src', r.src); i.value = r.src; commit(); status(r.embedded ? 'Image embedded in the page (save the page first to link files instead)' : 'Image linked'); } });
      wrap.append(i, b);
      F.append(makeField('Image file', wrap));
      F.append(textField('Description (alt text)', el.getAttribute('alt') || '', (v) => el.setAttribute('alt', v), { placeholder: 'What is in the picture?' }));
      F.append(textField('Width', el.style.width || el.getAttribute('width') || '', (v) => { el.removeAttribute('width'); el.removeAttribute('height'); el.style.width = normLen(v); el.style.height = 'auto'; }, { placeholder: 'e.g. 300px or 50%' }));
      F.append(styleField('Rounded corners', 'borderRadius', { placeholder: 'e.g. 12px or 50%' }));
      const p = el.parentElement;
      if (p && p !== body() && !isInline(p)) {
        F.append(segField('Alignment', [['left', 'alignLeft', 'Left'], ['center', 'alignCenter', 'Center'], ['right', 'alignRight', 'Right']], p.style.textAlign || 'left', (v) => { p.style.textAlign = v === 'left' ? '' : v; }));
      }
    }
    if (tag === 'IFRAME') {
      F.append(textField('Video / embed address', el.getAttribute('data-he-src') || '', (v) => el.setAttribute('data-he-src', v)));
      F.append(btnRow([['Change video…', () => openVideoDialog(el)]]));
    }
    if (tag === 'HR') {
      F.append(styleField('Thickness', 'borderTopWidth', { placeholder: '1px' }));
      F.append(colorField('Line color', 'borderTopColor'));
    }
    if (tag === 'UL' || tag === 'OL' || tag === 'LI') {
      const list = tag === 'LI' ? el.closest('ul, ol') : el;
      if (list) F.append(selectField('List type', [['ul', 'Bullets'], ['ol', 'Numbers']], list.tagName.toLowerCase(), (v) => { const n = changeTag(list, v); if (tag === 'LI') selectElement(el); else selectElement(n); }));
    }
    if (['TABLE', 'TR', 'TD', 'TH', 'TBODY', 'THEAD', 'TFOOT'].includes(tag)) {
      const table = el.closest('table');
      const cell = el.closest('td, th');
      const sec = section('Table');
      sec.append(btnRow([
        ['+ Row above', () => tableAddRow(table, cell, -1)], ['+ Row below', () => tableAddRow(table, cell, 1)],
        ['+ Column left', () => tableAddCol(table, cell, -1)], ['+ Column right', () => tableAddCol(table, cell, 1)],
        ['Delete row', () => tableDelRow(table, cell), 'danger'], ['Delete column', () => tableDelCol(table, cell), 'danger'],
      ]));
      const hasBorders = table.style.borderCollapse === 'collapse' || $$('td, th', table).some((c) => c.style.border);
      sec.append(checkField('Show cell borders', hasBorders, (on) => tableBorders(table, on)));
      sec.append(styleField('Table width', 'width', { placeholder: 'e.g. 100%' }, normLen, table));
      F.append(sec);
    }

    // --- Appearance (every element) -----------------------------------------
    const app = section('Appearance');
    if (!VOID_LIKE.has(tag)) {
      app.append(segField('Text alignment', [['left', 'alignLeft', 'Left'], ['center', 'alignCenter', 'Center'], ['right', 'alignRight', 'Right'], ['justify', 'alignJustify', 'Justify']], el.style.textAlign || 'left', (v) => { el.style.textAlign = v === 'left' ? '' : v; }));
      app.append(colorField('Text color', 'color'));
    }
    app.append(colorField('Background color', 'backgroundColor'));
    if (!VOID_LIKE.has(tag)) {
      const row = document.createElement('div'); row.className = 'field-row';
      row.append(styleField('Text size', 'fontSize', { placeholder: 'e.g. 18px' }));
      row.append(selectField('Weight', [['', 'Normal'], ['bold', 'Bold'], ['300', 'Light']], el.style.fontWeight || '', (v) => { el.style.fontWeight = v; }));
      app.append(row);
      app.append(selectField('Font', [['', 'Inherit from page'], ['system-ui, sans-serif', 'Modern (system)'], ['Arial, Helvetica, sans-serif', 'Arial'], ['Georgia, serif', 'Georgia'], ['"Times New Roman", serif', 'Times New Roman'], ['Verdana, sans-serif', 'Verdana'], ['"Courier New", monospace', 'Courier']], el.style.fontFamily || '', (v) => { el.style.fontFamily = v; }));
    }
    F.append(app);

    // --- Spacing & size -------------------------------------------------------
    const sp = section('Spacing & size', false);
    const r1 = document.createElement('div'); r1.className = 'field-row';
    r1.append(styleField('Space inside (padding)', 'padding', { placeholder: 'e.g. 16px' }));
    r1.append(styleField('Space around (margin)', 'margin', { placeholder: 'e.g. 16px' }));
    sp.append(r1);
    const r2 = document.createElement('div'); r2.className = 'field-row';
    r2.append(styleField('Width', 'width', { placeholder: 'auto' }));
    r2.append(styleField('Height', 'height', { placeholder: 'auto' }));
    sp.append(r2);
    const r3 = document.createElement('div'); r3.className = 'field-row';
    r3.append(styleField('Rounded corners', 'borderRadius', { placeholder: '0' }));
    r3.append(styleField('Border', 'border', { placeholder: 'e.g. 1px solid #ccc' }, (v) => v.trim()));
    sp.append(r3);
    F.append(sp);

    // --- Advanced -------------------------------------------------------------
    const adv = section('Advanced', false);
    adv.append(textField('ID', el.id, (v) => { if (v) el.id = v; else el.removeAttribute('id'); }));
    adv.append(textField('CSS classes', el.getAttribute('class') || '', (v) => { if (v.trim()) el.setAttribute('class', v); else el.removeAttribute('class'); }));
    const ta = document.createElement('textarea'); ta.value = el.getAttribute('style') || ''; ta.placeholder = 'color: red; font-size: 20px;';
    ta.addEventListener('change', () => { if (ta.value.trim()) el.setAttribute('style', ta.value); else el.removeAttribute('style'); commit(); renderProps(); });
    adv.append(makeField('Custom style (CSS)', ta));
    F.append(adv);
  }

  // Table helpers ------------------------------------------------------------
  function tableCellIndex(cell) { return cell ? Array.from(cell.parentElement.children).indexOf(cell) : 0; }
  function tableAddRow(table, cell, dir) {
    const row = cell ? cell.parentElement : (dir < 0 ? table.rows[0] : table.rows[table.rows.length - 1]);
    if (!row) return;
    const n = row.cloneNode(true);
    Array.from(n.cells).forEach((c) => { const td = doc().createElement('td'); td.setAttribute('style', c.getAttribute('style') || ''); td.innerHTML = '<br>'; c.replaceWith(td); });
    if (dir < 0) row.before(n); else row.after(n);
  }
  function tableAddCol(table, cell, dir) {
    const idx = tableCellIndex(cell);
    Array.from(table.rows).forEach((r) => {
      const ref = r.cells[Math.min(idx, r.cells.length - 1)];
      if (!ref) return;
      const c = doc().createElement(ref.tagName.toLowerCase());
      c.setAttribute('style', ref.getAttribute('style') || '');
      c.innerHTML = '<br>';
      if (dir < 0) ref.before(c); else ref.after(c);
    });
  }
  function tableDelRow(table, cell) {
    const row = cell ? cell.parentElement : table.rows[table.rows.length - 1];
    if (!row) return;
    if (table.rows.length <= 1) { table.remove(); state.selected = null; return; }
    row.remove(); state.selected = table;
  }
  function tableDelCol(table, cell) {
    const idx = tableCellIndex(cell);
    if (table.rows[0] && table.rows[0].cells.length <= 1) { table.remove(); state.selected = null; return; }
    Array.from(table.rows).forEach((r) => { if (r.cells[idx]) r.cells[idx].remove(); });
    state.selected = table;
  }
  function tableBorders(table, on) {
    table.style.borderCollapse = on ? 'collapse' : '';
    $$('td, th', table).forEach((c) => { c.style.border = on ? '1px solid #cbd5e1' : ''; if (on && !c.style.padding) c.style.padding = '8px'; });
  }

  // -------------------------------------------------------------------------
  // Breadcrumb
  // -------------------------------------------------------------------------
  function renderBreadcrumb() {
    breadcrumb.innerHTML = '';
    const b = body();
    if (!b) return;
    const chain = [];
    let el = state.selected;
    while (el && el !== b) { chain.unshift(el); el = el.parentElement; }
    const pageBtn = document.createElement('button'); pageBtn.textContent = 'Page';
    pageBtn.addEventListener('click', () => selectElement(null));
    breadcrumb.append(pageBtn);
    chain.forEach((node, i) => {
      const sep = document.createElement('span'); sep.className = 'crumb-sep'; sep.textContent = '›';
      const btn = document.createElement('button'); btn.textContent = labelFor(node);
      if (i === chain.length - 1) btn.className = 'current';
      btn.addEventListener('click', () => selectElement(node, { scroll: true }));
      breadcrumb.append(sep, btn);
    });
  }

  // -------------------------------------------------------------------------
  // Dialogs
  // -------------------------------------------------------------------------
  function wireDialogClose() {
    $$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close('cancel')));
  }

  function openLinkDialog() {
    const dlg = $('#dlg-link'), form = $('#form-link');
    const d = doc();
    const sel = d && d.getSelection();
    const existing = state.selected && state.selected.tagName === 'A' ? state.selected : null;
    const selectedText = sel && !sel.isCollapsed ? sel.toString() : '';
    form.text.value = existing ? existing.textContent : selectedText;
    form.href.value = existing ? existing.getAttribute('href') || '' : '';
    form.blank.checked = existing ? existing.target === '_blank' : false;
    form.text.disabled = !!selectedText && !existing;
    const savedRange = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const href = form.href.value.trim();
      const text = form.text.value.trim() || href;
      if (!href) return;
      if (existing) {
        existing.setAttribute('href', href);
        if (form.blank.checked) { existing.target = '_blank'; existing.rel = 'noopener'; } else { existing.removeAttribute('target'); existing.removeAttribute('rel'); }
        if (!existing.children.length && form.text.value.trim()) existing.textContent = form.text.value.trim();
        commit(); renderProps();
      } else if (savedRange && !savedRange.collapsed && d.body.contains(savedRange.commonAncestorContainer)) {
        win().focus();
        const s = d.getSelection(); s.removeAllRanges(); s.addRange(savedRange);
        d.execCommand('createLink', false, href);
        const a = elementFromSelection() && elementFromSelection().closest('a');
        if (a && form.blank.checked) { a.target = '_blank'; a.rel = 'noopener'; }
        commit();
      } else if (savedRange && d.body.contains(savedRange.commonAncestorContainer) && !state.pendingInsert) {
        win().focus();
        const s = d.getSelection(); s.removeAllRanges(); s.addRange(savedRange);
        d.execCommand('insertHTML', false, `<a href="${esc(href)}"${form.blank.checked ? ' target="_blank" rel="noopener"' : ''}>${esc(text)}</a>`);
        commit();
      } else {
        insertBlock(`<p><a href="${esc(href)}"${form.blank.checked ? ' target="_blank" rel="noopener"' : ''}>${esc(text)}</a></p>`);
      }
      status('Link added');
    };
    dlg.showModal();
    form.href.focus();
  }

  function openImageDialog(existing = null) {
    const dlg = $('#dlg-image-url'), form = $('#form-image-url');
    form.src.value = existing ? existing.getAttribute('src') || '' : '';
    form.alt.value = existing ? existing.getAttribute('alt') || '' : '';
    const apply = (src, alt) => {
      if (existing) { existing.setAttribute('src', src); existing.setAttribute('alt', alt); commit(); renderProps(); }
      else insertBlock(`<p><img src="${esc(src)}" alt="${esc(alt)}" style="max-width:100%;height:auto"></p>`);
      status('Image added');
    };
    $('#img-from-file').onclick = async () => {
      const r = await api.pickImage(state.path);
      if (!r) return;
      dlg.close('file');
      apply(r.src, form.alt.value.trim() || r.name.replace(/\.[^.]+$/, ''));
      if (r.embedded) status('Image embedded in the page. Save the page first if you prefer linking to the file.', 6000);
    };
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const src = form.src.value.trim();
      if (src) apply(src, form.alt.value.trim());
    };
    dlg.showModal();
  }

  function openTableDialog() {
    const dlg = $('#dlg-table'), form = $('#form-table');
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const rows = Math.max(1, +form.rows.value || 3), cols = Math.max(1, +form.cols.value || 3);
      const cellStyle = 'border:1px solid #cbd5e1;padding:8px;';
      let html = '<table style="border-collapse:collapse;width:100%;margin:16px 0">';
      for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) {
          const th = form.header.checked && r === 0;
          html += th ? `<th style="${cellStyle}background:#f1f5f9;text-align:left">Heading ${c + 1}</th>` : `<td style="${cellStyle}">${th ? '' : 'Cell'}</td>`;
        }
        html += '</tr>';
      }
      html += '</table>';
      const t = insertBlock(html);
      if (t) selectElement(t.querySelector('td, th'), { placeCaret: true });
      status('Table added');
    };
    dlg.showModal();
  }

  function embedUrl(url) {
    const u = url.trim();
    let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}`;
    m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (m) return `https://player.vimeo.com/video/${m[1]}`;
    return /^https?:\/\//.test(u) ? u : null;
  }

  function openVideoDialog(existing = null) {
    const dlg = $('#dlg-video'), form = $('#form-video');
    form.url.value = existing ? existing.getAttribute('data-he-src') || '' : '';
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      const src = embedUrl(form.url.value);
      if (!src) return status('That does not look like a valid video link', 5000);
      if (existing) { existing.setAttribute('data-he-src', src); commit(); renderProps(); return; }
      const node = insertBlock(`<div style="position:relative;padding-top:56.25%;margin:16px 0"><iframe data-he-src="${esc(src)}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0" allowfullscreen allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"></iframe></div>`);
      if (node) selectElement(node.querySelector('iframe'));
      status('Video added');
    };
    dlg.showModal();
    form.url.focus();
  }

  function openPageSettings() {
    const d = doc();
    if (!d) return;
    const dlg = $('#dlg-page'), form = $('#form-page');
    const cs = win().getComputedStyle(d.body);
    form.title.value = d.title || '';
    form.lang.value = d.documentElement.getAttribute('lang') || '';
    form.bg.value = toHex(d.body.style.backgroundColor || cs.backgroundColor);
    form.fg.value = toHex(d.body.style.color || cs.color);
    form.font.value = '';
    const origBg = form.bg.value, origFg = form.fg.value;
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return;
      d.title = form.title.value.trim();
      if (form.lang.value.trim()) d.documentElement.setAttribute('lang', form.lang.value.trim());
      if (form.bg.value !== origBg) d.body.style.backgroundColor = form.bg.value;
      if (form.fg.value !== origFg) d.body.style.color = form.fg.value;
      if (form.font.value) d.body.style.fontFamily = form.font.value;
      commit();
      setDirty(true); // title/lang live in <head>, outside the undo snapshot
      status('Page settings applied');
    };
    dlg.showModal();
  }

  function buildTemplateDialog() {
    const grid = $('#template-grid');
    HE_TEMPLATES.forEach((t) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'template-card';
      card.innerHTML = `<div class="swatch" style="background:${t.accent}"><div style="width:100%"><i style="width:70%"></i><i style="width:45%"></i><i style="width:60%"></i></div></div><div class="tc-body"><span class="tc-name">${esc(t.name)}</span><span class="tc-desc">${esc(t.description)}</span></div>`;
      card.addEventListener('click', () => { $('#dlg-new').close('template'); loadDocument(t.html, null); status(`New page from "${t.name}"`); });
      grid.append(card);
    });
    $('#dlg-new-open').addEventListener('click', () => { $('#dlg-new').close('open'); openFile(true); });
  }

  // -------------------------------------------------------------------------
  // Find
  // -------------------------------------------------------------------------
  function findBar(show) {
    const bar = $('#find-bar');
    bar.hidden = !show;
    if (show) { $('#find-input').focus(); $('#find-input').select(); }
  }
  function findNext(backwards = false) {
    const q = $('#find-input').value;
    if (!q || !win()) return;
    const found = win().find(q, false, backwards, true, false, true, false);
    if (!found) status('Not found');
    else { const el = elementFromSelection(); if (el) selectElement(el); }
  }

  // -------------------------------------------------------------------------
  // File operations
  // -------------------------------------------------------------------------
  async function confirmDiscard() {
    if (!state.dirty) return true;
    const r = await api.showMessage({ type: 'question', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2, title: 'Unsaved changes', message: 'This page has unsaved changes.', detail: 'Do you want to save them first?' });
    if (r === 0) return save(false);
    return r === 1;
  }
  async function newPage() {
    if (!(await confirmDiscard())) return;
    $('#dlg-new').showModal();
  }
  async function openFile(skipConfirm = false) {
    if (!skipConfirm && !(await confirmDiscard())) return;
    const r = await api.openFile();
    if (r) { loadDocument(r.content, r.path); status(`Opened ${r.path}`); }
  }
  async function save(saveAs) {
    const wasCode = state.codeMode;
    if (wasCode) await showCode(false);
    commit();
    const html = getHtml();
    if (!html) return false;
    const hadPath = !!state.path;
    const r = await api.saveFile(saveAs ? null : state.path, html);
    if (!r) return false;
    state.path = r.path;
    if (!hadPath) {
      // Now that the page has a home, resolve relative images against it.
      const d = doc();
      if (d && !d.querySelector('base[href]')) { const base = d.createElement('base'); base.href = dirUrl(); base.setAttribute('data-he-injected', ''); d.head.insertBefore(base, d.head.firstChild); }
    }
    setDirty(false);
    api.setTitle(fileName());
    status(`Saved ${r.path}`);
    if (wasCode) showCode(true);
    return true;
  }
  async function preview() {
    if (state.codeMode) { await showCode(false); showCode(true); }
    const html = getHtml();
    if (!html) return;
    await api.previewInBrowser(html, state.path);
    status('Opened in your browser');
  }

  // -------------------------------------------------------------------------
  // Menu / keyboard wiring
  // -------------------------------------------------------------------------
  function handleMenu(action, payload) {
    switch (action) {
      case 'new': return newPage();
      case 'open': return openFile();
      case 'save': return save(false);
      case 'save-as': return save(true);
      case 'preview': return preview();
      case 'undo': return undo();
      case 'redo': return redo();
      case 'find': return findBar(true);
      case 'page-settings': return openPageSettings();
      case 'insert': return payload === 'image' ? openImageDialog() : addBlock(payload);
      case 'toggle-blocks': return togglePanel(blocksPanel);
      case 'toggle-props': return togglePanel(propsPanel);
      case 'toggle-code': return showCode(!state.codeMode);
      case 'toggle-outlines': return toggleOutlines();
      case 'zoom': return zoom(payload);
      case 'help': return $('#dlg-help').showModal();
      case 'shortcuts': return $('#dlg-shortcuts').showModal();
      default: return undefined;
    }
  }

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTextInput(e.target)) { e.preventDefault(); undo(); }
    if (((mod && e.shiftKey && e.key.toLowerCase() === 'z') || (mod && e.key.toLowerCase() === 'y')) && !isTextInput(e.target)) { e.preventDefault(); redo(); }
    if (e.key === 'Escape' && !$('#find-bar').hidden) findBar(false);
  });
  const isTextInput = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');

  // -------------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------------
  function init() {
    buildToolbar();
    buildBlocksPanel();
    buildTemplateDialog();
    wireDialogClose();
    codeView.addEventListener('input', () => { if (!state.dirty) setDirty(true); });
    $('#find-close').innerHTML = HE_ICONS.close;
    $('#find-close').addEventListener('click', () => findBar(false));
    $('#find-next').addEventListener('click', () => findNext(false));
    $('#find-prev').addEventListener('click', () => findNext(true));
    $('#find-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey); } });

    api.onMenuAction(handleMenu);
    api.onSaveAndClose(async () => { if (await save(false)) api.closeNow(); });
    api.onFileOpenedExternally(async (d) => { if (d && (await confirmDiscard())) { loadDocument(d.content, d.path); status(`Opened ${d.path}`); } });

    api.rendererReady().then((initial) => {
      if (initial) { loadDocument(initial.content, initial.path); status(`Opened ${initial.path}`); }
      else { loadDocument(HE_TEMPLATES[0].html, null); $('#dlg-new').showModal(); }
    });
  }

  // Exposed for the automated smoke test only.
  window.__he = { state, getHtml, loadDocument, insertBlock, addBlock, selectElement, undo, redo, commit, bodyHtml, changeTag, deleteSelected, save, showCode, embedUrl, BLOCKS };

  init();
})();
