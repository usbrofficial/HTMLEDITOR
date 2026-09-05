// Some environments install npm packages with lifecycle scripts disabled,
// which leaves the Electron package without its binary. This script makes
// sure the binary is present so `npm start` works out of the box.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const electronDir = path.join(__dirname, '..', 'node_modules', 'electron');
const pathTxt = path.join(electronDir, 'path.txt');

if (!fs.existsSync(electronDir)) process.exit(0); // nothing to do (production install)
if (fs.existsSync(pathTxt)) process.exit(0);

console.log('[htmleditor] Electron binary missing, downloading...');
const r = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' });
process.exit(r.status || 0);
