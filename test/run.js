// Runs the smoke test inside Electron. Uses xvfb-run automatically when there
// is no display (CI / headless servers).
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const electron = require('electron'); // path to the binary
const smoke = path.join(__dirname, 'smoke.js');
const tmp = path.join(__dirname, 'tmp');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

// A sample page with the things that need round-tripping: head scripts,
// relative images, an embedded video, inline styles.
const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
fs.writeFileSync(path.join(tmp, 'dot.png'), png1x1);
fs.writeFileSync(path.join(tmp, 'sample.html'), `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Sample page</title>
<style>body { font-family: sans-serif; } .note { color: rebeccapurple; }</style>
<script>window.__pageScriptRan = true; document.title = 'HACKED';</script>
</head>
<body>
<h1 id="title">Hello world</h1>
<p class="note">Some <strong>bold</strong> text and a <a href="https://example.com">link</a>.</p>
<p><img src="dot.png" alt="A dot" width="1" height="1"></p>
<ul><li>One</li><li>Two</li></ul>
<div style="position:relative;padding-top:56.25%"><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div>
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
</body>
</html>
`);

const args = ['--no-sandbox', '--disable-gpu', smoke, path.join(tmp, 'sample.html')];
let cmd = electron;
if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  args.unshift('-a', electron);
  cmd = 'xvfb-run';
}
const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, ELECTRON_ENABLE_LOGGING: '' } });
process.exit(r.status === null ? 1 : r.status);
