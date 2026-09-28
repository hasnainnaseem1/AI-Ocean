/**
 * A team's company domain, and letting colleagues in by it.
 *
 * ── Why a DNS record and not an email address ──
 *
 * Having an address at acme.com proves somebody gave you a mailbox. Publishing
 * a TXT record on acme.com proves you run the domain. Only the second is worth
 * anything here, because claiming a domain decides who is let into a team that
 * spends money — so the claim is nothing at all until `domainVerifiedAt` is
 * set, and one verified domain belongs to exactly one team (a partial unique
 * index, not a promise made by this file).
 *
 * ── What a domain can and cannot do ──
 *
 * It can let colleagues in as a Developer or a Viewer — the two roles that see
 * no money. It can never hand out Billing, Admin or Owner: signing up with the
 * right address must not be a way to reach a wallet. The database CHECK says
 * the same thing, so a future call site cannot get this wrong either.
 *
 * Public mailbox providers are refused (admin-editable blocklist). "Everyone
 * with a gmail address" is not a company, and letting one team claim gmail.com
 * would hand it every customer who ever signs up with one.
 *
 * ── This whole feature is off unless the platform turns it on ──
 *
 * Getting into a team is an invitation — by email, or by the link the inviter
 * copies. That is the only way an ordinary customer ever needs, and it is what
 * ChatGPT Team, Claude Team, GitHub and AWS Organizations do on their ordinary
 * plans too. Company domains are the enterprise extra, so
 * `features.teams.domainJoinEnabled` starts false and every entry point below
 * checks it. With it off, nobody is asked to touch DNS, and the word "domain"
 * does not appear in the customer center at all.
 */
const dns = require('dns').promises;
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

const JOIN_MODES = ['off', 'request', 'auto'];
/** A domain rule may only hand out a role that sees no money. */
const JOIN_ROLES = ['developer', 'viewer'];
const TXT_PREFIX = 'ai-ocean-domain-verification=';

/** A hostname, lower-cased, with any scheme, path, port or leading @ removed. */
const normalizeDomain = (raw) => String(raw || '')
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/^@/, '')
  .replace(/[/:].*$/, '')
  .replace(/\.$/, '');

const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The domain part of an email address, or ''. */
const domainOfEmail = (email) => String(email || '').toLowerCase().split('@')[1] || '';

const shape = (team) => ({
  domain: team.verifiedDomain || null,
  verified: !!team.domainVerifiedAt,
  verifiedAt: team.domainVerifiedAt || null,
  joinMode: team.domainJoinMode || 'off',
  joinRole: team.domainJoinRole || 'developer',
  // Only useful while unverified; it is what has to be published in DNS.
  txtRecord: team.domainToken && !team.domainVerifiedAt ? `${TXT_PREFIX}${team.domainToken}` : null,
  txtHost: team.verifiedDomain || null,
});

/**
 * What the team currently claims, verified or not — and whether the platform
 * offers company domains at all, which is what the customer center hides the
 * whole section on.
 */
const status = async (team) => {
  const settings = await teamSettingsService.getTeamSettings();
  if (!settings.domainJoinEnabled) return { enabled: false };
  const row = await prisma.team.findUnique({
    where: { id: byPublicId(team.id).id },
    select: {
      verifiedDomain: true, domainToken: true, domainVerifiedAt: true, domainJoinMode: true, domainJoinRole: true,
    },
  });
  return { enabled: true, ...shape(row || {}) };
};

/** Refuse anything domain-related while the platform keeps the feature off. */
const assertEnabled = async () => {
  const settings = await teamSettingsService.getTeamSettings();
  if (!settings.domainJoinEnabled) {
    throw fail(403, 'DOMAIN_JOIN_DISABLED', 'Joining by company domain is not available on this platform.');
  }
  return settings;
};

/**
 * Claim a domain (or replace the claim). Always starts unverified with a fresh
 * token: changing the domain must never inherit the last one's proof.
 */
const claim = async (team, actor, rawDomain, { req = null } = {}) => {
  const settings = await assertEnabled();
  if (team.kind !== 'team') throw fail(400, 'NOT_A_TEAM', 'A personal account has no domain.');

  const domain = normalizeDomain(rawDomain);
  if (!DOMAIN_RE.test(domain)) {
    throw fail(400, 'INVALID_DOMAIN', 'Enter a domain like acme.com.');
  }
  if (settings.publicEmailDomains.includes(domain)) {
    throw fail(400, 'PUBLIC_DOMAIN', 'That is a public email provider, not a company domain.');
  }

  // Somebody else has already proved this one.
  const taken = await prisma.team.findFirst({
    where: {
      verifiedDomain: domain,
      domainVerifiedAt: { not: null },
      deletedAt: null,
      id: { not: byPublicId(team.id).id },
    },
    select: { id: true },
  });
  if (taken) throw fail(409, 'DOMAIN_TAKEN', 'Another organization has already verified that domain.');

  const updated = await prisma.team.update({
    where: { id: byPublicId(team.id).id },
    data: {
      verifiedDomain: domain,
      domainToken: crypto.randomBytes(16).toString('hex'),
      domainVerifiedAt: null,
      // A domain that is not proved yet lets nobody in.
      domainJoinMode: 'off',
    },
    select: {
      verifiedDomain: true, domainToken: true, domainVerifiedAt: true, domainJoinMode: true, domainJoinRole: true,
    },
  });

  await teamActivityService.record(team, actor, 'domain.claimed', {
    targetType: 'domain', targetId: domain, targetName: domain, req,
  });
  return shape(updated);
};

/**
 * Look for the token in the domain's TXT records.
 *
 * Checked at the domain itself and at the `_ai-ocean` subdomain, because some
 * DNS panels will not let a customer add a second TXT record at the apex.
 */
/**
 * The DNS lookup, behind one object so a test can answer it without a real
 * zone to publish records in. Nothing but this file and its tests touch it —
 * no route or service can pass a resolver of its own.
 */
const resolver = { resolveTxt: (host) => dns.resolveTxt(host) };

const lookupToken = async (domain, token) => {
  const wanted = `${TXT_PREFIX}${token}`;
  const hosts = [domain, `_ai-ocean.${domain}`];
  for (const host of hosts) {
    try {
      const records = await resolver.resolveTxt(host);
      // Long records arrive split into chunks; each record is an array of them.
      const flat = records.map((chunks) => chunks.join('').trim());
      if (flat.some((value) => value === wanted || value === `"${wanted}"`)) return { found: true, host };
    } catch {
      // NXDOMAIN or no TXT at that host — try the next one.
    }
  }
  return { found: false };
};

/** Prove the claim. Nothing changes if the record is not there yet. */
const verify = async (team, actor, { req = null } = {}) => {
  const settings = await assertEnabled();
  const row = await prisma.team.findUnique({
    where: { id: byPublicId(team.id).id },
    select: { verifiedDomain: true, domainToken: true, domainVerifiedAt: true },
  });
  if (!row?.verifiedDomain) throw fail(404, 'NO_DOMAIN', 'Add a domain first.');
  if (row.domainVerifiedAt) return status(team);

  /*
   * The blocklist is checked here as well as at claim time, not only there.
   * A claim sits on record until somebody publishes the DNS record, and the
   * admin's list can change in between — a domain that has since been marked
   * as a public mailbox provider must not slip through on an older claim.
   */
  if (settings.publicEmailDomains.includes(row.verifiedDomain)) {
    throw fail(400, 'PUBLIC_DOMAIN', 'That is a public email provider, not a company domain.');
  }

  const { found } = await lookupToken(row.verifiedDomain, row.domainToken);
  if (!found) {
    throw fail(409, 'DNS_RECORD_NOT_FOUND',
      'That TXT record is not visible yet. DNS changes can take a while — try again in a few minutes.');
  }

  // Someone else may have verified the same domain while this one waited.
  const taken = await prisma.team.findFirst({
    where: {
      verifiedDomain: row.verifiedDomain,
      domainVerifiedAt: { not: null },
      deletedAt: null,
      id: { not: byPublicId(team.id).id },
    },
    select: { id: true },
  });
  if (taken) throw fail(409, 'DOMAIN_TAKEN', 'Another organization has already verified that domain.');

  const updated = await prisma.team.update({
    where: { id: byPublicId(team.id).id },
    data: { domainVerifiedAt: new Date() },
    select: {
      verifiedDomain: true, domainToken: true, domainVerifiedAt: true, domainJoinMode: true, domainJoinRole: true,
    },
  });
  await teamActivityService.record(team, actor, 'domain.verified', {
    targetType: 'domain', targetId: row.verifiedDomain, targetName: row.verifiedDomain, req,
  });
  return shape(updated);
};

/** How colleagues at the verified domain get in, if at all. */
const setJoinRule = async (team, actor, { mode, role }, { req = null } = {}) => {
  await assertEnabled();
  const row = await prisma.team.findUnique({
    where: { id: byPublicId(team.id).id },
    select: { verifiedDomain: true, domainVerifiedAt: true },
  });
  if (!row?.domainVerifiedAt) throw fail(409, 'DOMAIN_NOT_VERIFIED', 'Verify the domain first.');

  const nextMode = JOIN_MODES.includes(mode) ? mode : null;
  if (!nextMode) throw fail(400, 'INVALID_JOIN_MODE', 'Choose off, request or auto.');
  const nextRole = role === undefined ? undefined : role;
  if (nextRole !== undefined && !JOIN_ROLES.includes(nextRole)) {
    throw fail(400, 'INVALID_JOIN_ROLE', 'A domain can only let people in as a Developer or a Viewer.');
  }

  const updated = await prisma.team.update({
    where: { id: byPublicId(team.id).id },
    data: { domainJoinMode: nextMode, ...(nextRole ? { domainJoinRole: nextRole } : {}) },
    select: {
      verifiedDomain: true, domainToken: true, domainVerifiedAt: true, domainJoinMode: true, domainJoinRole: true,
    },
  });
  await teamActivityService.record(team, actor, 'domain.joinRuleChanged', {
    targetType: 'domain',
    targetId: updated.verifiedDomain,
    targetName: updated.verifiedDomain,
    metadata: { mode: nextMode, role: updated.domainJoinRole },
    req,
  });
  return shape(updated);
};

/** Give the domain up. Members already in the team stay in it. */
const remove = async (team, actor, { req = null } = {}) => {
  const row = await prisma.team.findUnique({
    where: { id: byPublicId(team.id).id }, select: { verifiedDomain: true },
  });
  if (!row?.verifiedDomain) throw fail(404, 'NO_DOMAIN', 'There is no domain on this organization.');

  await prisma.$transaction([
    prisma.team.update({
      where: { id: byPublicId(team.id).id },
      data: {
        verifiedDomain: null, domainToken: null, domainVerifiedAt: null, domainJoinMode: 'off',
      },
    }),
    // Nothing may be approved against a domain the team no longer holds.
    prisma.teamJoinRequest.updateMany({
      where: {
        teamId: byPublicId(team.id).id, approvedAt: null, declinedAt: null, cancelledAt: null,
      },
      data: { cancelledAt: new Date() },
    }),
  ]);

  await teamActivityService.record(team, actor, 'domain.removed', {
    targetType: 'domain', targetId: row.verifiedDomain, targetName: row.verifiedDomain, req,
  });
  return { removed: true };
};

module.exports = {
  JOIN_MODES,
  JOIN_ROLES,
  TXT_PREFIX,
  resolver,
  normalizeDomain,
  domainOfEmail,
  status,
  claim,
  verify,
  setJoinRule,
  remove,
};
