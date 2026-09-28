/**
 * Notification Cleanup Job
 *
 * `Notification.expiresAt` has no database-level enforcement — any notification
 * past its `expiresAt` was auto-deleted in the background with no code
 * needed. Postgres has no equivalent, so this job exists purely to replace
 * that: delete every notification whose `expiresAt` has passed, once a day.
 */
const notificationService = require('../services/notification/notificationService');

const run = async () => {
  const deleted = await notificationService.deleteExpired();
  if (deleted > 0) {
    console.log(`[CRON] Notification cleanup: removed ${deleted} expired notification(s)`);
  }
};

module.exports = { run };
