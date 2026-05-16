const fs = require('fs');
const path = require('path');
const { buildTourSummaryHtml } = require('./tourSummaryHtml');
const { renderPdfFromHtml } = require('./puppeteerPdf');
const { resolveImageToDataUri } = require('./pdfAssets');

// ============================================================
// PDF Generation — uses Chrome's --print-to-pdf via shell.
// Replicates the exact command that works in the terminal.
// NO Puppeteer. NO IPC pipes. Just a shell command.
// ============================================================

const logFile = path.join(__dirname, '../pdf-debug.log');
const logLine = (msg) => {
  try {
    const entry = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(logFile, entry);
    console.log(msg);
  } catch (e) {
    console.error('Logging failed:', e.message);
  }
};

async function embedLeadTripImages(lead, options = {}) {
  const images = Array.isArray(lead?.tripImages) ? lead.tripImages.filter(Boolean).slice(0, 3) : [];
  if (!images.length) return lead;
  const embedded = await Promise.all(
    images.map((img) =>
      resolveImageToDataUri(img, { apiBaseUrl: options.apiBaseUrl, timeoutMs: 10000 })
    )
  );
  return { ...lead, tripImages: embedded.filter(Boolean) };
}

async function buildTourSummaryPdf(lead, res, options = {}) {
  logLine(`buildTourSummaryPdf started for lead: ${lead._id}`);
  const leadWithImages = await embedLeadTripImages(lead, options);
  const html = buildTourSummaryHtml(leadWithImages, options);
  logLine('HTML built');

  try {
    const { pdfBuffer } = await renderPdfFromHtml({ html, timeoutMs: 90000 });
    logLine(`PDF generated successfully, size: ${pdfBuffer.length} bytes`);

    const leadId = lead?.leadId || lead?._id?.toString?.() || 'lead';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="tour-summary-${leadId}.pdf"`);
    res.send(pdfBuffer);
    logLine('PDF sent to client');
  } catch (err) {
    logLine(`FATAL PDF error: ${err.message}`);
    throw err;
  }
}

module.exports = { buildTourSummaryPdf };
