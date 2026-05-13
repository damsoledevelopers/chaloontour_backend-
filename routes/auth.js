const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { auth, resolveCrmRole } = require('../middleware/auth');

const router = express.Router();

const uploadsDir = path.join(__dirname, '..', 'uploads', 'avatars');
try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
} catch (e) {
  console.warn('Uploads dir not writable (e.g. serverless); avatar upload may fail:', e.message);
}

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        cb(null, uploadsDir);
      } catch (err) {
        cb(new Error('File upload not available on this environment (use Render or enable writable storage).'));
      }
    },
    filename: (req, file, cb) => {
      const ext = (file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/gif' ? '.gif' : '.jpg');
      cb(null, `${req.user.id}-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  }
});

const generateToken = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: process.env.JWT_EXPIRE || '7d' });

router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase().trim() }).select('+password');
    if (!user) return res.status(401).json({ message: 'Invalid email or password' });
    if (!user.isActive) return res.status(401).json({ message: 'Account is pending approval.' });
    if (!user.password) return res.status(500).json({ message: 'Account error.' });
    const isMatch = await user.comparePassword(password.trim());
    if (!isMatch) return res.status(401).json({ message: 'Invalid email or password' });
    User.updateOne({ _id: user._id }, { $set: { lastLogin: new Date() } }).catch(() => {});
    const token = generateToken(user._id);
    res.json({
      message: 'Login successful',
      token,
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: resolveCrmRole(user.role), agency: user.agency, lastLogin: user.lastLogin, isActive: user.isActive }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: resolveCrmRole(user.role),
        agency: user.agency,
        phone: user.phone,
        address: user.address,
        isActive: user.isActive,
        lastLogin: user.lastLogin,
        profileImage: user.profileImage,
        agentInfo: user.agentInfo,
        staffInfo: user.staffInfo
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const email = (req.body.email || '').toLowerCase().trim();
    const user = await User.findOne({ email }).select('+resetPasswordToken +resetPasswordExpires');
    if (!user) return res.status(200).json({ message: 'If that email is registered, you will receive a reset link.' });
    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save({ validateBeforeSave: false });
    const baseUrl = process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',')[0].trim() : 'http://localhost:3001';
    const resetLink = `${baseUrl}/auth/reset-password?token=${token}`;
    res.json({ message: 'Reset link generated.', resetLink });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { token, password } = req.body;
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    }).select('+resetPasswordToken +resetPasswordExpires');
    if (!user) return res.status(400).json({ message: 'Invalid or expired reset link.' });
    const hash = await bcrypt.hash(password.trim(), 10);
    await User.updateOne(
      { _id: user._id },
      { $set: { password: hash }, $unset: { resetPasswordToken: 1, resetPasswordExpires: 1 } }
    );
    res.json({ message: 'Password updated. You can sign in with your new password.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const allowed = ['firstName', 'lastName', 'phone', 'address', 'profileImage', 'agentInfo', 'staffInfo', 'team'];
    allowed.forEach(f => { if (req.body[f] !== undefined) user[f] = req.body[f]; });
    await user.save();
    res.json({
      message: 'Profile updated successfully',
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: resolveCrmRole(user.role), agency: user.agency, phone: user.phone, address: user.address, isActive: user.isActive, lastLogin: user.lastLogin, profileImage: user.profileImage, agentInfo: user.agentInfo, staffInfo: user.staffInfo }
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/me/avatar', auth, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: 'Image must be under 2MB' });
      return res.status(400).json({ message: err.message || 'Upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file || !req.file.path) return res.status(400).json({ message: 'No image uploaded' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const relativePath = path.join('uploads', 'avatars', path.basename(req.file.path)).replace(/\\/g, '/');
    if (user.profileImage) {
      const oldPath = path.join(__dirname, '..', user.profileImage);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    user.profileImage = '/' + relativePath;
    await user.save();
    res.json({
      message: 'Profile photo updated',
      profileImage: user.profileImage,
      user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: resolveCrmRole(user.role), agency: user.agency, phone: user.phone, address: user.address, isActive: user.isActive, lastLogin: user.lastLogin, profileImage: user.profileImage, agentInfo: user.agentInfo, staffInfo: user.staffInfo }
    });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
