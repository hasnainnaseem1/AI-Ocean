/**
 * Team invitations — invite by email, preview, accept, decline, revoke.
 *
 * The link carries a random 256-bit token; only its SHA-256 is stored, so a
 * copy of the database cannot be used to join a team. An invitation is:
 *   - bound to one email — only a verified account with that exact address
 *     may accept it, so a forwarded or leaked link is useless to anyone else;
 *   - single-use — accepting is an atomic "claim if still open" update, so two
 *     simultaneous clicks cannot both succeed;
 *   - expiring, and revocable by the team;
 *   - never for `owner` (the database refuses that too) and never for a role
 *     above the inviter's own.
 * Abuse limits (admin settings): invites per team per day, pending invites
 * per team, and total members.
 */
const crypto = require('crypto');
const prisma = require('../../lib/prismaClient');
const teamSettingsService = require('./teamSettingsService');
const teamActivityService = require('./teamActivityService');
const { RANK } = require('./permissions');
const { ASSIGNABLE } = require('./membershipService');
const { byPublicId } = require('../../utils/helpers/publicId');

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fail = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const customerUrl = (path) => `${(process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002').replace(/\/$/, '')}${path}`;

/** Open = not accepted, declined or revoked, and not expired. */
const openWhere = (now = new Date()) => ({
  acceptedAt: null, declinedAt: null, revokedAt: null, expiresAt: { gt: now },
});

const shape = (inv) => ({
  id: inv.id,
  email: inv.email,
  role: inv.role,
  expiresAt: inv.expiresAt,
  createdAt: inv.createdAt,
  invitedBy: inv.invitedBy ? { name: inv.invitedBy.name, email: inv.invitedBy.email } : null,
});

/**
 * Invite `email` to `team` as `role`. Re-inviting the same address replaces
 * its open invitation (new link, fresh expiry), so an old link stops working.
 */
const create = async (team, actor, actorUser, { email, role }) => {
  if (team.kind !== 'team') throw fail(400, 'NOT_A_TEAM', 'A personal account cannot invite members.');
  const settings = await teamSettingsService.getTeamSettings();
  if (!settings.enabled) throw fail(403, 'TEAMS_DISABLED', 'Teams are not available right now.');

  const address = normalizeEmail(email);
  if (!EMAIL.test(address) || address.length > 254) throw fail(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  if (!ASSIGNABLE.includes(role)) throw fail(400, 'INVALID_ROLE', 'That role cannot be invited.');
  if (RANK[role] > RANK[actor.role]) throw fail(403, 'ROLE_ABOVE_YOURS', 'You cannot invite someone with a role above your own.');

  const now = new Date();
  const [alreadyMember, members, pending, sentToday] = await Promise.all([
    prisma.teamMember.findFirst({ where: { teamId: team.id, user: { email: { equals: address, mode: 'insensitive' } } }, select: { id: true } }),
    prisma.teamMember.count({ where: { teamId: team.id } }),
    prisma.teamInvitation.count({ where: { teamId: team.id, ...openWhere(now), email: { not: address } } }),
    prisma.teamInvitation.count({ where: { teamId: team.id, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } }),
  ]);
  if (alreadyMember) throw fail(409, 'ALREADY_MEMBER', 'That person is already a member of this team.');
  if (members + pending >= settings.maxMembers) {
    throw fail(409, 'TEAM_FULL', `A team can have at most ${settings.maxMembers} members, counting pending invitations.`);
  }
  if (pending >= settings.maxPendingInvites) throw fail(429, 'TOO_MANY_PENDING', 'Too many invitations are waiting for an answer.');
  if (sentToday >= settings.invitesPerDay) throw fail(429, 'INVITE_RATE_LIMIT', 'This team has sent too many invitations today. Try again tomorrow.');

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + settings.inviteExpiryDays * DAY_MS);

  const invitation = await prisma.$transaction(async (tx) => {
    // The previous open invitation for this address, if any, stops working.
    await tx.teamInvitation.updateMany({
      where: { teamId: team.id, email: address, ...openWhere(now) },
      data: { revokedAt: now },
    });
    return tx.teamInvitation.create({
      data: {
        teamId: team.id, email: address, role, tokenHash: hash(token), invitedById: actorUser.id, expiresAt,
      },
      include: { invitedBy: { select: { name: true, email: true } } },
    });
  });

  // The email is best-effort: the invitation stands (and can be re-sent)
  // even if the mail server is down.
  const existing = await prisma.user.findFirst({
    where: { email: { equals: address, mode: 'insensitive' } }, select: { name: true, language: true },
  });
  require('../email/emailService').sendTeamInviteEmail(
    { email: address, name: existing?.name || address, language: existing?.language || actorUser.language },
    {
      teamName: team.name,
      inviterName: actorUser.name || actorUser.email,
      role,
      acceptUrl: customerUrl(`/invite/${token}`),
      expiresDays: settings.inviteExpiryDays,
    },
  ).catch(() => {});

  await teamActivityService.record(team, actorUser, 'member.invited', {
    targetType: 'invitation', targetId: invitation.id, targetName: address, metadata: { role },
  });

  // The raw token is returned only here, only to the inviter, so the UI can
  // offer "copy link" when email is not an option.
  return { invitation: shape(invitation), inviteUrl: customerUrl(`/invite/${token}`) };
};

const listPending = async (team) => {
  const rows = await prisma.teamInvitation.findMany({
    where: { teamId: team.id, ...openWhere() },
    include: { invitedBy: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(shape);
};

const revoke = async (team, invitationId, { actorUser = null, req = null } = {}) => {
  const target = await prisma.teamInvitation.findFirst({
    where: { id: byPublicId(invitationId).id, teamId: team.id },
    select: { id: true, email: true, role: true },
  });
  const result = await prisma.teamInvitation.updateMany({
    where: { id: byPublicId(invitationId).id, teamId: team.id, ...openWhere() },
    data: { revokedAt: new Date() },
  });
  if (result.count !== 1) throw fail(404, 'INVITATION_NOT_FOUND', 'That invitation is not open any more.');
  await teamActivityService.record(team, actorUser, 'member.inviteRevoked', {
    targetType: 'invitation', targetId: target.id, targetName: target.email, metadata: { role: target.role }, req,
  });
  return { revoked: true };
};

/** Why an invitation cannot be used, or null if it can. */
const closedReason = (inv, now = new Date()) => {
  if (inv.acceptedAt) return 'ACCEPTED';
  if (inv.declinedAt) return 'DECLINED';
  if (inv.revokedAt) return 'REVOKED';
  if (inv.expiresAt <= now) return 'EXPIRED';
  if (inv.team.deletedAt) return 'REVOKED';
  return null;
};

const findByToken = (token) => prisma.teamInvitation.findUnique({
  where: { tokenHash: hash(token) },
  include: {
    team: { select: { id: true, name: true, kind: true, deletedAt: true } },
    invitedBy: { select: { name: true } },
  },
});

/**
 * What the invite page shows before anyone signs in: the team, who invited,
 * the role, and the address it is for (so the right account is used). Only
 * someone holding the link can see this — the token is the secret.
 */
const preview = async (token) => {
  const inv = token ? await findByToken(token) : null;
  if (!inv) throw fail(404, 'INVITATION_NOT_FOUND', 'This invitation link is not valid.');
  const accountExists = !!(await prisma.user.findFirst({
    where: { email: { equals: inv.email, mode: 'insensitive' } }, select: { id: true },
  }));
  return {
    teamName: inv.team.name,
    invitedBy: inv.invitedBy?.name || null,
    role: inv.role,
    email: inv.email,
    expiresAt: inv.expiresAt,
    status: closedReason(inv) || 'OPEN',
    accountExists,
  };
};

const assertUsableBy = (inv, user) => {
  const reason = closedReason(inv);
  if (reason) throw fail(410, `INVITATION_${reason}`, 'This invitation is no longer valid.');
  if (normalizeEmail(user.email) !== inv.email) {
    throw fail(403, 'INVITATION_EMAIL_MISMATCH', `This invitation is for ${inv.email}. Sign in with that email to accept it.`);
  }
  if (!user.isEmailVerified || user.status !== 'active') {
    throw fail(403, 'ACCOUNT_NOT_READY', 'Verify your email before joining a team.');
  }
};

const accept = async (token, user) => {
  const inv = token ? await findByToken(token) : null;
  if (!inv) throw fail(404, 'INVITATION_NOT_FOUND', 'This invitation link is not valid.');
  assertUsableBy(inv, user);

  const settings = await teamSettingsService.getTeamSettings();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Claim it — only one caller can move it from open to accepted.
    const claimed = await tx.teamInvitation.updateMany({
      where: { id: inv.id, ...openWhere(now) },
      data: { acceptedAt: now },
    });
    if (claimed.count !== 1) throw fail(410, 'INVITATION_ACCEPTED', 'This invitation is no longer valid.');

    const already = await tx.teamMember.findUnique({
      where: { teamId_userId: { teamId: inv.teamId, userId: user.id } }, select: { id: true },
    });
    if (already) throw fail(409, 'ALREADY_MEMBER', 'You are already a member of this team.');

    const members = await tx.teamMember.count({ where: { teamId: inv.teamId } });
    if (members >= settings.maxMembers) throw fail(409, 'TEAM_FULL', 'This team is full.');

    await tx.teamMember.create({
      data: { teamId: inv.teamId, userId: user.id, role: inv.role, invitedById: inv.invitedById },
    });
  });

  await teamActivityService.record(inv.team, user, 'member.joined', {
    targetType: 'user', targetId: user.id, targetName: user.name, metadata: { role: inv.role },
  });

  return { team: { id: inv.team.id, name: inv.team.name, kind: inv.team.kind }, role: inv.role };
};

const decline = async (token, user) => {
  const inv = token ? await findByToken(token) : null;
  if (!inv) throw fail(404, 'INVITATION_NOT_FOUND', 'This invitation link is not valid.');
  assertUsableBy(inv, user);
  await prisma.teamInvitation.updateMany({ where: { id: inv.id, ...openWhere() }, data: { declinedAt: new Date() } });
  await teamActivityService.record(inv.team, user, 'member.inviteDeclined', {
    targetType: 'invitation', targetId: inv.id, targetName: inv.email, metadata: { role: inv.role },
  });
  return { declined: true };
};

module.exports = {
  create, listPending, revoke, preview, accept, decline, hash,
};
