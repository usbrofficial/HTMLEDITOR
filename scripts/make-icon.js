// Renders build/icon.svg to build/icon.png (512x512) using a headless browser.
// Requires Playwright (globally or locally installed). The PNG is committed, so
// this only needs to be re-run when the SVG changes.
'use strict';
const path = require('path');
const fs = require('fs');

async function main() {
  let playwright;
  try { playwright = require('playwright'); } catch { playwright = require('/opt/node22/lib/node_modules/playwright'); }
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.svg'), 'utf8');
  const browser = await playwright.chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: path.join(__dirname, '..', 'build', 'icon.png'), omitBackground: true });
  await browser.close();
  console.log('build/icon.png written');
}
main().catch((e) => { console.error(e); process.exit(1); });
