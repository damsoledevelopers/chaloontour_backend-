/**
 * Ensures Puppeteer's Chrome exists after npm install (local + VPS).
 * Skips quietly when puppeteer is missing or install fails (deploy may retry).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function chromeReady() {
  try {
    const puppeteer = require('puppeteer');
    const p = puppeteer.executablePath?.();
    return p && fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

if (chromeReady()) {
  console.log('[postinstall-pdf] Puppeteer Chrome already installed.');
  process.exit(0);
}

console.log('[postinstall-pdf] Installing Puppeteer Chrome (one-time download)...');
const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['puppeteer', 'browsers', 'install', 'chrome'],
  {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  }
);

if (result.status !== 0) {
  console.warn('[postinstall-pdf] Chrome install failed; run manually: npm run setup:pdf');
  process.exit(0);
}

console.log('[postinstall-pdf] Puppeteer Chrome installed.');
