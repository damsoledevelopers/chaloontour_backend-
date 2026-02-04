const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const User = require('./models/User');
const app = express();

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3001', credentials: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000 }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/superadmin_crm';
const SUPERADMIN_EMAIL = 'admin@chalo.com';
const SUPERADMIN_PASSWORD = 'chalo@123';

mongoose.connect(mongoUri).then(() => {
  console.log('MongoDB connected');
  (async () => {
    try {
      const user = await User.findOne({ email: SUPERADMIN_EMAIL }).select('+password');
      if (!user) {
        await User.create({
          firstName: 'Super',
          lastName: 'Admin',
          email: SUPERADMIN_EMAIL,
          password: SUPERADMIN_PASSWORD,
          role: 'super_admin'
        });
        console.log('Super admin user created:', SUPERADMIN_EMAIL);
      } else {
        user.password = SUPERADMIN_PASSWORD;
        await user.save();
        console.log('Super admin password synced:', SUPERADMIN_EMAIL);
      }
    } catch (e) {
      console.error('Seed super admin:', e.message);
    }
  })();
}).catch(err => console.error('MongoDB error:', err.message));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/agencies', require('./routes/agencies'));

app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
});
app.use('*', (req, res) => res.status(404).json({ message: 'Route not found' }));

const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => console.log(`Super Admin backend running on port ${PORT}`));

module.exports = app;
