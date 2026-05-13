const express = require('express');
const User = require('../models/User');
const { auth, requireSuperadmin, checkModulePermission } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

const router = express.Router();

/** Create user (super admin only) */
router.post('/', auth, requireSuperadmin(), [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').optional().isIn(['staff', 'superadmin']).withMessage('Invalid role')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });
    }

    const { firstName, lastName, email, password, role, phone, isActive, team } = req.body;

    const existingUser = await User.findOne({ email: (email || '').trim().toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    const user = await User.create({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim().toLowerCase(),
      password: password.trim(),
      role: ['staff', 'superadmin'].includes(role) ? role : 'staff',
      phone: phone ? String(phone).trim() : '',
      isActive: typeof isActive === 'boolean' ? isActive : true,
      team: team ? String(team).trim() : undefined
    });

    const out = await User.findById(user._id).select('-password').lean();
    return res.status(201).json({ message: 'User created successfully', user: out });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Email already in use' });
    return res.status(500).json({ message: 'Server error' });
  }
});

/** List active CRM users (staff + superadmin) for assign dropdowns — portal and superadmin */
router.get('/', auth, checkModulePermission(), async (req, res) => {
  try {
    const users = await User.find({ role: { $in: ['staff', 'superadmin'] }, isActive: true })
      .select('_id firstName lastName email role')
      .sort('firstName lastName')
      .lean();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

/** Super admin: full user details + how many are currently logged in (lastLogin in last 15 min) */
const LOGGED_IN_WINDOW_MS = 15 * 60 * 1000;

router.get('/details', auth, requireSuperadmin(), async (req, res) => {
  try {
    const now = new Date();
    const since = new Date(now.getTime() - LOGGED_IN_WINDOW_MS);
    const all = await User.find({ role: { $in: ['staff', 'superadmin'] } })
      .select('_id firstName lastName email role phone isActive lastLogin createdAt')
      .sort('firstName lastName')
      .lean();
    const loggedInCount = all.filter((u) => u.lastLogin && new Date(u.lastLogin) >= since).length;
    res.json({ users: all, loggedInCount, totalUsers: all.length });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

/** Get one user by id (super admin only) */
router.get('/:id', auth, requireSuperadmin(), async (req, res) => {
  try {
    const u = await User.findById(req.params.id).select('-password').lean();
    if (!u) return res.status(404).json({ message: 'User not found' });
    if (!['staff', 'superadmin'].includes(u.role)) return res.status(404).json({ message: 'User not found' });
    res.json({ user: u });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

/** Update user (super admin only) */
router.put('/:id', auth, requireSuperadmin(), async (req, res) => {
  try {
    const { firstName, lastName, email, role, phone, isActive, team, password } = req.body;
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ message: 'User not found' });
    if (!['staff', 'superadmin'].includes(u.role)) return res.status(404).json({ message: 'User not found' });
    if (firstName != null) u.firstName = firstName;
    if (lastName != null) u.lastName = lastName;
    if (email != null) u.email = email.trim().toLowerCase();
    if (role != null && ['staff', 'superadmin'].includes(role)) u.role = role;
    if (phone != null) u.phone = phone;
    if (typeof isActive === 'boolean') u.isActive = isActive;
    if (team != null) u.team = team;
    if (password != null && String(password).trim()) {
      const normalizedPassword = String(password).trim();
      if (normalizedPassword.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
      }
      u.password = normalizedPassword;
    }
    await u.save();
    const out = await User.findById(u._id).select('-password').lean();
    res.json({ user: out });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Email already in use' });
    res.status(500).json({ message: 'Server error' });
  }
});

/** Delete user permanently */
router.delete('/:id', auth, requireSuperadmin(), async (req, res) => {
  try {
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ message: 'User not found' });
    if (!['staff', 'superadmin'].includes(u.role)) return res.status(404).json({ message: 'User not found' });
    if (req.user.id === req.params.id) return res.status(400).json({ message: 'Cannot delete your own account' });
    await User.deleteOne({ _id: u._id });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
