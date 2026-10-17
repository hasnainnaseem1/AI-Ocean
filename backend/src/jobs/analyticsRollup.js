/**
 * The nightly job that keeps analytics history honest.
 *
 * Two kinds of work, and the distinction matters:
 *
 *  1. **Recording what cannot be recovered later.** A tier's stock is
 *     overwritten in place, so a daily heartbeat is the only thing that will
 *     ever be able to say what capacity looked like on a given day. Miss a
 *     night and that day is gone for good.
 *
 *  2. **Throwing away what we promised not to keep.** Capacity change rows
 *     past their retention window; later phases add page views past the
 *     operator's `dataRetentionDays`. Retention that only exists as a setting
 *     nobody enforces is not a retention policy.
 *
 * Every step is idempotent and independently guarded. A failure in pruning
 * must not cost us the heartbeat — the heartbeat is the irreplaceable half.
 */
const tierCapacityLog = require('../services/analytics/tierCapacityLog');
const churnRiskService = require('../services/analytics/churnRiskService');
const trafficCollector = require('../services/analytics/trafficCollector');
const { resolvePolicy } = require('../services/analytics/analyticsPolicyResolver');
const { getSettings } = require('../services/admin/adminSettingsService');
const analyticsCache = require('../services/analytics/analyticsCache');

const DAY_MS = 86400000;

const run = async () => {
  const started = Date.now();
  const summary = {
    heartbeats: 0,
    heartbeatsUpdated: 0,
    capacityEventsPruned: 0,
    churnScored: 0,
    churnWritten: 0,
    churnRemoved: 0,
    churnSnapshotsPruned: 0,
    sessionsClosed: 0,
    trafficRollups: null,
    trafficSessionsPruned: 0,
    errors: [],
  };

  const policy = await resolvePolicy().catch((err) => {
    console.error('[AnalyticsRollup] Policy unavailable, using defaults:', err.message);
    return {};
  });

  // ── 1. Snapshot today's stock, before anything that could fail ──
  try {
    const { written, updated } = await tierCapacityLog.writeHeartbeats();
    summary.heartbeats = written;
    summary.heartbeatsUpdated = updated;
  } catch (err) {
    summary.errors.push(`heartbeats: ${err.message}`);
    console.error('[AnalyticsRollup] Capacity heartbeat failed:', err.message);
  }

  // ── 2. Today's churn scores, which also cannot be computed later ──
  // Every input is current state (days since a sign-in, what the wallet holds
  // now), and all of it is overwritten in place. Miss tonight and that day's
  // score does not exist — which is the same irreplaceable half as the
  // heartbeat above, so it runs before anything that merely tidies up.
  try {
    const result = await churnRiskService.snapshot(policy);
    summary.churnScored = result.scored;
    summary.churnWritten = result.written;
    summary.churnRemoved = result.removed;
  } catch (err) {
    summary.errors.push(`churn snapshot: ${err.message}`);
    console.error('[AnalyticsRollup] Churn snapshot failed:', err.message);
  }

  /*
   * ── 3. Traffic: close, then roll up ──
   *
   * Order matters. A session's bounce flag and duration are only known once
   * it is closed, so rolling up before closing would record every still-open
   * visit as having bounced nowhere for zero seconds.
   *
   * Two days are rolled, today and yesterday: a visit that began at 23:50
   * closes after midnight, and yesterday's totals are not final until it has.
   */
  try {
    summary.sessionsClosed = await trafficCollector.closeIdleSessions(policy);
  } catch (err) {
    summary.errors.push(`close sessions: ${err.message}`);
    console.error('[AnalyticsRollup] Closing idle sessions failed:', err.message);
  }

  try {
    const now = new Date();
    summary.trafficRollups = [
      await trafficCollector.rollupDay(new Date(now.getTime() - DAY_MS)),
      await trafficCollector.rollupDay(now),
    ];
  } catch (err) {
    summary.errors.push(`traffic rollup: ${err.message}`);
    console.error('[AnalyticsRollup] Traffic rollup failed:', err.message);
  }

  // ── 4. Prune change rows (heartbeats are kept forever — they ARE the history) ──
  try {
    const retentionDays = Number(policy?.capacity?.eventRetentionDays) || 180;
    summary.capacityEventsPruned = await tierCapacityLog.prune(retentionDays);
  } catch (err) {
    summary.errors.push(`capacity prune: ${err.message}`);
    console.error('[AnalyticsRollup] Capacity prune failed:', err.message);
  }

  // ── 5. Prune churn snapshots past their retention ──
  try {
    summary.churnSnapshotsPruned = await churnRiskService.prune(
      policy?.churn?.snapshotRetentionDays,
    );
  } catch (err) {
    summary.errors.push(`churn prune: ${err.message}`);
    console.error('[AnalyticsRollup] Churn prune failed:', err.message);
  }

  /*
   * ── 6. Prune raw page views, LAST ──
   *
   * This is the operator's data-retention promise being kept, and it is
   * deliberately the final step: it destroys the only copy of the raw events,
   * so it runs after the rollups that preserve their shape. If the rollup
   * above failed, this still runs — the retention promise is not conditional
   * on our reporting being convenient — but the rollup error is already in
   * the summary, so the job reports failure and an operator can see why a day
   * is thin.
   */
  try {
    const settings = await getSettings();
    summary.trafficSessionsPruned = await trafficCollector.pruneRawEvents(
      settings?.analyticsSettings,
    );
  } catch (err) {
    summary.errors.push(`traffic prune: ${err.message}`);
    console.error('[AnalyticsRollup] Traffic prune failed:', err.message);
  }

  // Yesterday's cached aggregates are now one day stale in a way the TTL
  // cannot see — the window itself moved.
  analyticsCache.clear();

  summary.durationMs = Date.now() - started;
  if (summary.errors.length) {
    const err = new Error(summary.errors.join(' · '));
    err.summary = summary;
    throw err;
  }
  return summary;
};

module.exports = { run };
