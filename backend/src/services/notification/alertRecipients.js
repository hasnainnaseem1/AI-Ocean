/**
 * Who gets told when the platform raises an alert — read from settings, not code.
 *
 * ── Why this exists ──
 *
 * Every system alert on this platform calls `listActiveAdmins()` and emails
 * whoever comes back. That is a decision about *who should be told*, written
 * into eleven different files, and the only way to change it is to change
 * code and deploy. A platform where "everything is managed from the admin
 * centre" cannot have its most operational decision hardcoded.
 *
 * The concrete case that makes it obvious: a billing team that should get
 * unbilled-usage alerts but not isolation alerts, or an on-call role that
 * should get the urgent ones at 3am and nothing else. Both are role lists
 * that already exist in `CustomRole`, and neither is reachable from code that
 * says `listActiveAdmins()`.
 *
 * ── What an audience is ──
 *
 * A stored value per alert, naming one of:
 *
 *   'admins'        every active admin account (what the code used to do)
 *   'super_admins'  only super admins — for the ones that are security events
 *   'role:<name>'   everybody holding a named CustomRole
 *   'off'           nobody; the alert is not raised at all
 *
 * Plus whether email is sent as well as an in-app notification. The two are
 * separate because they fail differently: a notification is seen by somebody
 * already in the admin centre, email reaches somebody who is not.
 *
 * ── The rule that cannot be configured away ──
 *
 * An audience that resolves to nobody falls back to every active admin, and
 * says so in the log. A platform that silently tells no-one about a stalled
 * customer order, because a role was renamed six months ago, is worse than one
 * that tells slightly the wrong person. `off` is the only way to have an alert
 * reach nobody, because that one is somebody's deliberate choice rather than
 * a mistake nobody can see.
 */
const userService = require('../user/userService');
const adminSettingsService = require('../admin/adminSettingsService');

/** Audiences that are not a named role. */
const AUDIENCE = {
  ADMINS: 'admins',
  SUPER_ADMINS: 'super_admins',
  /**
   * Addresses typed in by hand, for people with no account here.
   *
   * The case this is for is real and common: a shared ops mailbox, an
   * on-call pager address, an external NOC. None of them is a user of this
   * platform, so none can be a role — and requiring an account just to
   * receive an alert is the kind of friction that ends with somebody
   * forwarding their own mail instead.
   */
  CUSTOM: 'custom',
  OFF: 'off',
};

/** A `role:<name>` audience, or null if this is not one. */
const roleNameOf = (audience) => {
  const value = String(audience || '');
  return value.startsWith('role:') ? value.slice(5).trim() : null;
};

/**
 * Split and tidy a list of typed-in addresses.
 *
 * Accepts commas, semicolons, newlines or spaces between them, because a
 * person pasting three addresses out of their own mail client should not have
 * to think about which separator this field wants.
 */
const parseEmails = (value) => {
  if (Array.isArray(value)) return parseEmails(value.join(','));

  return String(value || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
};

/**
 * Is this a plausible address?
 *
 * Deliberately permissive — the point is to catch a typo like a missing `@`
 * or a trailing comma, not to adjudicate the RFC. An address this rejects
 * could never have received the alert anyway.
 */
const isEmail = (value) => /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(String(value || ''));

/**
 * The people a given audience resolves to, right now.
 *
 * Returns `{ recipients, audience, fellBack }` rather than an array, because
 * the caller needs to know when a configured audience produced nobody — that
 * is worth a log line, and it is the only way a misconfiguration ever gets
 * noticed.
 */
const resolve = async (audience, { emails = '' } = {}) => {
  const value = String(audience || AUDIENCE.ADMINS);

  if (value === AUDIENCE.OFF) {
    return { recipients: [], audience: value, fellBack: false, off: true };
  }

  /*
   * Typed-in addresses. These are NOT users of this platform, so they have no
   * id and cannot receive an in-app notification — only email. Marked
   * `external: true` so the caller can tell the difference rather than trying
   * to write a notification row against an id that does not exist.
   */
  if (value === AUDIENCE.CUSTOM) {
    const list = parseEmails(emails).filter(isEmail);

    if (!list.length) {
      const fallback = await userService.listActiveAdmins().catch(() => []);
      console.warn(
        '[AlertRecipients] "custom" is selected but no valid address is saved — falling back to '
        + `${fallback.length} admin(s).`
      );
      return { recipients: fallback, audience: value, fellBack: true };
    }

    return {
      recipients: list.map((email) => ({ id: null, email, name: email, external: true })),
      audience: value,
      fellBack: false,
    };
  }

  const roleName = roleNameOf(value);

  let recipients = [];
  try {
    if (roleName) {
      const prisma = require('../../lib/prismaClient');
      const role = await prisma.customRole.findFirst({
        where: { name: roleName, isActive: true },
        select: {
          users: {
            where: { status: 'active' },
            select: { id: true, email: true, name: true },
          },
        },
      });
      recipients = role?.users || [];
    } else if (value === AUDIENCE.SUPER_ADMINS) {
      recipients = await userService.listActiveAdmins({ role: 'super_admin' });
    } else {
      recipients = await userService.listActiveAdmins();
    }
  } catch (err) {
    console.error(`[AlertRecipients] Could not resolve "${value}":`, err.message);
    recipients = [];
  }

  /*
   * Nobody matched, and the audience was not `off`. The role may have been
   * renamed, deactivated, or had its last member removed — all silent, all
   * things that happen months after somebody set this up. Falling back to
   * every admin keeps the alert reaching a human.
   */
  if (!recipients.length) {
    const fallback = await userService.listActiveAdmins().catch(() => []);
    console.warn(
      `[AlertRecipients] "${value}" matched nobody — falling back to ${fallback.length} admin(s). `
      + 'Check this audience in Admin → Settings → Notifications.'
    );
    return { recipients: fallback, audience: value, fellBack: true };
  }

  return { recipients, audience: value, fellBack: false };
};

/**
 * One alert's configuration, with its defaults applied.
 *
 * Defaults match what the code did before this existed, so an installation
 * that has never opened the settings screen behaves exactly as it did.
 */
const configFor = async (alertKey, { settings = null, defaultAudience = AUDIENCE.ADMINS } = {}) => {
  const loaded = settings || await adminSettingsService.getSettings();
  const ns = loaded?.notificationSettings || {};
  const alerts = ns.alerts || {};
  const own = alerts[alertKey] || {};

  return {
    audience: own.audience || defaultAudience,
    // Only meaningful for the `custom` audience; harmless otherwise.
    emails: own.emails || '',
    /*
     * Email defaults on for alerts, and is still gated by the platform-wide
     * `enableEmailNotifications` switch — an operator who turns all email off
     * means it, and a per-alert setting must not quietly override that.
     */
    email: own.email !== false && ns.enableEmailNotifications !== false,
  };
};

/**
 * The audiences an admin screen can offer, with the roles that actually exist.
 *
 * Built from the database rather than a fixed list, so a role created this
 * morning is selectable this morning.
 */
const options = async () => {
  const prisma = require('../../lib/prismaClient');

  const roles = await prisma.customRole.findMany({
    where: { isActive: true },
    select: { name: true, _count: { select: { users: true } } },
    orderBy: { name: 'asc' },
  }).catch(() => []);

  /*
   * Order matters more than it looks.
   *
   * A platform with a dozen roles — several of them empty leftovers — pushes
   * the built-in choices off the bottom of the dropdown, and "Specific email
   * addresses" at the very end becomes an option nobody knows exists. So the
   * four fixed choices sit together at the top, and roles follow with the
   * ones that actually have members first.
   */
  const withMembers = roles.filter((r) => (r._count?.users || 0) > 0);
  const empty = roles.filter((r) => !(r._count?.users || 0));

  const asOption = (r) => ({
    value: `role:${r.name}`,
    label: r.name,
    // Shown on the screen: choosing a role nobody holds is a silent mistake
    // otherwise, and this is the moment to make it visible.
    members: r._count?.users || 0,
  });

  return [
    { value: AUDIENCE.ADMINS, label: 'All admins' },
    { value: AUDIENCE.SUPER_ADMINS, label: 'Super admins only' },
    { value: AUDIENCE.CUSTOM, label: 'Specific email addresses…' },
    { value: AUDIENCE.OFF, label: 'Nobody — do not raise this alert' },
    ...withMembers.map(asOption),
    ...empty.map(asOption),
  ];
};

module.exports = {
  AUDIENCE,
  roleNameOf,
  parseEmails,
  isEmail,
  resolve,
  configFor,
  options,
};
