const express = require('express');
const { paginate } = require('../../../utils/helpers/pagination');
const router = express.Router();
/**
 * These are every signed-in user's OWN notifications — customers as much as
 * admins. They were mounted behind adminAuth, which gave customers a flat
 * '403 Admin privileges required' on their own notification bell while the
 * backend went on writing real notifications for them (deployment ready,
 * paused for lack of credit, pay-as-you-go offers) that they could never read.
 *
 * Every handler below already scopes to req.userId and the mutating ones check
 * ownership, so the generic auth middleware is both correct and sufficient.
 */
const { auth } = require('../../../middleware/auth');
const notificationService = require('../../../services/notification/notificationService');

// @route   GET /api/v1/notifications/unread-count
// @desc    Get unread notification count
// @access  Private
router.get('/unread-count', auth, async (req, res) => {
  try {
    const unreadCount = await notificationService.getUnreadCount(req.userId);

    res.json({
      success: true,
      unreadCount
    });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching unread count'
    });
  }
});

// @route   PUT /api/v1/notifications/mark-all-read
// @desc    Mark all notifications as read
// @access  Private
router.put('/mark-all-read', auth, async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.userId);

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notifications'
    });
  }
});

// @route   GET /api/v1/notifications
// @desc    Get all notifications for current user
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const { limit = 20, skip = 0, unreadOnly = false } = req.query;
    const { limit: safeLimit } = paginate({ limit });
    const safeSkip = Math.max(0, Number.isFinite(Number(skip)) ? Math.floor(Number(skip)) : 0);

    const { notifications, total, unreadCount, language } = await notificationService.listForUser(req.userId, {
      limit: safeLimit, skip: safeSkip, unreadOnly: unreadOnly === 'true',
    });

    res.json({
      success: true,
      notifications: notifications || [],
      total,
      unreadCount,
      // Which language the wording above was rendered in. The client does not
      // need it to display the bell — the text arrives ready — but it makes a
      // "why is this still English?" report answerable without a debugger.
      language,
      pagination: {
        limit: safeLimit,
        skip: safeSkip
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching notifications'
    });
  }
});

// @route   PUT /api/v1/notifications/:id/read
// @desc    Mark notification as read
// @access  Private
router.put('/:id/read', auth, async (req, res) => {
  try {
    const result = await notificationService.markAsRead(req.params.id, req.userId);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }
    if (result.forbidden) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this notification'
      });
    }

    res.json({
      success: true,
      message: 'Notification marked as read',
      notification: result.doc
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notification'
    });
  }
});

// @route   DELETE /api/v1/notifications/:id
// @desc    Delete notification
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await notificationService.deleteOwned(req.params.id, req.userId);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }
    if (result.forbidden) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this notification'
      });
    }

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting notification'
    });
  }
});

module.exports = router;
