/**
 * Activity Log — the audit trail, written from ~40 call sites across the whole
 * app, all through the single choke point `logActivity(...)`. That one entry
 * point is why the audit trail is trustworthy: there is no second way to write
 * a row, so nothing can be recorded inconsistently or skipped by accident.
 *
 * `logActivity` deliberately never throws to its caller. Logging describes
 * something that already happened; a failure to describe it must not undo it.
 *
 * `targetId` is a plain id string, not a foreign key. It is a polymorphic
 * reference paired with `targetModel` — the thing it points at may since have
 * been deleted, and the log entry is still worth keeping.
 */
const prisma = require('../../lib/prismaClient');
const { paginate } = require('../../utils/helpers/pagination');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');

/**
 * Mirrors the original static helper exactly — same params, same
 * never-throws-to-the-caller contract (logging must never break the main
 * flow it's describing).
 */
const logActivity = async ({
  userId, userName, userEmail, userRole, action, actionType,
  targetModel = null, targetId = null, targetName = null,
  description, metadata = {}, ipAddress = null, userAgent = null,
  status = 'success', errorMessage = null,
}) => {
  try {
    const adminSettingsService = require('./adminSettingsService');
    const settings = await adminSettingsService.getSettings();
    if (settings.features?.enableActivityLogs === false) {
      return null;
    }

    const user = await prisma.user.findUnique({ where: byPublicId(userId), select: { id: true } });
    if (!user) {
      // An audit-log row without a real user to blame is worse than a
      // missing one — the old original schema required `userId` too.
      console.error(`[ActivityLog] No user found for id ${userId}, skipping log entry`);
      return null;
    }

    const row = await prisma.activityLog.create({
      data: {

        userId: user.id,
        userName,
        userEmail,
        userRole,
        action,
        actionType,
        targetModel: targetModel || null,
        targetId: targetId ? String(targetId) : null,
        targetName: targetName || null,
        description,
        metadata: metadata || {},
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        status,
        errorMessage: errorMessage || null,
      },
    });

    return row;
  } catch (error) {
    console.error('Error logging activity:', error);
    return null;
  }
};

/**
 * The "permanently delete customer" cascade in admin/customers.routes.js.
 * `ActivityLog.userId` is `onDelete: Restrict` — "an audit trail must never
 * silently lose its link" — but a superadmin permanently erasing a customer
 * already unconditionally erases their wallet/ledger the same way (see
 * Phase 3/4's `deleteAllForUsers` additions), so this follows the same
 * already-established "erase everything" intent rather than leaving this one
 * table as a silent block.
 */
const deleteAllForUsers = async (userIds, db = prisma) => {
  const users = await db.user.findMany({ where: byPublicIds(userIds), select: { id: true } });
  const userPgIds = users.map((u) => u.id);
  if (!userPgIds.length) return;

  await db.activityLog.deleteMany({ where: { userId: { in: userPgIds } } });
};

/** jobs/index.js's custom "database cleanup" cron action, target 'activityLogs'. */
const deleteOlderThan = async (cutoff) => {
  // `deleteMany` already reports how many rows it removed. Fetching them all
  // first just to call `.length` pulled the entire matching set into memory —
  // on a real activity_logs table that is the cleanup job exhausting the
  // process instead of doing its job.
  const { count } = await prisma.activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
};

// ── routes/v1/admin/logs.routes.js — the admin activity-log viewer ──────

const LOG_INCLUDE = { user: { select: { id: true, name: true, email: true, accountType: true, role: true, status: true } } };

const wrapLog = (row) => ({
  id: row.id,
  user: row.user ? {
    id: row.user.id, name: row.user.name, email: row.user.email, accountType: row.user.accountType, role: row.user.role, status: row.user.status,
  } : null,
  userName: row.userName,
  userEmail: row.userEmail,
  userRole: row.userRole,
  action: row.action,
  actionType: row.actionType,
  targetModel: row.targetModel,
  targetId: row.targetId,
  targetName: row.targetName,
  description: row.description,
  metadata: row.metadata,
  ipAddress: row.ipAddress,
  userAgent: row.userAgent,
  status: row.status,
  errorMessage: row.errorMessage,
  createdAt: row.createdAt,
});

const buildWhere = async ({
  action, userId, actionType, status, startDate, endDate, search,
} = {}) => {
  const where = {};
  if (action) where.action = action;

  if (userId) {
    const user = await prisma.user.findUnique({ where: byPublicId(userId), select: { id: true } });
    where.userId = user?.id || '__none__';
  }

  if (actionType) {
    const types = String(actionType).split(',').map((t) => t.trim()).filter(Boolean);
    if (types.length) where.actionType = { in: types };
  }

  if (status) {
    const statuses = String(status).split(',').map((s) => s.trim()).filter(Boolean);
    if (statuses.length) where.status = { in: statuses };
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  if (search) {
    where.OR = [
      { userName: { contains: search, mode: 'insensitive' } },
      { userEmail: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { action: { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
};

const list = async (filters, { page = 1, limit = 50 } = {}) => {
  const where = await buildWhere(filters);
  const { skip, take } = paginate({ page, limit });
  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      where, include: LOG_INCLUDE, orderBy: { createdAt: 'desc' }, skip, take,
    }),
    prisma.activityLog.count({ where }),
  ]);
  return { logs: rows.map(wrapLog), total };
};

const getStats = async () => {
  const [totalLogs, successLogs, failedLogs, warningLogs] = await Promise.all([
    prisma.activityLog.count(),
    prisma.activityLog.count({ where: { status: 'success' } }),
    prisma.activityLog.count({ where: { status: 'failed' } }),
    prisma.activityLog.count({ where: { status: 'warning' } }),
  ]);
  return {
    totalLogs, successLogs, failedLogs, warningLogs,
  };
};

const findById = async (id) => {
  const row = await prisma.activityLog.findUnique({ where: byPublicId(id), include: LOG_INCLUDE });
  return row ? wrapLog(row) : null;
};

const listForUser = async (userId, { page = 1, limit = 20 } = {}) => {
  const user = await prisma.user.findUnique({ where: byPublicId(userId), select: { id: true } });
  if (!user) return { logs: [], total: 0 };

  const where = { userId: user.id };
  const { skip, take } = paginate({ page, limit });
  const [rows, total] = await Promise.all([
    prisma.activityLog.findMany({
      where, orderBy: { createdAt: 'desc' }, skip, take,
    }),
    prisma.activityLog.count({ where }),
  ]);
  return { logs: rows.map(wrapLog), total };
};

/** users.routes.js's per-user login history. */
const listLogins = async (userId, limit = 10) => {
  const user = await prisma.user.findUnique({ where: byPublicId(userId), select: { id: true } });
  if (!user) return [];

  const { limit: take } = paginate({ limit }, { defaultLimit: 10 });

  const rows = await prisma.activityLog.findMany({
    where: { userId: user.id, action: 'login', actionType: 'auth' },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map(wrapLog);
};

/** admin/customers.routes.js's per-customer login history — a broader action set than `listLogins`. */
const listLoginHistory = async (userId, { limit = 10, actions = ['login', 'customer_login', 'failed_login', 'logout'] } = {}) => {
  const user = await prisma.user.findUnique({ where: byPublicId(userId), select: { id: true } });
  if (!user) return [];

  const { limit: take } = paginate({ limit }, { defaultLimit: 10 });

  const rows = await prisma.activityLog.findMany({
    where: { userId: user.id, action: { in: actions } },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map(wrapLog);
};

const deleteByDateRange = async (start, end) => {
  // Same reasoning as deleteOlderThan — count from the delete, don't
  // materialise the rows to count them.
  const { count } = await prisma.activityLog.deleteMany({ where: { createdAt: { gte: start, lte: end } } });
  return count;
};

const listForExport = async (filters, take = 10000) => {
  const where = await buildWhere(filters);
  const rows = await prisma.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  return rows.map(wrapLog);
};

const groupCount = async (by, where) => {
  const rows = await prisma.activityLog.groupBy({ by: [by], where, _count: { _all: true } });
  return rows.map((r) => ({ _id: r[by], count: r._count._all })).sort((a, b) => b.count - a.count);
};

/** The '/stats/summary' dashboard — action-type/action/status breakdowns since `startDate`. */
const summary = async (startDate) => {
  const where = { createdAt: { gte: startDate } };
  const [actionTypes, topActions, statusDistribution, failedActions] = await Promise.all([
    groupCount('actionType', where),
    groupCount('action', where),
    groupCount('status', where),
    groupCount('action', { ...where, status: 'failed' }),
  ]);
  return {
    actionTypes,
    topActions: topActions.slice(0, 10),
    statusDistribution,
    failedActions: failedActions.slice(0, 5),
  };
};

module.exports = {
  logActivity,
  deleteAllForUsers,
  deleteOlderThan,
  list,
  getStats,
  findById,
  listForUser,
  listLogins,
  listLoginHistory,
  deleteByDateRange,
  listForExport,
  summary,
};
