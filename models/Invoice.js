const mongoose = require('mongoose');

const PAYMENT_METHODS = ['UPI', 'Cash', 'Bank', 'Card'];
const PAYMENT_STATUSES = ['Pending', 'Unpaid', 'Partial', 'Paid'];

function toPositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

const invoiceSchema = new mongoose.Schema({
  receiptNumber: { type: String, unique: true, sparse: true, trim: true },
  sourceType: { type: String, enum: ['lead', 'manual'], default: 'manual' },
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiptDate: { type: Date, required: true },
  officeAddress: { type: String, default: '', trim: true },
  companyName: { type: String, required: true, trim: true },
  website: { type: String, default: '', trim: true },
  customerName: { type: String, required: true, trim: true },
  contactNumbers: [{ type: String, trim: true }],
  email: { type: String, default: '', trim: true, lowercase: true },
  address: { type: String, default: '', trim: true },
  tourName: { type: String, required: true, trim: true },
  tourDuration: { type: String, default: '', trim: true },
  startDate: { type: Date, default: null },
  endDate: { type: Date, default: null },
  pricePerPerson: { type: Number, default: 0 },
  numberOfPersons: { type: Number, default: 0 },
  kidsPricePerPerson: { type: Number, default: 0 },
  kidsCount: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },
  touristNames: [{ type: String, trim: true }],
  advanceAmount: { type: Number, default: 0 },
  paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'UPI' },
  paymentDate: { type: Date, default: null },
  transactionId: { type: String, default: '', trim: true },
  balanceAmount: { type: Number, default: 0 },
  status: { type: String, enum: PAYMENT_STATUSES, default: 'Pending' },
}, { timestamps: true });

invoiceSchema.pre('save', async function (next) {
  const pricePerPerson = toPositiveNumber(this.pricePerPerson);
  const numberOfPersons = toPositiveNumber(this.numberOfPersons);
  const kidsPricePerPerson = toPositiveNumber(this.kidsPricePerPerson);
  const kidsCount = toPositiveNumber(this.kidsCount);
  const advanceAmount = toPositiveNumber(this.advanceAmount);
  const adultTotal = pricePerPerson * numberOfPersons;
  const kidsTotal = kidsPricePerPerson * kidsCount;
  const totalAmount = adultTotal + kidsTotal;

  this.pricePerPerson = pricePerPerson;
  this.numberOfPersons = numberOfPersons;
  this.kidsPricePerPerson = kidsPricePerPerson;
  this.kidsCount = kidsCount;
  this.advanceAmount = advanceAmount;
  this.totalAmount = totalAmount;
  this.balanceAmount = Math.max(0, totalAmount - advanceAmount);

  if (totalAmount <= 0) this.status = 'Pending';
  else if (advanceAmount <= 0) this.status = 'Unpaid';
  else if (advanceAmount >= totalAmount) this.status = 'Paid';
  else this.status = 'Partial';

  if (!this.receiptNumber) {
    try {
      const Invoice = mongoose.model('Invoice');
      const lastInvoice = await Invoice.findOne({ receiptNumber: { $exists: true, $ne: null } })
        .sort({ receiptNumber: -1 })
        .select('receiptNumber');
      let nextNumber = 1;
      if (lastInvoice && lastInvoice.receiptNumber) {
        const match = lastInvoice.receiptNumber.match(/\d+$/);
        if (match) nextNumber = parseInt(match[0], 10) + 1;
      }

      let attempts = 0;
      do {
        const nextReceiptNumber = `COT/${String(nextNumber).padStart(3, '0')}`;
        const exists = await Invoice.findOne({ receiptNumber: nextReceiptNumber }).select('_id');
        if (!exists) {
          this.receiptNumber = nextReceiptNumber;
          break;
        }
        nextNumber++;
        if (++attempts > 100) {
          this.receiptNumber = `COT/${Date.now().toString().slice(-6)}`;
          break;
        }
      } while (true);
    } catch (err) {
      this.receiptNumber = `COT/${Date.now().toString().slice(-6)}`;
    }
  }

  next();
});

invoiceSchema.index({ createdAt: -1 });
invoiceSchema.index({ createdBy: 1 });
invoiceSchema.index({ lead: 1 });
invoiceSchema.index({ receiptDate: -1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
