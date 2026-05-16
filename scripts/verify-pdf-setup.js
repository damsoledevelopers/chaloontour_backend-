const fs = require('fs');
const path = require('path');
const { resolveChromeExecutable, renderPdfFromHtml } = require('../lib/chromePdf');
const { buildTourQuotationHtml } = require('../lib/tourQuotationHtml');

async function main() {
  const chromePath = resolveChromeExecutable();
  console.log('Chrome path:', chromePath || '(not found)');
  console.log('Chrome exists:', chromePath ? fs.existsSync(chromePath) : false);

  const publicDir = path.join(__dirname, '..', 'public');
  for (const name of ['chalo-on-tour-e1766686260447.png', 'Chalo-on-tour.jpg.jpeg']) {
    const p = path.join(publicDir, name);
    console.log(`Asset ${name}:`, fs.existsSync(p) ? 'OK' : 'MISSING');
  }

  if (!chromePath) {
    console.error('\nFAIL: Install Chrome with: npm run setup:pdf');
    process.exit(1);
  }

  const html = buildTourQuotationHtml(
    {
      packageName: 'Kashmir Tour',
      perPersonCost: '25000',
      totalPax: '4',
      tourDuration: '5 Nights 6 Days',
      destinations: 'Srinagar, Gulmarg'
    },
    {}
  );

  const { pdfBuffer } = await renderPdfFromHtml({ html, timeoutMs: 90000 });
  const out = path.join(__dirname, '..', 'test-output-verify.pdf');
  fs.writeFileSync(out, pdfBuffer);
  console.log('\nOK: Wrote', out, `(${pdfBuffer.length} bytes)`);
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});
