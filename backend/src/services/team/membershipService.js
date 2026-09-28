/**
 * A team's members — listing them, changing a role, removing someone, leaving.
 *
 * Who may manage whom (on top of the `team.members` permission the routes
 * already require):
 *   - the owner is never removed, demoted or re-roled by anyone — ownership
 *     only moves by an accepted transfer (phase CUSTODY);
 *   - an owner manages everyone else; an admin manages only members ranked
 *     below them (billing, developer, viewer) — never another admin;
 *   - nobody grants a role above their own, and nobody grants `owner`;
 *   - the owner cannot leave (they would leave the account without an owner).
 *
 * A personal account has one member and none of this applies to it.
 *
 * Removing a member removes their access only: deployments they created stay
 * with the team and keep running (the team pays for them, not the member).
 */
const prisma = require('../../lib/prismaClient');
const { RANK } = require('./permissions');
const teamActivityService = require('./teamActivityService');
const { byPublicId } = require('../../utils/helpers/publicId');

const fail = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

const ASSIGNABLE = ['admin', 'billing', 'developer', 'viewer'];

const assertTeam = (team) => {
  if (team.kind !== 'team') throw fail(400, 'NOT_A_TEAM', 'A personal account has no members to manage.');
};

/** May `actor` manage `target` at all? */
const canManage = (actor, target) => {
  if (target.role === 'owner') return false;
  if (actor.role === 'owner') return true;
  return RANK[target.role] < RANK[actor.role];
};

/**
 * `withMoney` — the caller may see the team's money (canSeeMoney): each
 * member's monthly spend limit and what they have spent against it this
 * month. Developers and Viewers get the list without either.
 */
const list = async (team, { withMoney = false } = {}) => {
  const rows = await prisma.teamMember.findMany({
    where: { teamId: team.id },
    select: {
      role: true, joinedAt: true, spendLimitMonthly: true,
      user: { select: { id: true, name: true, email: true, avatar: true, status: true } },
    },
    orderBy: { joinedAt: 'asc' },
  });
  const spendLimitService = require('./spendLimitService');
  return Promise.all(rows.map(async (r) => ({
    userId: r.user.id,
    name: r.user.name,
    email: r.user.email,
    avatar: r.user.avatar,
    role: r.role,
    joinedAt: r.joinedAt,
    ...(withMoney ? {
      spendLimitMonthly: r.spendLimitMonthly === null ? null : Number(r.spendLimitMonthly),
      monthSpend: await spendLimitService.memberMonthSpend(team.id, r.user.id),
    } : {}),
  })));
};

const findTarget = async (team, userId, { withUser = false } = {}) => {
  const target = await prisma.teamMember.findFirst({
    where: { teamId: team.id, userId: byPublicId(userId).id },
    select: {
      id: true,
      userId: true,
      role: true,
      ...(withUser ? { user: { select: { name: true, email: true } } } : {}),
    },
  });
  if (!target) throw fail(404, 'MEMBER_NOT_FOUND', 'That person is not a member of this team.');
  return target;
};

const changeRole = async (team, actor, actorUserId, targetUserId, role, { actorUser = null, req = null } = {}) => {
  assertTeam(team);
  if (!ASSIGNABLE.includes(role)) throw fail(400, 'INVALID_ROLE', 'That role cannot be assigned.');
  if (String(targetUserId) === String(actorUserId)) {
    throw fail(403, 'CANNOT_CHANGE_OWN_ROLE', 'You cannot change your own role.');
  }
  const target = await findTarget(team, targetUserId, { withUser: true });
  if (!canManage(actor, target)) throw fail(403, 'CANNOT_MANAGE_MEMBER', 'You cannot change this member’s role.');
  if (RANK[role] > RANK[actor.role]) throw fail(403, 'ROLE_ABOVE_YOURS', 'You cannot give someone a role above your own.');

  if (target.role === role) return { userId: target.userId, role, previous: role };
  await prisma.teamMember.update({ where: { id: target.id }, data: { role } });
  await teamActivityService.record(team, actorUser, 'member.roleChanged', {
    targetType: 'user',
    targetId: target.userId,
    targetName: target.user?.name,
    metadata: { from: target.role, to: role },
    req,
  });
  return { userId: target.userId, role, previous: target.role };
};

const remove = async (team, actor, actorUserId, targetUserId, { actorUser = null, req = null } = {}) => {
  assertTeam(team);
  if (String(targetUserId) === String(actorUserId)) {
    throw fail(400, 'USE_LEAVE', 'To remove yourself, leave the team instead.');
  }
  const target = await findTarget(team, targetUserId, { withUser: true });
  if (!canManage(actor, target)) throw fail(403, 'CANNOT_MANAGE_MEMBER', 'You cannot remove this member.');
  await prisma.teamMember.delete({ where: { id: target.id } });
  await teamActivityService.record(team, actorUser, 'member.removed', {
    targetType: 'user',
    targetId: target.userId,
    targetName: target.user?.name,
    metadata: { role: target.role },
    req,
  });
  return { userId: target.userId, role: target.role };
};

/**
 * Set (or clear, with null) a Developer's monthly spend limit. Only for
 * Developers — the only role a limit applies to — and only by someone who may
 * manage that member.
 */
const MAX_LIMIT = 10000000;

const setSpendLimit = async (team, actor, actorUserId, targetUserId, limit, { actorUser = null, req = null } = {}) => {
  assertTeam(team);
  const target = await findTarget(team, targetUserId, { withUser: true });
  if (!canManage(actor, target)) throw fail(403, 'CANNOT_MANAGE_MEMBER', 'You cannot change this member’s limit.');
  if (target.role !== 'developer') {
    throw fail(400, 'LIMIT_ONLY_FOR_DEVELOPERS', 'Spending limits apply to Developers only.');
  }
  let value = null;
  if (limit !== null && limit !== undefined && limit !== '') {
    value = Math.round(Number(limit) * 100) / 100;
    if (!Number.isFinite(value) || value < 0 || value > MAX_LIMIT) {
      throw fail(400, 'INVALID_LIMIT', 'Enter a limit of 0 or more.');
    }
  }
  await prisma.teamMember.update({
    where: { id: target.id },
    // A new limit re-arms that month's alerts, so raising it to a figure the
    // member is still below alerts again when they near the new one.
    data: { spendLimitMonthly: value, limitAlertLevel: 0, limitAlertMonth: null },
  });
  await teamActivityService.record(team, actorUser, value === null ? 'member.limitCleared' : 'member.limitSet', {
    targetType: 'user',
    targetId: target.userId,
    targetName: target.user?.name,
    metadata: { limit: value },
    req,
  });
  return { userId: target.userId, spendLimitMonthly: value };
};

const leave = async (team, membership, { actorUser = null, req = null } = {}) => {
  assertTeam(team);
  if (membership.role === 'owner') {
    throw fail(409, 'OWNER_CANNOT_LEAVE', 'Transfer ownership to another member before leaving.');
  }
  await prisma.teamMember.delete({ where: { id: membership.id } });
  await teamActivityService.record(team, actorUser, 'member.left', {
    targetType: 'user', targetId: actorUser?.id, targetName: actorUser?.name, metadata: { role: membership.role }, req,
  });
  return { left: true };
};

module.exports = {
  ASSIGNABLE, canManage, list, changeRole, remove, leave, setSpendLimit,
};
