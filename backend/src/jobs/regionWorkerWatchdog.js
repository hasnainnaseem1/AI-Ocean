/**
 * Noticing that the region build worker has stopped, while orders wait on it.
 *
 * ── Why this is needed ──
 *
 * The build worker runs as a separate OS process, under a different user, so
 * that the credential able to change a network never enters the API process.
 * That separation is what keeps the platform's hardest promise provable — and
 * it has one cost: the API cannot see the worker. Being able to inspect it
 * would be the access the whole design removes.
 *
 * So if the worker dies, nothing in the API knows. A customer's order sits in
 * `awaiting a region` and waits, and keeps waiting, and the only trace is a
 * heartbeat column nobody is looking at. The order is not lost, it is simply
 * never built — which from the customer's side is the same thing, except they
 * also paid attention for a while first.
 *
 * ── Why it only fires when something is actually waiting ──
 *
 * A stopped worker with no orders on it is not a problem. Every region the
 * platform sells may already be built, in which case there is nothing for the
 * worker to do and its being down costs nothing — and an alert for that is
 * noise, which is how alerts stop being read.
 *
 * The condition is the one that costs money: somebody is waiting, and nothing
 * is going to act on it.
 *
 * ── Why it latches ──
 *
 * This runs every few minutes. Without a latch, an outage at 2am produces an
 * email every few minutes until somebody wakes up, which makes the next
 * genuine alert easier to ignore. One email per outage, and a new one only
 * after it has recovered.
 */
const prisma = require('../lib/prismaClient');
const regionDemand = require('../services/cloud/regionDemand');

/**
 * Whether an alert has already gone out for the current outage.
 *
 * In memory rather than the database on purpose: a backend restart should
 * re-alert. If the API has just restarted, the worker very possibly went down
 * with it, and that is exactly when somebody should be told again.
 */
let alerted = false;

/**
 * This alert's key in `notificationSettings.alerts`.
 *
 * Named rather than inlined because the other system alerts will move to the
 * same mechanism, and a key typed twice is a setting that silently stops
 * applying the day somebody fixes a typo in one of them.
 */
const ALERT_KEY = 'regionWorkerDown';

const run = async ({ now = new Date() } = {}) => {
  const summary = { ran: true, waiting: 0, workerRunning: true, alerted: false };

  const worker = await regionDemand.workerSeen();
  summary.workerRunning = worker.running !== false;
  summary.lastSeen = worker.lastSeen || null;

  /*
   * Orders held for a region, across every cloud. Counted from the
   * deployments themselves rather than the stored figure, for the same reason
   * the admin screen does: a count that drifts sends people to the wrong
   * place, or tells them nobody is waiting while orders sit still.
   */
  const waiting = await prisma.deployment.count({
    where: {
      holdKind: 'region',
      status: { in: ['pending_review', 'approved', 'provisioning'] },
    },
  });
  summary.waiting = waiting;

  // Recovered, or nothing to do. Either way the latch comes off so the next
  // genuine outage is reported.
  if (summary.workerRunning || !waiting) {
    if (alerted && summary.workerRunning) {
      console.log('[RegionWatchdog] The build worker is back.');
    }
    alerted = false;
    return summary;
  }

  if (alerted) return summary;

  const minutes = worker.minutesAgo;
  const silence = worker.lastSeen
    ? `It was last seen ${minutes} minute${minutes === 1 ? '' : 's'} ago.`
    : 'It has never reported in — it may never have been started.';

  console.error(
    `[RegionWatchdog] The region build worker is not running and ${waiting} order(s) `
    + `are waiting for a region. ${silence}`
  );

  await alertAdmins({ waiting, silence, now });
  alerted = true;
  summary.alerted = true;
  return summary;
};

/**
 * Tell the admins, in the notification centre and by email.
 *
 * Both, because the two fail differently: a notification is seen only by
 * somebody already looking at the admin centre, and email is seen by somebody
 * who is not. An order waiting on a dead worker is precisely the case where
 * nobody is looking.
 */
const alertAdmins = async ({ waiting, silence, now }) => {
  const alertRecipients = require('../services/notification/alertRecipients');

  /*
   * Who hears about this is a setting, not a line of code. The default is
   * every admin — exactly what this did before — but an operator can point it
   * at a named role (an on-call team, a billing team) without a deploy.
   */
  const config = await alertRecipients.configFor(ALERT_KEY);
  if (config.audience === alertRecipients.AUDIENCE.OFF) {
    console.log('[RegionWatchdog] This alert is switched off in settings.');
    return;
  }

  const { recipients: admins, fellBack } = await alertRecipients.resolve(
    config.audience, { emails: config.emails },
  );
  if (!admins.length) return;
  if (fellBack) {
    console.warn('[RegionWatchdog] The configured audience matched nobody; told the admins instead.');
  }

  /*
   * Typed-in addresses belong to people with no account here, so there is no
   * id to write a notification row against — they can only be emailed. Kept
   * apart rather than filtered out later, because creating a notification
   * with a null recipient is the kind of thing that fails quietly and leaves
   * nobody told.
   */
  const inApp = admins.filter((r) => !r.external && r.id);
  const external = admins.filter((r) => r.external);

  const adminUrl = (process.env.ADMIN_FRONTEND_URL || 'http://localhost:3003').replace(/\/$/, '');
  const title = 'Region build worker is not running';
  const message =
    `${waiting} customer order${waiting === 1 ? ' is' : 's are'} waiting for a region to be `
    + `built, and the build worker is not running. ${silence} `
    + 'Those orders will not start until it is back, or until the region is built by hand. '
    + 'Nothing is being charged while they wait.';

  if (external.length && !config.email) {
    /*
     * An address that can only be emailed, with email off, reaches nobody.
     * The settings screen refuses that combination, but a settings row edited
     * another way could still produce it — and silence is the one outcome
     * this alert must never have.
     */
    console.warn(
      `[RegionWatchdog] ${external.length} address(es) are configured but email is off for this `
      + 'alert, so they will not be told.'
    );
  }

  try {
    if (!inApp.length) throw new Error('no in-app recipients');
    const notificationService = require('../services/notification/notificationService');
    await notificationService.createMany(inApp.map((admin) => ({
      recipientId: admin.id,
      recipientType: 'admin',
      type: 'system_alert',
      title,
      message,
      priority: 'urgent',
      action: { label: 'Open AWS regions', url: `${adminUrl}/cloud/aws?tab=regions` },
      metadata: { waiting, at: now.toISOString() },
    })));
  } catch (err) {
    if (err.message !== 'no in-app recipients') {
      console.error('[RegionWatchdog] Could not create notifications:', err.message);
    }
  }

  /*
   * Email as well. Sent one at a time and never allowed to throw: an SMTP
   * problem must not stop the rest of the admins being told, and must not
   * fail the job either.
   */
  if (!config.email) {
    console.log('[RegionWatchdog] Email is off for this alert; notifications only.');
    return;
  }

  try {
    const emailService = require('../services/email/emailService');
    for (const admin of admins) {
      // eslint-disable-next-line no-await-in-loop
      await emailService.sendTeamNotificationEmail(admin, {
        title,
        message,
        actionLabel: 'Open AWS regions',
        actionUrl: `${adminUrl}/cloud/aws?tab=regions`,
      }).catch((err) => {
        console.error(`[RegionWatchdog] Email to ${admin.email} failed:`, err.message);
      });
    }
  } catch (err) {
    console.error('[RegionWatchdog] Could not send emails:', err.message);
  }
};

module.exports = {
  run,
  // Exported for tests: lets a run start from a known latch state.
  _reset: () => { alerted = false; },
};
