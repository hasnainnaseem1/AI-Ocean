/**
 * "What needs a human today."
 *
 * The old Dashboard opened on three counts and two charts — true, and almost
 * never actionable. An operator does not sign in to learn that 8 users exist;
 * they sign in to find out whether anything is on fire. So the first thing on
 * the page is now a prioritised list of conditions that a person has to do
 * something about, each one carrying the number, the threshold it crossed, and
 * a link to the screen where it gets fixed.
 *
 * ── Why a registry rather than one big function ──
 *
 * Each check is independent, each is one question, and later phases add more
 * (SLA breaches need the ticket timing columns from `ANLX-SUPPORT`, churn
 * bands need the snapshots from `ANLX-RETENTION`). A registry means adding one
 * is adding one entry, and means a check that throws — a table that does not
 * exist yet, a service that is mid-migration — removes itself from the list
 * instead of taking the whole Dashboard down with it.
 *
 * ── What is deliberately NOT here ──
 *
 * Nothing in this file decides what "too long" or "too low" means. Every
 * threshold arrives from the resolved `AnalyticsPolicy`; every check reads its
 * own entry in `policy.dashboard.attention`, which is also what switches it on
 * and sets its severity. An operator who thinks four hours is too twitchy for
 * a pending review changes it in one place and this file never knows.
 */
const prisma = require('../../lib/prismaClient');
const { num } = require('./numeric');

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const ago = (ms) => new Date(Date.now() - ms);

/**
 * Every check. `run` returns an item, or null when there is nothing to say —
 * and "nothing to say" is a real answer that keeps the list short enough to
 * be read.
 *
 * An item is: { count, title, detail, metric, threshold, href, since? }
 * `severity` and ordering come from the policy, not from here.
 */
const CHECKS = {
  /* ── Capacity ─────────────────────────────────────────────────────── */

  tiersOutOfStock: {
    label: 'Machine types out of stock',
    run: async () => {
      const rows = await prisma.tier.findMany({
        where: { isActive: true, status: 'out_of_stock' },
        select: { id: true, name: true },
        orderBy: { displayOrder: 'asc' },
        take: 5,
      });
      if (!rows.length) return null;
      return {
        count: rows.length,
        title: `${rows.length} machine ${rows.length === 1 ? 'type is' : 'types are'} out of stock`,
        detail: `Nobody can deploy ${rows.map((r) => r.name).join(', ')} right now.`,
        metric: rows.length,
        threshold: 0,
        href: '/tiers',
      };
    },
  },

  tiersLowStock: {
    label: 'Machine types running low',
    run: async (config) => {
      const minFree = Number(config.minFreePercent) || 25;
      // A tier with capacityTotal = 0 has no declared ceiling — reporting it
      // as 0% free would be an outage that is not happening.
      const rows = await prisma.tier.findMany({
        where: { isActive: true, status: { not: 'out_of_stock' }, capacityTotal: { gt: 0 } },
        select: { name: true, capacityTotal: true, capacityAllocated: true },
      });
      const low = rows
        .map((r) => ({
          name: r.name,
          freePercent: Math.round(((r.capacityTotal - r.capacityAllocated) / r.capacityTotal) * 100),
          free: r.capacityTotal - r.capacityAllocated,
        }))
        .filter((r) => r.freePercent <= minFree)
        .sort((a, b) => a.freePercent - b.freePercent);
      if (!low.length) return null;
      const worst = low[0];
      return {
        count: low.length,
        title: `${low.length} machine ${low.length === 1 ? 'type is' : 'types are'} running low`,
        detail: `${worst.name} has ${worst.free} unit${worst.free === 1 ? '' : 's'} left (${worst.freePercent}% free, flagged at ${minFree}%).`,
        metric: worst.freePercent,
        threshold: minFree,
        href: '/tiers',
      };
    },
  },

  /* ── Money owed ───────────────────────────────────────────────────── */

  debtOverLimit: {
    label: 'Accounts past their credit limit',
    run: async (config, { billingSettings }) => {
      const creditLimit = Number(billingSettings?.payg?.creditLimit) || 50;
      const agg = await prisma.creditWallet.aggregate({
        where: { outstandingBalance: { gt: creditLimit } },
        _count: { _all: true },
        _sum: { outstandingBalance: true },
      });
      const count = agg._count._all;
      if (!count) return null;
      return {
        count,
        title: `${count} account${count === 1 ? '' : 's'} past the credit limit`,
        detail: `USD ${num(agg._sum.outstandingBalance).toFixed(2)} owed above the USD ${creditLimit} limit — new deployments are already blocked for these accounts.`,
        metric: Math.round(num(agg._sum.outstandingBalance)),
        threshold: creditLimit,
        href: '/receivables',
      };
    },
  },

  debtAging: {
    label: 'Debt getting old',
    run: async (config) => {
      const minDays = Number(config.minDays) || 30;
      const cutoff = ago(minDays * DAY_MS);
      const agg = await prisma.creditWallet.aggregate({
        where: { outstandingBalance: { gt: 0 }, debtSince: { lt: cutoff } },
        _count: { _all: true },
        _sum: { outstandingBalance: true },
      });
      const count = agg._count._all;
      if (!count) return null;
      return {
        count,
        title: `${count} account${count === 1 ? '' : 's'} owing for over ${minDays} days`,
        detail: `USD ${num(agg._sum.outstandingBalance).toFixed(2)} has been outstanding longer than ${minDays} days.`,
        metric: count,
        threshold: minDays,
        href: '/receivables',
        since: cutoff,
      };
    },
  },

  /**
   * Accounts in the worst churn band right now.
   *
   * The policy has listed this check since the dashboard was rebuilt and it
   * could not be written — there was no scorer. Like `ticketsBreachingSla`,
   * the registry simply had no entry under the key and the queue ran one check
   * short without saying so.
   *
   * Read from last night's SNAPSHOT rather than scored live, deliberately: the
   * attention queue loads on every dashboard open, and scoring every account
   * on the platform to render one row would make the dashboard pay for a job
   * that has already been done. The list itself scores live; this is the
   * summary, and a few hours old is fine for "go and look".
   */
  churnCritical: {
    label: 'Accounts about to leave',
    run: async (config, { policy }) => {
      const bands = policy?.churn?.bands || [];
      const worst = bands[bands.length - 1]?.key || 'critical';
      const latest = await prisma.churnRiskSnapshot.aggregate({ _max: { day: true } });
      const day = latest._max.day;
      if (!day) return null;                       // no snapshot yet; say nothing

      const count = await prisma.churnRiskSnapshot.count({ where: { day, band: worst } });
      if (!count) return null;
      return {
        count,
        title: `${count} account${count === 1 ? ' is' : 's are'} at critical churn risk`,
        detail: `Scored on ${new Date(day).toISOString().slice(0, 10)}. Open the list to see why each one is flagged — nothing has been sent to them.`,
        metric: count,
        href: '/analytics/churn-risk',
      };
    },
  },

  disputeHolds: {
    label: 'Accounts on dispute hold',
    run: async () => {
      const count = await prisma.team.count({ where: { disputeHold: true, deletedAt: null } });
      if (!count) return null;
      return {
        count,
        title: `${count} account${count === 1 ? ' is' : 's are'} on dispute hold`,
        detail: 'A chargeback is being reviewed. These accounts cannot start anything new until an admin clears the hold.',
        metric: count,
        threshold: 0,
        href: '/teams',
      };
    },
  },

  paymentMethodsFailing: {
    label: 'Cards failing or expired',
    run: async (config, { policy }) => {
      const minFailures = Number(policy?.churn?.thresholds?.autoChargeFailures) || 2;
      const [failing, expired] = await Promise.all([
        prisma.creditWallet.count({ where: { autoChargeFailures: { gte: minFailures } } }),
        prisma.paymentMethod.count({ where: { status: 'expired' } }),
      ]);
      const count = failing + expired;
      if (!count) return null;
      const parts = [];
      if (failing) parts.push(`${failing} account${failing === 1 ? '' : 's'} with ${minFailures}+ failed auto-charges`);
      if (expired) parts.push(`${expired} expired card${expired === 1 ? '' : 's'}`);
      return {
        count,
        title: 'Payments are failing to collect',
        detail: `${parts.join(' and ')} — these turn into debt rather than revenue.`,
        metric: count,
        threshold: minFailures,
        href: '/wallets',
      };
    },
  },

  /* ── Work queues ──────────────────────────────────────────────────── */

  deploymentsAwaitingReview: {
    label: 'Deployments waiting for approval',
    run: async (config) => {
      const minHours = Number(config.minHours) || 4;
      const cutoff = ago(minHours * HOUR_MS);
      const rows = await prisma.deployment.findMany({
        where: { status: 'pending_review', createdAt: { lt: cutoff } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
        take: 1,
      });
      const count = await prisma.deployment.count({
        where: { status: 'pending_review', createdAt: { lt: cutoff } },
      });
      if (!count) return null;
      const oldestHours = rows.length
        ? Math.floor((Date.now() - rows[0].createdAt.getTime()) / HOUR_MS) : minHours;
      return {
        count,
        title: `${count} deployment${count === 1 ? '' : 's'} waiting for review`,
        detail: `The oldest has been waiting ${oldestHours} hours — nothing bills until somebody approves it.`,
        metric: oldestHours,
        threshold: minHours,
        href: '/deployments',
        since: rows[0]?.createdAt || null,
      };
    },
  },

  deploymentsStuckProvisioning: {
    label: 'Deployments stuck provisioning',
    run: async (config) => {
      const minHours = Number(config.minHours) || 2;
      const cutoff = ago(minHours * HOUR_MS);
      const count = await prisma.deployment.count({
        where: { status: 'provisioning', updatedAt: { lt: cutoff } },
      });
      if (!count) return null;
      return {
        count,
        title: `${count} deployment${count === 1 ? ' is' : 's are'} stuck provisioning`,
        detail: `Still not running after ${minHours}+ hours. The customer is waiting and the machine may already be allocated.`,
        metric: count,
        threshold: minHours,
        href: '/deployments',
      };
    },
  },

  shutdownsPending: {
    label: 'Hardware still to switch off',
    run: async () => {
      const count = await prisma.deployment.count({
        where: { endpointShutdownRequired: true, endpointShutdownCompletedAt: null },
      });
      if (!count) return null;
      return {
        count,
        title: `${count} machine${count === 1 ? '' : 's'} still to be switched off`,
        detail: 'Our records closed these off but nobody has confirmed the hardware is actually down — it may still be costing money.',
        metric: count,
        threshold: 0,
        href: '/deployments',
      };
    },
  },

  /**
   * Tickets that have already missed, or are about to miss, what they were
   * promised.
   *
   * The policy has listed this check since the dashboard was rebuilt and it
   * could not be written: nothing recorded when a ticket was first answered or
   * what target it was held to, so the registry simply had no entry under this
   * key and the queue silently ran one check short. It has one now.
   *
   * Graded against the targets STAMPED ON THE TICKET, never today's policy, so
   * tightening a target tomorrow does not fill this list with yesterday's work.
   * A ticket with no stamped target — anything opened before the columns
   * existed — is not counted: it was never promised anything.
   */
  ticketsBreachingSla: {
    label: 'Tickets past their SLA',
    run: async () => {
      const now = new Date();
      const rows = await prisma.$queryRawUnsafe(
        `SELECT
           COUNT(*) FILTER (
             WHERE "sla_first_response_minutes" IS NOT NULL
               AND "first_response_at" IS NULL
               AND "created_at" < $1 - ("sla_first_response_minutes" * INTERVAL '1 minute')
           )::int AS response_late,
           COUNT(*) FILTER (
             WHERE "sla_resolution_minutes" IS NOT NULL
               AND "created_at" < $1 - ("sla_resolution_minutes" * INTERVAL '1 minute')
           )::int AS resolution_late
         FROM "support_tickets"
         WHERE "status" <> 'solved'`,
        now,
      );
      const responseLate = Number(rows[0]?.response_late || 0);
      const resolutionLate = Number(rows[0]?.resolution_late || 0);
      const count = responseLate + resolutionLate;
      if (!count) return null;

      const parts = [];
      if (responseLate) parts.push(`${responseLate} with no reply in time`);
      if (resolutionLate) parts.push(`${resolutionLate} still open past the resolution target`);
      return {
        count,
        title: `${count} ticket${count === 1 ? ' is' : 's are'} past their SLA`,
        detail: `${parts.join(', ')}. Graded against the target each ticket was given when it opened.`,
        metric: count,
        href: '/support-tickets?status=open',
      };
    },
  },

  ticketsUnanswered: {
    label: 'Tickets nobody has replied to',
    run: async (config) => {
      const minHours = Number(config.minHours) || 24;
      const cutoff = ago(minHours * HOUR_MS);
      /*
       * "Unanswered" is a different problem from "unresolved", and the one
       * worth waking up for: a customer who has had no reply at all does not
       * know anyone has seen them.
       *
       * Still derived from the messages rather than from `first_response_at`,
       * even though that column now exists: this check asks about tickets that
       * have had NO reply, and `first_response_at IS NULL` means the same
       * thing one way round while the message test also holds for the rows the
       * back-fill could not reach. One fewer assumption, same answer.
       */
      const count = await prisma.supportTicket.count({
        where: {
          status: { not: 'solved' },
          createdAt: { lt: cutoff },
          messages: { none: { authorType: 'admin' } },
        },
      });
      if (!count) return null;
      return {
        count,
        title: `${count} ticket${count === 1 ? ' has' : 's have'} had no reply`,
        detail: `Open for more than ${minHours} hours with nothing back from support yet.`,
        metric: count,
        threshold: minHours,
        href: '/support-tickets?status=open',
      };
    },
  },

  /* ── The platform itself ──────────────────────────────────────────── */

  jobsFailing: {
    label: 'Scheduled jobs failing',
    run: async () => {
      // Required lazily: the jobs registry is initialised from server.js, and
      // a service that pulls it in at module load would make it a dependency
      // of every script that happens to touch analytics.
      const { getJobStatuses } = require('../../jobs');
      const jobs = getJobStatuses().filter((j) => j.enabled && j.lastStatus === 'failed');
      if (!jobs.length) return null;
      const first = jobs[0];
      return {
        count: jobs.length,
        title: `${jobs.length} scheduled job${jobs.length === 1 ? ' is' : 's are'} failing`,
        detail: `${first.name}: ${first.lastError || 'last run failed'}. Billing, warnings and collection all run on these.`,
        metric: jobs.length,
        threshold: 0,
        href: '/jobs',
        since: first.lastRun || null,
      };
    },
  },
};

/**
 * Run every enabled check, in the order the policy lists them.
 *
 * A check that throws is logged and dropped. The Dashboard is the page an
 * operator opens when something is already wrong; it failing *because*
 * something is wrong is the least useful possible behaviour.
 */
const runAll = async (policy, context = {}) => {
  const configured = policy?.dashboard?.attention || [];

  const results = await Promise.all(configured.map(async (entry) => {
    if (entry.enabled === false) return null;
    const check = CHECKS[entry.key];
    if (!check) return null;              // declared for a later phase
    try {
      const item = await check.run(entry, { policy, ...context });
      return item ? { key: entry.key, severity: entry.severity || 'warning', ...item } : null;
    } catch (err) {
      console.error(`[Analytics] Attention check "${entry.key}" failed:`, err.message);
      return null;
    }
  }));

  return results.filter(Boolean);
};

module.exports = { CHECKS, runAll };
