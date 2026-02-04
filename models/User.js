const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false },
  role: { type: String, enum: ['super_admin', 'agency_admin', 'agent', 'staff', 'user'], required: true },
  agency: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency' },
  team: { type: String, trim: true },
  phone: { type: String, trim: true },
  address: { type: mongoose.Schema.Types.Mixed },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date },
  profileImage: { type: String },
  agentInfo: { type: mongoose.Schema.Types.Mixed },
  staffInfo: { type: mongoose.Schema.Types.Mixed },
  resetPasswordToken: { type: String, select: false },
  resetPasswordExpires: { type: Date, select: false }
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) { next(err); }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword || !this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
