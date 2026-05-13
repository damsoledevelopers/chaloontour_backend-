const fs = require('fs');
const path = require('path');
const { buildTourSummaryHtml } = require('./tourSummaryHtml');
const { renderPdfFromHtml } = require('./chromePdf');

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

async function buildTourSummaryPdf(lead, res, options = {}) {
  logLine(`buildTourSummaryPdf started for lead: ${lead._id}`);
  const html = buildTourSummaryHtml(lead, options);
  logLine('HTML built');

  try {
    const { pdfBuffer, chromePath } = renderPdfFromHtml({ html, windowSize: '794,1123', timeoutMs: 30000 });
    logLine(`PDF generated successfully, size: ${pdfBuffer.length} bytes (chrome=${chromePath})`);

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
