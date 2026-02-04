const express = require('express');
const { body, validationResult, query } = require('express-validator');
const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const { auth, checkModulePermission, validateEntryPermission, validateAgencyIsolation } = require('../middleware/auth');
const encryptionService = require('../services/encryptionService');

const router = express.Router();

const getNormalizedPriority = (priority) => {
  const map = { high: 'Hot', medium: 'Warm', low: 'Cold', hot: 'Hot', warm: 'Warm', cold: 'Cold', not_interested: 'Not_interested' };
  if (!priority) return 'Warm';
  const p = String(priority).toLowerCase();
  if (['Hot', 'Warm', 'Cold', 'Not_interested'].find(v => v.toLowerCase() === p)) return p.charAt(0).toUpperCase() + p.slice(1);
  return map[p] || 'Warm';
};

const getNormalizedSource = (source) => {
  const map = { fb: 'social_media', facebook: 'social_media', call: 'phone' };
  const valid = ['website', 'phone', 'email', 'walk_in', 'referral', 'social_media', 'other'];
  if (!source) return 'website';
  const s = String(source).toLowerCase();
  return map[s] || (valid.includes(s) ? s : 'other');
};

const normalizeLeadData = (lead) => {
  if (lead) {
    lead.priority = getNormalizedPriority(lead.priority);
    lead.source = getNormalizedSource(lead.source);
  }
  return lead;
};

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
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.source) filter.source = req.query.source;
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) filter.createdAt.$gte = new Date(req.query.startDate);
      if (req.query.endDate) { const d = new Date(req.query.endDate); d.setHours(23, 59, 59, 999); filter.createdAt.$lte = d; }
    }
    if (req.query.search) {
      const raw = req.query.search.trim();
      const words = raw.split(/\s+/).filter(Boolean);
      const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fields = [
        'contact.firstName',
        'contact.lastName',
        'contact.email',
        'contact.phone',
        'leadId'
      ];
      if (words.length === 1) {
        const term = escapeRe(words[0]);
        if (term) filter.$or = fields.map((f) => ({ [f]: new RegExp(term, 'i') }));
      } else if (words.length > 1) {
        filter.$and = words.map((word) => ({
          $or: fields.map((f) => ({ [f]: new RegExp(escapeRe(word), 'i') }))
        }));
      }
    }
    const leads = await Lead.find(filter).sort('-createdAt').skip(skip).limit(limit).lean();
    const decrypted = leads.map(l => {
      const o = { ...l };
      if (o.contact) o.contact = encryptionService.decryptLeadContact(o.contact);
      return normalizeLeadData(o);
    });
    const total = await Lead.countDocuments(filter);
    res.json({ leads: decrypted, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

const activeStatuses = ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation'];

router.get('/analytics/dashboard-metrics', auth, checkModulePermission(), async (req, res) => {
  try {
    const filter = {};
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
    const baseFilterWithoutDates = { ...filter };
    delete baseFilterWithoutDates.createdAt;

    const statsAggregation = await Lead.aggregate([
      { $match: filter },
      { $facet: {
        statusCounts: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        totalLeads: [{ $count: 'count' }]
      } }
    ]);
    const stats = statsAggregation[0];
    const totalLeads = stats.totalLeads[0]?.count || 0;
    const countsMap = {};
    (stats.statusCounts || []).forEach(s => { countsMap[s._id] = s.count; });
    const convertedLeadsSet = (countsMap['booked'] || 0) + (countsMap['closed'] || 0);
    const conversionRate = totalLeads > 0 ? ((convertedLeadsSet / totalLeads) * 100).toFixed(2) : 0;

    const timeMetrics = await Lead.aggregate([
      { $match: baseFilterWithoutDates },
      { $facet: {
        newToday: [{ $match: { createdAt: { $gte: startOfToday, $lte: endOfToday } } }, { $count: 'count' }],
        newThisMonth: [{ $match: { createdAt: { $gte: startOfMonth } } }, { $count: 'count' }],
        todaysFollowUps: [
          { $match: { followUpDate: { $gte: startOfToday, $lte: endOfToday } } },
          { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $in: ['$status', ['booked', 'closed', 'site_visit_completed']] }, 1, 0] } }, pending: { $sum: { $cond: [{ $in: ['$status', activeStatuses] }, 1, 0] } } } }
        ],
        missedFollowUps: [{ $match: { followUpDate: { $lt: startOfToday }, status: { $in: activeStatuses } } }, { $count: 'count' }]
      } }
    ]);
    const tMetrics = timeMetrics[0];
    const newLeadsToday = tMetrics.newToday[0]?.count || 0;
    const newLeadsThisMonth = tMetrics.newThisMonth[0]?.count || 0;
    const missedFollowUps = tMetrics.missedFollowUps[0]?.count || 0;
    const followUps = tMetrics.todaysFollowUps[0] || { total: 0, completed: 0, pending: 0 };

    res.json({
      metrics: {
        totalLeads,
        newLeadsToday,
        newLeadsThisMonth,
        conversionRate,
        missedFollowUps,
        statusCounts: countsMap,
        todaysFollowUps: { total: followUps.total, completed: followUps.completed, pending: followUps.pending, completionRate: followUps.total > 0 ? ((followUps.completed / followUps.total) * 100).toFixed(1) : 0 }
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    if (lead.contact) lead.contact = encryptionService.decryptLeadContact(lead.contact);
    res.json({ lead: normalizeLeadData(lead) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', auth, checkModulePermission(), [
  body('contact.firstName').trim().notEmpty(),
  body('contact.lastName').trim().notEmpty(),
  body('contact.email').isEmail(),
  body('contact.phone').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    const priority = getNormalizedPriority(req.body.priority);
    const source = getNormalizedSource(req.body.source);
    const validStatuses = ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booked', 'lost', 'closed', 'junk'];
    const status = req.body.status && validStatuses.includes(String(req.body.status).toLowerCase()) ? req.body.status.toLowerCase() : 'new';
    const contact = encryptionService.encryptLeadContact({
      firstName: req.body.contact.firstName.trim(),
      lastName: (req.body.contact.lastName || '').trim(),
      email: req.body.contact.email.trim().toLowerCase(),
      phone: (req.body.contact.phone || '').trim(),
      alternatePhone: req.body.contact.alternatePhone,
      address: req.body.contact.address || {}
    });
    const lead = new Lead({
      contact,
      source,
      status,
      priority,
      agency: req.body.agency || null,
      inquiry: req.body.inquiry || {},
      activityLog: [{ action: 'lead_created', details: { description: 'Lead created' }, performedBy: req.user.id }]
    });
    await lead.save();
    const leadObj = lead.toObject();
    if (leadObj.contact) leadObj.contact = encryptionService.decryptLeadContact(leadObj.contact);
    res.status(201).json({ lead: normalizeLeadData(leadObj) });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ message: 'Validation error', errors: Object.values(err.errors).map(e => ({ message: e.message })) });
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const entryPerm = validateEntryPermission(lead, req.user, 'edit');
    if (!entryPerm.allowed) return res.status(403).json({ message: 'Access denied' });
    const agencyCheck = validateAgencyIsolation(lead, req.user);
    if (!agencyCheck.allowed) return res.status(403).json({ message: 'Access denied' });
    if (req.body.priority) req.body.priority = getNormalizedPriority(req.body.priority);
    if (req.body.source) req.body.source = getNormalizedSource(req.body.source);
    if (req.body.status) {
      const valid = ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booked', 'lost', 'closed', 'junk'];
      if (valid.includes(req.body.status.toLowerCase())) req.body.status = req.body.status.toLowerCase();
    }
    if (req.body.contact) req.body.contact = encryptionService.encryptLeadContact(req.body.contact);
    const prevStatus = lead.status;
    Object.assign(lead, req.body);
    if (req.body.status && req.body.status !== prevStatus) {
      lead.activityLog.push({ action: 'status_change', details: { field: 'status', oldValue: prevStatus, newValue: req.body.status }, performedBy: req.user.id });
    }
    await lead.save();
    const leadObj = lead.toObject();
    if (leadObj.contact) leadObj.contact = encryptionService.decryptLeadContact(leadObj.contact);
    res.json({ lead: normalizeLeadData(leadObj) });
  } catch (err) {
    if (err.name === 'ValidationError') return res.status(400).json({ message: 'Validation error' });
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const entryPerm = validateEntryPermission(lead, req.user, 'delete');
    if (!entryPerm.allowed) return res.status(403).json({ message: 'Access denied' });
    const agencyCheck = validateAgencyIsolation(lead, req.user);
    if (!agencyCheck.allowed) return res.status(403).json({ message: 'Access denied' });
    await Lead.findByIdAndDelete(req.params.id);
    res.json({ message: 'Lead deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/bulk', auth, checkModulePermission(), async (req, res) => {
  try {
    const { leads } = req.body;
    if (!leads || !Array.isArray(leads) || leads.length === 0) return res.status(400).json({ message: 'No leads data provided' });
    const createdLeads = [];
    const errors = [];
    const duplicates = [];
    const priorityMap = { hot: 'Hot', warm: 'Warm', cold: 'Cold', not_interested: 'Not_interested' };
    const validSources = ['website', 'phone', 'email', 'walk_in', 'referral', 'social_media', 'other'];
    for (let i = 0; i < leads.length; i++) {
      const d = leads[i];
      try {
        if (!d.contact || !d.contact.firstName?.trim() || !d.contact.email?.trim() || !d.contact.phone?.trim()) {
          errors.push({ row: i + 1, error: 'Missing required contact fields' });
          continue;
        }
        const emailLower = d.contact.email.trim().toLowerCase();
        const existing = await Lead.findOne({ 'contact.email': emailLower }).lean();
        if (existing) {
          duplicates.push({ row: i + 1, email: emailLower, reason: 'Lead with this email already exists' });
          continue;
        }
        const contact = encryptionService.encryptLeadContact({
          firstName: d.contact.firstName.trim(),
          lastName: (d.contact.lastName || '').trim(),
          email: emailLower,
          phone: d.contact.phone.trim(),
          alternatePhone: d.contact.alternatePhone,
          address: d.contact.address || {}
        });
        const lead = new Lead({
          contact,
          status: ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booked', 'lost', 'closed', 'junk'].includes((d.status || '').toLowerCase()) ? d.status.toLowerCase() : 'new',
          priority: priorityMap[(d.priority || '').toLowerCase().replace(/\s/g, '_')] || 'Warm',
          source: validSources.includes((d.source || '').toLowerCase()) ? d.source.toLowerCase() : 'other',
          agency: d.agency || null,
          inquiry: d.inquiry || {}
        });
        await lead.save();
        createdLeads.push(lead._id);
      } catch (e) {
        errors.push({ row: i + 1, error: e.message || 'Failed to create lead' });
      }
    }
    res.status(201).json({
      message: `Created ${createdLeads.length} of ${leads.length} leads${duplicates.length ? `; ${duplicates.length} duplicate(s) skipped` : ''}`,
      created: createdLeads.length,
      failed: errors.length,
      duplicates: duplicates.length,
      total: leads.length,
      errors: errors.length ? errors : undefined,
      duplicateRows: duplicates.length ? duplicates : undefined
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id/assign', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    const { assignedAgent } = req.body;
    lead.assignedAgent = assignedAgent || null;
    lead.assignedBy = req.user.id;
    await lead.save();
    const leadObj = lead.toObject();
    if (leadObj.contact) leadObj.contact = encryptionService.decryptLeadContact(leadObj.contact);
    res.json({ lead: normalizeLeadData(leadObj) });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/auto-assign', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    res.json({ message: 'Auto-assign not configured', lead: lead });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/re-score', auth, checkModulePermission(), async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    res.json({ message: 'OK', lead: lead });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id/entry-permissions', auth, checkModulePermission(), async (req, res) => {
  try {
    const { entryPermissions } = req.body;
    if (!entryPermissions) return res.status(400).json({ message: 'entryPermissions required' });
    const lead = await Lead.findByIdAndUpdate(req.params.id, { $set: { entryPermissions } }, { new: true });
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    res.json(lead);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
