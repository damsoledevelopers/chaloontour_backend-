const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

router.get('/', auth, (req, res) => {
  res.json({ agencies: [] });
});

router.get('/:id', auth, (req, res) => {
  res.status(404).json({ message: 'Agency not found' });
});

module.exports = router;
