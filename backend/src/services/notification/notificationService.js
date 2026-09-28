/**
 * Notifications — the in-app bell, for both customers and admins. Ported to
 * Prisma as part of the Admin+Notification domain (see the migration plan).
 *
 * `createNotification` is a single choke point already used by ~15 call
 * sites across the app (`Notification.createNotification({...})`) —
 * `models/notification/Notification.js`'s static now just delegates here, so
 * every one of those call sites keeps working completely unchanged, the same
 * trick used for `ActivityLog.logActivity`/`AdminSettings.getSettings`.
 *
 * Unlike ActivityLog/AdminSettings, though, this file also owns Notification's
 * OWN primary interface — the bell itself (`routes/v1/notification/index.js`)
 * and the admin per-customer notification history
 * (`routes/v1/admin/customers.routes.js`) — so those two are fully ported to
 * read Postgres directly, not left on the mirror.
 *
 * `expiresAt` is not enforced by the database —
 * replaced by a new `notificationCleanup` cron job registered in
 * `jobs/index.js` that runs `deleteExpired()` daily, per the migration plan.
 */
const prisma = require('../../lib/prismaClient');
const { paginate } = require('../../utils/helpers/pagination');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');
const { renderCopy } = require('./notificationCopy');
const languageSettingsService = require('../i18n/languageSettingsService');

/**
 * `lang` decides which language the text comes out in. Passing 'en' — or a row
 * with no `contentKey` — yields byte-identical output to what this returned
 * before notifications became translatable, which is what keeps the admin's
 * per-customer history and every pre-existing row unchanged.
 */
const toDoc = (row, ctx) => {
  const rendered = renderCopy(row.contentKey, row.metadata, ctx.lang, row);
  return {
    id: row.id,
    recipientId: ctx.recipientId,
    recipientType: row.recipientType,
    type: row.type,
    title: rendered ? rendered.title : row.title,
    message: rendered ? rendered.message : row.message,
    action: { label: row.actionLabel || null, url: row.actionUrl || null },
    priority: row.priority,
    isRead: row.isRead,
    readAt: row.readAt,
    senderId: ctx.senderId || null,
    senderName: row.senderName,
    metadata: row.metadata || {},
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
};

const INCLUDE = { recipient: { select: { id: true } }, sender: { select: { id: true } } };
const wrap = (row, lang = 'en') => toDoc(row, {
  recipientId: row.recipient?.id, senderId: row.sender?.id, lang,
});

const resolveUserPg = async (id) => {
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: byPublicId(id), select: { id: true } });
  return user?.id || null;
};

/**
 * Mirrors the original static helper exactly — same params, same
 * never-throws-to-the-caller contract.
 */
const createNotification = async ({
  recipientId, recipientType = 'customer', type, title, message,
  action = null, priority = 'medium', senderId = null, senderName = 'System',
  metadata = {}, expiresAt = null, contentKey = null,
}) => {
  try {
    const [recipientPg, senderPg] = await Promise.all([resolveUserPg(recipientId), resolveUserPg(senderId)]);
    if (!recipientPg) {
      console.error(`[Notification] No user found for recipient id ${recipientId}, skipping`);
      return null;
    }

    const row = await prisma.notification.create({
      data: {

        recipientId: recipientPg,
        recipientType,
        type,
        // The English wording is still written, always. It is what the admin
        // history reads, what anything querying these columns directly sees,
        // and the fallback if `contentKey` is ever renamed out from under a
        // row. `contentKey` adds the ability to re-render; it does not replace
        // the record of what was said.
        title,
        message,
        contentKey,
        actionLabel: action?.label || null,
        actionUrl: action?.url || null,
        priority,
        senderId: senderPg,
        senderName: senderName || 'System',
        metadata: metadata || {},
        expiresAt,
      },
    });

    return row;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
};

/** Fan-out to many recipients at once (bulk admin notifications) — same shape as `createNotification`, one per entry. */
const createMany = async (entries) => {
  const created = await Promise.all(entries.map((entry) => createNotification(entry)));
  return created.filter(Boolean);
};

const getUnreadCount = async (userId) => {
  const userPg = await resolveUserPg(userId);
  if (!userPg) return 0;
  return prisma.notification.count({ where: { recipientId: userPg, isRead: false } });
};

// Addressed by skip/limit rather than page/limit, so it clamps them directly
// instead of going through `paginate`.
const listForUser = async (userId, { limit = 20, skip = 0, unreadOnly = false } = {}) => {
  const userPg = await resolveUserPg(userId);
  if (!userPg) return { notifications: [], total: 0, unreadCount: 0 };

  const { limit: take } = paginate({ limit });
  const safeSkip = Math.max(0, Number.isFinite(Number(skip)) ? Math.floor(Number(skip)) : 0);

  const where = { recipientId: userPg, ...(unreadOnly ? { isRead: false } : {}) };
  const [rows, total, unreadCount, recipient] = await Promise.all([
    prisma.notification.findMany({
      where, orderBy: { createdAt: 'desc' }, take, skip: safeSkip, include: INCLUDE,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { recipientId: userPg, isRead: false } }),
    // The reader's language, read fresh on every list. This is what makes the
    // whole bell — including items written months ago — follow a language
    // change with no rows written and no backfill.
    prisma.user.findUnique({
      where: { id: userPg },
      select: { language: true, languagePreferenceSet: true },
    }),
  ]);

  const lang = await languageSettingsService.resolveLanguage(recipient);
  return { notifications: rows.map((row) => wrap(row, lang)), total, unreadCount, language: lang };
};

/**
 * Admin per-customer notification history.
 *
 * Deliberately English: an admin reading a customer's history is reading a
 * record of what the platform sent, and a support conversation goes badly if
 * the two people are looking at differently-worded copies of the same event.
 * `wrap`'s default of 'en' is what enforces that, and it makes this function
 * byte-identical to what it returned before this phase.
 *
 * Filter is the same shape customers.routes.js already builds.
 */
const listForRecipientWithFilter = async (recipientId, { type, isRead, page = 1, limit = 20 } = {}) => {
  const userPg = await resolveUserPg(recipientId);
  if (!userPg) return { notifications: [], total: 0 };

  const where = { recipientId: userPg };
  if (type) where.type = type;
  if (isRead !== undefined) where.isRead = isRead === 'true' || isRead === true;

  const { skip, take } = paginate({ page, limit });
  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where, orderBy: { createdAt: 'desc' }, skip, take, include: INCLUDE,
    }),
    prisma.notification.count({ where }),
  ]);

  return { notifications: rows.map(wrap), total };
};

/**
 * The language to render one user's own notifications in.
 *
 * The single-notification endpoints hand their result straight back to the
 * customer, so they have to speak the same language the list does — otherwise
 * clicking an Urdu notification would return an English copy of it.
 */
const langForUser = async (userPgId) => {
  const user = await prisma.user.findUnique({
    where: { id: userPgId },
    select: { language: true, languagePreferenceSet: true },
  });
  return languageSettingsService.resolveLanguage(user);
};

const findOwned = async (id, userId) => {
  const row = await prisma.notification.findUnique({ where: byPublicId(id), include: INCLUDE });
  if (!row) return null;
  if (String(row.recipient?.id) !== String(userId)) return { forbidden: true };
  const doc = wrap(row, await langForUser(row.recipientId));
  return { row, doc };
};

const markAsRead = async (id, userId) => {
  const found = await findOwned(id, userId);
  if (!found || found.forbidden) return found;

  const now = new Date();
  const updated = await prisma.notification.update({
    where: { id: found.row.id }, data: { isRead: true, readAt: now }, include: INCLUDE,
  });
  return { doc: wrap(updated, await langForUser(found.row.recipientId)) };
};

const markAllAsRead = async (userId) => {
  const userPg = await resolveUserPg(userId);
  if (!userPg) return;

  const now = new Date();
  await prisma.notification.updateMany({ where: { recipientId: userPg, isRead: false }, data: { isRead: true, readAt: now } });
};

const deleteOwned = async (id, userId) => {
  const found = await findOwned(id, userId);
  if (!found || found.forbidden) return found;

  await prisma.notification.delete({ where: { id: found.row.id } });
  return { doc: found.doc };
};

/** The "permanently delete customer" cascade in admin/customers.routes.js. */
const deleteAllForUsers = async (userIds, db = prisma) => {
  const users = await db.user.findMany({ where: byPublicIds(userIds), select: { id: true } });
  const userPgIds = users.map((u) => u.id);
  if (!userPgIds.length) return;

  await db.notification.deleteMany({ where: { recipientId: { in: userPgIds } } });
};

/** jobs/index.js's custom "database cleanup" cron action, target 'notifications'. */
const deleteOlderThan = async (cutoff) => {
  const { count } = await prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return count;
};

/** The `notificationCleanup` cron job — what actually enforces `expiresAt`. */
const deleteExpired = async () => {
  const { count } = await prisma.notification.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
};

module.exports = {
  createNotification,
  createMany,
  getUnreadCount,
  listForUser,
  listForRecipientWithFilter,
  markAsRead,
  markAllAsRead,
  deleteOwned,
  deleteAllForUsers,
  deleteOlderThan,
  deleteExpired,
};
