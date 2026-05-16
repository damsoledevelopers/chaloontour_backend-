const fs = require('fs');
const path = require('path');
const { buildTourQuotationHtml } = require('./tourQuotationHtml');
const { renderPdfFromHtml } = require('./puppeteerPdf');
const { mapLeadToQuotationData } = require('./leadToQuotationData');
const {
  resolvePdfOutputPath,
  sanitizePdfFileName,
  resolveImageToDataUri,
  getLogoDataUri,
  TRANSPARENT_PIXEL
} = require('./pdfAssets');

const logFile = path.join(__dirname, '../pdf-debug.log');

function logPdf(msg) {
  const entry = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  try {
    fs.appendFileSync(logFile, `${entry}\n`);
  } catch (_) {}
}

async function embedQuotationImageData(data, options = {}) {
  const imageOpts = { apiBaseUrl: options.apiBaseUrl, timeoutMs: 10000 };
  const [heroMain, heroSub1, heroSub2] = await Promise.all([
    resolveImageToDataUri(data.heroMain, imageOpts),
    resolveImageToDataUri(data.heroSub1, imageOpts),
    resolveImageToDataUri(data.heroSub2, imageOpts)
  ]);
  const fallback = getLogoDataUri() || TRANSPARENT_PIXEL;
  return {
    ...data,
    heroMain: heroMain || fallback,
    heroSub1: heroSub1 || fallback,
    heroSub2: heroSub2 || fallback
  };
}

async function buildQuotationHtmlForLead(lead, options = {}) {
  const mapped = mapLeadToQuotationData(lead);
  const merged = { ...mapped, ...(options.data || {}) };
  const withImages = await embedQuotationImageData(merged, options);
  return buildTourQuotationHtml(withImages, {
    logoDataUri: getLogoDataUri()
  });
}

async function generateAndSaveLeadPdf(lead, options = {}) {
  const leadKey = lead.leadId || lead._id?.toString?.() || 'lead';
  const fileNameBase =
    options.fileName ||
    lead.packageName?.trim() ||
    `Tour-Quotation-${leadKey}`;

  logPdf(`generateAndSaveLeadPdf: lead=${lead._id}, fileNameBase=${fileNameBase}`);

  let html;
  try {
    html = await buildQuotationHtmlForLead(lead, options);
    logPdf(`HTML built (${html.length} chars)`);
  } catch (err) {
    logPdf(`HTML build failed: ${err.message}\n${err.stack || ''}`);
    throw err;
  }

  let pdfBuffer;
  try {
    ({ pdfBuffer } = await renderPdfFromHtml({ html, timeoutMs: options.timeoutMs || 90000 }));
    logPdf(`PDF buffer size: ${pdfBuffer.length} bytes`);
  } catch (err) {
    logPdf(`Puppeteer PDF failed: ${err.message}\n${err.stack || ''}`);
    throw err;
  }

  const { fullPath, relativePath, fileName } = resolvePdfOutputPath(lead._id, fileNameBase);
  fs.writeFileSync(fullPath, pdfBuffer);

  const pdfMeta = {
    fileName,
    relativePath,
    generatedAt: new Date()
  };

  logPdf(`PDF saved: ${relativePath}`);
  return { pdfMeta, fullPath, pdfBuffer };
}

async function renderQuotationPdfPreview(data, options = {}) {
  const withImages = await embedQuotationImageData(data || {}, options);
  const html = buildTourQuotationHtml(withImages, { logoDataUri: getLogoDataUri() });
  const { pdfBuffer } = await renderPdfFromHtml({ html, timeoutMs: options.timeoutMs || 90000 });
  return pdfBuffer;
}

module.exports = {
  buildQuotationHtmlForLead,
  embedQuotationImageData,
  generateAndSaveLeadPdf,
  renderQuotationPdfPreview,
  sanitizePdfFileName
};
