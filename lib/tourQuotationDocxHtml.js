const path = require('path');
const fs = require('fs');

/**
 * Helper to convert local image to base64 for Word compatibility
 */
function getImageDataUri(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function getLogoBase64() {
  const candidates = [
    path.join(__dirname, '..', 'public', 'Chalo-on-tour.jpg.jpeg'),
    path.join(process.cwd(), 'public', 'Chalo-on-tour.jpg.jpeg'),
    path.join(__dirname, '..', '..', 'frontend', 'public', 'Chalo-on-tour.jpg.jpeg'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return getImageDataUri(p);
      } catch (_) {}
    }
  }
  return null;
}

function getStampSignBase64(filename) {
  const candidates = [
    path.join(__dirname, '..', 'public', filename),
    path.join(process.cwd(), 'public', filename),
    path.join(__dirname, '..', '..', 'frontend', 'public', filename),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return getImageDataUri(p);
      } catch (_) {}
    }
  }
  return null;
}

function esc(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lines(value) {
  if (!value || !String(value).trim()) return [];
  return String(value)
    .split(/\r?\n/)
    .map((item) => item.replace(/^[\s\u2022\-\u27A2]+/, '').trim())
    .filter(Boolean);
}

function absImageSrc(src, frontendUrl) {
  const raw = String(src || '').trim();
  if (!raw) return '';
  if (/^data:/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!frontendUrl) return raw;
  if (raw.startsWith('/')) return `${frontendUrl}${raw}`;
  return `${frontendUrl}/${raw}`;
}

/**
 * Build Word-friendly HTML.
 * WE ARE USING STATIC TABLES ONLY. Word handles tables better than divs.
 */
function buildTourQuotationDocxHtml(data = {}, { frontendUrl } = {}) {
  const primaryColor = '#1e3a8a'; // Deep Navy
  const accentColor = '#ef4444'; // Logo Red
  const grayColor = '#64748b';
  
  const titleDestinations = (data.destinations || '').trim();
  const tripTitle = titleDestinations ? `Let's Explore ${titleDestinations}` : "Let's Explore Your Trip";

  const logoData = getLogoBase64();
  const logoImg = logoData ? `<img src="${logoData}" width="180" />` : '';
  const stampData = getStampSignBase64('stamp.png') || getStampSignBase64('stamp-sign.png');

  const hotels = Array.isArray(data.hotels) ? data.hotels : [];
  const itinerary = Array.isArray(data.itinerary) ? data.itinerary : [];
  const inclusions = lines(data.inclusions);
  const exclusions = lines(data.exclusions);

  return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: "Calibri", "Arial", sans-serif; font-size: 11pt; }
        table { border-collapse: collapse; width: 100%; border: none; }
        td, th { vertical-align: top; border: none; }
        .data-table { border: 1pt solid #cbd5e1; }
        .data-table th { background-color: ${primaryColor}; color: #ffffff; padding: 8pt; border: 1pt solid ${primaryColor}; }
        .data-table td { padding: 8pt; border: 1pt solid #cbd5e1; }
    </style>
</head>
<body>

    <!-- LOGO HEADER -->
    <table border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20pt;">
        <tr>
            <td width="60%">
                ${logoImg}
                <p style="margin: 2pt 0; color: ${primaryColor}; font-size: 8pt; font-weight: bold;">THE FUTURE OF TRAVEL</p>
            </td>
            <td width="40%" align="right">
                <h1 style="color: ${primaryColor}; font-size: 26pt; margin: 0;">Tour Quotation</h1>
                <p style="color: ${grayColor}; font-size: 10pt; margin: 4pt 0;">
                    Quote: <b>${esc(data.quoteNumber || '—')}</b> | Date: <b>${esc(data.quoteDate || '—')}</b>
                </p>
            </td>
        </tr>
    </table>

    <h2 style="font-size: 22pt; font-weight: 700; font-style: italic; font-family: Georgia, 'Times New Roman', Times, serif; color: #c62828; margin: 22pt 0 15pt 0; padding: 0; line-height: 1.2; text-align: center; letter-spacing: 0.02em; text-shadow: none;">
        ${esc(tripTitle)}
    </h2>

    <!-- SUMMARY -->
    <table border="0" cellspacing="0" cellpadding="10" style="background-color: #f8fafc; border: 1pt solid #cbd5e1; margin-bottom: 20pt;">
        <tr>
            <td width="25%">
                <p style="font-size: 8pt; color: ${grayColor}; font-weight: bold; text-transform: uppercase; margin: 0;">Cost Per Person</p>
                <p style="font-size: 12pt; font-weight: bold; color: ${primaryColor}; margin: 0;">₹ ${esc(data.perPersonCost || '—')}</p>
            </td>
            <td width="25%">
                <p style="font-size: 8pt; color: ${grayColor}; font-weight: bold; text-transform: uppercase; margin: 0;">Duration</p>
                <p style="font-size: 12pt; font-weight: bold; color: ${primaryColor}; margin: 0;">${esc(data.tourDuration || '—')}</p>
            </td>
            <td width="25%">
                <p style="font-size: 8pt; color: ${grayColor}; font-weight: bold; text-transform: uppercase; margin: 0;">Pax Count</p>
                <p style="font-size: 12pt; font-weight: bold; color: ${primaryColor}; margin: 0;">${esc(data.totalPax || '—')}</p>
            </td>
            <td width="25%">
                <p style="font-size: 8pt; color: ${grayColor}; font-weight: bold; text-transform: uppercase; margin: 0;">Meal Plan</p>
                <p style="font-size: 12pt; font-weight: bold; color: ${primaryColor}; margin: 0;">${esc(data.mealPlan || '—')}</p>
            </td>
        </tr>
    </table>

    <!-- SECTION TITLE: ACCOMMODATION -->
    <table border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 10pt;">
        <tr>
            <td style="border-bottom: 2pt solid ${accentColor}; padding-bottom: 4pt; color: ${primaryColor}; font-size: 16pt; font-weight: bold;">
                Accommodation Details
            </td>
        </tr>
    </table>

    <table class="data-table" border="1" cellspacing="0" cellpadding="0" style="margin-bottom: 20pt;">
        <tr>
            <th width="8%">Sr.</th>
            <th width="32%">Hotel Name</th>
            <th width="12%">Nights</th>
            <th width="20%">Category</th>
            <th width="15%">Type</th>
            <th width="13%">City</th>
        </tr>
        ${hotels.map((h, i) => `
            <tr>
                <td align="center">${i + 1}</td>
                <td style="font-weight: bold;">${esc(h?.name || '')}</td>
                <td align="center">${esc(h?.nights || '')}</td>
                <td>${esc(h?.roomCategory || '')}</td>
                <td>${esc(h?.roomSharing || '')}</td>
                <td style="font-weight: bold;">${esc(h?.destination || '')}</td>
            </tr>
        `).join('')}
    </table>

    <!-- SECTION TITLE: ITINERARY -->
    <table border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 15pt;">
        <tr>
            <td style="border-bottom: 2pt solid ${accentColor}; padding-bottom: 4pt; color: ${primaryColor}; font-size: 16pt; font-weight: bold;">
                Days of Wonder
            </td>
        </tr>
    </table>

    ${itinerary.map((day, i) => `
        <table border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20pt; page-break-inside: avoid;">
            <tr>
                <td style="padding-left: 15pt; border-left: 4pt solid ${primaryColor};">
                    <table border="0" cellspacing="0" cellpadding="5">
                        <tr>
                            <td width="100" bgcolor="${primaryColor}" style="background-color: ${primaryColor}; color: #ffffff; text-align: center; border-radius: 12pt;">
                                <b>${esc(day?.dayLabel || `DAY ${i + 1}`)}</b>
                            </td>
                            <td align="right" style="color: ${grayColor}; font-weight: bold;">
                                ${esc(day?.date || '')}
                            </td>
                        </tr>
                    </table>
                    <p style="font-size: 14pt; font-weight: bold; color: #1e293b; margin: 10pt 0 5pt 0;">${esc(day?.title || '')}</p>
                    <p style="color: #475569; margin: 0; line-height: 1.5;">${esc(day?.description || '')}</p>
                    
                    ${Array.isArray(day?.places) && day.places.filter(Boolean).length ? `
                        <table border="0" cellspacing="0" cellpadding="10" style="background-color: #f1f5f9; margin-top: 10pt; border: none;">
                            <tr>
                                <td>
                                    <p style="font-size: 9pt; font-weight: bold; color: ${accentColor}; margin: 0 0 4pt 0;">HIGHLIGHTS:</p>
                                    ${day.places.filter(Boolean).map(place => `<p style="margin: 1pt 0; font-size: 10pt;">• ${esc(place)}</p>`).join('')}
                                </td>
                            </tr>
                        </table>
                    ` : ''}
                </td>
            </tr>
        </table>
    `).join('')}

    <div style="page-break-before: always;"></div>

    <!-- POLICIES -->
    <table border="0" cellspacing="0" cellpadding="0">
        <tr>
            <td width="48%">
                <h4 style="color: ${primaryColor}; border-bottom: 1pt solid #cbd5e1; padding-bottom: 4pt;">Package Inclusions</h4>
                ${inclusions.map(item => `<p style="font-size: 10pt; margin: 2pt 0;">✓ ${esc(item)}</p>`).join('')}
            </td>
            <td width="4%"></td>
            <td width="48%">
                <h4 style="color: ${accentColor}; border-bottom: 1pt solid #cbd5e1; padding-bottom: 4pt;">Package Exclusions</h4>
                ${exclusions.map(item => `<p style="font-size: 10pt; margin: 2pt 0;">✕ ${esc(item)}</p>`).join('')}
            </td>
        </tr>
    </table>

    <table border="0" cellspacing="0" cellpadding="20" style="background-color: #f8fafc; border: 1pt solid #cbd5e1; margin-top: 20pt;">
        <tr>
            <td>
                <p style="font-weight: bold; color: ${primaryColor}; margin: 0 0 10pt 0;">TERMS & POLICIES</p>
                <p style="font-size: 10pt; line-height: 1.4;">${esc(data.paymentPolicy || '--')}</p>
                <p style="font-size: 10pt; line-height: 1.4; margin-top: 10pt;">${esc(data.cancellationPolicy || '--')}</p>
            </td>
        </tr>
    </table>

    <!-- FOOTER SIGNATORY -->
    <table border="0" cellspacing="0" cellpadding="0" style="margin-top: 40pt; border-top: 1pt solid #cbd5e1; padding-top: 20pt;">
        <tr>
            <td width="65%">
                <p style="font-size: 16pt; font-weight: bold; color: ${primaryColor}; margin: 0;">CHALO ON TOUR</p>
                <p style="font-weight: bold; margin: 4pt 0;">${esc(data.ceoName || 'Mr. Utkarsh Kale (C.E.O.)')}</p>
                <p style="font-size: 10pt; color: ${grayColor}; margin: 2pt 0;">Ph: ${esc(data.cell1 || '')} / ${esc(data.cell2 || '')}</p>
                <p style="font-size: 10pt; color: ${grayColor}; margin: 2pt 0;">Email: ${esc(data.companyEmail || '')}</p>
            </td>
            <td width="35%" align="center">
                <p style="font-family: 'Brush Script MT', cursive; font-size: 22pt; color: ${primaryColor}; margin: 0;">Utkarsh Kale</p>
                <div style="height: 1pt; background-color: ${primaryColor}; width: 100%;"></div>
                <p style="font-size: 8pt; color: ${grayColor}; font-weight: bold; margin-top: 4pt;">AUTHORISED SIGNATORY</p>
            </td>
        </tr>
    </table>

    <p style="text-align: center; font-size: 8pt; color: #94a3b8; margin-top: 30pt;">
        Registered Office: Near Police Station, Ghodegaon, Tal- Ambegaon, Dist Pune | www.chaloontour.com<br/>
        <i>*** This is a system-generated document. Digital Verification Active. ***</i>
    </p>

</body>
</html>`;
}

module.exports = { buildTourQuotationDocxHtml };
