const express = require('express');
const Lead = require('../models/Lead');
const { auth, checkModulePermission } = require('../middleware/auth');

const router = express.Router();

function getLeadFilter(req) {
  const filter = {};
  if (req.user.role === 'staff') {
    filter.assigned_to = req.user.id;
  }
  return filter;
}

router.get('/dashboard', auth, checkModulePermission(), async (req, res) => {
  try {
    const leadFilter = getLeadFilter(req);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setHours(23, 59, 59, 999);
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

    const [totalLeads, newLeads, bookedLeads, paymentPendingLeads, newTodayCount, newMonthCount, sourceAgg, statusAgg, todaysFollowUpsCount, missedFollowUpsCount] = await Promise.all([
      Lead.countDocuments(leadFilter),
      Lead.countDocuments({ ...leadFilter, status: 'new' }),
      Lead.countDocuments({ ...leadFilter, status: 'booked' }),
      Lead.countDocuments({ ...leadFilter, $or: [{ payment_status: { $ne: 'paid' } }, { remaining_amount: { $gt: 0 } }] }),
      Lead.countDocuments({ ...leadFilter, createdAt: { $gte: todayStart } }),
      Lead.countDocuments({ ...leadFilter, createdAt: { $gte: monthStart } }),
      Lead.aggregate([{ $match: leadFilter }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
      Lead.aggregate([{ $match: leadFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Lead.countDocuments({ ...leadFilter, followups: { $elemMatch: { date: { $gte: todayStart, $lte: todayEnd } } } }),
      Lead.countDocuments({ ...leadFilter, followups: { $elemMatch: { date: { $lt: todayStart } } } })
    ]);

    const inquiryStats = { manual: 0, excel: 0 };
    sourceAgg.forEach(s => {
      const k = s._id || 'manual';
      inquiryStats[k] = (inquiryStats[k] ?? 0) + s.count;
    });

    const statusBreakdown = {};
    statusAgg.forEach(s => {
      statusBreakdown[s._id || 'new'] = s.count;
    });

    const conversionRate = totalLeads > 0 ? Math.round((bookedLeads / totalLeads) * 10000) / 100 : 0;

    res.json({
      totalLeads,
      newLeads,
      bookedLeads,
      paymentPendingLeads,
      activeLeads: totalLeads - (statusBreakdown['lost'] || 0),
      newLeadsToday: newTodayCount,
      newLeadsThisMonth: newMonthCount,
      conversionRate,
      totalAgencies: 0,
      totalProperties: 0,
      activeProperties: 0,
      inquiryStats,
      statusBreakdown,
      inquiriesByAgency: [],
      todaysFollowUps: { total: todaysFollowUpsCount, completed: 0, pending: todaysFollowUpsCount, completionRate: 0 },
      missedFollowUps: missedFollowUpsCount
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
