/**
 * Creating a team, and the checks that decide whether this person may own
 * another account at all.
 *
 * The money rule behind every check here: an account that owes the platform
 * must not be left behind for a fresh one. A new team starts with an empty
 * ledger, so without these checks the way out of a debt limit would simply be
 * to open a team and carry on (plan loophole #2), and the way out of a dispute
 * hold the same (#14).
 */
const prisma = require('../../lib/prismaClient');
const teamService = require('./teamService');
const teamSettingsService = require('./teamSettingsService');
const teamActivityService = require('./teamActivityService');
const teamNotifier = require('./teamNotifier');

const fail = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

/**
 * Is anything this user owns — their personal account or a team they own —
 * held for money? Returns the reason, or null.
 */
const ownedAccountHold = async (userId) => {
  const debtService = require('../billing/debtService');
  const owned = await prisma.teamMember.findMany({
    where: { userId, role: 'owner', team: { deletedAt: null } },
    select: { team: { select: { id: true, disputeHold: true } } },
  });
  for (const { team } of owned) {
    if (team.disputeHold) return 'DISPUTE_HOLD';
    const status = await debtService.status(team.id);
    if (status.blocked) return 'DEBT_BLOCKED';
  }
  return null;
};

/**
 * Create a team owned by `user`. Only a verified, active customer may; the
 * number of teams one person can own is capped (admin setting); and no one
 * whose existing account is over its debt limit or under a dispute hold can
 * start a new one.
 */
const createTeam = async (user, { name } = {}) => {
  const settings = await teamSettingsService.getTeamSettings();
  if (!settings.enabled) throw fail(403, 'TEAMS_DISABLED', 'Teams are not available right now.');

  if (user.accountType !== 'customer' || user.status !== 'active' || !user.isEmailVerified) {
    throw fail(403, 'ACCOUNT_NOT_READY', 'Verify your email before creating a team.');
  }

  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 60) {
    throw fail(400, 'INVALID_NAME', 'A team name needs 2 to 60 characters.');
  }

  // Counted by ownership, not by who first created it: a team handed to
  // someone else stops counting against the person who made it and starts
  // counting against the person who now answers for it.
  const owned = await prisma.teamMember.count({
    where: { userId: user.id, role: 'owner', team: { kind: 'team', deletedAt: null } },
  });
  if (owned >= settings.maxTeamsPerUser) {
    throw fail(409, 'TEAM_LIMIT_REACHED', `You can own at most ${settings.maxTeamsPerUser} teams.`);
  }

  const hold = await ownedAccountHold(user.id);
  if (hold) {
    throw fail(402, 'TEAM_CREATE_BLOCKED', hold === 'DISPUTE_HOLD'
      ? 'A payment dispute on one of your accounts is being reviewed. Please contact support.'
      : 'One of your accounts has an unpaid balance over its limit. Settle it before creating a team.');
  }

  /*
   * Names are unique per owner, case-insensitively (partial unique index), and
   * deliberately not unique platform-wide. "That name is taken" across all
   * customers would let anyone test which companies are here, and would let an
   * unrelated customer take a name away from the company it belongs to. What
   * is worth preventing is one person ending up with two accounts they cannot
   * tell apart.
   */
  let team;
  try {
    team = await prisma.team.create({
      data: {
        kind: 'team',
        name: clean,
        createdById: user.id,
        members: { create: { userId: user.id, role: 'owner' } },
      },
      select: { id: true },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      throw fail(409, 'NAME_ALREADY_YOURS', 'You already have an organization with that name.');
    }
    throw error;
  }

  // Creating one counts as finishing the post-signup team onboarding.
  if (user.teamOnboardingPending) {
    await prisma.user.update({ where: { id: user.id }, data: { teamOnboardingPending: false } });
  }

  const created = await teamService.findById(team.id);
  await teamActivityService.record(created, user, 'team.created', {
    targetType: 'team', targetId: created.id, targetName: created.name,
  });
  return created;
};

/**
 * Close a team. Soft delete only — `deletedAt` is set and every row stays,
 * because an account that has ever held money keeps its ledger. It disappears
 * from the customer's account switcher and `findMembership` stops resolving
 * it, so the next request from anyone is refused.
 *
 * ── What has to be settled first ──
 *
 * Closing must never be a way out of paying (plan loophole #4), so:
 *   - nothing may still be deployed. Anything not terminated or rejected still
 *     costs — a stopped machine keeps paying for its disk — so every
 *     deployment must be terminated first;
 *   - an outstanding balance blocks it outright. The debt is the team's, and a
 *     closed team would simply carry it out of sight.
 *
 * Credit left in the wallet does not block it, but it is not quietly pocketed
 * either: the caller is refused once, told the exact amount, and must ask again
 * with `forfeitBalance` — so nobody loses money without being shown the number
 * first.
 */
const CLOSED_DEPLOYMENT_STATUSES = ['terminated', 'rejected'];

const deleteTeam = async (team, actor, { forfeitBalance = false, req = null } = {}) => {
  if (team.kind !== 'team') throw fail(400, 'NOT_A_TEAM', 'A personal account cannot be closed here.');
  if (team.deletedAt) throw fail(409, 'ALREADY_CLOSED', 'This team is already closed.');

  const openDeployments = await prisma.deployment.count({
    where: { teamId: team.id, status: { notIn: CLOSED_DEPLOYMENT_STATUSES } },
  });
  if (openDeployments > 0) {
    throw fail(409, 'DEPLOYMENTS_OPEN',
      `Terminate this team’s ${openDeployments} deployment(s) before closing it.`);
  }

  const creditService = require('../billing/creditService');
  const wallet = await creditService.getOrCreateWallet(team.id);
  const outstanding = Number(wallet.outstandingBalance || 0);
  if (outstanding > 0) {
    const err = fail(402, 'OUTSTANDING_BALANCE',
      'This team has an unpaid balance. Settle it before closing the account.');
    err.details = { outstanding, currency: wallet.currency };
    throw err;
  }

  const balance = Number(wallet.balance || 0);
  if (balance > 0 && !forfeitBalance) {
    const err = fail(409, 'BALANCE_REMAINING',
      'This team still has credit in its wallet. Closing it gives that credit up.');
    err.details = { balance, currency: wallet.currency };
    throw err;
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.team.update({ where: { id: team.id }, data: { deletedAt: now } }),
    // Nothing may be accepted into a closed team afterwards.
    prisma.teamInvitation.updateMany({
      where: { teamId: team.id, acceptedAt: null, declinedAt: null, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.ownershipTransfer.updateMany({
      where: { teamId: team.id, acceptedAt: null, declinedAt: null, cancelledAt: null },
      data: { cancelledAt: now },
    }),
    // A link to a closed account must open nothing, and nobody should be left
    // waiting on an answer that can never come.
    prisma.teamJoinLink.updateMany({
      where: { teamId: team.id, revokedAt: null },
      data: { revokedAt: now },
    }),
    prisma.teamJoinRequest.updateMany({
      where: { teamId: team.id, approvedAt: null, declinedAt: null, cancelledAt: null },
      data: { cancelledAt: now },
    }),
  ]);

  await teamActivityService.record({ ...team, deletedAt: null }, actor, 'team.deleted', {
    targetType: 'team', targetId: team.id, targetName: team.name, metadata: { forfeited: balance || 0 }, req,
  });

  // Everyone else loses access on their next request; they are told why.
  const others = await prisma.teamMember.findMany({
    where: { teamId: team.id, userId: { not: actor.id } },
    select: { userId: true },
  });
  for (const { userId } of others) {
    await teamNotifier.notify({
      recipientId: userId,
      recipientType: 'customer',
      type: 'team_closed',
      contentKey: 'team.closed',
      title: 'A team you were in was closed',
      message: `${team.name} was closed by its owner. You no longer have access to it.`,
      metadata: { teamName: team.name },
      priority: 'medium',
    }).catch((err) => console.error('[Team] Close notification failed:', err.message));
  }

  return { closed: true, forfeited: balance || 0, currency: wallet.currency };
};

module.exports = { createTeam, deleteTeam, ownedAccountHold };
