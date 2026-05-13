const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { body, validationResult, query } = require('express-validator');
const Lead = require('../models/Lead');
const { auth, checkModulePermission, requireSuperadmin, allowLeadCreateForPortal } = require('../middleware/auth');
// Puppeteer may capture env vars (like `PUPPETEER_CACHE_DIR`) at module load time.
// We therefore load it lazily inside the PDF route after normalizing cache dir.
let puppeteer;
const juice = require('juice');
const fs = require('fs');
const path = require('path');
const { buildTourSummaryHtml } = require('../lib/tourSummaryHtml');
const { buildTourSummaryPdf } = require('../lib/tourSummaryPdf');
const { buildTourQuotationDocxHtml } = require('../lib/tourQuotationDocxHtml');
const { buildTourQuotationDocx } = require('../lib/tourQuotationDocx');
const { renderPdfFromHtml } = require('../lib/chromePdf');

const router = express.Router();

// Shared logger for PDF generation
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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'booked', 'lost'];
const REMINDER_PAYMENT_STATUSES = ['qualified', 'booked'];
const REMINDER_TRIP_STATUSES = ['new', 'contacted', 'qualified', 'booked'];

function sanitizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

function resolveFrontendBaseUrl(req) {
  const envBase = sanitizeBaseUrl(process.env.FRONTEND_URL);
  if (envBase) return envBase;

  const clientUrl = String(process.env.CLIENT_URL || '')
    .split(',')
    .map((v) => sanitizeBaseUrl(v))
    .find(Boolean);
  if (clientUrl) return clientUrl;

  const origin = sanitizeBaseUrl(req.get('origin'));
  if (origin) return origin;

  return sanitizeBaseUrl(`${req.protocol}://${req.get('host')}`);
}

function resolveApiBaseUrl(req) {
  const envBase = sanitizeBaseUrl(process.env.PUBLIC_API_BASE_URL);
  if (envBase) return envBase;
  return sanitizeBaseUrl(`${req.protocol}://${req.get('host')}`);
}

function getRowValue(row, keys) {
  for (const key of keys) {
    if (row[key] != null && row[key] !== '') return row[key];
  }
  return '';
}

function parseOptionalDate(value) {
  if (value == null || value === '') return undefined;
  const normalized = String(value).trim();
  if (!normalized || Number.isNaN(Date.parse(normalized))) return undefined;
  return new Date(normalized);
}

function parseOptionalNumber(value) {
  if (value == null || value === '') return undefined;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : undefined;
}

function normalizePaymentStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['unpaid', 'partial', 'paid'].includes(normalized) ? normalized : undefined;
}

function buildReminderItem(lead, date) {
  return {
    date,
    leadId: lead._id,
    leadCode: lead.leadId,
    leadName: lead.name,
    destination: lead.destination,
    status: lead.status,
    total_amount: lead.total_amount,
    advance_amount: lead.advance_amount,
    remaining_amount: lead.remaining_amount,
    payment_status: lead.payment_status
  };
}

function normalizePaxBreakup(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      type: String(item?.type || '').trim(),
      count: item?.count != null && item.count !== '' ? Number(item.count) : null
    }))
    .filter((item) => item.type || item.count != null);
}

function summarizePaxBreakup(paxBreakup) {
  const totalCount = paxBreakup.reduce((sum, item) => sum + (Number.isFinite(item.count) ? item.count : 0), 0);
  const paxSummary = paxBreakup
    .map((item) => [item.count != null ? item.count : null, item.type].filter(Boolean).join(' ').trim())
    .filter(Boolean)
    .join(', ');
  return {
    totalCount: totalCount > 0 ? totalCount : null,
    paxSummary: paxSummary || ''
  };
}

function normalizeTripImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

/** Bulk body may be flat { name, phone, email } or { contact: { firstName, lastName, email, phone } } from the leads UI. */
function extractBulkLeadFields(d) {
  let name = (d.name || '').trim();
  let phone = (d.phone || '').trim();
  let email = (d.email || '').trim().toLowerCase();
  if (d.contact && typeof d.contact === 'object') {
    const c = d.contact;
    const fn = (c.firstName || '').trim();
    const ln = (c.lastName || '').trim();
    if (!name) name = [fn, ln].filter(Boolean).join(' ').trim();
    if (!phone) phone = String(c.phone || '').trim().replace(/\s+/g, '');
    if (!email) email = String(c.email || '').trim().toLowerCase();
  }
  return { name, phone, email };
}

function normalizeBulkLeadStatus(raw) {
  const s = String(raw || 'new').toLowerCase().trim().replace(/\s+/g, '_');
  const legacyMap = {
    site_visit_scheduled: 'contacted',
    site_visit_completed: 'contacted',
    negotiation: 'qualified',
    closed: 'booked',
    junk: 'lost',
    invalid: 'lost'
  };
  const mapped = legacyMap[s] || s;
  return VALID_STATUSES.includes(mapped) ? mapped : 'new';
}

/** Superadmin: all leads. Staff (portal): only leads assigned to them — not other portal users' leads. */
function getLeadFilter(req) {
  const filter = {};
  if (req.user.role === 'staff') {
    filter.assigned_to = req.user.id;
  }
  return filter;
}

router.get('/', auth, checkModulePermission(), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 500 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const filter = getLeadFilter(req);
    if (req.query.status) filter.status = req.query.status;
    if (req.query.source) filter.source = req.query.source;
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) filter.createdAt.$gte = new Date(req.query.startDate);
      if (req.query.endDate) { const d = new Date(req.query.endDate); d.setHours(23, 59, 59, 999); filter.createdAt.$lte = d; }
    }
    if (req.query.missed === '1') {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      filter.followups = { $elemMatch: { date: { $lt: startOfToday } } };
    }
    if (req.query.search) {
      const raw = req.query.search.trim();
      const words = raw.split(/\s+/).filter(Boolean);
      const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fields = ['name', 'email', 'phone', 'leadId'];
      if (words.length === 1) {
        const term = escapeRe(words[0]);
        if (term) filter.$or = fields.map((f) => ({ [f]: new RegExp(term, 'i') }));
      } else if (words.length > 1) {
        filter.$and = words.map((word) => ({
          $or: fields.map((f) => ({ [f]: new RegExp(escapeRe(word), 'i') }))
        }));
      }
    }
    const sortOrder = req.query.recent === '1' ? '-updatedAt' : '-createdAt';
    const leads = await Lead.find(filter).sort(sortOrder).skip(skip).limit(limit).populate('assigned_to', 'firstName lastName email').lean();
    const total = await Lead.countDocuments(filter);
    res.json({ leads, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/recent-activity', auth, checkModulePermission(), async (req, res) => {
  try {
    const filter = getLeadFilter(req);
    const limit = Math.min(parseInt(req.query.limit) || 15, 25);
    const activities = await Lead.find(filter)
      .sort('-updatedAt')
      .limit(limit)
      .populate('assigned_to', 'firstName lastName')
      .select('leadId name status updatedAt createdAt assigned_to')
      .lean();
    res.json({ activities });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/analytics/dashboard-metrics', auth, checkModulePermission(), async (req, res) => {
  try {
    const filter = getLeadFilter(req);
    if (req.query.source) filter.source = req.query.source;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) filter.createdAt.$gte = new Date(req.query.startDate);
      if (req.query.endDate) {
        const endDate = new Date(req.query.endDate);
        endDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endDate;
      }
    }
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const activeStatuses = ['new', 'contacted', 'qualified'];
    const todaysFollowUpsFilter = { ...filter, followups: { $elemMatch: { date: { $gte: startOfToday, $lte: endOfToday } } } };
    const missedFollowUpsFilter = { ...filter, status: { $in: activeStatuses }, followups: { $elemMatch: { date: { $lt: startOfToday } } } };

    const [statusCounts, totalLeads, newToday, newThisMonth, bookedCount, todaysFollowUpsCount, missedFollowUpsCount] = await Promise.all([
      Lead.aggregate([{ $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Lead.countDocuments(filter),
      Lead.countDocuments({ ...filter, createdAt: { $gte: startOfToday, $lte: endOfToday } }),
      Lead.countDocuments({ ...filter, createdAt: { $gte: startOfMonth } }),
      Lead.countDocuments({ ...filter, status: 'booked' }),
      Lead.countDocuments(todaysFollowUpsFilter),
      Lead.countDocuments(missedFollowUpsFilter)
    ]);
    const countsMap = {};
    statusCounts.forEach(s => { countsMap[s._id] = s.count; });
    const conversionRate = totalLeads > 0 ? ((bookedCount / totalLeads) * 100).toFixed(2) : 0;

    res.json({
      metrics: {
        totalLeads,
        newLeadsToday: newToday,
        newLeadsThisMonth: newThisMonth,
        conversionRate,
        missedFollowUps: missedFollowUpsCount,
        statusCounts: countsMap,
        todaysFollowUps: { total: todaysFollowUpsCount, completed: 0, pending: todaysFollowUpsCount, completionRate: todaysFollowUpsCount > 0 ? 0 : 100 }
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/upload', auth, allowLeadCreateForPortal(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ message: 'No file uploaded' });
    const ext = (req.file.originalname || '').toLowerCase().split('.').pop();
    let rows = [];
    if (ext === 'csv') {
      const csv = req.file.buffer.toString('utf8');
      const lines = csv.split(/\r?\n/).filter(Boolean);
      const header = lines[0].split(',').map(h => (h || '').trim().toLowerCase().replace(/\s/g, '_'));
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => (v || '').trim());
        const row = {};
        header.forEach((h, j) => { row[h] = values[j] || ''; });
        rows.push(row);
      }
    } else if (ext === 'xlsx' || ext === 'xls') {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const firstSheet = wb.SheetNames[0];
      const ws = wb.Sheets[firstSheet];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      rows = rows.map(r => {
        const out = {};
        for (const [k, v] of Object.entries(r)) {
          const key = String(k).toLowerCase().trim().replace(/\s/g, '_');
          out[key] = v != null ? String(v).trim() : '';
        }
        return out;
      });
    } else {
      return res.status(400).json({ message: 'Only .xlsx or .csv files are allowed' });
    }
    const required = ['name', 'phone', 'email'];
    const statusMap = { new: 'new', contacted: 'contacted', qualified: 'qualified', booked: 'booked', lost: 'lost' };
    const created = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = (r.name || '').trim();
      const phone = (r.phone || '').trim();
      const email = (r.email || '').trim().toLowerCase();
      const destination = (r.destination || '').trim();
      const travelDateRaw = getRowValue(r, ['travel_date', 'traveldate', 'tour_date']);
      const travel_date = parseOptionalDate(travelDateRaw);
      const budgetRaw = r.budget;
      const budget = budgetRaw != null && budgetRaw !== '' ? String(budgetRaw).trim() : undefined;
      const missing = required.filter(f => {
        if (f === 'name') return !name;
        if (f === 'phone') return !phone;
        if (f === 'email') return !email;
        return false;
      });
      if (missing.length) {
        errors.push({ row: i + 1, error: `Missing required: ${missing.join(', ')}` });
        continue;
      }
      const statusRaw = (r.status || 'new').toString().toLowerCase().trim().replace(/\s+/g, '_');
      const status = statusMap[statusRaw] || statusMap[statusRaw.replace(/_/g, '')] || 'new';
      const notes = (r.notes || '').trim() || undefined;
      const packageCost = parseOptionalNumber(getRowValue(r, ['package_cost', 'total_amount', 'package_amount']));
      const total_amount = packageCost;
      const advance_amount = parseOptionalNumber(getRowValue(r, ['advance_amount', 'advance_paid', 'advance']));
      const advanceDueDate = parseOptionalDate(getRowValue(r, ['advance_due_date', 'advance_due', 'advanceduedate']));
      const paymentDueDate = parseOptionalDate(getRowValue(r, ['payment_due_date', 'payment_due', 'paymentduedate', 'final_due_date']));
      const payment_status = normalizePaymentStatus(getRowValue(r, ['payment_status']));
      const noOfPax = parseOptionalNumber(r.no_of_pax);
      const paxCount = Number.isFinite(noOfPax) && noOfPax > 0 ? noOfPax : undefined;
      const paxType = (r.pax_type || '').trim() || undefined;
      const vehicleType = (r.vehicle_type || '').trim() || undefined;
      const hotelCategory = (r.hotel_category || '').trim() || undefined;
      const mealPlan = (r.meal_plan || '').trim() || undefined;
      const tourNightsRaw = parseOptionalNumber(r.tour_nights);
      const tourNights = Number.isFinite(tourNightsRaw) && tourNightsRaw >= 0 ? tourNightsRaw : undefined;
      const tourDaysRaw = parseOptionalNumber(r.tour_days);
      const tourDays = Number.isFinite(tourDaysRaw) && tourDaysRaw >= 0 ? tourDaysRaw : undefined;
      const tourStartDate = parseOptionalDate(getRowValue(r, ['tour_start_date', 'tour_start', 'tourstartdate']));
      const tourEndDate = parseOptionalDate(getRowValue(r, ['tour_end_date', 'tour_end', 'tourenddate']));
      const pickupPoint = (r.pick_up || '').trim() || undefined;
      const dropPoint = (r.drop || '').trim() || undefined;
      const destinationsStr = (r.destinations || '').trim();
      const destinations = destinationsStr ? destinationsStr.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      const inclusions = (r.package_inclusions || '').trim() || undefined;
      const exclusions = (r.package_exclusions || '').trim() || undefined;
      const payment_policy = (r.payment_policy || '').trim() || undefined;
      const cancellation_policy = (r.cancellation_policy || '').trim() || undefined;
      try {
        const lead = new Lead({
          name,
          phone,
          email,
          destination: destination || undefined,
          travel_date,
          budget: budget || undefined,
          status,
          source: 'excel',
          notes,
          total_amount,
          advance_amount,
          advanceDueDate,
          paymentDueDate,
          payment_status,
          paxCount,
          paxType,
          vehicleType,
          hotelCategory,
          mealPlan,
          tourNights,
          tourDays,
          tourStartDate,
          tourEndDate,
          pickupPoint,
          dropPoint,
          destinations,
          inclusions,
          exclusions,
          payment_policy,
          cancellation_policy,
          ...(req.user.role === 'staff' ? { assigned_to: req.user.id } : {})
        });
        await lead.save();
        created.push(lead._id);
      } catch (e) {
        errors.push({ row: i + 1, error: e.message || 'Failed to create lead' });
      }
    }
    res.status(201).json({
      message: `Created ${created.length} of ${rows.length} leads`,
      created: created.length,
      failed: errors.length,
      total: rows.length,
      errors: errors.length ? errors : undefined
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

/** Reminders: payment due for qualified/booked, trips for active leads, plus overdue buckets. */
router.get('/reminders', auth, checkModulePermission(), async (req, res) => {
  try {
    const filter = { ...getLeadFilter(req), status: { $in: REMINDER_TRIP_STATUSES } };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const daysAhead = 5;
    const endDate = new Date(todayStart);
    endDate.setDate(endDate.getDate() + daysAhead);

    const leads = await Lead.find(filter)
      .select('leadId name destination total_amount advance_amount remaining_amount payment_status advanceDueDate paymentDueDate travel_date tourStartDate status')
      .lean();
    const advanceReminders = [];
    const paymentReminders = [];
    const overdueAdvanceReminders = [];
    const overduePaymentReminders = [];
    const tripReminders = [];

    for (const lead of leads) {
      const isPaymentReminderLead = REMINDER_PAYMENT_STATUSES.includes(lead.status);
      const hasPendingPayment = lead.payment_status !== 'paid' || Number(lead.remaining_amount) > 0;

      if (lead.advanceDueDate && hasPendingPayment && isPaymentReminderLead) {
        const advanceDueDate = new Date(lead.advanceDueDate);
        advanceDueDate.setHours(0, 0, 0, 0);
        const reminderItem = buildReminderItem(lead, lead.advanceDueDate);
        if (advanceDueDate < todayStart) {
          overdueAdvanceReminders.push(reminderItem);
        } else if (advanceDueDate <= endDate) {
          advanceReminders.push(reminderItem);
        }
      }

      if (lead.paymentDueDate && hasPendingPayment && isPaymentReminderLead) {
        const paymentDueDate = new Date(lead.paymentDueDate);
        paymentDueDate.setHours(0, 0, 0, 0);
        const reminderItem = buildReminderItem(lead, lead.paymentDueDate);
        if (paymentDueDate < todayStart) {
          overduePaymentReminders.push(reminderItem);
        } else if (paymentDueDate <= endDate) {
          paymentReminders.push(reminderItem);
        }
      }

      const tripDate = lead.travel_date || lead.tourStartDate || null;
      if (tripDate) {
        const normalizedTripDate = new Date(tripDate);
        normalizedTripDate.setHours(0, 0, 0, 0);
        if (normalizedTripDate >= todayStart && normalizedTripDate <= endDate) {
          tripReminders.push(buildReminderItem(lead, tripDate));
        }
      }
    }

    overdueAdvanceReminders.sort((a, b) => new Date(a.date) - new Date(b.date));
    overduePaymentReminders.sort((a, b) => new Date(a.date) - new Date(b.date));
    advanceReminders.sort((a, b) => new Date(a.date) - new Date(b.date));
    paymentReminders.sort((a, b) => new Date(a.date) - new Date(b.date));
    tripReminders.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json({
      overdueAdvanceReminders,
      overduePaymentReminders,
      advanceReminders,
      paymentReminders,
      tripReminders,
      daysAhead,
      paymentLeadStatuses: REMINDER_PAYMENT_STATUSES,
      tripLeadStatuses: REMINDER_TRIP_STATUSES
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

/** Distinct destinations for trip plans filter (leads with travel_date only). */
router.get('/trips/destinations', auth, checkModulePermission(), async (req, res) => {
  try {
    const filter = getLeadFilter(req);
    filter.travel_date = { $exists: true, $ne: null };
    filter.destination = { $exists: true, $nin: [null, ''] };
    const list = await Lead.distinct('destination', filter);
    const destinations = list.map((d) => (d || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    res.json({ destinations });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

/** Trip plans: all leads with travel_date, sorted by travel_date. */
router.get('/trips', auth, checkModulePermission(), [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 200 })
], async (req, res) => {
  try {
    const filter = getLeadFilter(req);
    filter.travel_date = { $exists: true, $ne: null };
    if (req.query.from) filter.travel_date = { ...filter.travel_date, $gte: new Date(req.query.from) };
    if (req.query.to) {
      const to = new Date(req.query.to);
      to.setHours(23, 59, 59, 999);
      filter.travel_date = { ...filter.travel_date, $lte: to };
    }
    if (req.query.destination && String(req.query.destination).trim()) {
      const dest = String(req.query.destination).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.destination = { $regex: new RegExp('^' + dest + '$', 'i') };
    }
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const [trips, total] = await Promise.all([
      Lead.find(filter).sort({ travel_date: 1 }).skip(skip).limit(limit).populate('assigned_to', 'firstName lastName email').lean(),
      Lead.countDocuments(filter)
    ]);
    res.json({ trips, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/duplicate', auth, checkModulePermission(), async (req, res) => {
  try {
    const sourceLead = await Lead.findById(req.params.id).lean();
    if (!sourceLead) return res.status(404).json({ message: 'Lead not found' });

    const assignedId = sourceLead.assigned_to ? sourceLead.assigned_to.toString() : null;
    if (req.user.role === 'staff' && assignedId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      _id,
      leadId,
      createdAt,
      updatedAt,
      __v,
      ...duplicateData
    } = sourceLead;

    const duplicatedLead = new Lead({
      ...duplicateData,
      name: sourceLead.name ? `(Copy) ${sourceLead.name}` : '(Copy)',
      assigned_to: sourceLead.assigned_to || undefined
    });

    await duplicatedLead.save();

    const lead = await Lead.findById(duplicatedLead._id)
      .populate('assigned_to', 'firstName lastName email')
      .lean();

    res.status(201).json({ lead });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

router.get('/:id', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('assigned_to', 'firstName lastName email').lean();
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const assignedId = lead.assigned_to && (lead.assigned_to._id ? lead.assigned_to._id.toString() : lead.assigned_to.toString());
    if (req.user.role === 'staff' && assignedId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    res.json({ lead });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

/** GET /leads/:id/tour-summary-pdf — stream PDF of tour summary for the lead (HTML/CSS via Puppeteer) */
router.get('/:id/tour-summary-pdf', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .select([
        'leadId',
        'assigned_to',
        'total_amount',
        'packageCostPerPerson',
        'paxCount',
        'paxType',
        'paxBreakup',
        'vehicleType',
        'hotelCategory',
        'mealPlan',
        'tourNights',
        'tourDays',
        'tourStartDate',
        'tourEndDate',
        'travel_date',
        'pickupPoint',
        'dropPoint',
        'destinations',
        'destination',
        'accommodation',
        'vehicles',
        'flights',
        'itinerary',
        'inclusions',
        'exclusions',
        'payment_policy',
        'cancellation_policy',
        'termsAndConditions',
        'memorableTrip',
        'tripImages',
        'heroImageUrls'
      ].join(' '))
      .populate('assigned_to', 'firstName lastName email')
      .lean();
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const assignedId = lead.assigned_to && lead.assigned_to._id
      ? lead.assigned_to._id.toString()
      : lead.assigned_to
        ? lead.assigned_to.toString()
        : null;
    if (req.user.role === 'staff' && assignedId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const frontendBaseUrl = resolveFrontendBaseUrl(req);
    const apiBaseUrl = resolveApiBaseUrl(req);
    logLine(`Streaming Summary PDF for lead: ${lead._id} (frontend=${frontendBaseUrl}, api=${apiBaseUrl})`);
    await buildTourSummaryPdf(lead, res, { frontendBaseUrl, apiBaseUrl });
  } catch (err) {
    logLine(`Tour Summary PDF Error: ${err.message}\nStack: ${err.stack}`);
    res.status(500).json({ message: 'Failed to generate summary PDF', error: err.message });
  }
});

/** GET /leads/:id/tour-summary-word — download Word-compatible tour summary for the lead */
router.get('/:id/tour-summary-word', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .select([
        'leadId',
        'assigned_to',
        'destination',
        'travel_date',
        'total_amount',
        'packageCostPerPerson',
        'paxCount',
        'paxType',
        'paxBreakup',
        'vehicleType',
        'hotelCategory',
        'mealPlan',
        'tourNights',
        'tourDays',
        'tourStartDate',
        'tourEndDate',
        'pickupPoint',
        'dropPoint',
        'destinations',
        'accommodation',
        'vehicles',
        'flights',
        'itinerary',
        'tripImages',
        'inclusions',
        'exclusions',
        'payment_policy',
        'cancellation_policy',
        'termsAndConditions',
        'memorableTrip'
      ].join(' '))
      .populate('assigned_to', 'firstName lastName email')
      .lean();
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const assignedId = lead.assigned_to && lead.assigned_to._id
      ? lead.assigned_to._id.toString()
      : lead.assigned_to
        ? lead.assigned_to.toString()
        : null;
    if (req.user.role === 'staff' && assignedId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const leadId = lead.leadId || lead._id?.toString() || 'lead';
    const frontendBaseUrl = resolveFrontendBaseUrl(req);
    const apiBaseUrl = resolveApiBaseUrl(req);
    let html = buildTourSummaryHtml(lead, { frontendBaseUrl, apiBaseUrl });
    
    // Clean HTML to prevent CSS leakage in Word
    html = html.replace(/<head\b[^>]*>([\s\S]*?)<\/head>/gi, "")
               .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
               .replace(/<!DOCTYPE html>/gi, "")
               .replace(/<\/?html\b[^>]*>/gi, "")
               .replace(/<\/?body\b[^>]*>/gi, "");
    
    // Convert HTML to real DOCX buffer
    const HTMLToDOCX = require('html-to-docx');
    const docxBuffer = await HTMLToDOCX(html, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
    });

    logLine(`Streaming Summary Word for lead: ${lead._id}`);
    res.setHeader('Content-Disposition', `attachment; filename="tour-summary-${leadId}.docx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(docxBuffer);
    logLine('Summary Word file sent successfully');
  } catch (err) {
    logLine(`Tour Summary Word Error: ${err.message}\nStack: ${err.stack}`);
    res.status(500).json({ message: 'Failed to generate Word summary', error: err.message });
  }
});

/** POST /leads/convert-to-pdf — generate PDF from server-side HTML (fast, no network needed) */
router.post('/convert-to-pdf', auth, async (req, res) => {
  try {
    const { leadId, data, fileName } = req.body;
    if (!leadId) return res.status(400).json({ message: 'Lead ID is required' });

    logLine(`PDF Generation Started for lead: ${leadId}`);

    // Build HTML server-side from the data the frontend already sent
    const { buildTourQuotationHtml } = require('../lib/tourQuotationHtml');
    const frontendBaseUrl = resolveFrontendBaseUrl(req);
    const apiBaseUrl = resolveApiBaseUrl(req);
    const html = buildTourQuotationHtml(data || {}, { frontendBaseUrl, apiBaseUrl });

    logLine('Rendering PDF via headless Chrome...');
    const { pdfBuffer, chromePath } = renderPdfFromHtml({ html, windowSize: '794,1123', timeoutMs: 30000 });
    logLine(`PDF generated, size: ${pdfBuffer.length} bytes (chrome=${chromePath})`);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": pdfBuffer.length,
      "Content-Disposition": `attachment; filename="${fileName || 'tour-quotation'}.pdf"`
    });

    res.end(pdfBuffer);
    logLine('PDF successfully sent.');
  } catch (error) {
    console.error('PDF External Error:', error);
    logLine(`OUTER ERROR: ${error.message}`);
    res.status(500).json({ 
      message: 'Failed to generate PDF', 
      error: error.message
    });
  }
});

router.post('/:id/duplicate', auth, checkModulePermission(), async (req, res) => {
  try {
    const sourceLead = await Lead.findById(req.params.id).lean();
    if (!sourceLead) return res.status(404).json({ message: 'Lead not found' });

    const assignedId = sourceLead.assigned_to ? sourceLead.assigned_to.toString() : null;
    if (req.user.role === 'staff' && assignedId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      _id,
      leadId,
      createdAt,
      updatedAt,
      __v,
      ...duplicateData
    } = sourceLead;

    const duplicatedLead = new Lead({
      ...duplicateData,
      name: sourceLead.name ? `(Copy) ${sourceLead.name}` : '(Copy)',
      assigned_to: sourceLead.assigned_to || undefined
    });

    await duplicatedLead.save();

    const lead = await Lead.findById(duplicatedLead._id)
      .populate('assigned_to', 'firstName lastName email')
      .lean();

    res.status(201).json({ lead });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

router.get('/:id', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('assigned_to', 'firstName lastName email').lean();
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const assignedId = lead.assigned_to && (lead.assigned_to._id ? lead.assigned_to._id.toString() : lead.assigned_to.toString());
    if (req.user.role === 'staff' && assignedId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    res.json({ lead });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

/** GET /leads/:id/tour-summary-pdf — stream PDF of tour summary for the lead */
router.get('/:id/tour-summary-pdf', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .select([
        'leadId', 'assigned_to', 'total_amount', 'packageCostPerPerson',
        'paxCount', 'paxType', 'paxBreakup', 'vehicleType', 'hotelCategory',
        'mealPlan', 'tourNights', 'tourDays', 'tourStartDate', 'tourEndDate',
        'travel_date', 'pickupPoint', 'dropPoint', 'destinations', 'destination',
        'accommodation', 'vehicles', 'flights', 'itinerary', 'inclusions',
        'exclusions', 'payment_policy', 'cancellation_policy',
        'termsAndConditions', 'memorableTrip', 'tripImages', 'heroImageUrls'
      ].join(' '))
      .populate('assigned_to', 'firstName lastName email')
      .lean();
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const assignedId = lead.assigned_to && lead.assigned_to._id
      ? lead.assigned_to._id.toString()
      : lead.assigned_to ? lead.assigned_to.toString() : null;
    if (req.user.role === 'staff' && assignedId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const frontendBaseUrl = resolveFrontendBaseUrl(req);
    const apiBaseUrl = resolveApiBaseUrl(req);
    logLine(`Streaming Summary PDF for lead: ${lead._id} (frontend=${frontendBaseUrl}, api=${apiBaseUrl})`);
    await buildTourSummaryPdf(lead, res, { frontendBaseUrl, apiBaseUrl });
  } catch (err) {
    logLine(`Tour Summary PDF Error: ${err.message}\nStack: ${err.stack}`);
    res.status(500).json({ message: 'Failed to generate summary PDF', error: err.message });
  }
});

/** GET /leads/:id/tour-summary-word — download Word-compatible tour summary for the lead */
router.get('/:id/tour-summary-word', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .select([
        'leadId', 'assigned_to', 'destination', 'travel_date', 'total_amount',
        'packageCostPerPerson', 'paxCount', 'paxType', 'paxBreakup',
        'vehicleType', 'hotelCategory', 'mealPlan', 'tourNights', 'tourDays',
        'tourStartDate', 'tourEndDate', 'pickupPoint', 'dropPoint',
        'destinations', 'accommodation', 'vehicles', 'flights', 'itinerary',
        'tripImages', 'inclusions', 'exclusions', 'payment_policy',
        'cancellation_policy', 'termsAndConditions', 'memorableTrip'
      ].join(' '))
      .populate('assigned_to', 'firstName lastName email')
      .lean();
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const assignedId = lead.assigned_to && lead.assigned_to._id
      ? lead.assigned_to._id.toString()
      : lead.assigned_to ? lead.assigned_to.toString() : null;
    if (req.user.role === 'staff' && assignedId !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const leadId2 = lead.leadId || lead._id?.toString() || 'lead';
    const frontendBaseUrl = resolveFrontendBaseUrl(req);
    const apiBaseUrl = resolveApiBaseUrl(req);
    let html = buildTourSummaryHtml(lead, { frontendBaseUrl, apiBaseUrl });
    
    html = html.replace(/<head\b[^>]*>([\s\S]*?)<\/head>/gi, "")
               .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, "")
               .replace(/<!DOCTYPE html>/gi, "")
               .replace(/<\/?html\b[^>]*>/gi, "")
               .replace(/<\/?body\b[^>]*>/gi, "");
    
    const HTMLToDOCX = require('html-to-docx');
    const docxBuffer = await HTMLToDOCX(html, null, {
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
    });

    logLine(`Streaming Summary Word for lead: ${lead._id}`);
    res.setHeader('Content-Disposition', `attachment; filename="tour-summary-${leadId2}.docx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.send(docxBuffer);
    logLine('Summary Word file sent successfully');
  } catch (err) {
    logLine(`Tour Summary Word Error: ${err.message}\nStack: ${err.stack}`);
    res.status(500).json({ message: 'Failed to generate Word summary', error: err.message });
  }
});

/** POST /leads/convert-to-docx — A direct JSON -> DOCX generator using 'docx' library (No HTML) */
router.post('/convert-to-docx', auth, async (req, res) => {
  try {
    const { leadId, data, fileName } = req.body;
    if (!leadId) return res.status(400).json({ message: 'Lead ID is required' });

    console.log(`Generating programmatic DOCX for lead: ${leadId}`);
    
    // Execute the new direct generator
    const docxBuffer = await buildTourQuotationDocx(data || {});

    if (!docxBuffer || docxBuffer.length === 0) {
      throw new Error('DOCX generation failed: Buffer is empty');
    }

    res.set({
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Length": docxBuffer.length,
      "Content-Disposition": `attachment; filename="${fileName || 'tour-quotation'}.docx"`
    });
    res.end(docxBuffer);
  } catch (error) {
    console.error('Programmatic Word Generation Error:', error);
    res.status(500).json({ 
      message: 'Failed to generate Word document', 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

router.post('/', auth, allowLeadCreateForPortal(), [
  body('name').trim().notEmpty(),
  body('email').optional({ checkFalsy: true }).isEmail(),
  body('phone').trim().notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    const status = VALID_STATUSES.includes((req.body.status || '').toLowerCase()) ? req.body.status.toLowerCase() : 'new';
    const paxBreakup = normalizePaxBreakup(req.body.paxBreakup);
    const paxBreakupSummary = summarizePaxBreakup(paxBreakup);
    const assignedTo =
      req.user.role === 'staff'
        ? req.user.id
        : (req.body.assigned_to || undefined);
      const lead = new Lead({
      name: req.body.name.trim(),
      phone: req.body.phone.trim(),
      email: req.body.email ? String(req.body.email).trim().toLowerCase() : undefined,
      destination: req.body.destination?.trim() || undefined,
      travel_date: req.body.travel_date ? new Date(req.body.travel_date) : undefined,
      budget: req.body.budget?.trim() || undefined,
      status,
      assigned_to: assignedTo,
      total_amount: Number(req.body.total_amount) || 0,
      advance_amount: Number(req.body.advance_amount) || 0,
        advanceDueDate: req.body.advanceDueDate ? new Date(req.body.advanceDueDate) : undefined,
        paymentDueDate: req.body.paymentDueDate ? new Date(req.body.paymentDueDate) : undefined,
      payment_status: ['unpaid', 'partial', 'paid'].includes(req.body.payment_status) ? req.body.payment_status : 'unpaid',
      source: 'manual',
      notes: req.body.notes?.trim() || '',
      packageCostPerPerson: req.body.packageCostPerPerson != null && req.body.packageCostPerPerson !== '' ? Number(req.body.packageCostPerPerson) : undefined,
      kidsPackageCostPerPerson: req.body.kidsPackageCostPerPerson != null && req.body.kidsPackageCostPerPerson !== '' ? Number(req.body.kidsPackageCostPerPerson) : undefined,
      kidsCount: req.body.kidsCount != null && req.body.kidsCount !== '' ? Number(req.body.kidsCount) : undefined,
      paxCount: paxBreakupSummary.totalCount ?? (req.body.paxCount != null ? Number(req.body.paxCount) : undefined),
      paxType: paxBreakupSummary.paxSummary || req.body.paxType?.trim() || undefined,
      paxBreakup: paxBreakup.length ? paxBreakup : undefined,
      vehicleType: req.body.vehicleType?.trim() || undefined,
      hotelCategory: req.body.hotelCategory?.trim() || undefined,
      mealPlan: req.body.mealPlan?.trim() || undefined,
      tourNights: req.body.tourNights != null ? Number(req.body.tourNights) : undefined,
      tourDays: req.body.tourDays != null ? Number(req.body.tourDays) : undefined,
      tourStartDate: req.body.tourStartDate ? new Date(req.body.tourStartDate) : undefined,
      tourEndDate: req.body.tourEndDate ? new Date(req.body.tourEndDate) : undefined,
      pickupPoint: req.body.pickupPoint?.trim() || undefined,
      dropPoint: req.body.dropPoint?.trim() || undefined,
      destinations: Array.isArray(req.body.destinations) ? req.body.destinations.map((d) => String(d).trim()).filter(Boolean) : undefined,
      accommodation: Array.isArray(req.body.accommodation) ? req.body.accommodation.map((a) => ({
        hotelName: (a.hotelName || '').trim() || '',
        nights: a.nights != null && a.nights !== '' ? Number(a.nights) : null,
        roomType: (a.roomType || '').trim() || '',
        sharing: (a.sharing || '').trim() || '',
        destination: (a.destination || '').trim() || '',
        hotelTotalAmount: a.hotelTotalAmount != null && a.hotelTotalAmount !== '' ? Number(a.hotelTotalAmount) : null,
        hotelPaidAmount: a.hotelPaidAmount != null && a.hotelPaidAmount !== '' ? Number(a.hotelPaidAmount) : null,
        hotelBalanceDueDate: a.hotelBalanceDueDate ? new Date(a.hotelBalanceDueDate) : null
      })).filter((a) => a.hotelName || a.destination) : undefined,
      vehicles: Array.isArray(req.body.vehicles) ? req.body.vehicles.map((v) => ({
        vehicleName: (v.vehicleName || '').trim() || '',
        vehicleType: (v.vehicleType || '').trim() || '',
        vehicleTotalAmount: v.vehicleTotalAmount != null && v.vehicleTotalAmount !== '' ? Number(v.vehicleTotalAmount) : null,
        vehicleAdvanceAmount: v.vehicleAdvanceAmount != null && v.vehicleAdvanceAmount !== '' ? Number(v.vehicleAdvanceAmount) : null,
        vehicleBalanceDueDate: v.vehicleBalanceDueDate ? new Date(v.vehicleBalanceDueDate) : null
      })).filter((v) => v.vehicleName || v.vehicleType || v.vehicleTotalAmount != null || v.vehicleAdvanceAmount != null || v.vehicleBalanceDueDate) : undefined,
      flights: Array.isArray(req.body.flights) ? req.body.flights.map((f) => ({
        from: (f.from || '').trim() || '',
        to: (f.to || '').trim() || '',
        airline: (f.airline || '').trim() || '',
        pnr: (f.pnr || '').trim() || '',
        fare: f.fare != null && f.fare !== '' ? Number(f.fare) : null
      })).filter((f) => f.from || f.to || f.airline || f.pnr || f.fare != null) : undefined,
      tripImages: normalizeTripImages(req.body.tripImages),
      itinerary: Array.isArray(req.body.itinerary) ? req.body.itinerary.map((item) => ({
        day: item.day != null && item.day !== '' ? Number(item.day) : null,
        route: (item.route || '').trim() || '',
        description: (item.description || '').trim() || '',
        places: Array.isArray(item.places) ? item.places.map((p) => String(p).trim()).filter(Boolean) : []
      })).filter((item) => item.day != null || item.route || item.description || (item.places && item.places.length)) : undefined,
      inclusions: req.body.inclusions != null ? String(req.body.inclusions).trim() : undefined,
      exclusions: req.body.exclusions != null ? String(req.body.exclusions).trim() : undefined,
      payment_policy: req.body.payment_policy != null ? String(req.body.payment_policy).trim() : undefined,
      cancellation_policy: req.body.cancellation_policy != null ? String(req.body.cancellation_policy).trim() : undefined,
      termsAndConditions: req.body.termsAndConditions != null ? String(req.body.termsAndConditions).trim() : undefined,
      memorableTrip: req.body.memorableTrip != null ? String(req.body.memorableTrip).trim() : undefined,
      packageName: req.body.packageName != null ? String(req.body.packageName).trim() : undefined
    });
    await lead.save();
    const leadObj = await Lead.findById(lead._id).populate('assigned_to', 'firstName lastName email').lean();
    res.status(201).json({ lead: leadObj });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ message: 'Validation error', errors: Object.values(err.errors).map(e => ({ message: e.message })) });
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    if (req.user.role === 'staff') {
      const assignedId = lead.assigned_to ? lead.assigned_to.toString() : null;
      if (assignedId !== req.user.id) return res.status(403).json({ message: 'Access denied' });
    }

    const allowed = ['name', 'phone', 'email', 'packageName', 'destination', 'travel_date', 'budget', 'status', 'assigned_to', 'total_amount', 'advance_amount', 'advanceDueDate', 'paymentDueDate', 'payment_status', 'notes', 'followups',
      'packageCostPerPerson', 'kidsPackageCostPerPerson', 'kidsCount', 'paxCount', 'paxType', 'paxBreakup', 'vehicleType', 'hotelCategory', 'mealPlan', 'tourNights', 'tourDays', 'tourStartDate', 'tourEndDate', 'pickupPoint', 'dropPoint', 'destinations', 'accommodation', 'vehicles', 'flights', 'tripImages', 'itinerary', 'inclusions', 'exclusions', 'payment_policy', 'cancellation_policy', 'termsAndConditions', 'memorableTrip'];
    allowed.forEach(f => {
      if (req.body[f] === undefined) return;
        if (f === 'travel_date') lead.travel_date = req.body[f] ? new Date(req.body[f]) : undefined;
        else if (f === 'tourStartDate') lead.tourStartDate = req.body[f] ? new Date(req.body[f]) : undefined;
        else if (f === 'tourEndDate') lead.tourEndDate = req.body[f] ? new Date(req.body[f]) : undefined;
        else if (f === 'advanceDueDate') lead.advanceDueDate = req.body[f] ? new Date(req.body[f]) : null;
        else if (f === 'paymentDueDate') lead.paymentDueDate = req.body[f] ? new Date(req.body[f]) : null;
        else if (f === 'followups' && Array.isArray(req.body[f])) lead.followups = req.body[f];
        else if (f === 'destinations' && Array.isArray(req.body[f])) lead.destinations = req.body[f].map((d) => String(d).trim()).filter(Boolean);
        else if (f === 'accommodation' && Array.isArray(req.body[f])) {
          lead.accommodation = req.body[f]
            .map((a) => ({
              hotelName: (a.hotelName || '').trim() || '',
              nights: a.nights != null && a.nights !== '' ? Number(a.nights) : null,
              roomType: (a.roomType || '').trim() || '',
              sharing: (a.sharing || '').trim() || '',
              destination: (a.destination || '').trim() || '',
              hotelTotalAmount: a.hotelTotalAmount != null && a.hotelTotalAmount !== '' ? Number(a.hotelTotalAmount) : null,
              hotelPaidAmount: a.hotelPaidAmount != null && a.hotelPaidAmount !== '' ? Number(a.hotelPaidAmount) : null,
              hotelBalanceDueDate: a.hotelBalanceDueDate ? new Date(a.hotelBalanceDueDate) : null
            }))
            .filter((a) => a.hotelName || a.destination);
        } else if (f === 'vehicles' && Array.isArray(req.body[f])) {
          lead.vehicles = req.body[f]
            .map((v) => ({
              vehicleName: (v.vehicleName || '').trim() || '',
              vehicleType: (v.vehicleType || '').trim() || '',
              vehicleTotalAmount: v.vehicleTotalAmount != null && v.vehicleTotalAmount !== '' ? Number(v.vehicleTotalAmount) : null,
              vehicleAdvanceAmount: v.vehicleAdvanceAmount != null && v.vehicleAdvanceAmount !== '' ? Number(v.vehicleAdvanceAmount) : null,
              vehicleBalanceDueDate: v.vehicleBalanceDueDate ? new Date(v.vehicleBalanceDueDate) : null
            }))
            .filter((v) => v.vehicleName || v.vehicleType || v.vehicleTotalAmount != null || v.vehicleAdvanceAmount != null || v.vehicleBalanceDueDate);
        } else if (f === 'flights' && Array.isArray(req.body[f])) {
          lead.flights = req.body[f]
            .map((fl) => ({
              from: (fl.from || '').trim() || '',
              to: (fl.to || '').trim() || '',
              airline: (fl.airline || '').trim() || '',
              pnr: (fl.pnr || '').trim() || '',
              fare: fl.fare != null && fl.fare !== '' ? Number(fl.fare) : null
            }))
            .filter((fl) => fl.from || fl.to || fl.airline || fl.pnr || fl.fare != null);
        } else if (f === 'tripImages' && Array.isArray(req.body[f])) {
          lead.tripImages = normalizeTripImages(req.body[f]);
        } else if (f === 'itinerary' && Array.isArray(req.body[f])) {
          lead.itinerary = req.body[f]
            .map((item) => ({
              day: item.day != null && item.day !== '' ? Number(item.day) : null,
              route: (item.route || '').trim() || '',
              description: (item.description || '').trim() || '',
              places: Array.isArray(item.places) ? item.places.map((p) => String(p).trim()).filter(Boolean) : []
            }))
            .filter((item) => item.day != null || item.route || item.description || (item.places && item.places.length));
        } else if (f === 'paxBreakup' && Array.isArray(req.body[f])) {
          lead.paxBreakup = normalizePaxBreakup(req.body[f]);
          const paxBreakupSummary = summarizePaxBreakup(lead.paxBreakup);
          lead.paxCount = paxBreakupSummary.totalCount;
          lead.paxType = paxBreakupSummary.paxSummary;
        } else if (f === 'packageCostPerPerson' || f === 'kidsPackageCostPerPerson' || f === 'kidsCount' || f === 'paxCount' || f === 'tourNights' || f === 'tourDays') lead[f] = req.body[f] != null && req.body[f] !== '' ? Number(req.body[f]) : null;
        else lead[f] = req.body[f];
      });
    await lead.save();
    const leadObj = await Lead.findById(lead._id).populate('assigned_to', 'firstName lastName email').lean();
    res.json({ lead: leadObj });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ message: 'Validation error' });
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', auth, requireSuperadmin(), async (req, res) => {
  try {
    const lead = await Lead.findByIdAndDelete(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    res.json({ message: 'Lead deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/bulk', auth, allowLeadCreateForPortal(), async (req, res) => {
  try {
    const { leads } = req.body;
    if (!leads || !Array.isArray(leads) || leads.length === 0) return res.status(400).json({ message: 'No leads data provided' });
    const created = [];
    const errors = [];
    for (let i = 0; i < leads.length; i++) {
      const d = leads[i];
      const { name, phone, email } = extractBulkLeadFields(d);
      if (!name || !phone || !email) {
        errors.push({ row: i + 1, error: 'Missing required fields: name, phone, email' });
        continue;
      }
      try {
        const status = normalizeBulkLeadStatus(d.status);
        const lead = new Lead({
          name,
          phone,
          email,
          destination: (d.destination || '').trim() || undefined,
          travel_date: d.travel_date ? new Date(d.travel_date) : undefined,
          budget: (d.budget || '').trim() || undefined,
          status,
          source: 'excel',
          ...(req.user.role === 'staff' ? { assigned_to: req.user.id } : {})
        });
        await lead.save();
        created.push(lead._id);
      } catch (e) {
        errors.push({ row: i + 1, error: e.message || 'Failed to create lead' });
      }
    }
    res.status(201).json({
      message: `Created ${created.length} of ${leads.length} leads`,
      created: created.length,
      failed: errors.length,
      total: leads.length,
      errors: errors.length ? errors : undefined
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id/assign', auth, requireSuperadmin(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    lead.assigned_to = req.body.assigned_to || null;
    await lead.save();
    const leadObj = await Lead.findById(lead._id).populate('assigned_to', 'firstName lastName email').lean();
    res.json({ lead: leadObj });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
