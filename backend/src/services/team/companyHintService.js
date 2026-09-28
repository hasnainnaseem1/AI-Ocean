/**
 * "Somebody at your company is already here."
 *
 * When a customer signs up with a work address and their colleagues already
 * run an organization on the platform, the useful thing is to tell them —
 * rather than let a second account quietly grow beside the first one.
 *
 * ── Why this cannot be decided by a list of public email providers ──
 *
 * The obvious version is "if the domain is not gmail/yahoo/outlook, treat it
 * as a company". That cannot work: the internet has thousands of free mailbox
 * providers and more appear every week, so any list is out of date the day it
 * ships, and a domain that slipped through would tell strangers about each
 * other's organizations.
 *
 * So the question is never "is this domain private?". It is "did this
 * organization choose to be found this way?" — four layers, in this order:
 *
 *   1. CONSENT. `Team.discoverableByDomain` is off for every team until its
 *      owner turns it on. Nothing is ever disclosed because a domain looked
 *      private; it is disclosed because somebody decided to be findable. That
 *      covers every domain on the internet, known to us or not.
 *
 *   2. YOUR OWN DOMAIN ONLY. Nobody can ask about a domain they do not hold a
 *      verified address at. There is no way to test whether coca-cola.com is a
 *      customer here, because the answer is only ever about the asker's own
 *      address.
 *
 *   3. KNOWN PROVIDERS. The admin-editable public list, plus the platform's
 *      disposable-address list, are refused outright — so an owner cannot even
 *      switch consent on for gmail.com.
 *
 *   4. POPULARITY. The guard for every provider no list knows: if a domain
 *      already has more accounts on this platform than `companyHintMaxAccounts`
 *      outside the organization in question, it is treated as a public mailbox
 *      provider whatever it is called. A company's own domain has its staff
 *      here; a free provider has the world.
 *
 * Every one of those fails closed. When we are unsure, nobody is told anything.
 *
 * What is disclosed even then is deliberately thin: the organization's name,
 * how many people are in it, and a masked form of the owner's address — enough
 * to recognise your own employer, not enough to be worth harvesting.
 */
const prisma = require('../../lib/prismaClient');
const teamSettingsService = require('./teamSettingsService');
const joinRequestService = require('./joinRequestService');
const { byPublicId } = require('../../utils/helpers/publicId');

const fail = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

const domainOf = (email) => String(email || '').toLowerCase().split('@')[1] || '';

/** `abc@acme.com` → `ab…@acme.com`. Enough to recognise, not to harvest. */
const maskEmail = (email) => {
  const [local, domain] = String(email || '').toLowerCase().split('@');
  if (!local || !domain) return '';
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}…@${domain}`;
};

/**
 * Is this domain one the platform will never treat as a company?
 *
 * `exceptTeamId` is the organization being considered: its own members do not
 * count towards the popularity guard, so a large company whose staff are
 * mostly already inside the team is not mistaken for a mailbox provider.
 */
const looksPublic = async (domain, { settings, exceptTeamId = null } = {}) => {
  const conf = settings || await teamSettingsService.getTeamSettings();
  if (conf.publicEmailDomains.includes(domain)) return true;

  // The platform's disposable-address list is a second source of the same
  // answer; a throwaway provider is certainly not somebody's employer.
  try {
    const adminSettings = await require('../admin/adminSettingsService').getSettings();
    const blocked = adminSettings.customerSettings?.blockedTemporaryEmailDomains || [];
    if (blocked.includes(domain)) return true;
  } catch {
    // Unreadable settings must not make the answer more permissive, but they
    // are not on their own a reason to call a domain public either.
  }

  const outsiders = await prisma.user.count({
    where: {
      accountType: 'customer',
      email: { endsWith: `@${domain}`, mode: 'insensitive' },
      ...(exceptTeamId ? { teamMemberships: { none: { teamId: exceptTeamId } } } : {}),
    },
  });
  return outsiders > conf.companyHintMaxAccounts;
};

/**
 * Organizations this person's own address could belong to, and whether they
 * have already asked. Empty whenever anything at all is uncertain.
 */
const forUser = async (user) => {
  if (!joinRequestService.usable(user)) return [];

  const settings = await teamSettingsService.getTeamSettings();
  if (!settings.enabled || !settings.companyHintEnabled) return [];

  const domain = domainOf(user.email);
  if (!domain) return [];

  const teams = await prisma.team.findMany({
    where: {
      kind: 'team',
      deletedAt: null,
      discoverableByDomain: true,
      // The owner's own address is what ties an organization to a domain here.
      // No DNS is involved, and none is claimed: this says "the person who
      // runs this organization reads mail at the same place you do".
      createdBy: { email: { endsWith: `@${domain}`, mode: 'insensitive' } },
    },
    select: {
      id: true,
      name: true,
      createdBy: { select: { email: true } },
      _count: { select: { members: true } },
    },
    take: 5,
  });
  if (!teams.length) return [];

  const out = [];
  for (const team of teams) {
    // Checked per organization, because the popularity guard discounts that
    // organization's own people.
    if (await looksPublic(domain, { settings, exceptTeamId: team.id })) continue;
    const [member, pending] = await Promise.all([
      prisma.teamMember.findFirst({ where: { teamId: team.id, userId: user.id }, select: { id: true } }),
      prisma.teamJoinRequest.findFirst({
        where: { teamId: team.id, userId: user.id, ...joinRequestService.openWhere() },
        select: { id: true },
      }),
    ]);
    if (member) continue;
    out.push({
      teamId: team.id,
      name: team.name,
      domain,
      memberCount: team._count.members,
      ownerHint: maskEmail(team.createdBy?.email),
      requested: !!pending,
    });
  }
  return out;
};

/** Ask to join one of them. Every check above is applied again here. */
const requestJoin = async (user, teamId) => {
  const offered = await forUser(user);
  const match = offered.find((t) => String(t.teamId) === String(byPublicId(teamId).id)
    || String(t.teamId) === String(teamId));
  if (!match) throw fail(404, 'TEAM_NOT_FOUND', 'That organization is not open to you.');

  const team = await prisma.team.findUnique({
    where: { id: byPublicId(teamId).id }, select: { id: true, kind: true, name: true },
  });
  return joinRequestService.create(team, user);
};

module.exports = {
  domainOf, maskEmail, looksPublic, forUser, requestJoin,
};
