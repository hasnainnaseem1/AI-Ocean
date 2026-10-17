/**
 * One gated door for every analytics export.
 *
 * The whole router carries `analytics.export` at the mount. That permission
 * has existed on this platform since before any export did, and until the
 * churn list shipped it was never enforced anywhere — being allowed to look
 * at a screen and being allowed to walk out with the customer list are
 * different rights, and only one of them was being checked.
 *
 * Datasets live in `services/analytics/exportService.js`. Adding one is an
 * entry in that registry; nothing new has to remember to check a permission,
 * strip money, or write an audit line.
 */
const express = require('express');
const { failure } = require('../../../../utils/helpers/apiError');
const { checkPermission } = require('../../../../middleware/security');
const { sendCsv } = require('../../../../utils/helpers/csv');
const { getClientIP } = require('../../../../utils/helpers/ipHelper');
const activityLogService = require('../../../../services/admin/activityLogService');
const exportService = require('../../../../services/analytics/exportService');

const router = express.Router();

// One gate, applied once, for everything below.
router.use(checkPermission('analytics.export'));

// @route   GET /api/v1/admin/analytics/export
// @desc    What can be exported — so the UI lists datasets rather than hardcoding them
router.get('/', (req, res) => {
  res.json({ success: true, datasets: exportService.describeAll() });
});

// @route   GET /api/v1/admin/analytics/export/:dataset
// @desc    One dataset as CSV, honouring the same window and filters as its screen
router.get('/:dataset', async (req, res) => {
  try {
    /*
     * Money is a separate right from export. A caller without
     * `analytics.revenue` still gets the file — with the amount columns
     * removed — because the non-money half is usually what they were after,
     * and refusing the whole export would just push somebody to ask a
     * colleague to send it to them.
     */
    const canSeeMoney = !!req.user?.hasPermission?.('analytics.revenue');
    const result = await exportService.build(req.params.dataset, { query: req.query, canSeeMoney });

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'data_exported',
      actionType: 'export',
      targetModel: 'Analytics',
      targetName: req.params.dataset,
      description: `Exported ${result.rows} rows from "${req.params.dataset}" over ${result.window}`,
      metadata: {
        dataset: req.params.dataset,
        exportedCount: result.rows,
        format: 'CSV',
        // Which window left the building, as the server resolved it — not as
        // the query asked for it, which may have been clamped or corrected.
        window: result.window,
        includedMoney: canSeeMoney,
        droppedMoneyColumns: result.droppedMoneyColumns,
        filters: req.query,
      },
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
      // An audit write must never cost the operator their file.
    }).catch(() => {});

    sendCsv(res, result.filename, result.csv);
  } catch (error) {
    failure(res, error, 'Could not build that export', { log: `Analytics export ${req.params.dataset}` });
  }
});

module.exports = router;
