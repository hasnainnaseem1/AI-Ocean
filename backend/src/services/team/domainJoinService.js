/**
 * Letting colleagues into a team by its verified domain.
 *
 * Three settings, three behaviours (`Team.domainJoinMode`):
 *   off      nothing happens; the domain is only a claim on record.
 *   request  the colleague asks, and an owner or admin decides. The default a
 *            team is nudged towards: a mailbox at acme.com means the company's
 *            mail admin created an address, not that the person is trusted
 *            with an account that spends money.
 *   auto     they are in as soon as their email is verified.
 *
 * Either way they come in as `domainJoinRole`, which can only be Developer or
 * Viewer — signing up with the right address must never reach a wallet.
 *
 * Nothing here ever runs for an unverified account: `isEmailVerified` is the
 * whole basis of "this person really is at that domain", so an unverified
 * address is worth exactly nothing to this file.
 *
 * And nothing here runs at all unless the platform has turned company domains
 * on (`features.teams.domainJoinEnabled`, off by default). Invitations are how
 * an ordinary customer joins a team; this is the enterprise extra on top.
 */
const prisma = require('../../lib/prismaClient');
const teamSettingsService = require('./teamSettingsService');
const teamActivityService = require('./teamActivityService');
const teamNotifier = require('./teamNotifier');
const domainService = require('./domainService');
const { byPublicId } = require('../../utils/helpers/publicId');

const fail = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

const openWhere = () => ({ approvedAt: null, declinedAt: null, cancelledAt: null });

const TEAM_SELECT = {
  id: true, name: true, kind: true, verifiedDomain: true, domainJoinMode: true, domainJoinRole: true,
};

/** Is this account in a state where a domain rule may act on it at all? */
const usable = (user) => !!user
  && user.accountType === 'customer'
  && user.status === 'active'
  && user.isEmailVerified;

/**
 * Teams that have verified the domain this person's email is at.
 *
 * The public-provider list is applied here too, not only when a domain is
 * claimed and proved. A domain can be added to that list after a team verified
 * it — a provider the platform did not know about, or one that opened free
 * mailboxes later — and from that moment it must stop letting anyone in, for
 * the whole reason the list exists: everyone with an address at a mailbox
 * provider is not a company. Making the check here means the list works
 * backwards as well as forwards, and no row already in the database can put a
 * crowd of strangers into one team.
 */
const teamsForEmail = async (email) => {
  const domain = domainService.domainOfEmail(email);
  if (!domain) return [];
  const settings = await teamSettingsService.getTeamSettings();
  if (!settings.domainJoinEnabled) return [];
  if (settings.publicEmailDomains.includes(domain)) return [];
  return prisma.team.findMany({
    where: {
      kind: 'team',
      deletedAt: null,
      verifiedDomain: domain,
      domainVerifiedAt: { not: null },
      domainJoinMode: { in: ['request', 'auto'] },
    },
    select: TEAM_SELECT,
  });
};

const notifyManagers = async (teamId, payload) => {
  const managers = await prisma.teamMember.findMany({
    where: { teamId, role: { in: ['owner', 'admin'] }, user: { status: 'active' } },
    select: { userId: true },
  });
  for (const { userId } of managers) {
    await teamNotifier.notify({
      recipientId: userId, recipientType: 'customer', ...payload,
    }).catch((err) => console.error('[DomainJoin] Notification failed:', err.message));
  }
};

/**
 * Put `user` into every `auto` team for their address.
 *
 * Called when an email is verified, and again whenever the customer center
 * asks what they could join — a team often verifies its domain after its
 * people have already signed up, and those people should not have to do
 * anything about it.
 *
 * Never throws: it runs inside sign-up and verification flows, which must not
 * fail because a team's domain rule could not be applied.
 */
const applyForUser = async (user) => {
  const joined = [];
  try {
    if (!usable(user)) return joined;
    const teams = await teamsForEmail(user.email);
    const settings = await teamSettingsService.getTeamSettings();

    for (const team of teams) {
      if (team.domainJoinMode !== 'auto') continue;
      const [already, members] = await Promise.all([
        prisma.teamMember.findFirst({ where: { teamId: team.id, userId: user.id }, select: { id: true } }),
        prisma.teamMember.count({ where: { teamId: team.id } }),
      ]);
      if (already || members >= settings.maxMembers) continue;

      try {
        await prisma.teamMember.create({
          data: { teamId: team.id, userId: user.id, role: team.domainJoinRole },
        });
      } catch (error) {
        // Two requests at once; the unique index decided which won.
        if (error.code === 'P2002') continue;
        throw error;
      }

      await teamActivityService.record(team, user, 'member.joinedByDomain', {
        targetType: 'user',
        targetId: user.id,
        targetName: user.name,
        metadata: { role: team.domainJoinRole, domain: team.verifiedDomain },
      });
      await notifyManagers(team.id, {
        type: 'team_domain_join',
        contentKey: 'team.domainJoined',
        title: 'Someone joined through your domain',
        message: `${user.name} (${user.email}) joined ${team.name} automatically, because your domain rule lets anyone at ${team.verifiedDomain} in.`,
        metadata: { memberName: user.name, memberEmail: user.email, teamName: team.name, domain: team.verifiedDomain },
        priority: 'medium',
      });
      joined.push({ id: team.id, name: team.name, role: team.domainJoinRole });
    }
  } catch (error) {
    console.error('[DomainJoin] Could not apply domain rules:', error.message);
  }
  return joined;
};

/**
 * What this person could join, for the customer center to offer. Auto teams
 * are applied first, so the answer never says "you could join" about a team
 * they are in by the time they read it.
 */
const discover = async (user) => {
  if (!usable(user)) return { joined: [], canRequest: [] };
  const joined = await applyForUser(user);

  const teams = await teamsForEmail(user.email);
  const canRequest = [];
  for (const team of teams) {
    if (team.domainJoinMode !== 'request') continue;
    const [already, open] = await Promise.all([
      prisma.teamMember.findFirst({ where: { teamId: team.id, userId: user.id }, select: { id: true } }),
      prisma.teamJoinRequest.findFirst({
        where: { teamId: team.id, userId: user.id, ...openWhere() }, select: { id: true, createdAt: true },
      }),
    ]);
    if (already) continue;
    canRequest.push({
      teamId: team.id,
      name: team.name,
      domain: team.verifiedDomain,
      role: team.domainJoinRole,
      requested: !!open,
      requestId: open?.id || null,
    });
  }
  return { joined, canRequest };
};

/**
 * Ask to be let in, for a team that has verified this person's email domain.
 *
 * The asking, the queue and the answering all live in joinRequestService —
 * a join link leads to the same place, and there must not be two versions of
 * "let them in" that can drift apart.
 */
const request = async (user, teamId) => {
  if (!usable(user)) throw fail(403, 'ACCOUNT_NOT_READY', 'Verify your email first.');

  const team = await prisma.team.findFirst({
    where: {
      id: byPublicId(teamId).id, kind: 'team', deletedAt: null, domainVerifiedAt: { not: null },
    },
    select: TEAM_SELECT,
  });
  if (!team) throw fail(404, 'TEAM_NOT_FOUND', 'That organization is not open to domain joins.');
  if (team.domainJoinMode !== 'request') {
    throw fail(409, 'JOIN_NOT_OPEN', 'That organization is not taking join requests.');
  }

  const settings = await teamSettingsService.getTeamSettings();
  if (!settings.domainJoinEnabled) {
    throw fail(403, 'DOMAIN_JOIN_DISABLED', 'Joining by company domain is not available on this platform.');
  }
  if (domainService.domainOfEmail(user.email) !== team.verifiedDomain) {
    throw fail(403, 'DOMAIN_MISMATCH', 'Your email is not at that organization’s domain.');
  }

  return require('./joinRequestService').create(team, user);
};

module.exports = {
  applyForUser, discover, request, teamsForEmail,
};
