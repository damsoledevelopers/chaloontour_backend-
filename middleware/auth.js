const jwt = require('jsonwebtoken');
const User = require('../models/User');

/** Maps legacy/alternate role strings so CRM rules match (portal users = staff). Case-insensitive. */
function normalizeRole(role) {
  if (role == null || role === '') return null;
  const r = String(role).replace(/\u00a0/g, ' ').trim().toLowerCase();
  if (r === 'portal' || r === 'agent' || r === 'portal_user' || r === 'b2b') return 'staff';
  if (r === 'super_admin' || r === 'superadmin') return 'superadmin';
  if (r === 'staff') return 'staff';
  return r;
}

/** Final role for CRM auth: staff | superadmin | null. Maps extra portal/CRM aliases not covered by normalizeRole. */
function resolveCrmRole(rawRole) {
  const n = normalizeRole(rawRole);
  if (n === 'staff' || n === 'superadmin') return n;
  const s = String(rawRole ?? '').replace(/\u00a0/g, ' ').trim().toLowerCase();
  if (!s) return null;
  const staffAliases = new Set([
    'sales', 'partner', 'user', 'member', 'employee', 'field_agent', 'consultant', 'associate',
    'rep', 'sales_rep', 'travel_agent', 'agent_portal'
  ]);
  if (staffAliases.has(s)) return 'staff';
  if (s.includes('portal') && !s.includes('superadmin')) return 'staff';
  return n;
}

function hasCrmAccess(role) {
  return role === 'staff' || role === 'superadmin';
}

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'No token, authorization denied' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const userId = decoded.userId || decoded.id;
    const user = await User.findById(userId);
    if (!user) return res.status(401).json({ message: 'Token is not valid' });
    if (!user.isActive) return res.status(401).json({ message: 'Account is deactivated' });
    const role = resolveCrmRole(user.role);
    req.user = {
      id: user._id.toString(),
      role,
      email: user.email,
      agency: user.agency ? user.agency.toString() : null
    };
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Authentication required' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Access denied.' });
  next();
};

/** Allows both superadmin and staff (CRM access), including resolved portal aliases. */
const checkModulePermission = () => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Authentication required' });
  if (hasCrmAccess(req.user.role)) return next();
  return res.status(403).json({ message: 'Access denied.' });
};

/**
 * Create lead + Excel upload — superadmin and portal users (staff).
 * Do NOT use requireSuperadmin() here; that blocks portal users with "Superadmin only."
 */
const allowLeadCreateForPortal = () => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Authentication required' });
  if (hasCrmAccess(req.user.role)) return next();
  return res.status(403).json({ message: 'Access denied. Portal and superadmin only.' });
};

/** Only superadmin (for delete, payment edit, assign, bulk, etc.). */
const requireSuperadmin = () => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Authentication required' });
  if (req.user.role === 'superadmin') return next();
  return res.status(403).json({ message: 'Access denied. Superadmin only.' });
};

const validateEntryPermission = (doc, user, action) => ({ allowed: true });
const validateAgencyIsolation = (doc, user) => ({ allowed: true });

module.exports = {
  auth,
  authorize,
  checkModulePermission,
  allowLeadCreateForPortal,
  requireSuperadmin,
  normalizeRole,
  resolveCrmRole,
  hasCrmAccess,
  validateEntryPermission,
  validateAgencyIsolation
};
