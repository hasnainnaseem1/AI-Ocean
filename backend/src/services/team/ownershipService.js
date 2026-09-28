/**
 * Handing a team over to one of its members.
 *
 * ── Why it takes two people ──
 *
 * Owning a team means owing for it: its deployments, its outstanding balance
 * and whatever it spends next all sit on the account the owner answers for. So
 * ownership never moves on one person's say-so. The owner offers, and the
 * member accepts — until then nothing has changed. An offer left unanswered
 * expires (admin setting `ownershipExpiryDays`).
 *
 * ── What moves, and what does not ──
 *
 * Only the two roles swap: the member becomes owner, and the outgoing owner
 * stays on as an admin rather than being dropped out of the team they built.
 * The wallet, the cards, the ledger and any outstanding balance belong to the
 * TEAM, not to whoever owns it, so a handover moves no money in either
 * direction. That is the whole reason this cannot be used to escape a debt
 * (plan loophole #6): the balance does not follow the person out.
 *
 * ── Who may receive one ──
 *
 * Someone who could not create a team of their own cannot be handed one
 * instead: the same checks that guard `createTeam` guard the receiving end —
 * an account of theirs over its debt limit or under a dispute hold (#2, #14),
 * and the cap on how many teams one person may own. Otherwise a blocked
 * customer could simply be handed a clean team by a friend.
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

/** An offer nobody has answered yet and which has not run out of time. */
const openWhere = (now = new Date()) => ({
  acceptedAt: null,
  declinedAt: null,
  cancelledAt: null,
  expiresAt: { gt: now },
});

const shape = (row) => (row ? {
  id: row.id,
  teamId: row.teamId,
  teamName: row.team?.name || null,
  from: row.fromUser ? { userId: row.fromUser.id, name: row.fromUser.name, email: row.fromUser.email } : null,
  to: row.toUser ? { userId: row.toUser.id, name: row.toUser.name, email: row.toUser.email } : null,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
} : null);

const INCLUDE = {
  team: { select: { name: true } },
  fromUser: { select: { id: true, name: true, email: true } },
  toUser: { select: { id: true, name: true, email: true } },
};

/** The team's open offer, or null. */
const pending = async (team) => shape(await prisma.ownershipTransfer.findFirst({
  where: { teamId: byPublicId(team.id).id, ...openWhere() },
  include: INCLUDE,
}));

/** Open offers waiting on this person, across all their teams. */
const pendingForUser = async (userId) => {
  const rows = await prisma.ownershipTransfer.findMany({
    where: { toUserId: byPublicId(userId).id, team: { deletedAt: null }, ...openWhere() },
    include: INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(shape);
};

/**
 * Offer the team to a member. The owner is the only one who can, and only to
 * somebody already in the team — a handover is not a way to add a stranger.
 */
const offer = async (team, owner, targetUserId, { req = null } = {}) => {
  if (team.kind !== 'team') throw fail(400, 'NOT_A_TEAM', 'A personal account cannot be transferred.');

  const targetId = byPublicId(targetUserId).id;
  if (String(targetId) === String(owner.id)) {
    throw fail(400, 'ALREADY_OWNER', 'You already own this team.');
  }

  const target = await prisma.teamMember.findFirst({
    where: { teamId: byPublicId(team.id).id, userId: targetId },
    select: { role: true, user: { select: { id: true, name: true, email: true, status: true, isEmailVerified: true } } },
  });
  if (!target) throw fail(404, 'MEMBER_NOT_FOUND', 'That person is not a member of this team.');
  if (target.user.status !== 'active' || !target.user.isEmailVerified) {
    throw fail(409, 'MEMBER_NOT_READY', 'That member’s account is not active and verified.');
  }

  // The receiving end gets the same checks as creating a team: someone who is
  // blocked for money cannot be handed a clean account instead.
  const teamLifecycleService = require('./teamLifecycleService');
  const hold = await teamLifecycleService.ownedAccountHold(targetId);
  if (hold) {
    throw fail(402, 'MEMBER_BLOCKED', hold === 'DISPUTE_HOLD'
      ? 'That member has a payment dispute under review on one of their accounts.'
      : 'That member has an unpaid balance over its limit on one of their accounts.');
  }

  const settings = await teamSettingsService.getTeamSettings();
  const owns = await prisma.teamMember.count({
    where: { userId: targetId, role: 'owner', team: { kind: 'team', deletedAt: null } },
  });
  if (owns >= settings.maxTeamsPerUser) {
    throw fail(409, 'MEMBER_TEAM_LIMIT', 'That member already owns the maximum number of teams.');
  }

  const expiresAt = new Date(Date.now() + settings.ownershipExpiryDays * 86400000);
  let row;
  try {
    row = await prisma.ownershipTransfer.create({
      data: {
        teamId: byPublicId(team.id).id,
        fromUserId: owner.id,
        toUserId: targetId,
        expiresAt,
      },
      include: INCLUDE,
    });
  } catch (error) {
    // The partial unique index: an offer is already open on this team.
    if (error.code === 'P2002') {
      throw fail(409, 'TRANSFER_PENDING', 'A handover is already waiting for an answer. Cancel it first.');
    }
    throw error;
  }

  await teamActivityService.record(team, owner, 'ownership.offered', {
    targetType: 'user', targetId, targetName: target.user.name, req,
  });

  await teamNotifier.notify({
    recipientId: targetId,
    recipientType: 'customer',
    type: 'team_ownership',
    contentKey: 'team.ownershipOffered',
    title: 'You have been offered ownership',
    message: `${owner.name} has offered you ownership of ${team.name}. `
      + 'Accept it to take over the account, or decline to leave it with them.',
    metadata: { teamName: team.name, fromName: owner.name },
    priority: 'high',
    action: {
      label: 'Team settings',
      url: `${(process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002').replace(/\/$/, '')}/team`,
    },
  }).catch((err) => console.error('[Ownership] Offer notification failed:', err.message));

  return shape(row);
};

/** The owner takes the offer back. */
const cancel = async (team, owner, { req = null } = {}) => {
  const open = await prisma.ownershipTransfer.findFirst({
    where: { teamId: byPublicId(team.id).id, ...openWhere() },
    include: INCLUDE,
  });
  if (!open) throw fail(404, 'NO_TRANSFER_PENDING', 'There is no handover waiting for an answer.');

  await prisma.ownershipTransfer.update({ where: { id: open.id }, data: { cancelledAt: new Date() } });
  await teamActivityService.record(team, owner, 'ownership.cancelled', {
    targetType: 'user', targetId: open.toUserId, targetName: open.toUser?.name, req,
  });
  return { cancelled: true };
};

/**
 * The member takes the team on. Both roles change in one transaction — there
 * is no instant in which a team has two owners or none — and the claim is made
 * conditionally, so two clicks on Accept cannot both succeed.
 */
const accept = async (transferId, user, { req = null } = {}) => {
  const now = new Date();
  const open = await prisma.ownershipTransfer.findFirst({
    where: { id: byPublicId(transferId).id, toUserId: user.id, ...openWhere(now) },
    include: { ...INCLUDE, team: { select: { id: true, kind: true, name: true, deletedAt: true } } },
  });
  if (!open) throw fail(404, 'TRANSFER_NOT_FOUND', 'This handover is no longer open.');
  if (open.team.deletedAt) throw fail(409, 'TEAM_CLOSED', 'That team has been closed.');

  // Both sides must still be in the team: either could have left or been
  // removed while the offer sat unanswered.
  const [incoming, outgoing] = await Promise.all([
    prisma.teamMember.findFirst({ where: { teamId: open.teamId, userId: open.toUserId }, select: { id: true } }),
    prisma.teamMember.findFirst({ where: { teamId: open.teamId, userId: open.fromUserId, role: 'owner' }, select: { id: true } }),
  ]);
  if (!incoming) throw fail(409, 'NOT_A_MEMBER', 'You are no longer a member of that team.');
  if (!outgoing) throw fail(409, 'OFFER_NO_LONGER_VALID', 'The person who offered this no longer owns the team.');

  // Still blocked for money? The check at offer time can have gone stale.
  const teamLifecycleService = require('./teamLifecycleService');
  const hold = await teamLifecycleService.ownedAccountHold(user.id);
  if (hold) {
    throw fail(402, 'MEMBER_BLOCKED', hold === 'DISPUTE_HOLD'
      ? 'A payment dispute on one of your accounts is being reviewed.'
      : 'One of your accounts has an unpaid balance over its limit. Settle it first.');
  }

  const claimed = await prisma.ownershipTransfer.updateMany({
    where: { id: open.id, ...openWhere(now) },
    data: { acceptedAt: now },
  });
  if (claimed.count !== 1) throw fail(409, 'TRANSFER_NOT_FOUND', 'This handover is no longer open.');

  await prisma.$transaction([
    prisma.teamMember.update({ where: { id: incoming.id }, data: { role: 'owner' } }),
    // The outgoing owner stays, as an admin — they keep working in the team
    // they built, they just no longer answer for it.
    prisma.teamMember.update({ where: { id: outgoing.id }, data: { role: 'admin' } }),
  ]);

  const teamRow = { id: open.teamId, kind: 'team', name: open.team.name };
  await teamActivityService.record(teamRow, user, 'ownership.accepted', {
    targetType: 'user', targetId: open.fromUserId, targetName: open.fromUser?.name, req,
  });

  await teamNotifier.notify({
    recipientId: open.fromUserId,
    recipientType: 'customer',
    type: 'team_ownership',
    contentKey: 'team.ownershipAccepted',
    title: 'Ownership transferred',
    message: `${user.name} is now the owner of ${open.team.name}. You are an admin of it.`,
    metadata: { teamName: open.team.name, toName: user.name },
    priority: 'high',
  }).catch((err) => console.error('[Ownership] Accept notification failed:', err.message));

  return { accepted: true, teamId: open.teamId, teamName: open.team.name };
};

/** The member says no. The team keeps its owner. */
const decline = async (transferId, user, { req = null } = {}) => {
  const open = await prisma.ownershipTransfer.findFirst({
    where: { id: byPublicId(transferId).id, toUserId: user.id, ...openWhere() },
    include: INCLUDE,
  });
  if (!open) throw fail(404, 'TRANSFER_NOT_FOUND', 'This handover is no longer open.');

  await prisma.ownershipTransfer.update({ where: { id: open.id }, data: { declinedAt: new Date() } });
  await teamActivityService.record({ id: open.teamId, kind: 'team' }, user, 'ownership.declined', {
    targetType: 'user', targetId: open.fromUserId, targetName: open.fromUser?.name, req,
  });

  await teamNotifier.notify({
    recipientId: open.fromUserId,
    recipientType: 'customer',
    type: 'team_ownership',
    contentKey: 'team.ownershipDeclined',
    title: 'Handover declined',
    message: `${user.name} declined ownership of ${open.team?.name || 'the team'}. You are still its owner.`,
    metadata: { teamName: open.team?.name || '', toName: user.name },
    priority: 'medium',
  }).catch((err) => console.error('[Ownership] Decline notification failed:', err.message));

  return { declined: true };
};

module.exports = { pending, pendingForUser, offer, cancel, accept, decline };
