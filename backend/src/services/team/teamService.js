/**
 * Team Service
 *
 * Teams are the accounts that own money on this platform — wallet, ledger,
 * cards, payments, deployments, usage (see the Team model in schema.prisma).
 * Every customer has exactly one `personal` account, created with the user
 * and presented to them simply as "Personal"; they may also own or belong to
 * any number of `team` accounts.
 *
 * This file is the only place a Team row is created or its account-level
 * fields (gateway customer ids, dispute hold, PAYG access) are written, so
 * the rules about them live in one place.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicId } = require('../../utils/helpers/publicId');

const TEAM_SELECT = {
  id: true,
  kind: true,
  name: true,
  createdById: true,
  paygAccess: true,
  disputeHold: true,
  disputeReason: true,
  disputedAt: true,
  stripeCustomerId: true,
  polarCustomerId: true,
  discoverableByDomain: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
};

/** A team by id, or null. Deleted teams are returned too — callers decide. */
const findById = async (teamId) => (teamId
  ? prisma.team.findUnique({ where: byPublicId(teamId), select: TEAM_SELECT })
  : null);

/** The user's personal account, or null if they have none (admins never do). */
const findPersonal = async (userId) => (userId
  ? prisma.team.findFirst({
    where: { createdById: byPublicId(userId).id, kind: 'personal' }, select: TEAM_SELECT,
  })
  : null);

/**
 * Create a user's personal account, with them as its owner. Idempotent: a
 * second call returns the existing one, and the database enforces one per user
 * with a partial unique index so a race cannot make two.
 *
 * The check-then-create is not atomic, though, and two requests that arrive
 * together — the customer center asks for the account list and the current
 * account on the same page load — both find nothing and both insert. One wins,
 * the other gets a unique-constraint error for a row that now exists and is
 * exactly what it wanted, so it reads it back rather than failing the request.
 *
 * `db` lets signup create the user and their account in one transaction.
 */
const createPersonal = async (user, db = prisma) => {
  const existing = await db.team.findFirst({
    where: { createdById: user.id, kind: 'personal' }, select: TEAM_SELECT,
  });
  if (existing) return existing;

  try {
    return await db.team.create({
      data: {
        kind: 'personal',
        name: user.name || user.email || 'Personal',
        createdById: user.id,
        members: { create: { userId: user.id, role: 'owner' } },
      },
      select: TEAM_SELECT,
    });
  } catch (error) {
    if (error.code !== 'P2002') throw error;
    // The winner of the race. Read outside `db`: inside a transaction that
    // statement has already aborted, and the row is committed either way.
    const winner = await prisma.team.findFirst({
      where: { createdById: user.id, kind: 'personal' }, select: TEAM_SELECT,
    });
    if (!winner) throw error;
    return winner;
  }
};

/**
 * Write account-level fields. Only the fields that belong on a Team are
 * accepted, so a caller cannot use this to move money or reassign an owner.
 */
const WRITABLE = ['name', 'paygAccess', 'disputeHold', 'disputeReason', 'disputedAt',
  'stripeCustomerId', 'polarCustomerId', 'discoverableByDomain'];

const update = async (team, data) => {
  const changes = {};
  for (const key of WRITABLE) if (data[key] !== undefined) changes[key] = data[key];
  return prisma.team.update({ where: { id: team.id }, data: changes, select: TEAM_SELECT });
};

/**
 * The contact a payment gateway should hold for an account: the person's
 * name and email for a personal account, the team's name with its creator's
 * email for a team. Gateways need an email; a team has none of its own.
 */
const gatewayContact = async (team) => {
  const owner = await prisma.user.findUnique({
    where: { id: team.createdById }, select: { id: true, name: true, email: true },
  });
  return {
    name: team.kind === 'personal' ? (owner?.name || team.name) : team.name,
    email: owner?.email || null,
    ownerUserId: owner?.id || null,
  };
};

/**
 * Roles that handle an account's money — they see its wallet, invoices and
 * debt, and are the ones told when money needs attention (low balance, a
 * failed collection, a card expiring). For a personal account that is simply
 * its one member.
 */
const MONEY_ROLES = ['owner', 'admin', 'billing'];

/** User ids to notify about this account's money. */
const billingRecipientIds = async (teamId) => {
  const rows = await prisma.teamMember.findMany({
    where: { teamId: byPublicId(teamId).id, role: { in: MONEY_ROLES }, user: { status: 'active' } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
};

/**
 * Who hears about one deployment: whoever created it (while they are still a
 * member of the account) plus the account's Owner and Admins. With
 * `money: true` — the event is about the account's money (paused for credit,
 * over the debt limit) — the Billing members too, and the creator only if
 * their own role may see money.
 *
 * For a personal account every branch is the one customer.
 */
const deploymentRecipientIds = async (deployment, { money = false } = {}) => {
  const roles = money ? MONEY_ROLES : ['owner', 'admin'];
  const rows = await prisma.teamMember.findMany({
    where: { teamId: byPublicId(deployment.teamId).id, user: { status: 'active' } },
    select: { userId: true, role: true },
  });
  const ids = new Set(rows.filter((r) => roles.includes(r.role)).map((r) => r.userId));
  const creator = rows.find((r) => String(r.userId) === String(deployment.userId));
  if (creator && (!money || MONEY_ROLES.includes(creator.role))) ids.add(creator.userId);
  return [...ids];
};

/** The account a Stripe / Polar customer belongs to (disputes, refunds). */
const findByStripeCustomerId = async (stripeCustomerId) => (stripeCustomerId
  ? prisma.team.findFirst({ where: { stripeCustomerId }, select: TEAM_SELECT })
  : null);
const findByPolarCustomerId = async (polarCustomerId) => (polarCustomerId
  ? prisma.team.findFirst({ where: { polarCustomerId }, select: TEAM_SELECT })
  : null);

/**
 * Which account a completed top-up pays into, from the checkout's own
 * server-written metadata. `teamId` is authoritative; a checkout started
 * before teams existed carries only `userId`, and pays into that user's
 * personal account — the only account they had when they started it.
 *
 * The metadata is written by our server when the checkout is created (only
 * for a member allowed to top up that account), and gateways sign the
 * webhook, so it is trusted as-is. Membership is deliberately NOT re-checked
 * here: a payer who left the team between paying and the webhook arriving has
 * still paid, and that money must land in the account it was paid for.
 */
const resolveTopUpAccount = async ({ teamId, userId }) => (teamId
  ? findById(teamId)
  : findPersonal(userId));

/**
 * How many accounts have their own pay-as-you-go setting, by value — so the
 * admin turning the platform switch off can see who it will NOT reach.
 * @returns {Promise<{allowed: number, blocked: number}>}
 */
const countPaygOverrides = async () => {
  const rows = await prisma.team.groupBy({
    by: ['paygAccess'],
    where: { deletedAt: null, paygAccess: { in: ['allowed', 'blocked'] } },
    _count: { _all: true },
  });
  const out = { allowed: 0, blocked: 0 };
  rows.forEach((r) => { out[r.paygAccess] = r._count._all; });
  return out;
};

/**
 * A user's membership in an account, with the account — or null when they
 * are not a member, or the account is deleted. Always read from the database:
 * a role change or a removal takes effect on the very next request.
 */
const findMembership = async (teamId, userId) => {
  const teamKey = byPublicId(teamId).id;
  const userKey = byPublicId(userId).id;
  const row = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: teamKey, userId: userKey } },
    select: {
      id: true, role: true, spendLimitMonthly: true, joinedAt: true,
      team: { select: TEAM_SELECT },
    },
  });
  if (!row || row.team.deletedAt) return null;
  const { team, ...membership } = row;
  return {
    team,
    membership: {
      ...membership,
      spendLimitMonthly: membership.spendLimitMonthly === null ? null : Number(membership.spendLimitMonthly),
    },
  };
};

/** Every account the user belongs to, personal first — the team switcher. */
const listForUser = async (userId) => {
  const rows = await prisma.teamMember.findMany({
    where: { userId: byPublicId(userId).id, team: { deletedAt: null } },
    select: { role: true, team: { select: { id: true, name: true, kind: true, createdAt: true } } },
    orderBy: { joinedAt: 'asc' },
  });
  return rows
    .map((r) => ({ ...r.team, role: r.role }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'personal' ? -1 : 1));
};

module.exports = {
  deploymentRecipientIds,
  findMembership,
  listForUser,
  countPaygOverrides,
  findByStripeCustomerId,
  findByPolarCustomerId,
  resolveTopUpAccount,
  MONEY_ROLES,
  billingRecipientIds,
  findById,
  findPersonal,
  createPersonal,
  update,
  gatewayContact,
};
