const path = require('path');
const {
  escapeHtml,
  getLogoDataUri,
  resolveFirstExistingFile,
  fileToDataUri
} = require('./pdfAssets');

function getStampSignBase64(filename) {
  const candidates = [
    (process.env.PDF_STAMP_PATH || '').trim(),
    path.join(__dirname, '..', 'public', filename),
    path.join(process.cwd(), 'public', filename),
    path.join(__dirname, '..', '..', 'chaloontour_frontend', 'public', filename)
  ].filter(Boolean);
  const stampPath = resolveFirstExistingFile(candidates);
  if (!stampPath) return null;
  try {
    return fileToDataUri(stampPath);
  } catch (_) {
    return null;
  }
}

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

function esc(value) {
  if (value == null || value === '') return '–';
  return escapeHtml(String(value));
}

function textOrDash(value) {
  return value != null && String(value).trim() !== '' ? String(value).trim() : '–';
}

function formatDate(value) {
  if (!value) return '–';
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return textOrDash(value);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (_) {
    return textOrDash(value);
  }
}

function formatAmount(value) {
  if (value == null || value === '') return '—';
  const amount = Number(value);
  if (Number.isNaN(amount)) return textOrDash(value);
  return amount.toLocaleString('en-IN');
}

function formatCurrency(value) {
  if (value == null || value === '') return '–';
  return `Rs. ${formatAmount(value)} /-`;
}

function calculateBalance(totalValue, advanceValue) {
  if (totalValue == null || totalValue === '') return null;
  const total = Number(totalValue);
  const advance = advanceValue == null || advanceValue === '' ? 0 : Number(advanceValue);
  if (Number.isNaN(total) || Number.isNaN(advance)) return null;
  return Math.max(0, total - advance);
}

function buildPaxLabel(lead) {
  if (Array.isArray(lead?.paxBreakup) && lead.paxBreakup.length > 0) {
    return lead.paxBreakup
      .map((item) => [item?.count != null ? item.count : null, item?.type].filter(Boolean).join(' ').trim())
      .filter(Boolean)
      .join(', ');
  }
  return lead?.paxCount != null ? String(lead.paxCount) : '';
}

function buildTourDuration(lead) {
  return [
    lead?.tourNights != null && `${lead.tourNights} Nights`,
    lead?.tourDays != null && `${lead.tourDays} Days`,
  ].filter(Boolean).join(' / ');
}

function buildDestinations(lead) {
  if (Array.isArray(lead?.destinations) && lead.destinations.length > 0) {
    return lead.destinations.filter(Boolean).join(', ');
  }
  return lead?.destination || '';
}

function getListItems(value) {
  if (!value || !String(value).trim()) return [];
  return String(value).split(/\r?\n/).map(i => i.replace(/^[\s\u2022\-\u27A2]+/, '').trim()).filter(Boolean);
}

function buildTourSummaryHtml(lead, options = {}) {
  const leadId = lead.leadId || lead._id?.toString() || 'lead';
  const frontendBaseUrl = sanitizeBaseUrl(options.frontendBaseUrl);
  const apiBaseUrl = sanitizeBaseUrl(options.apiBaseUrl);
  const assetBase = apiBaseUrl || frontendBaseUrl;
  const logoData = getLogoDataUri() || null;
  const logoImg = logoData ? `<img src="${logoData}" alt="Logo" style="max-width:280px; height:auto;" />` : '';
  const watermark = logoData ? `<div style="position:fixed; top:30%; left:15%; width:70%; opacity:0.04; z-index:-1000; transform:rotate(-30deg); pointer-events:none;"><img src="${logoData}" style="width:100%;" /></div>` : '';
  
  const stampData = getStampSignBase64('stamp.png') || getStampSignBase64('stamp-sign.png');
  // We use the same script font via Google Fonts
  const signatureText = 'Utkarsh Kale';

  const tripTitle = buildDestinations(lead) ? `Let's Explore ${buildDestinations(lead)}` : "Let's Explore Your Trip";
  const perPersonCost = lead.packageCostPerPerson != null ? `Rs. ${formatAmount(lead.packageCostPerPerson)} /-` : (lead.total_amount != null ? `Rs. ${formatAmount(lead.total_amount)} /-` : '–');
  const totalPax = buildPaxLabel(lead) || '–';

  const primaryColor = '#1e3a8a';
  const accentColor = '#ef4444';
  const borderColor = '#cbd5e1';
  const lightBg = '#f8fafc';

  const accRows = Array.isArray(lead.accommodation) ? lead.accommodation : [];
  const flightRows = Array.isArray(lead.flights) ? lead.flights : [];
  const itinerary = Array.isArray(lead.itinerary) ? lead.itinerary : [];
  const tripImages = Array.isArray(lead.tripImages)
    ? lead.tripImages
        .filter(Boolean)
        .slice(0, 3)
        .map((img) => {
          const value = String(img || '').trim();
          if (value.startsWith('data:')) return value;
          return makeAbsoluteAssetUrl(img, assetBase);
        })
        .filter(Boolean)
    : [];

  const inclusionItems = getListItems(lead.inclusions);
  const exclusionItems = getListItems(lead.exclusions);
  const paymentPolicyItems = getListItems(lead.payment_policy);
  const cancellationPolicyItems = getListItems(lead.cancellation_policy);
  const termsItems = getListItems(lead.termsAndConditions);

  const assigned = lead.assigned_to;
  const assignedName = assigned && typeof assigned === 'object'
    ? [assigned.firstName, assigned.lastName].filter(Boolean).join(' ').trim() || assigned.email || 'Mr. Utkarsh Kale (C.E.O.)'
    : 'Mr. Utkarsh Kale (C.E.O.)';

  const footerHtml = `
    <div style="margin-top:40px; page-break-inside:avoid; border-top:1px solid ${borderColor}; padding-top:40px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-end;">
        <div style="flex:1.5;">
          <div style="font-weight:900; font-size:14pt; color:${primaryColor}; margin-bottom:5px;">CHALO ON TOUR</div>
          <div style="font-weight:800; color:#000; margin-bottom:10px; font-size:10pt;">${esc(assignedName)}</div>
          <div style="color:#475569; font-size:9pt; margin-bottom:3px;"><strong>Ph:</strong> 9960625167 / 9136549898</div>
          <div style="color:#475569; font-size:9pt; margin-bottom:3px;"><strong>Email:</strong> bookings@chaloontour.com</div>
          <div style="color:#475569; font-size:9pt;"><strong>Web:</strong> www.chaloontour.com</div>
        </div>
        <div style="flex:1;">
          <div style="display:flex; justify-content:center; align-items:center; gap:15px; height:100px; margin-bottom:10px;">
            <div style="width:100px; height:100px; display:flex; justify-content:center; align-items:center;">
              ${stampData ? `<img src="${stampData}" style="max-width:100%; max-height:100%; object-fit:contain; opacity:0.9;" />` : ''}
            </div>
            <div style="width:120px; height:100px; display:flex; justify-content:center; align-items:center;">
              <div style="font-family:'Dancing Script', cursive; font-size:20pt; color:${primaryColor}; transform:rotate(-5deg); white-space:nowrap;">
                ${signatureText}
              </div>
            </div>
          </div>
          <div style="text-align:center;">
            <div style="height: 2px; background: ${primaryColor}; width: 100%; margin-bottom: 5px; opacity: 0.2;"></div>
            <div style="font-size:8pt; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:1px;">Authorised Signatory</div>
          </div>
        </div>
      </div>
      <div style="margin-top:50px; text-align:center; font-size:8pt; color:#94a3b8;">
        Registered Office: Near Police Station, Ghodegaon, Tal- Ambegaon, Dist Pune | www.chaloontour.com
        <div style="margin-top:10px; font-style:italic; opacity:0.5;">*** This is a system-generated document. Digital Verification Active. ***</div>
      </div>
    </div>
  `;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Tour Quotation - ${esc(leadId)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Dancing+Script:wght@700&display=swap" rel="stylesheet">
  <style>
    @page { size: A4; margin: 0; }
    body { font-family: 'Inter', sans-serif; margin: 0; padding: 0; font-size: 10pt; color: #1e293b; background: #fff; line-height: 1.5; }
    .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 20mm 15mm; page-break-after: always; position: relative; background: #fff; box-sizing: border-box; display: flex; flex-direction: column; }
    .page:last-child { page-break-after: auto; }
    h1, h2, h3, h4 { margin: 0; }
    table { width: 100%; border-collapse: collapse; }
    .summary-bar { background: ${lightBg}; color: ${primaryColor}; padding: 20px; border-radius: 12px; margin-bottom: 30px; border: 1px solid ${borderColor}; }
    .summary-item { display: inline-block; width: 24%; vertical-align: top; }
    .summary-label { font-size: 7pt; opacity: 0.7; text-transform: uppercase; font-weight: 700; margin-bottom: 4px; color: #64748b; }
    .summary-value { font-size: 11pt; font-weight: 800; }
    
    .data-table { border: 1px solid ${borderColor}; border-radius: 8px; overflow: hidden; }
    .data-table th { background: ${primaryColor}; color: #fff; text-align: left; padding: 10px; font-size: 8.5pt; font-weight: 600; }
    .data-table td { border-bottom: 1px solid ${borderColor}; padding: 10px; font-size: 9pt; }
    .data-table tr:last-child td { border-bottom: none; }
    
    .itinerary-day { border-left: 3px solid ${primaryColor}; padding-left: 20px; margin-bottom: 25px; page-break-inside: avoid; }
    .day-badge { background: ${primaryColor}; color: #fff; padding: 3px 10px; border-radius: 20px; font-size: 8pt; font-weight: 800; display: inline-block; margin-bottom: 8px; }
    
    .policy-box { background: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid ${borderColor}; margin-bottom: 25px; page-break-inside: avoid; }
    .policy-title { font-size: 9pt; font-weight: 800; color: ${primaryColor}; text-transform: uppercase; margin-bottom: 12px; }
    
    @media print { .page { margin: 0; width: 100%; height: auto; } }
  </style>
</head>
<body>
  <!-- PAGE 1: COVER -->
  <div class="page">
    ${watermark}
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:40px;">
      <div style="width:250px;">
        ${logoImg}
        <div style="padding:4px 12px; background:${primaryColor}; color:#fff; font-size:7.5pt; font-weight:800; border-radius:4px; text-align:center; letter-spacing:1px; margin-top:10px; display:inline-block;">THE FUTURE OF TRAVEL</div>
      </div>
      <div style="text-align:right;">
        <h1 style="font-size:24pt; font-weight:900; color:${primaryColor}; text-transform:uppercase; line-height:1;">TOUR<br>QUOTATION</h1>
      </div>
    </div>

    <h2 style="font-size:28pt; font-weight:700; font-style:italic; font-family:Georgia,'Times New Roman',Times,serif; color:#c62828; margin:38px 0 30px 0; padding:0; line-height:1.2; text-align:center; letter-spacing:0.02em; text-shadow:none;">${esc(tripTitle)}</h2>

    ${tripImages.length > 0 ? `
    <div style="margin-bottom:30px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">
        <tr>
          ${tripImages.length === 1 ? `
            <td width="100%"><img src="${esc(tripImages[0])}" style="width:100%; height:350px; object-fit:cover; border-radius:15px; border:1px solid ${borderColor};" /></td>
          ` : `
            <td width="65%" style="padding-right:15px;"><img src="${esc(tripImages[0])}" style="width:100%; height:350px; object-fit:cover; border-radius:15px; border:1px solid ${borderColor};" /></td>
            <td width="35%">
              <img src="${esc(tripImages[1])}" style="width:100%; height:167px; object-fit:cover; border-radius:12px; border:1px solid ${borderColor}; margin-bottom:15px;" />
              ${tripImages[2] ? `<img src="${esc(tripImages[2])}" style="width:100%; height:167px; object-fit:cover; border-radius:12px; border:1px solid ${borderColor};" />` : ''}
            </td>
          `}
        </tr>
      </table>
    </div>
    ` : ''}

    <div class="summary-bar">
      <div class="summary-item"><div class="summary-label">Cost / Person</div><div class="summary-value">${perPersonCost}</div></div>
      <div class="summary-item"><div class="summary-label">Duration</div><div class="summary-value">${buildTourDuration(lead)}</div></div>
      <div class="summary-item"><div class="summary-label">Pax Count</div><div class="summary-value">${totalPax}</div></div>
      <div class="summary-item" style="width:20%;"><div class="summary-label">Meal Plan</div><div class="summary-value">${textOrDash(lead.mealPlan)}</div></div>
    </div>

    <div style="display:flex; gap:20px;">
      <div style="flex:1; padding:15px; border:1px solid ${borderColor}; border-radius:10px;">
        <span style="font-size:7pt; font-weight:800; color:#64748b; text-transform:uppercase;">Vehicle Preference</span>
        <div style="font-weight:700; margin-top:2px;">${textOrDash(lead.vehicleType)}</div>
      </div>
      <div style="flex:1; padding:15px; border:1px solid ${borderColor}; border-radius:10px;">
        <span style="font-size:7pt; font-weight:800; color:#64748b; text-transform:uppercase;">Hotel Category</span>
        <div style="font-weight:700; margin-top:2px;">${textOrDash(lead.hotelCategory)}</div>
      </div>
    </div>
    
    <div style="flex:1"></div>
    ${itinerary.length < 2 ? footerHtml : ''}
  </div>

  <!-- PAGE 2: DETAILS -->
  <div class="page">
    ${watermark}
    <h3 style="font-size:16pt; font-weight:900; color:${primaryColor}; margin-bottom:20px; border-bottom:2px solid ${accentColor}; padding-bottom:8px; display:inline-block;">Accommodation Details</h3>
    <div class="data-table" style="margin-bottom:30px;">
      <table>
        <thead>
          <tr><th>Hotel Name</th><th>Nights</th><th>Category</th><th>Type</th><th>City</th></tr>
        </thead>
        <tbody>
          ${accRows.length ? accRows.map(h => `<tr><td style="font-weight:700;">${esc(h.hotelName)}</td><td>${esc(h.nights)}</td><td>${esc(h.roomType)}</td><td>${esc(h.sharing)}</td><td style="font-weight:600;">${esc(h.destination)}</td></tr>`).join('') : '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:20px;">No listed properties</td></tr>'}
        </tbody>
      </table>
    </div>

    ${flightRows.length ? `
      <h3 style="font-size:16pt; font-weight:900; color:${primaryColor}; margin-bottom:20px; border-bottom:2px solid ${accentColor}; padding-bottom:8px; display:inline-block;">Flight Itinerary</h3>
      <div class="data-table">
        <table>
          <thead><tr style="background:#f1f5f9; color:${primaryColor};"><th>Route</th><th>Details</th><th>Airline</th><th>PNR</th></tr></thead>
          <tbody>
            ${flightRows.map(f => `<tr><td style="font-weight:700;">${esc(f.from)} → ${esc(f.to)}</td><td style="font-size:8.5pt;">${formatDate(f.depDate)}</td><td><div style="font-weight:600;">${esc(f.airline)}</div></td><td style="font-weight:800; color:${accentColor};">${esc(f.pnr)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}

    <h3 style="font-size:16pt; font-weight:900; color:${primaryColor}; margin-top:40px; margin-bottom:25px; border-bottom:2px solid ${accentColor}; padding-bottom:8px; display:inline-block;">Tour Itinerary</h3>
    ${itinerary.map((day, i) => `
      <div class="itinerary-day">
        <div class="day-badge">${esc(day.dayLabel || `DAY ${i + 1}`)}</div>
        <div style="font-weight:800; font-size:12pt; margin-bottom:5px;">${esc(day.title || day.route)}</div>
        <p style="font-size:9.5pt; color:#475569; margin-bottom:10px;">${esc(day.description)}</p>
        ${day.places?.length ? `<div style="font-size:8pt; font-weight:800; color:${accentColor}; text-transform:uppercase; letter-spacing:1px;">Highlights: ${esc(day.places.join(', '))}</div>` : ''}
      </div>
    `).join('')}

    <div style="flex:1"></div>
    ${footerHtml}
  </div>

  <!-- PAGE 3: POLICIES -->
  <div class="page">
    ${watermark}
    <div style="display:flex; gap:30px; margin-bottom:30px;">
      ${inclusionItems.length ? `
        <div style="flex:1">
          <h4 style="font-size:10pt; font-weight:800; color:${primaryColor}; text-transform:uppercase; margin-bottom:15px;">Package Inclusions</h4>
          <ul style="padding-left:15px; margin:0; list-style:none;">
            ${inclusionItems.map(item => `<li style="font-size:9pt; margin-bottom:6px; position:relative;"><span style="color:#16a34a; font-weight:900; position:absolute; left:-18px;">✓</span> ${esc(item)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${exclusionItems.length ? `
        <div style="flex:1">
          <h4 style="font-size:10pt; font-weight:800; color:${accentColor}; text-transform:uppercase; margin-bottom:15px;">Package Exclusions</h4>
          <ul style="padding-left:15px; margin:0; list-style:none;">
            ${exclusionItems.map(item => `<li style="font-size:9pt; margin-bottom:6px; position:relative;"><span style="color:${accentColor}; font-weight:900; position:absolute; left:-18px;">✕</span> ${esc(item)}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>

    <div class="policy-box">
      <div class="policy-title">Terms & Policies</div>
      <table width="100%">
        <tr>
          <td width="50%" valign="top" style="padding-right:20px;">
            <div style="font-size:7.5pt; font-weight:800; color:#64748b; text-transform:uppercase; margin-bottom:8px;">Payment Schedule</div>
            ${paymentPolicyItems.map(i => `<div style="font-size:8.5pt; margin-bottom:4px;">• ${esc(i)}</div>`).join('')}
          </td>
          <td width="50%" valign="top">
            <div style="font-size:7.5pt; font-weight:800; color:#64748b; text-transform:uppercase; margin-bottom:8px;">Cancellation Terms</div>
            ${cancellationPolicyItems.map(i => `<div style="font-size:8.5pt; margin-bottom:4px;">• ${esc(i)}</div>`).join('')}
          </td>
        </tr>
      </table>
    </div>

    ${lead.memorableTrip ? `<div style="background:#fffef3; border:1px solid #fde68a; padding:15px; border-radius:10px; margin-bottom:30px;"><div style="font-weight:800; color:#92400e; font-size:9pt; margin-bottom:4px;">Tip for a Memorable Trip:</div><p style="font-size:9pt; color:#78350f; margin:0;">${esc(lead.memorableTrip)}</p></div>` : ''}

    <div style="flex:1"></div>
    ${footerHtml}
  </div>
</body>
</html>`;
}

module.exports = { buildTourSummaryHtml };
