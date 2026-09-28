/**
 * The team's join link: one link its people can pass round their own chat.
 *
 * ── It does not let anyone in ──
 *
 * Opening the link gets somebody a request, not a membership. An owner or
 * admin decides, and until they do the person has exactly the access they had
 * before: none. That single property is what makes the link safe to treat
 * casually — forwarded to the wrong group, screenshotted, still sitting in an
 * ex-employee's inbox — because none of those get anybody an account that
 * spends money.
 *
 * A platform that wants the shorter path can allow teams to skip approval
 * (`joinLinkApproval: 'team'`), but it has to say so; out of the box approval
 * is always required.
 *
 * ── The rest of the guard rails ──
 *
 *   - only the SHA-256 of the token is stored, as with invitations, so a copy
 *     of the database opens nothing;
 *   - one live link per team, enforced by a partial unique index — re-issuing
 *     revokes the last one rather than leaving a second door open;
 *   - it expires (the team chooses, within the platform's maximum), it can be
 *     revoked, and it can carry a cap on how many people come through it;
 *   - the role it hands out can only be Developer or Viewer, by a database
 *     CHECK as well as by this file;
 *   - the account using it must be verified and active, so the platform's
 *     sign-up rules — including the disposable-address blocker — are already
 *     behind it.
 */
const crypto = require('crypto');
const prisma = require('../../lib/prismaClient');
const teamSettingsService = require('./teamSettingsService');
const teamActivityService = require('./teamActivityService');
const { byPublicId } = require('../../utils/helpers/publicId');

const fail = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

const LINK_ROLES = ['developer', 'viewer'];
const DAY_MS = 86400000;

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const customerUrl = (path) => `${(process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002').replace(/\/$/, '')}${path}`;

/** A link nobody has revoked and whose day has not passed. */
const liveWhere = (now = new Date()) => ({ revokedAt: null, expiresAt: { gt: now } });

const shape = (row, { token = null } = {}) => (row ? {
  id: row.id,
  role: row.role,
  expiresAt: row.expiresAt,
  maxUses: row.maxUses,
  usedCount: row.usedCount,
  createdAt: row.createdAt,
  // The raw token exists only in the reply to the person who just made the
  // link; everywhere else this is null, because only the hash is kept.
  url: token ? customerUrl(`/join/${token}`) : null,
} : null);

const assertEnabled = async () => {
  const settings = await teamSettingsService.getTeamSettings();
  if (!settings.joinLinksEnabled) {
    throw fail(403, 'JOIN_LINKS_DISABLED', 'Join links are not available on this platform.');
  }
  return settings;
};

/** The team's live link, without the token — it cannot be shown twice. */
const current = async (team) => {
  const settings = await teamSettingsService.getTeamSettings();
  if (!settings.joinLinksEnabled) return { enabled: false };
  const row = await prisma.teamJoinLink.findFirst({
    where: { teamId: byPublicId(team.id).id, ...liveWhere() },
  });
  return {
    enabled: true,
    // Whether this team may hand out membership without approving each person.
    approvalChoice: settings.joinLinkApproval === 'team',
    maxExpiryDays: settings.joinLinkMaxExpiryDays,
    defaultExpiryDays: settings.joinLinkExpiryDays,
    maxUsesLimit: settings.joinLinkMaxUses,
    link: shape(row),
  };
};

/**
 * Make a link (and retire the previous one). The token is returned exactly
 * once, here, to the person who asked for it.
 */
const issue = async (team, actor, { role, expiryDays, maxUses } = {}, { req = null } = {}) => {
  const settings = await assertEnabled();
  if (team.kind !== 'team') throw fail(400, 'NOT_A_TEAM', 'A personal account has no members to invite.');

  const linkRole = LINK_ROLES.includes(role) ? role : 'developer';

  const days = Math.min(
    Math.max(Math.floor(Number(expiryDays) || settings.joinLinkExpiryDays), 1),
    settings.joinLinkMaxExpiryDays,
  );
  const uses = maxUses === null || maxUses === undefined || maxUses === ''
    ? null
    : Math.min(Math.max(Math.floor(Number(maxUses)) || 1, 1), settings.joinLinkMaxUses);

  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();

  const row = await prisma.$transaction(async (tx) => {
    // The old link stops working the moment a new one exists.
    await tx.teamJoinLink.updateMany({
      where: { teamId: byPublicId(team.id).id, revokedAt: null },
      data: { revokedAt: now },
    });
    return tx.teamJoinLink.create({
      data: {
        teamId: byPublicId(team.id).id,
        tokenHash: hash(token),
        role: linkRole,
        createdById: actor.id,
        expiresAt: new Date(now.getTime() + days * DAY_MS),
        maxUses: uses,
      },
    });
  });

  await teamActivityService.record(team, actor, 'joinLink.issued', {
    targetType: 'joinLink', targetId: row.id, metadata: { role: linkRole, expiryDays: days }, req,
  });
  return shape(row, { token });
};

/** Turn the link off. Anyone holding it gets a plain "no longer valid". */
const revoke = async (team, actor, { req = null } = {}) => {
  const result = await prisma.teamJoinLink.updateMany({
    where: { teamId: byPublicId(team.id).id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!result.count) throw fail(404, 'NO_JOIN_LINK', 'This organization has no live join link.');
  await teamActivityService.record(team, actor, 'joinLink.revoked', { targetType: 'joinLink', req });
  return { revoked: true };
};

/**
 * What the link's landing page may say before anybody signs in.
 *
 * Deliberately thin: the organization's name, how many people are in it and
 * the role on offer. No member list, no money, nothing about the owner — the
 * person holding this link has not been approved by anyone yet.
 */
const preview = async (token) => {
  await assertEnabled();
  const row = await prisma.teamJoinLink.findFirst({
    where: { tokenHash: hash(token || ''), ...liveWhere() },
    include: { team: { select: { id: true, name: true, kind: true, deletedAt: true } } },
  });
  if (!row || row.team.kind !== 'team' || row.team.deletedAt) {
    throw fail(404, 'JOIN_LINK_INVALID', 'This link is not valid any more.');
  }
  if (row.maxUses !== null && row.usedCount >= row.maxUses) {
    throw fail(410, 'JOIN_LINK_USED_UP', 'This link has been used as many times as it was meant to be.');
  }

  const members = await prisma.teamMember.count({ where: { teamId: row.team.id } });
  return {
    teamName: row.team.name,
    role: row.role,
    memberCount: members,
    expiresAt: row.expiresAt,
  };
};

/**
 * Use the link: either a request an owner will answer, or — where the platform
 * allows a team to skip that — the membership itself.
 *
 * The checks that matter run here again rather than at preview time, because
 * preview answers anybody and this answers a signed-in account.
 */
const use = async (token, user, { req = null } = {}) => {
  const settings = await assertEnabled();
  if (user.accountType !== 'customer' || user.status !== 'active' || !user.isEmailVerified) {
    throw fail(403, 'ACCOUNT_NOT_READY', 'Verify your email before joining an organization.');
  }

  const now = new Date();
  const row = await prisma.teamJoinLink.findFirst({
    where: { tokenHash: hash(token || ''), ...liveWhere(now) },
    include: { team: { select: { id: true, name: true, kind: true, deletedAt: true } } },
  });
  if (!row || row.team.kind !== 'team' || row.team.deletedAt) {
    throw fail(404, 'JOIN_LINK_INVALID', 'This link is not valid any more.');
  }
  if (row.maxUses !== null && row.usedCount >= row.maxUses) {
    throw fail(410, 'JOIN_LINK_USED_UP', 'This link has been used as many times as it was meant to be.');
  }

  const already = await prisma.teamMember.findFirst({
    where: { teamId: row.team.id, userId: user.id }, select: { id: true },
  });
  if (already) throw fail(409, 'ALREADY_MEMBER', 'You are already a member of this organization.');

  const members = await prisma.teamMember.count({ where: { teamId: row.team.id } });
  if (members >= settings.maxMembers) throw fail(409, 'TEAM_FULL', 'This organization is full.');

  const teamRow = { id: row.team.id, kind: 'team', name: row.team.name };

  // Approval is the default and, unless the platform hands the choice to
  // teams, the only way in. A link is safe precisely because of this step.
  if (settings.joinLinkApproval !== 'team') {
    const request = await require('./joinRequestService').create(teamRow, user, { link: row, req });
    return {
      requested: true, teamId: row.team.id, teamName: row.team.name, ...request,
    };
  }

  await prisma.$transaction([
    prisma.teamMember.create({ data: { teamId: row.team.id, userId: user.id, role: row.role } }),
    prisma.teamJoinLink.update({ where: { id: row.id }, data: { usedCount: { increment: 1 } } }),
  ]);

  await teamActivityService.record(teamRow, user, 'member.joinedByLink', {
    targetType: 'user', targetId: user.id, targetName: user.name, metadata: { role: row.role }, req,
  });
  return {
    joined: true, teamId: row.team.id, teamName: row.team.name, role: row.role,
  };
};

module.exports = {
  LINK_ROLES, hash, current, issue, revoke, preview, use, liveWhere,
};
