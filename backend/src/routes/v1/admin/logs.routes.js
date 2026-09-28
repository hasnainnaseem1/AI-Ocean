const express = require('express');
const userService = require('../../../services/user/userService');
const { paginate } = require('../../../utils/helpers/pagination');
const router = express.Router();
const activityLogService = require('../../../services/admin/activityLogService');
const { adminAuth } = require('../../../middleware/auth');
const { checkPermission, checkFeatureEnabled } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');

// @route   GET /api/admin/activity-logs
// @desc    Get activity logs with filters
// @access  Private (Admin with logs.view permission)
router.get('/', adminAuth, checkPermission('logs.view'), checkFeatureEnabled('enableActivityLogs'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      action,
      actionType,
      userId,
      status,
      startDate,
      endDate,
      search
    } = req.query;
    const { page: safePage, limit: safeLimit } = paginate({ page, limit });

    const [{ logs, total }, stats] = await Promise.all([
      activityLogService.list({
        action, userId, actionType, status, startDate, endDate, search,
      }, { page, limit }),
      activityLogService.getStats(),
    ]);

    res.json({
      success: true,
      logs: logs.map(log => ({
        id: log.id,
        user: log.user,
        userName: log.userName,
        userEmail: log.userEmail,
        userRole: log.userRole,
        action: log.action,
        actionType: log.actionType,
        targetModel: log.targetModel,
        targetId: log.targetId,
        targetName: log.targetName,
        description: log.description,
        metadata: log.metadata,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        status: log.status,
        errorMessage: log.errorMessage,
        createdAt: log.createdAt
      })),
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit),
        totalItems: total,
        itemsPerPage: safeLimit
      },
      stats
    });

  } catch (error) {
    console.error('Get activity logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching activity logs'
    });
  }
});

// @route   GET /api/admin/activity-logs/:id
// @desc    Get single activity log
// @access  Private (Admin with logs.view permission)
router.get('/:id', adminAuth, checkPermission('logs.view'), checkFeatureEnabled('enableActivityLogs'), async (req, res) => {
  try {
    const log = await activityLogService.findById(req.params.id);

    if (!log) {
      return res.status(404).json({
        success: false,
        message: 'Activity log not found'
      });
    }

    res.json({
      success: true,
      log: {
        id: log.id,
        user: log.user,
        userName: log.userName,
        userEmail: log.userEmail,
        userRole: log.userRole,
        action: log.action,
        actionType: log.actionType,
        targetModel: log.targetModel,
        targetId: log.targetId,
        targetName: log.targetName,
        description: log.description,
        metadata: log.metadata,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        status: log.status,
        errorMessage: log.errorMessage,
        createdAt: log.createdAt
      }
    });

  } catch (error) {
    console.error('Get activity log error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching activity log'
    });
  }
});

// @route   GET /api/admin/activity-logs/user/:userId
// @desc    Get activity logs for specific user
// @access  Private (Admin with logs.view permission)
router.get('/user/:userId', adminAuth, checkPermission('logs.view'), checkFeatureEnabled('enableActivityLogs'), async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { page: safePage, limit: safeLimit } = paginate({ page, limit });

    // Without this an unknown id returned an empty list with 200 — including
    // for values like `../../etc/passwd`.
    const user = await userService.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { logs, total } = await activityLogService.listForUser(req.params.userId, { page, limit });

    res.json({
      success: true,
      logs: logs.map(log => ({
        id: log.id,
        action: log.action,
        actionType: log.actionType,
        description: log.description,
        ipAddress: log.ipAddress,
        status: log.status,
        createdAt: log.createdAt
      })),
      pagination: {
        currentPage: safePage,
        totalPages: Math.ceil(total / safeLimit),
        totalItems: total,
        itemsPerPage: safeLimit
      }
    });

  } catch (error) {
    console.error('Get user activity logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user activity logs'
    });
  }
});

// @route   DELETE /api/admin/activity-logs/old
// @desc    Delete old activity logs (older than specified days)
// @access  Private (Admin with logs.delete permission)
router.delete('/old', adminAuth, checkPermission('logs.delete'), checkFeatureEnabled('enableActivityLogs'), async (req, res) => {
  try {
    const { days = 90 } = req.body;
    const clientIP = getClientIP(req);

    if (days < 30) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete logs newer than 30 days'
      });
    }

    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const deletedCount = await activityLogService.deleteOlderThan(cutoffDate);

    // Log this action
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'data_exported',
      actionType: 'delete',
      targetModel: 'ActivityLog',
      description: `Deleted ${deletedCount} old activity logs (older than ${days} days)`,
      metadata: { days, deletedCount },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: `Deleted ${deletedCount} old activity logs`,
      deletedCount
    });

  } catch (error) {
    console.error('Delete old logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting old logs'
    });
  }
});

// @route   DELETE /api/admin/activity-logs/range
// @desc    Delete activity logs by date range
// @access  Private (Admin with logs.delete permission)
router.delete('/range', adminAuth, checkPermission('logs.delete'), checkFeatureEnabled('enableActivityLogs'), async (req, res) => {
  try {
    const { startDate, endDate } = req.body;
    const clientIP = getClientIP(req);

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both startDate and endDate'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      return res.status(400).json({
        success: false,
        message: 'Start date must be before end date'
      });
    }

    const deletedCount = await activityLogService.deleteByDateRange(start, end);

    // Log this action
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'data_deleted',
      actionType: 'delete',
      targetModel: 'ActivityLog',
      description: `Deleted ${deletedCount} activity logs from ${startDate} to ${endDate}`,
      metadata: {
        startDate,
        endDate,
        deletedCount
      },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: `Deleted ${deletedCount} activity logs from the specified date range`,
      deletedCount
    });

  } catch (error) {
    console.error('Delete logs by date range error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting logs'
    });
  }
});

// @route   GET /api/admin/activity-logs/export
// @desc    Export activity logs as CSV
// @access  Private (Admin with logs.export permission)
router.get('/export/csv', adminAuth, checkPermission('logs.export'), checkFeatureEnabled('enableActivityLogs'), async (req, res) => {
  try {
    const { startDate, endDate, actionType, status, search } = req.query;
    const clientIP = getClientIP(req);

    const logs = await activityLogService.listForExport({
      startDate, endDate, actionType, status, search,
    }, 10000);

    // Convert to CSV
    const csvHeaders = 'Date,User Name,User Email,User Role,Action,Action Type,Description,Status,IP Address\n';
    const csvRows = logs.map(log => {
      return `${log.createdAt.toISOString()},"${log.userName}","${log.userEmail}",${log.userRole},"${log.action}",${log.actionType},"${log.description}",${log.status},${log.ipAddress}`;
    }).join('\n');

    const csv = csvHeaders + csvRows;

    // Log export activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'data_exported',
      actionType: 'export',
      targetModel: 'ActivityLog',
      description: `Exported ${logs.length} activity logs`,
      metadata: { exportedCount: logs.length, format: 'CSV', filters: { startDate, endDate, actionType, status } },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=activity-logs-${Date.now()}.csv`);
    res.send(csv);

  } catch (error) {
    console.error('Export logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting logs'
    });
  }
});

// @route   GET /api/admin/activity-logs/stats/summary
// @desc    Get activity log statistics summary
// @access  Private (Admin with logs.view permission)
router.get('/stats/summary', adminAuth, checkPermission('logs.view'), checkFeatureEnabled('enableActivityLogs'), async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    let days;
    switch(period) {
      case '7d': days = 7; break;
      case '30d': days = 30; break;
      case '90d': days = 90; break;
      default: days = 30;
    }

    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const summary = await activityLogService.summary(startDate);

    res.json({
      success: true,
      period,
      summary
    });

  } catch (error) {
    console.error('Get log stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching log statistics'
    });
  }
});

module.exports = router;
