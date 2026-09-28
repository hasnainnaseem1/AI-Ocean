/**
 * "Someone wants to join" — the one queue, whichever door they came to.
 *
 * Three doors lead here and they all stop at the same place:
 *   - the team's join link, passed round the company's own chat;
 *   - the company hint, shown to somebody whose own verified address is at the
 *     domain of an organization that chose to be findable;
 *   - a verified company domain in `request` mode (the enterprise extra).
 *
 * None of them admits anybody. Each one produces a row here, and an owner or
 * admin decides. Keeping that decision in a single file is the point: a second
 * copy of "let them in" is how one door eventually ends up with weaker checks
 * than the others.
 *
 * The role a request is approved at never comes from the person asking. It
 * comes from the link they used, or from the team's domain rule, and it can
 * only be Developer or Viewer — asking to join is never a way to reach money.
 */
const prisma = require('../../lib/prismaClient');
const teamSettingsService = require('./teamSettingsService');
const teamActivityService = require('./teamActivityService');
const teamNotifier = require('./teamNotifier');
const { byPublicId } = require('../../utils/helpers/publicId');

const fail = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

const openWhere = () => ({ approvedAt: null, declinedAt: null, cancelledAt: null });

/** Roles a request may ever be approved at. */
const JOINABLE_ROLES = ['developer', 'viewer'];

/** Is this account in a state where anybody should be letting it into a team? */
const usable = (user) => !!user
  && user.accountType === 'customer'
  && user.status === 'active'
  && user.isEmailVerified;

const notifyManagers = async (teamId, payload) => {
  const managers = await prisma.teamMember.findMany({
    where: { teamId, role: { in: ['owner', 'admin'] }, user: { status: 'active' } },
    select: { userId: true },
  });
  for (const { userId } of managers) {
    await teamNotifier.notify({
      recipientId: userId, recipientType: 'customer', ...payload,
    }).catch((err) => console.error('[JoinRequest] Notification failed:', err.message));
  }
};

/**
 * Record the asking. `link` is the join link it came through, if any — the
 * role is read back off it at approval time rather than stored here, so a team
 * that re-issues its link with a different role gets what it meant.
 */
const create = async (team, user, { link = null, req = null } = {}) => {
  if (!usable(user)) throw fail(403, 'ACCOUNT_NOT_READY', 'Verify your email first.');

  const already = await prisma.teamMember.findFirst({
    where: { teamId: byPublicId(team.id).id, userId: user.id }, select: { id: true },
  });
  if (already) throw fail(409, 'ALREADY_MEMBER', 'You are already a member of this organization.');

  let row;
  try {
    row = await prisma.teamJoinRequest.create({
      data: {
        teamId: byPublicId(team.id).id,
        userId: user.id,
        email: String(user.email).toLowerCase(),
        joinLinkId: link ? link.id : null,
      },
      select: { id: true, createdAt: true },
    });
  } catch (error) {
    // The partial unique index: they have already asked and nobody has answered.
    if (error.code === 'P2002') throw fail(409, 'REQUEST_PENDING', 'You have already asked to join.');
    throw error;
  }

  await teamActivityService.record(team, user, 'member.joinRequested', {
    targetType: 'user',
    targetId: user.id,
    targetName: user.name,
    metadata: { via: link ? 'link' : 'domain' },
    req,
  });
  await notifyManagers(byPublicId(team.id).id, {
    type: 'team_join_request',
    contentKey: 'team.joinRequested',
    title: 'Someone asked to join',
    message: `${user.name} (${user.email}) asked to join ${team.name}.`,
    metadata: { memberName: user.name, memberEmail: user.email, teamName: team.name },
    priority: 'medium',
    action: {
      label: 'Team settings',
      url: `${(process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002').replace(/\/$/, '')}/team`,
    },
  });

  return { requestId: row.id, createdAt: row.createdAt };
};

/** Everyone still waiting on an answer, for the owner's screen. */
const listPending = async (team) => {
  const rows = await prisma.teamJoinRequest.findMany({
    where: { teamId: byPublicId(team.id).id, ...openWhere() },
    include: {
      user: { select: { id: true, name: true, email: true, avatar: true } },
      joinLink: { select: { id: true, role: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    userId: r.user.id,
    name: r.user.name,
    email: r.email,
    avatar: r.user.avatar,
    via: r.joinLinkId ? 'link' : 'domain',
    role: r.joinLink?.role || null,
    createdAt: r.createdAt,
  }));
};

/** The role this particular request would be approved at. */
const roleFor = async (teamId, row) => {
  if (row.joinLinkId) {
    const link = await prisma.teamJoinLink.findUnique({
      where: { id: row.joinLinkId }, select: { role: true },
    });
    if (link && JOINABLE_ROLES.includes(link.role)) return link.role;
  }
  const team = await prisma.team.findUnique({
    where: { id: teamId }, select: { domainJoinRole: true },
  });
  const role = team?.domainJoinRole;
  return JOINABLE_ROLES.includes(role) ? role : 'viewer';
};

/**
 * Let them in.
 *
 * Claimed conditionally so two admins clicking at once cannot both succeed,
 * and everything is checked again here: the account can have been suspended,
 * the team can have filled up, and the address can have changed since they
 * asked.
 */
const approve = async (team, actor, requestId, { req = null } = {}) => {
  const teamId = byPublicId(team.id).id;
  const row = await prisma.teamJoinRequest.findFirst({
    where: { id: byPublicId(requestId).id, teamId, ...openWhere() },
    include: {
      user: {
        select: {
          id: true, name: true, email: true, accountType: true, status: true, isEmailVerified: true,
        },
      },
    },
  });
  if (!row) throw fail(404, 'REQUEST_NOT_FOUND', 'That request is no longer open.');
  if (!usable(row.user)) {
    throw fail(409, 'MEMBER_NOT_READY', 'That person’s account is not active and verified.');
  }

  const settings = await teamSettingsService.getTeamSettings();
  const members = await prisma.teamMember.count({ where: { teamId } });
  if (members >= settings.maxMembers) throw fail(409, 'TEAM_FULL', 'This organization is full.');

  const role = await roleFor(teamId, row);

  const claimed = await prisma.teamJoinRequest.updateMany({
    where: { id: row.id, ...openWhere() },
    data: { approvedAt: new Date(), decidedById: actor.id },
  });
  if (claimed.count !== 1) throw fail(409, 'REQUEST_NOT_FOUND', 'That request is no longer open.');

  await prisma.$transaction([
    prisma.teamMember.create({
      data: {
        teamId, userId: row.user.id, role, invitedById: actor.id,
      },
    }),
    // A link's cap counts people who actually got in, not people who asked.
    ...(row.joinLinkId
      ? [prisma.teamJoinLink.update({ where: { id: row.joinLinkId }, data: { usedCount: { increment: 1 } } })]
      : []),
  ]);

  await teamActivityService.record(team, actor, 'member.joinApproved', {
    targetType: 'user', targetId: row.user.id, targetName: row.user.name, metadata: { role }, req,
  });

  await teamNotifier.notify({
    recipientId: row.user.id,
    recipientType: 'customer',
    type: 'team_join_request',
    contentKey: 'team.joinApproved',
    title: 'You are in',
    message: `Your request to join ${team.name} was approved.`,
    metadata: { teamName: team.name },
    priority: 'medium',
  }).catch((err) => console.error('[JoinRequest] Approval notification failed:', err.message));

  return { approved: true, userId: row.user.id, role };
};

/** Say no. They are told, so nobody is left waiting on nothing. */
const decline = async (team, actor, requestId, { req = null } = {}) => {
  const row = await prisma.teamJoinRequest.findFirst({
    where: { id: byPublicId(requestId).id, teamId: byPublicId(team.id).id, ...openWhere() },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!row) throw fail(404, 'REQUEST_NOT_FOUND', 'That request is no longer open.');

  await prisma.teamJoinRequest.update({
    where: { id: row.id }, data: { declinedAt: new Date(), decidedById: actor.id },
  });
  await teamActivityService.record(team, actor, 'member.joinDeclined', {
    targetType: 'user', targetId: row.user.id, targetName: row.user.name, req,
  });

  await teamNotifier.notify({
    recipientId: row.user.id,
    recipientType: 'customer',
    type: 'team_join_request',
    contentKey: 'team.joinDeclined',
    title: 'Your request was declined',
    message: `Your request to join ${team.name} was not approved.`,
    metadata: { teamName: team.name },
    priority: 'low',
  }).catch((err) => console.error('[JoinRequest] Decline notification failed:', err.message));

  return { declined: true };
};

/** The open requests this person has made, for their own screen. */
const mine = async (user) => {
  const rows = await prisma.teamJoinRequest.findMany({
    where: { userId: user.id, ...openWhere(), team: { deletedAt: null } },
    include: { team: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id, teamId: r.team.id, teamName: r.team.name, createdAt: r.createdAt,
  }));
};

module.exports = {
  JOINABLE_ROLES, usable, openWhere, create, listPending, approve, decline, mine,
};
