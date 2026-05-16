const fs = require('fs');
const path = require('path');

function fileExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch (_) {
    return false;
  }
}

function resolveChromeExecutable() {
  const envCandidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN
  ]
    .map((v) => (v || '').trim())
    .filter(Boolean);

  for (const p of envCandidates) {
    if (fileExists(p)) return p;
  }

  try {
    const puppeteer = require('puppeteer');
    const bundled = puppeteer.executablePath?.();
    if (fileExists(bundled)) return bundled;
  } catch (_) {}

  const platform = process.platform;
  const candidates = [];

  if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else if (platform === 'win32') {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    candidates.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local ? path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe') : ''
    );
  } else {
    candidates.push(
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
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

function isProductionLinux() {
  return (
    process.env.NODE_ENV === 'production' ||
    !!process.env.RENDER ||
    !!process.env.RENDER_SERVICE_ID ||
    (process.platform === 'linux' && process.env.NODE_ENV !== 'development')
  );
}

/**
 * Local dev: full puppeteer (bundled Chrome).
 * Production (Render/Linux): puppeteer-core + @sparticuz/chromium, or PUPPETEER_EXECUTABLE_PATH.
 */
async function launchPuppeteerBrowser() {
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ];

  const envExecutable = resolveChromeExecutable();
  if (envExecutable) {
    const puppeteerCore = require('puppeteer-core');
    return puppeteerCore.launch({
      executablePath: envExecutable,
      headless: true,
      args: launchArgs
    });
  }

  if (isProductionLinux()) {
    try {
      const chromium = require('@sparticuz/chromium');
      const puppeteerCore = require('puppeteer-core');
      return puppeteerCore.launch({
        args: [...chromium.args, ...launchArgs],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless
      });
    } catch (err) {
      console.warn('[@sparticuz/chromium] unavailable, falling back to puppeteer:', err.message);
    }
  }

  const puppeteer = require('puppeteer');
  return puppeteer.launch({
    headless: true,
    args: launchArgs
  });
}

async function renderPdfFromHtml({ html, timeoutMs = 90000 }) {
  if (!html || !String(html).trim()) {
    throw new Error('HTML content is empty.');
  }

  let browser;
  try {
    browser = await launchPuppeteerBrowser();
    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });

    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      timeout: timeoutMs
    });

    const pdfBuffer = Buffer.from(pdfBytes);
    if (!pdfBuffer.length) {
      throw new Error('PDF generation produced an empty file.');
    }

    return { pdfBuffer };
  } catch (err) {
    const msg = err?.message || String(err);
    const needsChrome =
      /Could not find|Failed to launch|ENOENT|no usable sandbox|Browser was not found/i.test(msg);
    const hint = needsChrome ? ' Run: npm run setup:pdf (local) or set PUPPETEER_EXECUTABLE_PATH / use @sparticuz/chromium on Render.' : '';
    throw new Error(`PDF generation failed: ${msg}${hint}`);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
  }
}

module.exports = {
  launchPuppeteerBrowser,
  renderPdfFromHtml,
  resolveChromeExecutable
};
