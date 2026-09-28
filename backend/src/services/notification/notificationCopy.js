/**
 * The wording of every notification the platform writes — the bell's
 * equivalent of `services/email/defaultTemplates.js`.
 *
 * ── Why the copy lives here instead of at the call sites ──
 *
 * A notification's text used to be written into the row at the moment the
 * event happened, which meant it was frozen in whatever language the platform
 * spoke at write time. A customer who switches to Urdu would get an Urdu app
 * with an English bell — including items from an hour ago — which is precisely
 * the failure this whole feature exists to remove.
 *
 * So the row stores WHICH message it is (`contentKey`) plus the values that
 * vary (`metadata`), and the sentence is assembled when it is read. Switching
 * language re-renders the entire history with no rows written and nothing lost.
 *
 * ── Placeholders ──
 *
 * `{singleBrace}` tokens, substituted by `render()` from
 * `services/billing/copyTemplates` — reused rather than reinvented, and it
 * already follows the rule this project applies everywhere: an unrecognised
 * placeholder stays visible as `{typo}` instead of silently blanking, because
 * a visible placeholder is a bug report and a blank one is a sentence that
 * reads fine and says something false.
 *
 * Note these are single braces, unlike email templates' `{{double}}`. Email
 * templates are admin-editable and follow the convention that file already
 * established; these are not, and follow the billing-copy convention instead.
 *
 * ── What is deliberately NOT here ──
 *
 * Three notifications keep their write-time message because their text is
 * written by the operator in the Admin Center, not by us: the two
 * `billingCopy(...)` pause messages in `deploymentService`, the storage-debt
 * warning in `debtCollection`, and the signup welcome message from
 * `themeSettings.welcomeTitle/welcomeMessage`. Operator prose has no language
 * dimension to translate along — the same scope call already made for the
 * deploy-journey question bank. Their titles are still keyed, so at least the
 * heading follows the reader.
 */
const { render } = require('../billing/copyTemplates');

const copy = {
  /* ── Deployment lifecycle ── */

  'deployment.movedToPrepaid': {
    // Sent when pay-as-you-go is taken away (fundingService.enforcePaygAccessNow).
    title: 'Deployment moved to prepaid',
    message: 'Pay-as-you-go is no longer available on your account, so "{deploymentName}" now runs on '
      + 'your prepaid balance. Usage up to now was billed as pay-as-you-go. Keep credit in your '
      + 'wallet to keep it running.',
  },
  'team.spendLimitNear': {
    title: 'Spending limit almost reached',
    message: '{memberName} has used {percent}% of their {currency} {limit} monthly limit in {teamName}.',
  },
  'team.spendLimitReached': {
    title: 'Spending limit reached',
    message: '{memberName} has reached their {currency} {limit} monthly limit in {teamName}. They cannot start new deployments until next month or until you raise it.',
  },
  'team.ownershipOffered': {
    title: 'You have been offered ownership',
    message: '{fromName} has offered you ownership of {teamName}. Accept it to take over the account, or decline to leave it with them.',
  },
  'team.ownershipAccepted': {
    title: 'Ownership transferred',
    message: '{toName} is now the owner of {teamName}. You are an admin of it.',
  },
  'team.ownershipDeclined': {
    title: 'Handover declined',
    message: '{toName} declined ownership of {teamName}. You are still its owner.',
  },
  'team.closed': {
    title: 'A team you were in was closed',
    message: '{teamName} was closed by its owner. You no longer have access to it.',
  },
  'team.domainJoined': {
    title: 'Someone joined through your domain',
    message: '{memberName} ({memberEmail}) joined {teamName} automatically, because your domain rule lets anyone at {domain} in.',
  },
  'team.joinRequested': {
    title: 'Someone asked to join',
    message: '{memberName} ({memberEmail}) asked to join {teamName}.',
  },
  'team.joinApproved': {
    title: 'You are in',
    message: 'Your request to join {teamName} was approved.',
  },
  'team.joinDeclined': {
    title: 'Your request was declined',
    message: 'Your request to join {teamName} was not approved.',
  },
  'team.addedByAdmin': {
    title: 'You were added to an organization',
    message: 'You were added to {teamName} by support.',
  },
  'team.removedByAdmin': {
    title: 'You were removed from an organization',
    message: 'You no longer have access to {teamName}.',
  },
  'deployment.approved': {
    title: 'Deployment approved',
    message: 'Your {modelName} deployment "{deploymentName}" was approved and is being set up.',
  },
  'deployment.ready': {
    title: 'Your model is live',
    message: '"{deploymentName}" is running and ready to accept requests.',
  },
  'deployment.keyRotated': {
    title: 'New API key issued',
    message: '"{deploymentName}" is running again. Because it was suspended, a new API key was '
      + 'issued and the previous one no longer works — copy the new key from the deployment page '
      + 'before your next request.',
  },
  'deployment.rejected': {
    title: 'Deployment request declined',
    // `reason` is the admin's own free text when they gave one. It is not
    // translated for the same reason the billingCopy messages are not.
    message: '{reason}',
  },
  'deployment.rejectedNoReason': {
    title: 'Deployment request declined',
    message: 'Your deployment request could not be fulfilled.',
  },
  'deployment.pausedNoCredit': {
    title: 'Deployment paused — out of credit',
    message: '',   // operator-authored, see the header
  },
  'deployment.pausedCardRequired': {
    title: 'Deployment paused — verified card required',
    message: '',   // operator-authored, see the header
  },

  /* ── Credit and debt ── */

  /**
   * Runway is three keys, not one with a `{remaining}` placeholder.
   *
   * The unit word ("hour(s)" / "day(s)") is part of the sentence, so passing a
   * pre-built "3.5 hour(s)" through metadata would drop an English fragment
   * into the middle of an Urdu sentence — and a translator could not move it,
   * because in Urdu the number and its unit do not sit where English puts them.
   * Splitting the key lets each language write the whole sentence.
   */
  'credit.lowBalanceHours': {
    title: 'Low credit balance',
    message: 'Your balance is {currency} {balance} — about {runway} hour(s) at your current usage '
      + 'of {currency} {burnRatePerHour}/hr. Top up to avoid interruption.',
  },
  'credit.lowBalanceDays': {
    title: 'Low credit balance',
    message: 'Your balance is {currency} {balance} — about {runway} day(s) at your current usage '
      + 'of {currency} {burnRatePerHour}/hr. Top up to avoid interruption.',
  },
  'credit.pausingSoon': {
    // Only fires under 24 hours of runway, so the unit is always hours.
    title: 'Your deployments will pause soon',
    message: 'Your balance is {currency} {balance} — about {runway} hour(s) at your current usage '
      + 'of {currency} {burnRatePerHour}/hr. Top up to avoid interruption.',
  },
  'credit.adjustedUp': {
    title: 'Credit added to your account',
    message: '+{amount} {currency}. New balance: {balance} {currency}.{note}',
  },
  'credit.adjustedDown': {
    title: 'Account balance adjusted',
    message: '{amount} {currency}. New balance: {balance} {currency}.{note}',
  },
  'debt.collected': {
    title: 'Outstanding balance settled',
    message: 'Your card was charged {currency} {amount} to settle your outstanding balance.',
  },
  'debt.collectionFailed': {
    title: 'Could not collect your outstanding balance',
    message: 'We tried to charge your card {currency} {amount} to settle your outstanding balance, '
      + 'but it failed ({error}). Please update your payment method or add funds.',
  },
  'debt.pausedOverLimit': {
    title: 'Deployment paused — outstanding balance',
    message: '"{deploymentName}" was paused because your outstanding balance has gone above the '
      + 'platform\'s limit. Settle it to resume.',
  },
  'debt.pausedTooOld': {
    title: 'Deployment paused — outstanding balance',
    message: '"{deploymentName}" was paused because your outstanding balance has gone unpaid for '
      + 'too long. Settle it to resume.',
  },

  /* ── Storage grace ── */

  'storage.terminated': {
    title: 'Deployment terminated — unpaid storage',
    message: '"{deploymentName}" was terminated because its storage went unpaid for more than '
      + '{graceDays} days. Any outstanding balance is still owed.',
  },
  'storage.warning': {
    title: 'Unpaid storage — action needed',
    message: '',   // operator-authored, see the header
  },

  /* ── Payment methods ── */

  'card.expired': {
    title: 'Your saved card has expired',
    message: 'Your {brand} card ending {last4} has expired. Add a new card to keep pay-as-you-go '
      + 'and automatic top-ups working.',
  },
  'card.expiring': {
    title: 'Your saved card is expiring soon',
    message: 'Your {brand} card ending {last4} expires in {days} day(s). Add a new card before '
      + 'then to avoid an interruption.',
  },

  /* ── Account ── */

  'account.emailVerified': {
    title: 'Email Verified',
    message: 'Your email has been verified by admin. You can now access all features.',
  },
  'account.suspended': {
    title: 'Account Suspended',
    message: 'Your account has been suspended. Please contact support for more information.',
  },
  'account.suspendedWithReason': {
    title: 'Account Suspended',
    message: '{reason}',   // admin's own words, see the header
  },
  'account.activated': {
    title: 'Account Activated',
    message: 'Your account has been activated. You can now access all features.',
  },
  'account.statusSuspended': {
    title: 'Account Status Updated',
    // "for assistance" here, "for more information" in account.suspended —
    // the two call sites have always worded this differently. Kept as-is:
    // this phase translates the existing copy, it does not rewrite it.
    message: 'Your account has been suspended. Please contact support for assistance.',
  },
  'account.statusActivated': {
    title: 'Account Status Updated',
    message: 'Your account has been activated. You can now access all features.',
  },
  'account.updatedByAdmin': {
    title: 'Account Updated',
    message: 'Your account has been updated by {adminName}.',
  },
  'admin.welcome': {
    title: 'Welcome to Admin Panel',
    message: 'Your admin account has been created by {adminName}. Your role is: {role}.',
  },
};

const CONTENT_KEYS = Object.keys(copy);

/**
 * The catalogue in one language, with English filling any gap.
 *
 * Per-key rather than all-or-nothing, so a half-finished pack renders the
 * strings it does have instead of being ignored entirely — the same merge the
 * email templates and the frontend namespaces use.
 *
 * The computed `require` is deliberate: CommonJS on a server with no bundler,
 * so a new language's notifications are one file drop into `./locales/` with no
 * code change. Node's module cache makes the repeat lookups free.
 */
const getCopy = (lang) => {
  if (!lang || lang === 'en') return copy;
  let pack = {};
  try {
    pack = require(`./locales/${lang}`);
  } catch {
    return copy;
  }
  const merged = {};
  CONTENT_KEYS.forEach((key) => {
    const en = copy[key];
    const tr = pack[key];
    merged[key] = {
      title: (tr && typeof tr.title === 'string' && tr.title.trim()) ? tr.title : en.title,
      // An empty string is a real value here (the operator-authored bodies), so
      // this checks for a *present* string rather than a truthy one.
      message: (tr && typeof tr.message === 'string' && tr.message.trim()) ? tr.message : en.message,
    };
  });
  return merged;
};

/**
 * One notification's text, in one language.
 *
 * Returns null when the row has no `contentKey`, or names copy that no longer
 * exists — a renamed key must not blank out a customer's notification, so the
 * caller falls back to the stored English.
 *
 * A key whose template is deliberately empty (the operator-authored bodies)
 * also falls back for the message, so the admin's own sentence survives while
 * its heading still follows the reader's language.
 */
const renderCopy = (contentKey, metadata, lang, stored) => {
  if (!contentKey) return null;
  const entry = getCopy(lang)[contentKey];
  if (!entry) return null;

  const ctx = metadata || {};
  const message = entry.message
    ? render(entry.message, ctx)
    : (stored && stored.message) || '';

  return { title: render(entry.title, ctx), message };
};

module.exports = { copy, getCopy, renderCopy, CONTENT_KEYS };
