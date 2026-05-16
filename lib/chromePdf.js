const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

function fileExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

function resolveChromeExecutable() {
  const envCandidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH
  ]
    .map((v) => (v || '').trim())
    .filter(Boolean);

  for (const p of envCandidates) {
    if (fileExists(p)) return p;
  }

  // Try puppeteer bundled Chrome (recommended fallback in server envs)
  try {
    // eslint-disable-next-line global-require
    const puppeteer = require('puppeteer');
    const p = puppeteer.executablePath?.();
    if (fileExists(p)) return p;
  } catch (_) {}

  const platform = process.platform;
  const candidates = [];

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else if (platform === 'win32') {
    const pf = process.env['PROGRAMFILES'] || 'C:\\\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] || '';
    candidates.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : ''
    );
  } else {
    // linux
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium'
    );
  }

  for (const p of candidates) {
    if (fileExists(p)) return p;
  }

  return '';
}

function writeTempFile(prefix, ext, content) {
  const dir = os.tmpdir();
  const name = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function createTempPath(prefix, ext) {
  const dir = os.tmpdir();
  const name = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
  return path.join(dir, name);
}

function renderPdfFromHtml({ html, windowSize = '794,1123', timeoutMs = 30000 }) {
  const chromePath = resolveChromeExecutable();
  if (!chromePath) {
    throw new Error(
      'No Chrome/Chromium executable found. Set CHROME_PATH (or install Chrome) and retry.'
    );
  }

  const htmlFilePath = writeTempFile('cot-html', 'html', html);
  const pdfFilePath = createTempPath('cot-pdf', 'pdf');
  const fileUrl = pathToFileURL(htmlFilePath).href;

  const args = [
    '--headless',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-crash-reporter',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--run-all-compositor-stages-before-draw',
    '--print-to-pdf-no-header',
    `--print-to-pdf=${pdfFilePath}`,
    `--window-size=${windowSize}`,
    fileUrl
  ];

  const env = { ...process.env };
  if (process.platform !== 'win32') {
    env.HOME = os.tmpdir();
    env.DBUS_SESSION_BUS_ADDRESS = '/dev/null';
  }

  try {
    spawnSync(chromePath, args, {
      timeout: timeoutMs,
      env,
      stdio: 'ignore',
      windowsHide: true
    });

    if (!fileExists(pdfFilePath)) {
      throw new Error('Chrome failed to create PDF.');
    }

    return { pdfBuffer: fs.readFileSync(pdfFilePath), chromePath };
  } finally {
    try { fs.unlinkSync(htmlFilePath); } catch (_) {}
    try { fs.unlinkSync(pdfFilePath); } catch (_) {}
  }
}

module.exports = { resolveChromeExecutable, renderPdfFromHtml };

