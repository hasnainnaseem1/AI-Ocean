/**
 * Noticing that nothing is building the region a customer is waiting for.
 *
 * ── What this is guarding ──
 *
 * The build worker runs in its own process so the credential that can change a
 * network never enters the API. The price of that separation is that the API
 * cannot see the worker — so when it dies, nothing knows. A customer's order
 * waits, and keeps waiting, and the only trace is a heartbeat column nobody
 * reads.
 *
 * These tests are about when an alert fires and when it stays quiet. Both
 * matter: an alert that fires for a healthy platform is noise, and noise is
 * how the real alert gets ignored at 2am.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const code = () => require('fs')
  .readFileSync(require.resolve('../regionWorkerWatchdog.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('when the alarm is allowed to go off', () => {
  test('both conditions are required, not either', () => {
    /*
     * A stopped worker with nothing waiting costs nothing — every region may
     * already be built. Alerting on that trains people to ignore the alert.
     * Orders waiting with a healthy worker is the normal case while a region
     * builds. Only the combination is a problem.
     */
    const src = code();
    assert.match(src, /if \(summary\.workerRunning \|\| !waiting\)/);
  });

  test('the alert is latched, so one outage is one email', () => {
    // This runs every five minutes. Without a latch an overnight outage is a
    // dozen identical emails, and the next genuine one is easier to miss.
    const src = code();
    assert.match(src, /if \(alerted\) return summary;/);
    assert.match(src, /alerted = true;/);
  });

  test('and the latch comes off when it recovers', () => {
    // Otherwise the first outage is the only one ever reported.
    assert.match(code(), /alerted = false;/);
  });

  test('the latch is in memory, so a restart re-alerts', () => {
    /*
     * Deliberate: if the API has just restarted, the worker may well have gone
     * down with it — which is exactly when somebody should be told again
     * rather than silenced by a flag that survived.
     */
    const src = code();
    assert.match(src, /let alerted = false;/);
    assert.ok(!/alerted.*prisma|prisma.*alerted/i.test(src), 'the latch must not be persisted');
  });
});

describe('who gets told, and how', () => {
  test('admins are reached by notification AND email', () => {
    /*
     * The two fail differently. A notification is seen by somebody already in
     * the admin centre; email reaches somebody who is not. An order stalled on
     * a dead worker is precisely the case where nobody is looking.
     */
    const src = code();
    assert.match(src, /notificationService/);
    assert.match(src, /emailService/);
    assert.match(src, /sendTeamNotificationEmail/);
  });

  test('who it goes to is a setting, not a line of code', () => {
    /*
     * This used to call `listActiveAdmins()` directly, which made "who gets
     * woken up" a decision that needed a deploy to change. It now resolves an
     * audience from settings — all admins, super admins only, a named custom
     * role, or nobody — so a billing team can be pointed at billing alerts
     * without touching this file.
     */
    const src = code();
    assert.match(src, /alertRecipients/);
    assert.match(src, /configFor\(ALERT_KEY\)/);
    assert.ok(
      !/listActiveAdmins/.test(src),
      'the recipients must come from settings, not be hardcoded here',
    );
  });

  test('and it can be switched off entirely', () => {
    assert.match(code(), /AUDIENCE\.OFF/);
  });

  test('email delivery follows its own setting', () => {
    // Separate from the audience: an operator may want the bell but not the
    // inbox, and the platform-wide email switch still overrides both.
    assert.match(code(), /if \(!config\.email\)/);
  });

  test('a failing mailbox does not stop the rest being told', () => {
    // One bad address must not swallow the alert for everyone else, and must
    // not fail the job either.
    const src = code();
    const at = src.indexOf('sendTeamNotificationEmail');
    assert.match(src.slice(at, at + 400), /catch/);
  });

  test('and the message says nothing is being charged', () => {
    /*
     * The admin's first question about a stalled order is whether it is
     * costing anybody anything. Answering it in the alert saves the lookup.
     */
    assert.match(code(), /[Nn]othing is being charged/);
  });

  test('it says how many orders are affected', () => {
    // "The worker is down" is a fact. "Three orders are waiting" is a priority.
    assert.match(code(), /\$\{waiting\}/);
  });
});

describe('what it counts', () => {
  test('held orders are counted, not read from a stored figure', () => {
    /*
     * The stored count is written when a hold is placed and can drift — an
     * order cancelled, a region built by hand. A watchdog firing on a stale
     * number is worse than one that does not fire.
     */
    const src = code();
    assert.match(src, /prisma\.deployment\.count/);
    assert.match(src, /holdKind: 'region'/);
  });

  test('and only orders that are still live', () => {
    // A terminated order from last week must not keep an alarm ringing.
    assert.match(code(), /status: \{ in: \['pending_review', 'approved', 'provisioning'\] \}/);
  });
});
