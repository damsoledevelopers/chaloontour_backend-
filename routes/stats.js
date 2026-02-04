const express = require('express');
const Lead = require('../models/Lead');
const { auth, checkModulePermission } = require('../middleware/auth');

const router = express.Router();

router.get('/dashboard', auth, checkModulePermission(), async (req, res) => {
  try {
    const leadFilter = {};
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

    const [totalLeads, activeLeads, inquiryStats, statusAgg, newTodayCount, newMonthCount, convertedCount] = await Promise.all([
      Lead.countDocuments(leadFilter),
      Lead.countDocuments({ ...leadFilter, status: { $in: ['new', 'contacted', 'qualified', 'site_visit_scheduled', 'site_visit_completed', 'negotiation'] } }),
      Lead.aggregate([{ $match: leadFilter }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
      Lead.aggregate([{ $match: leadFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Lead.countDocuments({ ...leadFilter, createdAt: { $gte: todayStart } }),
      Lead.countDocuments({ ...leadFilter, createdAt: { $gte: monthStart } }),
      Lead.countDocuments({ ...leadFilter, status: { $in: ['booked', 'closed'] } })
    ]);

    const formattedInquiryStats = { website: 0, phone: 0, email: 0, walk_in: 0, referral: 0, social_media: 0, other: 0 };
    inquiryStats.forEach(s => {
      const k = s._id || 'other';
      if (Object.prototype.hasOwnProperty.call(formattedInquiryStats, k)) formattedInquiryStats[k] = s.count;
      else formattedInquiryStats.other += s.count;
    });

    const statusBreakdown = {};
    statusAgg.forEach(s => {
      statusBreakdown[s._id || 'new'] = s.count;
    });

    const conversionRate = totalLeads > 0 ? Math.round((convertedCount / totalLeads) * 10000) / 100 : 0;

    res.json({
      totalLeads,
      activeLeads,
      newLeadsToday: newTodayCount,
      newLeadsThisMonth: newMonthCount,
      conversionRate,
      totalAgencies: 0,
      totalProperties: 0,
      activeProperties: 0,
      inquiryStats: formattedInquiryStats,
      statusBreakdown,
      inquiriesByAgency: []
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
