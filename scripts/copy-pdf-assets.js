/**
 * Copy branding images from frontend/public into backend/public for PDF generation on VPS.
 */
const fs = require('fs');
const path = require('path');

const files = [
  'chalo-on-tour-e1766686260447.png',
  'Chalo-on-tour.jpg.jpeg',
  'stamp-sign.png',
  'signature.png'
];

const frontendPublic = path.join(__dirname, '..', '..', 'chaloontour_frontend', 'public');
const backendPublic = path.join(__dirname, '..', 'public');

if (!fs.existsSync(frontendPublic)) {
  console.error('Frontend public folder not found:', frontendPublic);
  process.exit(1);
}

fs.mkdirSync(backendPublic, { recursive: true });

for (const name of files) {
  const src = path.join(frontendPublic, name);
  const dst = path.join(backendPublic, name);
  if (!fs.existsSync(src)) {
    console.warn('Skip (missing):', name);
    continue;
  }
  fs.copyFileSync(src, dst);
  console.log('Copied', name);
}

console.log('Done.');
