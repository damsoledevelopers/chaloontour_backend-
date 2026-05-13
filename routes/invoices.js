const express = require('express');
const { body, validationResult } = require('express-validator');

const Invoice = require('../models/Invoice');
const Lead = require('../models/Lead');
const { auth, checkModulePermission } = require('../middleware/auth');

const router = express.Router();

const PAYMENT_METHODS = ['UPI', 'Cash', 'Bank', 'Card'];

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function parseDateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function getLeadAssignedUserId(lead) {
  if (!lead?.assigned_to) return null;
  return String(lead.assigned_to?._id || lead.assigned_to);
}

function canAccessInvoice(invoice, reqUser) {
  if (!invoice || !reqUser) return false;
  if (reqUser.role === 'superadmin') return true;

  const createdById = invoice.createdBy ? String(invoice.createdBy?._id || invoice.createdBy) : null;
  if (createdById === reqUser.id) return true;

  const assignedLeadUserId = getLeadAssignedUserId(invoice.lead);
  return assignedLeadUserId === reqUser.id;
}

async function getAccessibleLead(req, leadId) {
  if (!leadId) return null;
  const lead = await Lead.findById(leadId).select('_id assigned_to leadId name').lean();
  if (!lead) return null;
  if (req.user.role === 'staff' && getLeadAssignedUserId(lead) !== req.user.id) {
    return 'forbidden';
  }
  return lead;
}

async function buildNextReceiptNumber() {
  const lastInvoice = await Invoice.findOne({ receiptNumber: { $exists: true, $ne: null } })
    .sort({ receiptNumber: -1 })
    .select('receiptNumber')
    .lean();

  let nextNumber = 1;
  if (lastInvoice?.receiptNumber) {
    const match = String(lastInvoice.receiptNumber).match(/\d+$/);
    if (match) nextNumber = parseInt(match[0], 10) + 1;
  }

  return `COT/${String(nextNumber).padStart(3, '0')}`;
}

function assignInvoiceFields(invoice, body, createdById) {
  invoice.sourceType = body.sourceType === 'lead' ? 'lead' : 'manual';
  invoice.lead = invoice.sourceType === 'lead' && body.selectedLeadId ? body.selectedLeadId : null;
  invoice.createdBy = createdById || invoice.createdBy;
  invoice.receiptNumber = String(body.receiptNumber || '').trim() || invoice.receiptNumber;
  invoice.receiptDate = parseDateOrNull(body.receiptDate) || new Date();
  invoice.officeAddress = String(body.officeAddress || '').trim();
  invoice.companyName = String(body.companyName || '').trim();
  invoice.website = String(body.website || '').trim();
  invoice.customerName = String(body.customerName || '').trim();
  invoice.contactNumbers = normalizeStringArray(body.contactNumbers);
  invoice.email = String(body.email || '').trim().toLowerCase();
  invoice.address = String(body.address || '').trim();
  invoice.tourName = String(body.tourName || '').trim();
  invoice.tourDuration = String(body.tourDuration || '').trim();
  invoice.startDate = parseDateOrNull(body.startDate);
  invoice.endDate = parseDateOrNull(body.endDate);
  invoice.pricePerPerson = toPositiveNumber(body.pricePerPerson);
  invoice.numberOfPersons = toPositiveNumber(body.numberOfPersons);
  invoice.kidsPricePerPerson = toPositiveNumber(body.kidsPricePerPerson);
  invoice.kidsCount = toPositiveNumber(body.kidsCount);
  invoice.touristNames = normalizeStringArray(body.touristNames);
  invoice.advanceAmount = toPositiveNumber(body.advanceAmount);
  invoice.paymentMethod = PAYMENT_METHODS.includes(body.paymentMethod) ? body.paymentMethod : 'UPI';
  invoice.paymentDate = parseDateOrNull(body.paymentDate);
  invoice.transactionId = String(body.transactionId || '').trim();
}

router.get('/meta/next-receipt-number', auth, checkModulePermission(), async (req, res) => {
  try {
    const receiptNumber = await buildNextReceiptNumber();
    res.json({ receiptNumber });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/', auth, checkModulePermission(), async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .populate('lead', 'leadId name assigned_to')
      .populate('createdBy', 'firstName lastName email role')
      .sort('-createdAt')
      .lean();

    const filteredInvoices = req.user.role === 'staff'
      ? invoices.filter((invoice) => canAccessInvoice(invoice, req.user))
      : invoices;

    res.json({ invoices: filteredInvoices });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', auth, checkModulePermission(), async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('lead', 'leadId name assigned_to')
      .populate('createdBy', 'firstName lastName email role')
      .lean();

    if (!invoice) return res.status(404).json({ message: 'Receipt not found' });
    if (!canAccessInvoice(invoice, req.user)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ invoice });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', auth, checkModulePermission(), [
  body('sourceType').optional().isIn(['lead', 'manual']),
  body('companyName').trim().notEmpty(),
  body('customerName').trim().notEmpty(),
  body('tourName').trim().notEmpty(),
  body('receiptDate').notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    if (req.body.sourceType === 'lead' && !req.body.selectedLeadId) {
      return res.status(400).json({ message: 'Lead selection is required for lead receipts' });
    }

    if (req.body.sourceType === 'lead') {
      const lead = await getAccessibleLead(req, req.body.selectedLeadId);
      if (!lead) return res.status(404).json({ message: 'Lead not found' });
      if (lead === 'forbidden') return res.status(403).json({ message: 'Access denied' });
    }

    const invoice = new Invoice();
    assignInvoiceFields(invoice, req.body, req.user.id);
    await invoice.save();

    const savedInvoice = await Invoice.findById(invoice._id)
      .populate('lead', 'leadId name assigned_to')
      .populate('createdBy', 'firstName lastName email role')
      .lean();

    res.status(201).json({ invoice: savedInvoice });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Receipt number already exists' });
    }
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

router.put('/:id', auth, checkModulePermission(), [
  body('sourceType').optional().isIn(['lead', 'manual']),
  body('companyName').trim().notEmpty(),
  body('customerName').trim().notEmpty(),
  body('tourName').trim().notEmpty(),
  body('receiptDate').notEmpty(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const invoice = await Invoice.findById(req.params.id).populate('lead', 'assigned_to');
    if (!invoice) return res.status(404).json({ message: 'Receipt not found' });
    if (!canAccessInvoice(invoice, req.user)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (req.body.sourceType === 'lead' && !req.body.selectedLeadId) {
      return res.status(400).json({ message: 'Lead selection is required for lead receipts' });
    }

    if (req.body.sourceType === 'lead') {
      const lead = await getAccessibleLead(req, req.body.selectedLeadId);
      if (!lead) return res.status(404).json({ message: 'Lead not found' });
      if (lead === 'forbidden') return res.status(403).json({ message: 'Access denied' });
    }

    assignInvoiceFields(invoice, req.body);
    await invoice.save();

    const savedInvoice = await Invoice.findById(invoice._id)
      .populate('lead', 'leadId name assigned_to')
      .populate('createdBy', 'firstName lastName email role')
      .lean();

    res.json({ invoice: savedInvoice });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ message: 'Receipt number already exists' });
    }
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

router.delete('/:id', auth, checkModulePermission(), async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('lead', 'assigned_to')
      .populate('createdBy', '_id');

    if (!invoice) return res.status(404).json({ message: 'Receipt not found' });
    if (!canAccessInvoice(invoice, req.user)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await Invoice.deleteOne({ _id: invoice._id });
    res.json({ message: 'Receipt deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
