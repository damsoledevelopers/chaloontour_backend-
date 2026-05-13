const express = require('express');
const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// CRITICAL: Force writable directories for Puppeteer on Linux servers
process.env.HOME = '/tmp';
process.env.XDG_CONFIG_HOME = '/tmp/.config';
process.env.XDG_DATA_HOME = '/tmp/.local/share';
process.env.XDG_CACHE_HOME = '/tmp/.cache';

// Normalize Puppeteer cache-dir early.
// Your `.env` may point to a Linux Render path (e.g. `/opt/...`) while local dev runs on Windows.
// Puppeteer expects the cache dir to exist and contain the downloaded Chromium revision.
if (process.platform === 'win32') {
  const envCacheDir = (process.env.PUPPETEER_CACHE_DIR || '').trim();
  const localCacheDir = path.join(__dirname, '.cache', 'puppeteer');

  const envLooksRender = envCacheDir.includes('/opt/') || envCacheDir.toLowerCase().includes('render');
  const envExists = envCacheDir ? fs.existsSync(envCacheDir) : false;

  if ((!envCacheDir || envLooksRender || !envExists) && fs.existsSync(localCacheDir)) {
    process.env.PUPPETEER_CACHE_DIR = localCacheDir;
    console.log(`PUPPETEER_CACHE_DIR normalized to: ${localCacheDir}`);
  }
}

const User = require('./models/User');
const app = express();

// Required when behind Vercel/reverse proxy so express-rate-limit and req.ip work correctly
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://chalo-on-tour-frontend-psi.vercel.app',
  'https://crm.chaloontour.com' // ✅ ADD THIS
];
// Production: set CLIENT_URL to your Vercel URL(s), comma-separated for multiple (e.g. main + preview)
const clientUrls = process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',').map(u => u.trim()).filter(Boolean) : [];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const isAllowed = allowedOrigins.includes(origin) || 
                     clientUrls.some(url => origin === url || origin === url.replace(/\/$/, '')) ||
                     origin.endsWith('.vercel.app'); // Helpful for preview deployments
                     
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/superadmin_crm';
const SUPERADMIN_EMAIL = 'sadmin@gmail.com';
const SUPERADMIN_PASSWORD = '123456';
const STAFF_EMAIL = 'staff@gmail.com';
const STAFF_PASSWORD = '123456';

// Track DB readiness so routes can fail fast instead of waiting 10s for timeout
app.locals.dbReady = false;

async function connectWithRetry(retries = 3, delay = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`MongoDB connection attempt ${attempt}/${retries}...`);
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
      app.locals.dbReady = true;
      console.log('MongoDB connected successfully');
      return true;
    } catch (err) {
      console.error(`MongoDB connection attempt ${attempt} failed:`, err.message);
      if (err.message.includes('whitelist') || err.message.includes('Could not connect')) {
        console.error('\n⚠️  Your current IP is NOT whitelisted in MongoDB Atlas!');
        console.error('   → Go to https://cloud.mongodb.com → Network Access → Add Current IP\n');
      }
      if (attempt < retries) {
        console.log(`Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  console.error('❌ All MongoDB connection attempts failed. API routes requiring DB will return 503.');
  return false;
}

// Listen for connection events
mongoose.connection.on('connected', () => { app.locals.dbReady = true; });
mongoose.connection.on('disconnected', () => { app.locals.dbReady = false; console.warn('MongoDB disconnected'); });
mongoose.connection.on('error', (err) => { console.error('MongoDB connection error:', err.message); });

connectWithRetry().then(async (connected) => {
  if (!connected) return;
  try {
    const superadmin = await User.findOne({ email: SUPERADMIN_EMAIL }).select('+password');
    if (!superadmin) {
      await User.create({
        firstName: 'Super',
        lastName: 'Admin',
        email: SUPERADMIN_EMAIL,
        password: SUPERADMIN_PASSWORD,
        role: 'superadmin'
      });
      console.log('Super admin user created:', SUPERADMIN_EMAIL);
    } else {
      if (superadmin.role === 'super_admin') superadmin.role = 'superadmin';
      superadmin.password = SUPERADMIN_PASSWORD;
      await superadmin.save();
      console.log('Super admin password synced:', SUPERADMIN_EMAIL);
    }

    const staffUser = await User.findOne({ email: STAFF_EMAIL }).select('+password');
    if (!staffUser) {
      await User.create({
        firstName: 'Staff',
        lastName: 'User',
        email: STAFF_EMAIL,
        password: STAFF_PASSWORD,
        role: 'staff'
      });
      console.log('Staff user created:', STAFF_EMAIL);
    } else {
      staffUser.password = STAFF_PASSWORD;
      await staffUser.save();
      console.log('Staff password synced:', STAFF_EMAIL);
    }
  } catch (e) {
    console.error('Seed users:', e.message);
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// DB readiness check — fail fast with 503 instead of waiting for 10s timeout
app.use('/api', (req, res, next) => {
  // Allow health check without DB
  if (req.path === '/health') return next();
  if (!req.app.locals.dbReady) {
    return res.status(503).json({
      message: 'Database is not connected. Please check your MongoDB Atlas IP whitelist and connection string.',
      hint: 'Go to https://cloud.mongodb.com → Network Access → Add your current IP address'
    });
  }
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/users', require('./routes/users'));
app.use('/api/agencies', require('./routes/agencies'));

app.get('/api/health', (req, res) =>
  res.json({
    status: req.app.locals.dbReady ? 'OK' : 'DB_DISCONNECTED',
    database: req.app.locals.dbReady ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    leadCreate: 'portal-and-superadmin'
  })
);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
});
app.use('*', (req, res) => res.status(404).json({ message: 'Route not found' }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Super Admin backend running on port ${PORT}`));

module.exports = app;
