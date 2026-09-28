const prisma = require('../../lib/prismaClient');
const { paginate } = require('../../utils/helpers/pagination');
const {
  hashPassword, comparePassword, isLocked, getPermissions, hasPermission,
} = require('./userHelpers');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');

/**
 * Users and custom roles.
 *
 * One table holds both admins and customers, separated by `accountType`. The
 * two auth middlewares and the RBAC layer all read what this file returns, so
 * the shape it hands back is effectively the app's definition of "a user".
 *
 * `wrapUser` does two things worth knowing about. It attaches the behaviour
 * that belongs to a user rather than to a caller — `hasPermission()`,
 * `comparePassword()`, `isLocked()` — so no route has to re-implement a
 * permission check. And it deletes the password hash from the object while
 * keeping it in the closure that `comparePassword` reads, so the hash cannot
 * be leaked by anything that spreads or serialises a user.
 *
 * `sanitizeUserRef` is the same protection for a user attached as someone
 * else's relation (`createdBy`, `assignedBy`), which arrives from Prisma as a
 * raw record — password hash and all.
 */

const wrapUser = (user) => {
  if (!user) return null;
  const passwordHash = user.password;
  const wrapped = { ...user, id: user.id, };
  // Never carry the password hash further than this function — every old
  // read site used `.select('-password')`; comparePassword still
  // needs it, so it's kept in this closure instead of on the object itself.
  delete wrapped.password;
  wrapped.isLocked = () => isLocked(wrapped);
  wrapped.comparePassword = (candidate) => comparePassword({ password: passwordHash }, candidate);
  wrapped.getPermissions = () => getPermissions(wrapped);
  wrapped.hasPermission = (permission) => hasPermission(wrapped, permission);
  return wrapped;
};

const CUSTOM_ROLE_INCLUDE = { customRole: true };

/**
 * For a User attached to a response as someone ELSE's relation — `assignedBy`,
 * `createdBy`, `updatedBy` — rather than as the request's own `req.user`.
 * Those come back from Prisma `include` as raw records (password hash and
 * all), so anything that spreads one into a JSON response must go through
 * this first. `wrapUser` covers the main subject of a request; this covers
 * every nested reference to a *different* user.
 */
const sanitizeUserRef = (user) => {
  if (!user) return user;
  const { password, emailVerificationToken, passwordResetToken, ...rest } = user;
  return { ...rest, id: user.id, };
};

const findById = async (id, { include = CUSTOM_ROLE_INCLUDE } = {}) => {
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: byPublicId(id), include });
  return wrapUser(user);
};

/**
 * Many users in one query — for the background jobs, which used to look each
 * customer up individually inside a loop.
 */
const findManyByIds = async (ids = [], { include = CUSTOM_ROLE_INCLUDE } = {}) => {
  const unique = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!unique.length) return [];
  const rows = await prisma.user.findMany({ where: byPublicIds(unique), include });
  return rows.map(wrapUser);
};

const findByEmail = async (email, { accountType, include = CUSTOM_ROLE_INCLUDE } = {}) => {
  const user = await prisma.user.findFirst({
    where: { email, ...(accountType ? { accountType } : {}) },
    include,
  });
  return wrapUser(user);
};

const findSuperAdmin = async () => {
  const user = await prisma.user.findFirst({ where: { role: 'super_admin', accountType: 'admin' } });
  return wrapUser(user);
};

const findByToken = async (field, tokenValue, { requireFuture = false } = {}) => {
  const where = { [field]: tokenValue };
  if (requireFuture) {
    const expiresField = field === 'emailVerificationToken' ? 'emailVerificationExpires' : 'passwordResetExpires';
    where[expiresField] = { gt: new Date() };
  }
  const user = await prisma.user.findFirst({ where });
  return wrapUser(user);
};

/**
 * `data` is plain field values (camelCase, matching the Prisma schema).
 * `password`, if present, is the RAW password — hashed here, once, and the
 * same hash is written to both stores.
 */
/**
 * Every customer is created together with their personal account (Team) in
 * one transaction — never one without the other, since everything they pay
 * for hangs off that account. Staff (accountType 'admin') have no account.
 */
const createUser = async (data) => {
  const password = data.password ? await hashPassword(data.password) : undefined;
  const isCustomer = (data.accountType || 'customer') === 'customer';

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { ...data, password },
      include: CUSTOM_ROLE_INCLUDE,
    });
    if (isCustomer) {
      await require('../team/teamService').createPersonal(user, tx);
    }
    return user;
  });

  return wrapUser(created);
};

/**
 * `data` is the partial set of fields to change. If `data.password` is
 * present it's treated as a RAW password and hashed here (never pass an
 * already-hashed value).
 */
const updateUser = async (user, data) => {
  const changes = { ...data };
  if (changes.password) changes.password = await hashPassword(changes.password);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: changes,
    include: CUSTOM_ROLE_INCLUDE,
  });

  return wrapUser(updated);
};

/**
 * @param {object} user  a wrapped user record
 * @param {object} [db]  a Prisma transaction client, when this delete is one
 *                       step of the larger cascade in userDeletionService
 */
const deleteUser = async (user, db = prisma) => {
  await db.user.delete({ where: { id: user.id } });
};

/** Records a failed sign-in attempt, locking the account past the configured limit. */
const incLoginAttempts = async (user, maxAttempts = 5, lockDurationMs = 2 * 60 * 60 * 1000) => {
  if (user.lockUntil && new Date(user.lockUntil) < new Date()) {
    return wrapUser(await prisma.user.update({
      where: { id: user.id },
      data: { loginAttempts: 1, lockUntil: null },
      include: CUSTOM_ROLE_INCLUDE,
    }));
  }

  const nextAttempts = user.loginAttempts + 1;
  const data = { loginAttempts: { increment: 1 } };
  if (nextAttempts >= maxAttempts && !isLocked(user)) {
    data.lockUntil = new Date(Date.now() + lockDurationMs);
  }

  return wrapUser(await prisma.user.update({ where: { id: user.id }, data, include: CUSTOM_ROLE_INCLUDE }));
};

/** Clears the failed-attempt counter and any lock after a successful sign-in. */
const resetLoginAttempts = async (user) => {
  return wrapUser(await prisma.user.update({
    where: { id: user.id },
    data: { loginAttempts: 0, lockUntil: null },
    include: CUSTOM_ROLE_INCLUDE,
  }));
};

/** jobs/index.js's "database cleanup" cron action, target 'unverifiedUsers'. */
const deleteUnverifiedOlderThan = async (cutoff) => {
  const rows = await prisma.user.findMany({
    where: { isEmailVerified: false, accountType: 'customer', createdAt: { lt: cutoff } },
    select: { id: true },
  });
  if (!rows.length) return 0;

  await prisma.user.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.length;
};

/**
 * jobs/index.js's "database cleanup" cron action, target 'expiredSessions'.
 * Ported with the field name fixed — the original version targeted
 * `resetPasswordExpires`, a field that never existed on the schema
 * (`passwordResetExpires` is the real one), so this cleanup has silently
 * matched nothing since before this migration began.
 */
const clearExpiredPasswordResets = async (now = new Date()) => {
  const rows = await prisma.user.findMany({
    where: { passwordResetExpires: { lt: now } },
    select: { id: true },
  });
  if (!rows.length) return 0;

  await prisma.user.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { passwordResetToken: null, passwordResetExpires: null },
  });
  return rows.length;
};

const customerWhere = ({ status, search, isEmailVerified } = {}) => {
  const where = { accountType: 'customer' };
  if (status) {
    const statuses = String(status).split(',').filter(Boolean);
    where.status = statuses.length > 1 ? { in: statuses } : statuses[0];
  }
  if (isEmailVerified !== undefined) where.isEmailVerified = isEmailVerified === 'true' || isEmailVerified === true;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  return where;
};

/** admin/customers.routes.js's customer list — paginated, with platform-wide stats. */
const listCustomersAdmin = async ({
  status, search, isEmailVerified, sortBy = 'createdAt', order = 'desc', page = 1, limit = 20,
} = {}) => {
  const where = customerWhere({ status, search, isEmailVerified });
  const SORT_FIELDS = ['createdAt', 'name', 'email', 'status', 'lastLogin'];
  const orderBy = { [SORT_FIELDS.includes(sortBy) ? sortBy : 'createdAt']: order === 'asc' ? 'asc' : 'desc' };
  const { skip, take } = paginate({ page, limit });

  const [rows, total, totalCustomers, activeCustomers, pendingVerification, suspendedCustomers] = await Promise.all([
    prisma.user.findMany({
      where, orderBy, skip, take,
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: { accountType: 'customer' } }),
    prisma.user.count({ where: { accountType: 'customer', status: 'active' } }),
    prisma.user.count({ where: { accountType: 'customer', status: 'pending_verification' } }),
    prisma.user.count({ where: { accountType: 'customer', status: 'suspended' } }),
  ]);

  return {
    customers: rows.map(wrapUser),
    total,
    stats: {
      totalCustomers, activeCustomers, pendingVerification, suspendedCustomers,
    },
  };
};

/** Every customer matching a filter, unpaginated — admin customer CSV export. */
const listCustomersForExport = async ({ status, search, isEmailVerified } = {}) => {
  const rows = await prisma.user.findMany({
    where: customerWhere({ status, search, isEmailVerified }), orderBy: { createdAt: 'desc' },
  });
  return rows.map(wrapUser);
};

/** jobs/index.js's custom "notification" cron action: every admin account. */
const listAdmins = async () => {
  const rows = await prisma.user.findMany({ where: { accountType: 'admin' }, select: { id: true } });
  return rows.map((r) => ({ id: r.id, }));
};

/** adminNotifier.js's getAdminIds/getSuperAdmins — active admins, optionally scoped to one role. */
const listActiveAdmins = async ({ role } = {}) => {
  const rows = await prisma.user.findMany({
    where: { accountType: 'admin', status: 'active', ...(role ? { role } : {}) },
    select: { id: true, email: true, name: true },
  });
  return rows.map((r) => ({ id: r.id, email: r.email, name: r.name }));
};

module.exports = {
  wrapUser,
  sanitizeUserRef,
  findById,
  findManyByIds,
  findByEmail,
  findSuperAdmin,
  findByToken,
  createUser,
  updateUser,
  deleteUser,
  incLoginAttempts,
  resetLoginAttempts,
  deleteUnverifiedOlderThan,
  clearExpiredPasswordResets,
  listAdmins,
  listActiveAdmins,
  listCustomersAdmin,
  listCustomersForExport,
};
