const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  leadId: { type: String, unique: true, sparse: true },
  source: { type: String, enum: ['website', 'phone', 'email', 'walk_in', 'referral', 'social_media', 'other'], default: 'website' },
  campaignName: { type: String, trim: true },
  property: { type: mongoose.Schema.Types.ObjectId, ref: 'Property' },
  contact: {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    alternatePhone: String,
    address: { street: String, city: String, state: String, country: String, zipCode: String }
  },
  inquiry: {
    message: String,
    budget: { min: Number, max: Number, currency: { type: String, default: 'USD' } },
    preferredLocation: [String],
    propertyType: [String],
    timeline: { type: String, enum: ['immediate', '1_month', '3_months', '6_months', '1_year', 'flexible'] },
    requirements: String
  },
  status: { type: String, enum: ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation', 'booked', 'lost', 'closed', 'junk'], default: 'new' },
  priority: { type: String, enum: ['Hot', 'Warm', 'Cold', 'Not_interested'], default: 'Warm' },
  agency: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency' },
  assignedAgent: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  team: { type: String, trim: true },
  notes: [{ note: { type: String, required: true }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, createdAt: { type: Date, default: Date.now } }],
  communications: [{ type: { type: String, enum: ['call', 'email', 'sms', 'meeting', 'note'], required: true }, subject: String, message: String, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, createdAt: { type: Date, default: Date.now } }],
  tasks: [{ title: { type: String, required: true }, taskType: { type: String, enum: ['call_back', 'site_visit', 'meeting', 'other'], default: 'other' }, dueDate: Date, status: { type: String, enum: ['pending', 'in_progress', 'completed', 'cancelled'], default: 'pending' }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, createdAt: { type: Date, default: Date.now } }],
  followUpDate: Date,
  reminders: [{ title: { type: String, required: true }, reminderDate: { type: Date, required: true }, createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, createdAt: { type: Date, default: Date.now } }],
  lostReason: String,
  tags: [String],
  score: { type: Number, default: 0, min: 0, max: 100 },
  activityLog: [{ action: { type: String, required: true }, details: { field: String, oldValue: mongoose.Schema.Types.Mixed, newValue: mongoose.Schema.Types.Mixed }, performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, timestamp: { type: Date, default: Date.now } }],
  entryPermissions: {
    agency_admin: { view: Boolean, edit: Boolean, delete: Boolean },
    agent: { view: Boolean, edit: Boolean, delete: Boolean },
    staff: { view: Boolean, edit: Boolean, delete: Boolean }
  }
}, { timestamps: true });

leadSchema.pre('save', async function (next) {
  if (!this.leadId) {
    try {
      const Lead = mongoose.model('Lead');
      const lastLead = await Lead.findOne({ leadId: { $exists: true, $ne: null } }).sort({ leadId: -1 }).select('leadId');
      let nextNumber = 1;
      if (lastLead && lastLead.leadId) {
        const match = lastLead.leadId.match(/\d+$/);
        if (match) nextNumber = parseInt(match[0], 10) + 1;
      }
      let attempts = 0;
      do {
        const newLeadId = `LEAD-${String(nextNumber).padStart(6, '0')}`;
        const exists = await Lead.findOne({ leadId: newLeadId });
        if (!exists) { this.leadId = newLeadId; break; }
        nextNumber++;
        if (++attempts > 100) { this.leadId = `LEAD-${Date.now().toString().slice(-6)}`; break; }
      } while (true);
    } catch (err) {
      this.leadId = `LEAD-${Date.now().toString().slice(-6)}`;
    }
  }
  next();
});

leadSchema.index({ 'contact.email': 1, 'contact.phone': 1 });
leadSchema.index({ status: 1, priority: 1 });
leadSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Lead', leadSchema);
