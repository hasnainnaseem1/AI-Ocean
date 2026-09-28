/**
 * Telling somebody that something happened in their organization.
 *
 * ── One door for both ways of saying it ──
 *
 * Every team event was already written to the bell, each service calling
 * `notificationService.createNotification` for itself. Adding email to that
 * would have meant the same two lines in eight files, and the eighth would
 * eventually be the one that forgot. So the team services call this instead:
 * it writes the bell notification and, when the platform wants it, sends the
 * same thing as an email.
 *
 * ── Why the email needs no copy of its own ──
 *
 * The bell already stores a `contentKey` and renders the sentence in the
 * reader's language at read time (services/notification/notificationCopy, six
 * languages). The email asks that same catalogue for the same sentence in the
 * recipient's language and drops it into one wrapper template. So a new team
 * event needs its wording written once, not twice, and the email is never in a
 * different language from the bell.
 *
 * ── What the platform controls ──
 *
 * `features.teams.emailNotifications` switches team emails off entirely, and
 * `features.teams.emailEvents` narrows them to the kinds worth an inbox — an
 * operator who thinks a spend-limit warning deserves mail but a declined
 * invitation does not can say so. Invitations are deliberately NOT in here:
 * they are their own email (`teamInvite`), sent to somebody who may not have
 * an account yet, so a bell notification would reach nobody.
 *
 * Email is always best-effort. A notification that was written must not be
 * rolled back because a mail server was down.
 */
const notificationService = require('../notification/notificationService');
const teamSettingsService = require('./teamSettingsService');

/**
 * Which kind each event is, for the admin's per-kind switches. A content key
 * with no kind here gets no email — new events opt in deliberately rather than
 * starting to mail everyone the day they are added.
 */
const EVENT_KINDS = {
  'team.joinRequested': 'joins',
  'team.joinApproved': 'joins',
  'team.joinDeclined': 'joins',
  'team.domainJoined': 'joins',
  'team.ownershipOffered': 'ownership',
  'team.ownershipAccepted': 'ownership',
  'team.ownershipDeclined': 'ownership',
  'team.spendLimitNear': 'limits',
  'team.spendLimitReached': 'limits',
  'team.closed': 'closure',
};

const KINDS = [...new Set(Object.values(EVENT_KINDS))];

/**
 * Write the bell notification, and email it if the platform says so.
 *
 * Takes exactly what `createNotification` takes; `emailKind` may override the
 * table above for a one-off.
 */
const notify = async (payload, { emailKind = null } = {}) => {
  const notification = await notificationService.createNotification(payload)
    .catch((err) => {
      console.error('[TeamNotifier] Notification failed:', err.message);
      return null;
    });

  try {
    const kind = emailKind || EVENT_KINDS[payload.contentKey];
    if (!kind) return notification;

    const settings = await teamSettingsService.getTeamSettings();
    if (!settings.emailNotifications) return notification;
    if (!settings.emailEvents.includes(kind)) return notification;

    const recipient = await require('../../lib/prismaClient').user.findUnique({
      where: { id: payload.recipientId },
      select: { name: true, email: true, language: true, status: true },
    });
    if (!recipient?.email || recipient.status !== 'active') return notification;

    // The sentence the bell would show this person, in their own language.
    const languageSettingsService = require('../i18n/languageSettingsService');
    const lang = await languageSettingsService.resolveLanguage(recipient);
    const { renderCopy } = require('../notification/notificationCopy');
    const rendered = renderCopy(payload.contentKey, payload.metadata || {}, lang, {
      title: payload.title, message: payload.message,
    });

    await require('../email/emailService').sendTeamNotificationEmail(recipient, {
      title: rendered?.title || payload.title,
      message: rendered?.message || payload.message,
      actionLabel: payload.action?.label || '',
      actionUrl: payload.action?.url || '',
    });
  } catch (error) {
    // Best effort, always: the bell entry stands either way.
    console.error('[TeamNotifier] Email failed:', error.message);
  }

  return notification;
};

module.exports = { EVENT_KINDS, KINDS, notify };
