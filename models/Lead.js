const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  leadId: { type: String, unique: true, sparse: true },
  name: { type: String, required: true, trim: true },
  phone: { type: String, required: true, trim: true },
  email: { type: String, required: false, lowercase: true, trim: true },
  packageName: { type: String, trim: true, default: '' },
  destination: { type: String, trim: true },
  travel_date: { type: Date },
  budget: { type: String, trim: true },
  status: { type: String, enum: ['new', 'contacted', 'qualified', 'booked', 'lost'], default: 'new' },
  assigned_to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  total_amount: { type: Number, default: 0 },
  advance_amount: { type: Number, default: 0 },
  remaining_amount: { type: Number, default: 0 },
  advanceDueDate: { type: Date, default: null },
  paymentDueDate: { type: Date, default: null },
  payment_status: { type: String, enum: ['unpaid', 'partial', 'paid'], default: 'unpaid' },
  source: { type: String, enum: ['manual', 'excel'], default: 'manual' },
  notes: { type: String, default: '' },
  followups: [{ date: { type: Date, required: true }, note: { type: String, required: true } }],
  // Tour Summary (Phase 1)
  packageCostPerPerson: { type: Number, default: null },
  kidsPackageCostPerPerson: { type: Number, default: null },
  kidsCount: { type: Number, default: null },
  paxCount: { type: Number, default: null },
  paxType: { type: String, trim: true, default: '' },
  paxBreakup: [{
    type: { type: String, trim: true, default: '' },
    count: { type: Number, default: null }
  }],
  vehicleType: { type: String, trim: true, default: '' },
  hotelCategory: { type: String, trim: true, default: '' },
  mealPlan: { type: String, trim: true, default: '' },
  tourNights: { type: Number, default: null },
  tourDays: { type: Number, default: null },
  tourStartDate: { type: Date, default: null },
  tourEndDate: { type: Date, default: null },
  pickupPoint: { type: String, trim: true, default: '' },
  dropPoint: { type: String, trim: true, default: '' },
  destinations: [{ type: String, trim: true }],
  // Accommodation (Phase 2): hotel-wise stay
  accommodation: [{
    hotelName: { type: String, trim: true, default: '' },
    nights: { type: Number, default: null },
    roomType: { type: String, trim: true, default: '' },
    sharing: { type: String, trim: true, default: '' },
    destination: { type: String, trim: true, default: '' },
    hotelTotalAmount: { type: Number, default: null },
    hotelPaidAmount: { type: Number, default: null },
    hotelBalanceDueDate: { type: Date, default: null }
  }],
  vehicles: [{
    vehicleName: { type: String, trim: true, default: '' },
    vehicleType: { type: String, trim: true, default: '' },
    vehicleTotalAmount: { type: Number, default: null },
    vehicleAdvanceAmount: { type: Number, default: null },
    vehicleBalanceDueDate: { type: Date, default: null }
  }],
  // Flight Details
  flights: [{
    from: { type: String, trim: true, default: '' },
    to: { type: String, trim: true, default: '' },
    airline: { type: String, trim: true, default: '' },
    pnr: { type: String, trim: true, default: '' },
    fare: { type: Number, default: null }
  }],
  tripImages: [{ type: String, trim: true }],
  // Day-wise Itinerary (Phase 3)
  itinerary: [{
    day: { type: Number, default: null },
    route: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    places: [{ type: String, trim: true }]
  }],
  // Inclusions / Exclusions (Phase 4)
  inclusions: { type: String, default: '' },
  exclusions: { type: String, default: '' },
  // Payment & Cancellation policy (Phase 6)
  payment_policy: { type: String, default: '' },
  cancellation_policy: { type: String, default: '' },
  termsAndConditions: { type: String, default: '' },
  memorableTrip: { type: String, default: '' }
}, { timestamps: true });

leadSchema.pre('save', async function (next) {
  const total = Number(this.total_amount) || 0;
  const advance = Number(this.advance_amount) || 0;
  this.remaining_amount = Math.max(0, total - advance);

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

leadSchema.index({ email: 1, phone: 1 });
leadSchema.index({ status: 1 });
leadSchema.index({ assigned_to: 1 });
leadSchema.index({ createdAt: -1 });
leadSchema.index({ travel_date: 1 });
leadSchema.index({ advanceDueDate: 1 });
leadSchema.index({ paymentDueDate: 1 });

module.exports = mongoose.model('Lead', leadSchema);
