/**
 * Quick local PDF smoke test (no DB).
 * Usage: node scripts/test-pdf-local.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { renderQuotationPdfPreview } = require('../lib/leadPdfService');
const { getLogoDataUri, buildLogoCandidates, resolveFirstExistingFile } = require('../lib/pdfAssets');

async function main() {
  const logoPath = resolveFirstExistingFile(buildLogoCandidates());
  console.log('Logo file:', logoPath || '(none — run npm run copy:pdf-assets)');
  console.log('Logo data URI length:', getLogoDataUri().length);

  const sampleData = {
    packageName: 'Test Kashmir Trip',
    destinations: 'Srinagar, Gulmarg',
    perPersonCost: '25000',
    totalPax: '4 Adults',
    vehicleType: 'Innova',
    hotelCategory: '3-Star',
    mealPlan: 'MAP',
    tourDuration: '4 Nights / 5 Days',
    tourDateFrom: '01/06/2026',
    tourDateTo: '05/06/2026',
    pickupPoint: 'Srinagar Airport',
    dropPoint: 'Srinagar Airport',
    hotels: [{ name: 'Sample Hotel', nights: '2 Nights', roomCategory: 'Deluxe', roomSharing: 'Double', destination: 'Srinagar' }],
    itinerary: [{ dayLabel: 'Day 1', date: '01 June 2026', title: 'Arrival', description: 'Welcome to Kashmir.', places: ['Dal Lake'] }],
    inclusions: 'Breakfast\nHotel stay',
    exclusions: 'Flights\nPersonal expenses'
  };

  console.log('Rendering PDF...');
  const pdfBuffer = await renderQuotationPdfPreview(sampleData, {});
  const out = path.join(__dirname, '..', 'uploads', 'test-output.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, pdfBuffer);
  console.log('OK — wrote', out, `(${pdfBuffer.length} bytes)`);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
