/**
 * Team settings — the admin-controlled limits for teams
 * (`AdminSettings.features.teams`), merged over DEFAULTS on every read.
 *
 * The merge is load-bearing: `adminSettingsService.getSettings()` does not fill
 * in defaults for keys added after a settings row was created, so a platform
 * that has never saved this block still gets every field (same pattern as
 * languageSettingsService / billingModeService).
 *
 * Every number here is a guard against a way of abusing teams, which is why
 * none of them may be missing or unbounded:
 *   maxMembers         a team is a shared account, not a mailing list
 *   inviteExpiryDays   an old invite link must stop working
 *   invitesPerDay      stops a team being used to spam arbitrary addresses
 *   maxPendingInvites  same, for invites that are never answered
 *   maxTeamsPerUser    stops one person creating throwaway accounts
 *   ownershipExpiryDays  an unanswered handover offer must not stay open forever
 *   publicEmailDomains   mailbox providers nobody may claim as a company domain
 *   domainJoinEnabled    whether company domains exist for customers at all
 *   joinLinks*           the shareable "ask to join" link, and its limits
 *   companyHint*         "somebody at your company is already here"
 *   seatFee*             what a team pays per member, if the platform charges
 *   email*               which team events also go out as email
 */
const adminSettingsService = require('../admin/adminSettingsService');

const DEFAULTS = {
  // Customers can create and join teams. Off: the signup question and every
  // team entry point disappear; existing teams keep working (they hold money
  // and deployments that cannot simply vanish).
  enabled: true,
  maxMembers: 25,
  inviteExpiryDays: 7,
  invitesPerDay: 20,
  maxPendingInvites: 50,
  maxTeamsPerUser: 5,
  ownershipExpiryDays: 7,
  /*
   * Company domains: off.
   *
   * Every way into a team that a customer needs is an invitation — by email or
   * by the link the inviter copies — which is what ChatGPT Team, Claude Team,
   * GitHub and AWS Organizations all do on their ordinary plans. Joining by
   * company domain is the enterprise extra, and it asks for a DNS record,
   * because letting somebody in automatically on the strength of an email
   * address alone is exactly the hole it would open: anyone could claim
   * acme.com and quietly collect its staff.
   *
   * So it is switched off, and a platform that has enterprise customers turns
   * it on deliberately. With it off, no customer ever meets the word "domain".
   */
  domainJoinEnabled: false,

  /*
   * ── The join link ──
   *
   * One link a team drops into its own chat. It never admits anyone by itself:
   * whoever opens it asks, and an owner or admin approves. That is what makes
   * a leaked, forwarded or forgotten link harmless, so `joinLinkApproval` is
   * 'always' and a platform only relaxes it deliberately ('team' lets each
   * organization decide for itself).
   *
   * A team picks its own expiry, but never longer than the platform allows.
   */
  joinLinksEnabled: true,
  joinLinkApproval: 'always',
  joinLinkExpiryDays: 7,
  joinLinkMaxExpiryDays: 90,
  joinLinkMaxUses: 50,

  /*
   * ── "Somebody at your company is already here" ──
   *
   * Shown to a customer whose own verified address is at the same domain as an
   * organization that has CHOSEN to be findable that way
   * (`Team.discoverableByDomain`, off by default). Nobody can ask about a
   * domain that is not their own, so no one can test which companies are
   * customers here.
   *
   * `companyHintMaxAccounts` is the guard no list can give us: if a domain
   * already has more than this many accounts on the platform outside the
   * organization in question, it is treated as a public mailbox provider and
   * the hint stays silent — whether or not anyone has ever heard of it. The
   * internet has far more free-mail providers than any list will hold, so the
   * unknown ones have to fail closed on their own.
   */
  companyHintEnabled: true,
  companyHintMaxAccounts: 25,

  /*
   * ── Seat fees ──
   *
   * Off. A platform that charges for people sets a monthly fee per member and
   * how many seats it gives away; every member above that is billed, a day's
   * share at a time (jobs/teamSeatFee). Nothing is free: what the wallet
   * cannot cover becomes debt on the account like any other charge.
   */
  seatFeeEnabled: false,
  seatFeeMonthly: 0,
  seatFeeFreeSeats: 1,

  /*
   * ── Team events by email ──
   *
   * The bell always gets them; this decides which also reach an inbox. On by
   * default, because the events that matter here are ones somebody is waiting
   * on — a join request nobody answers is a colleague locked out, and a
   * spend-limit warning read a day late is a developer stopped mid-work.
   *
   * `emailEvents` narrows it by kind, so an operator can keep the useful ones
   * without mailing people about every declined invitation.
   */
  emailNotifications: true,
  emailEvents: ['joins', 'ownership', 'limits', 'closure'],
  /*
   * "Everyone with a gmail address" is not a company. A team that could claim
   * one of these would be handed every customer who ever signs up with one, so
   * they cannot be verified as a domain at all. Editable, because which
   * providers matter differs by market.
   */
  publicEmailDomains: [
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
    'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
    'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
    'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com',
    'qq.com', '163.com', '126.com', 'naver.com', 'rediffmail.com',
  ],
};

const LIMITS = {
  maxMembers: [2, 1000],
  inviteExpiryDays: [1, 30],
  invitesPerDay: [1, 500],
  maxPendingInvites: [1, 1000],
  maxTeamsPerUser: [1, 100],
  ownershipExpiryDays: [1, 30],
  joinLinkExpiryDays: [1, 365],
  joinLinkMaxExpiryDays: [1, 365],
  joinLinkMaxUses: [1, 1000],
  companyHintMaxAccounts: [1, 10000],
  seatFeeFreeSeats: [0, 1000],
};

const clampInt = (value, [min, max], fallback) => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/**
 * Every domain in the blocklist, lower-cased and de-duplicated. A bad entry is
 * dropped rather than failing the whole read — a typo in one row of an admin
 * list must not take the teams feature down with it.
 */
const cleanDomains = (value) => {
  const list = Array.isArray(value) ? value : DEFAULTS.publicEmailDomains;
  const seen = new Set();
  list.forEach((entry) => {
    const domain = String(entry || '').trim().toLowerCase().replace(/^@/, '');
    if (/^[a-z0-9.-]+\.[a-z]{2,63}$/.test(domain)) seen.add(domain);
  });
  return [...seen];
};

/** Validate and complete a teams block — used on read and by the admin save route. */
const sanitize = (raw = {}) => {
  const out = { enabled: raw.enabled === undefined ? DEFAULTS.enabled : !!raw.enabled };
  Object.keys(LIMITS).forEach((key) => {
    out[key] = clampInt(raw[key], LIMITS[key], DEFAULTS[key]);
  });
  out.publicEmailDomains = cleanDomains(raw.publicEmailDomains);
  out.domainJoinEnabled = raw.domainJoinEnabled === undefined
    ? DEFAULTS.domainJoinEnabled
    : !!raw.domainJoinEnabled;
  out.joinLinksEnabled = raw.joinLinksEnabled === undefined
    ? DEFAULTS.joinLinksEnabled
    : !!raw.joinLinksEnabled;
  out.joinLinkApproval = raw.joinLinkApproval === 'team' ? 'team' : 'always';
  out.companyHintEnabled = raw.companyHintEnabled === undefined
    ? DEFAULTS.companyHintEnabled
    : !!raw.companyHintEnabled;
  out.seatFeeEnabled = raw.seatFeeEnabled === undefined
    ? DEFAULTS.seatFeeEnabled
    : !!raw.seatFeeEnabled;
  out.emailNotifications = raw.emailNotifications === undefined
    ? DEFAULTS.emailNotifications
    : !!raw.emailNotifications;
  // Unknown kinds are dropped rather than rejected: a saved list from an older
  // build must not fail the whole save, and a kind this build does not know
  // could only ever mail nobody.
  const kinds = require('./teamNotifier').KINDS;
  const wanted = Array.isArray(raw.emailEvents) ? raw.emailEvents : DEFAULTS.emailEvents;
  out.emailEvents = kinds.filter((k) => wanted.includes(k));
  // Money, not a count: kept to the four decimals the ledger stores, and never
  // negative — a "fee" that pays customers is not a thing this platform does.
  const fee = Math.round((Number(raw.seatFeeMonthly) || 0) * 10000) / 10000;
  out.seatFeeMonthly = Number.isFinite(fee) && fee > 0 ? Math.min(fee, 100000) : 0;
  // A team may never be given a longer life for its link than the platform allows.
  out.joinLinkExpiryDays = Math.min(out.joinLinkExpiryDays, out.joinLinkMaxExpiryDays);
  return out;
};

const getTeamSettings = async () => {
  let saved = {};
  try {
    const settings = await adminSettingsService.getSettings();
    saved = settings.features?.teams || {};
  } catch (err) {
    console.error('Error reading team settings, falling back to defaults:', err.message);
  }
  return sanitize({ ...DEFAULTS, ...saved });
};

module.exports = { DEFAULTS, LIMITS, sanitize, getTeamSettings };
