/**
 * Server-side Tour Quotation HTML builder.
 *
 * Generates the EXACT same layout as the React TourPDFGenerator component,
 * but as a self-contained HTML string with all CSS inlined.
 *
 * This eliminates:
 *  - Chrome navigating to a live URL (network)
 *  - Next.js React hydration
 *  - API call from frontend back to backend
 *  - Auth/CORS issues
 *  - Font loading from Google
 *
 * Chrome converts this local file:// HTML in ~2-3 seconds.
 */

const fs = require('fs');
const path = require('path');

// Resolve logo to base64 so Chrome can embed it from file:// without network
let logoBase64 = '';
try {
  const logoPath = path.join(__dirname, '../../frontend/public/Chalo-on-tour.jpg.jpeg');
  if (fs.existsSync(logoPath)) {
    const buf = fs.readFileSync(logoPath);
    logoBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
} catch (e) {
  console.warn('Could not read logo for PDF:', e.message);
}

const esc = (str) => String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sanitizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

function makeAbsoluteAssetUrl(input, fallbackBase) {
  const value = String(input || '').trim();
  if (!value) return '';
  if (value.startsWith('data:') || /^https?:\/\//i.test(value)) return value;
  const base = sanitizeBaseUrl(fallbackBase);
  if (!base) return value;
  return `${base}/${value.replace(/^\/+/, '')}`;
}

const getListItems = (value) =>
  String(value || '')
    .split(/\r?\n/)
    .map((item) => item.replace(/^[\s•\-*➳]+/, '').trim())
    .filter(Boolean);

const bulletSvg = `<svg viewBox="0 0 24 24" width="16" height="16" style="flex-shrink:0;margin-top:2px;"><path d="M4 12h12.17l-3.28-3.29c-.39-.39-.39-1.02 0-1.41a.9959.9959 0 0 1 1.41 0l5 5c.39.39.39 1.02 0 1.41l-5 5a.9959.9959 0 0 1-1.41 0c-.39-.39-.39-1.02 0-1.41L16.17 13H4c-.55 0-1-.45-1-1s.45-1 1-1z" fill="#c62828"/></svg>`;

function buildBulletList(items) {
  if (!items.length) return '';
  return `<ul style="list-style:none;padding:0;margin:0;">
    ${items.map(item => `<li style="display:flex;align-items:flex-start;gap:10px;margin-bottom:6px;font-size:10.5pt;line-height:1.4;">
      ${bulletSvg}<span>${esc(item)}</span>
    </li>`).join('')}
  </ul>`;
}

function buildSectionHeader(title, bgColor) {
  return `<table style="width:100%;border-collapse:collapse;margin:10px 0;border:none;">
    <tbody><tr><td style="padding:7px 0;text-align:center;vertical-align:middle;border:none;border-radius:4px;background:${bgColor};line-height:1;">
      <span style="color:#ffffff;font-size:12pt;font-weight:bold;text-transform:uppercase;font-family:Arial,sans-serif;line-height:normal;">${esc(title)}</span>
    </td></tr></tbody>
  </table>`;
}

function formatCurrency(val) {
  if (!val) return '--';
  const num = Number(val);
  if (isNaN(num)) return val;
  return `Rs. ${num.toLocaleString('en-IN')} /- Per Person`;
}

function buildTourQuotationHtml(data, options = {}) {
  const d = data || {};
  const frontendBaseUrl = sanitizeBaseUrl(options.frontendBaseUrl);
  const apiBaseUrl = sanitizeBaseUrl(options.apiBaseUrl);
  const assetBase = apiBaseUrl || frontendBaseUrl;

  const tripTitleLabel = (d.packageName || '').trim() || (d.destinations || '').trim() || 'Your Trip';
  const tripTitle = `Let's Explore ${tripTitleLabel}`;

  const tourDateRange = d.tourDateFrom && d.tourDateTo
    ? `${esc(d.tourDateFrom)} to ${esc(d.tourDateTo)}`
    : d.tourDateFrom ? esc(d.tourDateFrom) : '--';

  const hotels = Array.isArray(d.hotels) ? d.hotels : [];
  const flights = Array.isArray(d.flights) ? d.flights : [];
  const itinerary = Array.isArray(d.itinerary) ? d.itinerary : [];

  const inclusionItems = getListItems(d.inclusions);
  const exclusionItems = getListItems(d.exclusions);
  const paymentPolicyItems = getListItems(d.paymentPolicy);
  const cancellationPolicyItems = getListItems(d.cancellationPolicy);
  const termsItems = getListItems(d.termsAndConditions);

  const logoSrc = logoBase64 || '/Chalo-on-tour.jpg.jpeg';

  // For hero images: if they are URLs, use them; if empty, use logo
  const heroMain = makeAbsoluteAssetUrl(d.heroMain, assetBase) || logoSrc;
  const heroSub1 = makeAbsoluteAssetUrl(d.heroSub1, assetBase) || logoSrc;
  const heroSub2 = makeAbsoluteAssetUrl(d.heroSub2, assetBase) || logoSrc;

  // Build hotel rows
  const hotelRows = hotels.length > 0
    ? hotels.map((h, i) => `<tr>
        <td style="text-align:center;">${String(i + 1).padStart(2, '0')}.</td>
        <td>${esc(h.name)}</td>
        <td style="text-align:center;">${esc(h.nights)} Nights</td>
        <td>${esc(h.roomCategory)}</td>
        <td>${esc(h.roomSharing)}</td>
        <td>${esc(h.destination)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;">No accommodation listed</td></tr>';

  // Build flight rows
  const flightSection = flights.length > 0 ? `
    <div style="margin-bottom:12px;">
      ${buildSectionHeader('FLIGHT DETAILS: -', '#1565c0')}
      <table class="data-table flight-table">
        <thead><tr><th>Sr.No</th><th>From</th><th>To</th><th>Airline</th><th>PNR Details</th></tr></thead>
        <tbody>
          ${flights.map((f, i) => `<tr>
            <td style="text-align:center;">${String(i + 1).padStart(2, '0')}.</td>
            <td>${esc(f.from)}</td>
            <td>${esc(f.to)}</td>
            <td>${esc(f.airline)}</td>
            <td>${esc(f.pnr)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${d.flightNote ? `<p style="font-size:9pt;font-style:italic;margin-top:-15px;margin-bottom:15px;">* ${esc(d.flightNote)}</p>` : ''}
    </div>
  ` : '';

  // Build itinerary days
  const itineraryDays = itinerary.map((day, di) => {
    const places = Array.isArray(day.places) ? day.places.filter(Boolean) : [];
    const placesHtml = places.length > 0 ? `
      <div style="color:#c62828;font-weight:bold;text-decoration:underline;margin-top:10px;margin-bottom:5px;">Places to Visit: -</div>
      <ul style="list-style:none;padding:0;margin:0;">
        ${places.map(place => `<li style="display:flex;align-items:flex-start;gap:12px;margin-bottom:6px;font-size:10.5pt;line-height:1.4;">
          ${bulletSvg}<span style="display:block;flex:1;font-size:10.5pt;line-height:1.4;color:#000;">${esc(place)}</span>
        </li>`).join('')}
      </ul>
    ` : '';

    return `<div style="margin-bottom:15px;">
      <table style="width:100%;border-collapse:collapse;margin-top:15px;border:1px solid #d4d400;">
        <tbody><tr><td style="padding:5px 0;text-align:center;vertical-align:middle;background-color:#ffeb3b;border:none;line-height:1;">
          <span style="color:#000;font-weight:bold;font-size:11pt;font-family:Arial,sans-serif;line-height:normal;">
            ${esc(day.dayLabel || `Day ${di + 1}`)} :- ${esc(day.title)} (${esc(day.date || '')})
          </span>
        </td></tr></tbody>
      </table>
      <div style="margin-bottom:12px;line-height:1.5;">
        <p style="margin-top:10px;">${esc(day.description)}</p>
        ${placesHtml}
      </div>
    </div>`;
  }).join('');

  // Build optional sections
  const optionalSections = [];
  if (inclusionItems.length > 0) {
    optionalSections.push(`<div>
      <div class="optional-heading">Package Inclusions</div>
      ${buildBulletList(inclusionItems)}
    </div>`);
  }
  if (exclusionItems.length > 0) {
    optionalSections.push(`<div style="margin-top:15px;">
      <div class="optional-heading">Package Exclusions</div>
      ${buildBulletList(exclusionItems)}
    </div>`);
  }
  if (paymentPolicyItems.length > 0) {
    optionalSections.push(`<div style="margin-top:15px;">
      <div class="optional-heading">Payment Policy</div>
      ${buildBulletList(paymentPolicyItems)}
    </div>`);
  }
  if (cancellationPolicyItems.length > 0) {
    optionalSections.push(`<div style="margin-top:15px;">
      <div class="optional-heading">Cancellation Policy</div>
      ${buildBulletList(cancellationPolicyItems)}
    </div>`);
  }
  if (termsItems.length > 0) {
    optionalSections.push(`<div style="margin-top:15px;">
      <div class="optional-heading">Terms And Conditions</div>
      ${buildBulletList(termsItems)}
    </div>`);
  }

  const memorableTripHtml = d.memorableTrip ? `
    <div style="margin-top:12px;padding:12px 14px;border:1px solid #1565c0;background:#f4f8ff;">
      <div style="color:#1565c0;font-weight:bold;font-size:12pt;margin-bottom:6px;">Tip For Memorable Trip</div>
      <p style="margin:0;font-size:10.5pt;line-height:1.5;color:#000;">${esc(d.memorableTrip)}</p>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@1,700&display=swap');

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 11pt;
      color: #000;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pdf-root {
      width: 210mm;
      margin: 0 auto;
      padding: 20px 40px;
      background: #fff;
      position: relative;
    }
    .watermark {
      position: absolute;
      top: 38%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg) scale(2);
      opacity: 0.19;
      z-index: 0;
      pointer-events: none;
    }
    .header { text-align: center; margin-bottom: 12px; }
    .logo-box { display: flex; justify-content: center; margin-bottom: 18px; }
    .logo-img { max-width: 220px; height: auto; }
    .trip-title {
      font-family: 'Merriweather', Georgia, serif;
      font-size: 22pt;
      font-weight: 700;
      font-style: italic;
      color: #c62828;
      text-align: center;
      line-height: 1.2;
      letter-spacing: 0.02em;
      text-shadow: none;
      margin: 0;
    }
    .image-section { margin-bottom: 14px; }
    .main-image-wrap {
      width: 100%; height: 300px; position: relative;
      border-radius: 8px; overflow: hidden; margin-bottom: 10px; border: 1px solid #ddd;
    }
    .sub-images-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .sub-image-wrap {
      width: 100%; height: 180px; position: relative;
      border-radius: 8px; overflow: hidden; border: 1px solid #ddd;
    }
    .full-img { width: 100%; height: 100%; object-fit: cover; }
    .section-block { margin-bottom: 12px; }

    /* Data tables */
    .data-table {
      width: 100%; table-layout: fixed; border-collapse: collapse;
      margin-bottom: 12px; border: 2px solid #000;
    }
    .data-table th, .data-table td {
      border: 1px solid #000; padding: 6px 8px;
      text-align: left; font-size: 9.5pt; vertical-align: middle; word-break: break-word;
    }
    .data-table th { background-color: #f5f5f5; text-align: center; }

    /* Summary table column widths */
    .summary-table td:first-child { width: 8%; text-align: center; }
    .summary-table td:nth-child(2) { width: 34%; font-weight: bold; }
    .summary-table td:nth-child(3) { width: 58%; }

    /* Accommodation table */
    .accommodation-table th:nth-child(1), .accommodation-table td:nth-child(1) { width: 9%; text-align: center; }
    .accommodation-table th:nth-child(2), .accommodation-table td:nth-child(2) { width: 24%; }
    .accommodation-table th:nth-child(3), .accommodation-table td:nth-child(3) { width: 16%; }
    .accommodation-table th:nth-child(4), .accommodation-table td:nth-child(4) { width: 19%; }
    .accommodation-table th:nth-child(5), .accommodation-table td:nth-child(5) { width: 17%; }
    .accommodation-table th:nth-child(6), .accommodation-table td:nth-child(6) { width: 15%; }

    /* Flight table */
    .flight-table th:nth-child(1), .flight-table td:nth-child(1) { width: 9%; text-align: center; }
    .flight-table th:nth-child(2), .flight-table td:nth-child(2) { width: 28%; }
    .flight-table th:nth-child(3), .flight-table td:nth-child(3) { width: 28%; }
    .flight-table th:nth-child(4), .flight-table td:nth-child(4) { width: 20%; }
    .flight-table th:nth-child(5), .flight-table td:nth-child(5) { width: 15%; }

    .optional-heading {
      color: #c62828; font-weight: bold; font-size: 12pt;
      text-decoration: underline; margin-bottom: 8px;
    }
    .footer { margin-top: 16px; text-align: left; }
    .footer-note { text-align: left; font-size: 9pt; margin-bottom: 20px; font-style: italic; }
    .company-link { color: #0d47a1; font-weight: bold; text-decoration: underline; font-size: 13pt; }
    .contact-line { color: #c62828; font-weight: bold; margin-top: 4px; }

    /* Page break rules */
    table tr { break-inside: avoid; }
    @media print {
      .pdf-root { width: 210mm !important; }
    }
  </style>
</head>
<body>
  <div class="pdf-root">
    <!-- Watermark -->
    <div class="watermark">
      <img src="${logoSrc}" alt="" style="width:400px;">
    </div>

    <!-- Header -->
    <div class="header">
      <div class="logo-box">
        <img src="${logoSrc}" alt="Chalo On Tour" class="logo-img">
      </div>
      <h1 class="trip-title">${esc(tripTitle)}</h1>
    </div>

    <!-- Images Section -->
    <div class="image-section">
      <div class="main-image-wrap">
        <img src="${heroMain}" class="full-img" alt="Main">
      </div>
      <div class="sub-images-grid">
        <div class="sub-image-wrap">
          <img src="${heroSub1}" class="full-img" alt="Sub 1">
        </div>
        <div class="sub-image-wrap">
          <img src="${heroSub2}" class="full-img" alt="Sub 2">
        </div>
      </div>
    </div>

    <!-- TOUR SUMMARY -->
    <div class="section-block">
      ${buildSectionHeader('TOUR SUMMARY: -', '#1565c0')}
      <table class="data-table summary-table">
        <tbody>
          <tr><td>01.</td><td>Per Person Cost</td><td>${formatCurrency(d.perPersonCost)}</td></tr>
          <tr><td>02.</td><td>Total No. of Pax</td><td>${esc(d.totalPax) || '--'}</td></tr>
          <tr><td>03.</td><td>Vehicle Type</td><td>${esc(d.vehicleType) || '--'}</td></tr>
          <tr><td>04.</td><td>Hotel Category</td><td>${esc(d.hotelCategory) || '--'}</td></tr>
          <tr><td>05.</td><td>Meal Plan</td><td>${esc(d.mealPlan) || '--'}</td></tr>
          <tr><td>06.</td><td>Tour Duration</td><td>${esc(d.tourDuration) || '--'}</td></tr>
          <tr><td>07.</td><td>Tour Date</td><td>${tourDateRange}</td></tr>
          <tr><td>08.</td><td>Pick up</td><td>${esc(d.pickupPoint) || '--'}</td></tr>
          <tr><td>09.</td><td>Drop</td><td>${esc(d.dropPoint) || '--'}</td></tr>
          <tr><td>10.</td><td>Destinations</td><td>${esc(d.destinations) || '--'}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- ACCOMMODATION -->
    <div class="section-block">
      ${buildSectionHeader('ACCOMMODATION: -', '#1565c0')}
      <table class="data-table accommodation-table">
        <thead><tr><th>Sr.No</th><th>Hotel Name</th><th>No. of Nights</th><th>Room Category</th><th>Room Sharing</th><th>Destination</th></tr></thead>
        <tbody>${hotelRows}</tbody>
      </table>
      ${d.accommodationNote ? `<p style="font-size:9pt;font-style:italic;margin-top:-15px;margin-bottom:15px;">* ${esc(d.accommodationNote)}</p>` : ''}
    </div>

    <!-- FLIGHT DETAILS -->
    ${flightSection}

    <!-- TOUR ITINERARY -->
    <div class="section-block">
      ${buildSectionHeader('TOUR ITINERARY: -', '#c62828')}
      ${itineraryDays}
    </div>

    <!-- POLICIES -->
    ${optionalSections.length > 0 ? `<div style="margin-top:12px;">${optionalSections.join('')}</div>` : ''}

    <!-- MEMORABLE TRIP -->
    ${memorableTripHtml}

    <!-- Footer -->
    <div class="footer">
      <div style="font-size:13pt;margin-bottom:5px;font-weight:bold;color:#1565c0;">Thank You</div>
      <p class="footer-note" style="font-size:10pt;color:#444;">
        Let's stay connected via email, phone, WhatsApp, Facebook, Instagram, and more. We look forward to seeing you again on another memorable Chalo On Tour Trip.
      </p>
      <div style="text-align:left;">
        <div style="margin-top:15px;">
          <div style="font-weight:bold;">Thanks &amp; Regards</div>
          <div class="company-link">CHALO ON TOUR</div>
          <div style="font-weight:bold;color:#000;margin-top:5px;">${esc(d.ceoName || 'Mr. Utkarsh Kale (C.E.O.)')}</div>
          <div class="contact-line">Cell: - ${esc(d.cell1 || '')} ${d.cell2 ? `/ ${esc(d.cell2)}` : ''}</div>
          <div class="contact-line">Mail ID: - <span style="color:#c62828;">${esc(d.companyEmail || '')}</span></div>
          <div class="contact-line">Website: - <a href="https://${esc(d.companyWebsite || '')}" style="color:#0d47a1;text-decoration:underline;">${esc(d.companyWebsite || '')}</a></div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { buildTourQuotationHtml };
