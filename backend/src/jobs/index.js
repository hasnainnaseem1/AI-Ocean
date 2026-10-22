/**
 * Cron Job Registry
 * 
 * Manages both built-in (system) and custom (DB-stored) scheduled jobs.
 * Called once from server.js after DB connection is established.
 */
const cron = require('node-cron');
const hourlyBilling = require('./hourlyBilling');
const lowBalanceWarning = require('./lowBalanceWarning');
const debtCollection = require('./debtCollection');
const notificationCleanup = require('./notificationCleanup');
const teamSeatFee = require('./teamSeatFee');
const analyticsRollup = require('./analyticsRollup');
const gcpReconciler = require('./gcpReconciler');
const awsReconciler = require('./awsReconciler');
const isolationAudit = require('./isolationAudit');
const regionWorkerWatchdog = require('./regionWorkerWatchdog');
const tierPriceService = require('../services/cloud/tierPriceService');

/* ─── Built-in system jobs ─── */
const systemJobs = {
  hourlyBilling: {
    name: 'Deployment Billing',
    description: 'Charges running deployments for elapsed machine time, charges paused ones for the storage they still hold, and suspends those out of credit',
    /**
     * Every ten minutes, not on the hour.
     *
     * Billing is watermark-based and idempotent, so the interval is purely a
     * question of how long a deployment can keep running past the point its
     * owner's wallet emptied. Every one of those minutes is billed either way —
     * nothing is given away by running less often — but the longer the gap, the
     * more a customer can run up as debt before anything stops them. On the hour
     * that was a full hour of an H100 per exhaustion; at ten minutes it is a
     * sixth of that.
     *
     * The key stays `hourlyBilling` because it is the stored identifier this job
     * is toggled and tracked by; renaming it would orphan its history.
     */
    schedule: '*/10 * * * *',
    scheduleLabel: 'Every 10 minutes',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  lowBalanceWarning: {
    name: 'Low Balance Warnings',
    // Hourly, not daily: the warning is about runway, and a customer with four
    // hours of credit left would be paused long before a once-a-day check ran.
    // The per-customer notification is latched, so this does not mean hourly email.
    description: 'Warns customers whose balance, or whose hours of runway, are running short',
    schedule: '30 * * * *',
    scheduleLabel: 'Every hour',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  debtCollection: {
    name: 'Debt Collection',
    description: 'Attempts to charge saved cards for outstanding balances, warns and eventually '
      + 'terminates deployments whose unpaid storage has run past its grace period, pauses '
      + 'pay-as-you-go deployments for accounts over the debt limit, and warns about expiring cards.',
    /**
     * Hourly, not once a night.
     *
     * At 03:00 daily, a server that was down at 03:00 skipped the whole day —
     * and nothing ever made it up. On one account the job ran on 2 nights out
     * of 28: four scheduled card attempts produced none, eleven grace warnings
     * were never sent, and three deployments were terminated two days late.
     * A deploy or restart at the wrong minute does the same in production.
     *
     * Running hourly does not mean acting hourly. Every decision is "is it due
     * and not yet done" (services/billing/collectionSchedule.js): one card
     * attempt per dunning slot, one grace reminder per day, card-expiry and
     * stale-provisioning notices latched. So the only effect of the extra runs
     * is that a missed hour is made up within the next one.
     *
     * At :45 so it never starts alongside billing (every ten minutes, from :00)
     * or the low-balance check (:30).
     */
    schedule: '45 * * * *',
    scheduleLabel: 'Every hour',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  teamSeatFee: {
    name: 'Team Seat Fees',
    /*
     * Daily, and deliberately not hourly: a
     * seat fee is a share of a calendar day, so a day is the smallest unit it
     * can be charged in. Each day is claimed once on a unique index, so a
     * restart or a manual run in the same day charges nothing twice.
     */
    description: 'Charges each team one day of its monthly seat fee, for the members above the free '
      + 'seats the platform gives away. Whatever the wallet cannot cover becomes debt.',
    schedule: '0 4 * * *',
    scheduleLabel: 'Daily at 4:00 AM',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  analyticsRollup: {
    name: 'Analytics Rollup',
    /*
     * After the seat fee, so the day's money is already written before
     * anything snapshots it. Daily rather than hourly because what it records
     * — a day's capacity — has no smaller unit, and because the pruning half
     * only needs to run often enough to honour a retention measured in days.
     *
     * The heartbeat half is the one that matters: a tier's stock is
     * overwritten in place, so a night missed here is a day of capacity
     * history that cannot be reconstructed afterwards.
     */
    description: 'Snapshots each machine type\'s stock for the day, and prunes analytics history '
      + 'past its retention window. Capacity history cannot be rebuilt later, so a missed run '
      + 'loses that day permanently.',
    schedule: '15 4 * * *',
    scheduleLabel: 'Daily at 4:15 AM',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  gcpReconciler: {
    name: 'Cloud Machine Reconciler',
    description: 'Finds out whether machines asked for on Google Cloud actually came up, starts the '
      + 'billing clock the moment one does, retries what failed transiently, and reports machines '
      + 'that exist with no deployment behind them',
    /**
     * Every minute, which is far more often than anything else here.
     *
     * The interval is not a throughput question — a build takes 30 to 90
     * seconds, and this only polls operations that are open. It is a *money*
     * question in two directions. A machine that came up is already costing the
     * platform, and the compute clock cannot start until this job notices; the
     * charge is back-dated to GCP's own timestamp so nothing is lost, but a
     * customer whose wallet is empty keeps running until a billing pass sees a
     * clock that exists. And a build that failed leaves a customer watching a
     * spinner.
     *
     * Every pass is "due and not yet done", so running often costs one indexed
     * query when there is nothing to do.
     */
    schedule: '* * * * *',
    scheduleLabel: 'Every minute',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  tierPriceRefresh: {
    name: 'Tier Price Refresh',
    description: 'Works out what every tier costs on each cloud in each region — the machine, '
      + "that region's standing cost, overhead and tax — and keeps each price in step with it",
    /**
     * Hourly, matching how long the providers' own price caches hold.
     *
     * This is what makes the margin guard a backstop rather than a daily
     * obstruction: if the matrix tracks what the clouds charge, a price can
     * only fall below its floor in the gap between one pass and the next.
     * Running it more often would re-ask providers for figures that move on
     * the order of months; running it less leaves that gap open for longer.
     */
    schedule: '15 * * * *',
    scheduleLabel: 'Hourly',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  awsReconciler: {
    name: 'AWS Machine Reconciler',
    description: 'Finds out whether machines asked for on AWS actually came up, starts the '
      + 'billing clock the moment one does, and retries what failed transiently',
    /**
     * Every minute, like its Google counterpart, and for the same reason: this
     * is where the money clock starts.
     *
     * The interval is not about throughput — it only polls instances with an
     * open question. It is about two directions of loss. A machine that came
     * up is already costing this platform, and the meter cannot start until
     * this job notices; the charge is back-dated to AWS's own `launchTime` so
     * nothing is given away, but a build that *failed* leaves a customer
     * watching a spinner until a pass sees it.
     */
    schedule: '* * * * *',
    scheduleLabel: 'Every minute',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  awsOrphanSweep: {
    name: 'AWS Orphan Sweep',
    description: 'Finds machines on AWS that this platform created and can no longer account for — '
      + 'they bill by the hour with nobody being charged for them',
    /**
     * Every fifteen minutes, not every minute like the Google reconciler.
     *
     * That job runs every minute because it also starts the billing clock, and
     * every minute of delay there is money. This one only *records* — it polls
     * no operations and starts no clock, so the cost of finding an orphan five
     * minutes later is five minutes of a bill that is already running either
     * way. What it does cost is API calls: the sweep asks every configured
     * region, so a minute-by-minute schedule would be one call per region per
     * minute, forever, to answer a question whose answer almost never changes.
     *
     * Status polling and the billing clock run separately, every minute, as
     * `awsReconciler` above — that is where lateness costs money.
     */
    schedule: '*/15 * * * *',
    scheduleLabel: 'Every 15 minutes',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  isolationAudit: {
    name: 'Customer Isolation Audit',
    description: 'Asks AWS whether each built region is still isolating customer machines from '
      + 'each other, and stops placing customers in one that is not',
    /**
     * Every thirty minutes.
     *
     * The thing this watches for is a change that produces NO other symptom:
     * one word in one network ACL rule, after which every customer machine in
     * a region can reach every other. Nothing is created, no bill moves, no
     * error is raised. The only way it is ever noticed is by asking.
     *
     * Thirty minutes is the window in which that could be true without anyone
     * knowing, and it is chosen against the cost of asking: two API calls per
     * built region per run, which at three regions is trivial. A daily audit
     * would make that window a day; a per-minute one would buy little, because
     * the realistic causes (a leaked credential, a console edit, a careless
     * script) are not things that resolve on their own in under half an hour.
     *
     * The build worker runs the same check on every apply, so this one exists
     * entirely for what happens AFTERWARDS.
     */
    schedule: '*/30 * * * *',
    scheduleLabel: 'Every 30 minutes',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  regionWorkerWatchdog: {
    name: 'Region Build Worker Watchdog',
    description: 'Notices when the region build worker has stopped while customer orders are '
      + 'waiting for a region, and tells the admins by notification and email',
    /**
     * Every five minutes.
     *
     * The worker is a separate process the API deliberately cannot inspect —
     * that separation is what keeps a network-admin credential out of the API
     * — so the only way to know it has died is that its heartbeat went quiet.
     *
     * Five minutes against a heartbeat considered stale after five: an outage
     * is reported within about ten minutes, which is inside the half hour a
     * customer is told a region takes. Alerting faster would catch a worker
     * mid-apply and call it dead; slower and the customer notices before we do.
     *
     * The alert is latched, so one outage is one email rather than one every
     * five minutes until somebody wakes up.
     */
    schedule: '*/5 * * * *',
    scheduleLabel: 'Every 5 minutes',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
  notificationCleanup: {
    name: 'Notification Cleanup',
    // Expiry is enforced by this job rather than by the database, which has no
    // Postgres equivalent — see the migration plan.
    description: 'Deletes notifications past their expiresAt',
    schedule: '0 4 * * *',
    scheduleLabel: 'Daily at 4:00 AM',
    system: true,
    enabled: true,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  },
};

const systemRunners = {
  hourlyBilling: hourlyBilling.run,
  lowBalanceWarning: lowBalanceWarning.run,
  debtCollection: debtCollection.run,
  notificationCleanup: notificationCleanup.run,
  teamSeatFee: teamSeatFee.run,
  analyticsRollup: analyticsRollup.run,
  gcpReconciler: gcpReconciler.run,
  tierPriceRefresh: tierPriceService.refreshAll,
  awsReconciler: awsReconciler.pollPending,
  awsOrphanSweep: awsReconciler.runOnce,
  isolationAudit: isolationAudit.run,
  regionWorkerWatchdog: regionWorkerWatchdog.run,
};

/* ─── Custom jobs (loaded from DB at init, keyed by DB _id) ─── */
const customJobs = {}; // key → { ...meta, task }

/* ─── Helpers ─── */
const buildCustomRunner = (job) => {
  /* ── HTTP Request ── */
  if (job.actionType === 'http') {
    return async () => {
      const url = job.httpConfig?.url;
      if (!url) throw new Error('HTTP URL not configured');
      const opts = {
        method: job.httpConfig.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(job.httpConfig.headers || {}) },
      };
      if (['POST', 'PUT'].includes(opts.method) && job.httpConfig.body) {
        opts.body = job.httpConfig.body;
      }
      const res = await fetch(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    };
  }

  /* ── Email ── */
  if (job.actionType === 'email') {
    return async () => {
      const cfg = job.emailConfig;
      if (!cfg?.to) throw new Error('Email recipients not configured');
      if (!cfg?.subject) throw new Error('Email subject not configured');
      const emailService = require('../services/email/emailService');
      await emailService.sendEmail({
        to: cfg.to, // comma-separated is fine for nodemailer
        subject: cfg.subject,
        html: cfg.body || '<p>Scheduled email from cron job</p>',
      });
      console.log(`[CUSTOM-CRON] Email sent to ${cfg.to}`);
    };
  }

  /* ── Database Cleanup ── */
  if (job.actionType === 'cleanup') {
    return async () => {
      const cfg = job.cleanupConfig;
      const target = cfg?.target || 'activityLogs';
      const days = cfg?.olderThanDays || 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      let deleted = 0;

      if (target === 'activityLogs') {
        const activityLogService = require('../services/admin/activityLogService');
        deleted = await activityLogService.deleteOlderThan(cutoff);
      } else if (target === 'notifications') {
        const notificationService = require('../services/notification/notificationService');
        deleted = await notificationService.deleteOlderThan(cutoff);
      } else if (target === 'unverifiedUsers') {
        const userService = require('../services/user/userService');
        deleted = await userService.deleteUnverifiedOlderThan(cutoff);
      } else if (target === 'expiredSessions') {
        // Clean expired password-reset tokens and verification tokens
        const userService = require('../services/user/userService');
        deleted = await userService.clearExpiredPasswordResets(new Date());
      } else if (target === 'failedJobs') {
        const cronJobService = require('../services/admin/cronJobService');
        deleted = await cronJobService.clearFailedStatus();
      }
      console.log(`[CUSTOM-CRON] Cleanup "${target}": removed/cleaned ${deleted} records older than ${days} days`);
    };
  }

  /* ── In-App Notification ── */
  if (job.actionType === 'notification') {
    return async () => {
      const cfg = job.notificationConfig;
      if (!cfg?.title) throw new Error('Notification title not configured');
      const notificationService = require('../services/notification/notificationService');
      const userService = require('../services/user/userService');

      // Find all admin users to send notification to
      const admins = await userService.listAdmins();
      if (!admins.length) throw new Error('No admin users found');

      const docs = admins.map((admin) => ({
        recipientId: admin.id,
        recipientType: 'admin',
        type: cfg.notificationType || 'system_alert',
        title: cfg.title,
        message: cfg.message || cfg.title,
        priority: 'medium',
      }));
      await notificationService.createMany(docs);
      console.log(`[CUSTOM-CRON] Notification "${cfg.title}" sent to ${admins.length} admin(s)`);
    };
  }

  /* ── Database Backup ── */
  if (job.actionType === 'backup') {
    return async () => {
      const fs = require('fs');
      const path = require('path');
      const prisma = require('../lib/prismaClient');
      const cfg = job.backupConfig;
      // Admin-configured table names, matching Prisma's model names (case-insensitive).
      // Kept as a fixed allowlist rather than dynamic lookup, so a typo in the
      // admin UI fails one table with a clear log line instead of throwing.
      const TABLE_MAP = {
        users: 'user', customroles: 'customRole',
        activitylogs: 'activityLog', adminsettings: 'adminSettings',
        blogposts: 'blogPost', marketingpages: 'marketingPage',
        customernotes: 'customerNote', departments: 'department',
        seoredirects: 'seoRedirect', questiontemplates: 'questionTemplate',
        cronjobs: 'cronJob', recommendationpolicies: 'recommendationPolicy',
        deploymentjourneys: 'deploymentJourney', notifications: 'notification',
        usecasetags: 'useCaseTag', tiercategories: 'tierCategory',
        resourcecomponents: 'resourceComponent', tiers: 'tier', aimodels: 'aIModel',
        creditwallets: 'creditWallet', credittransactions: 'creditTransaction',
        paymentmethods: 'paymentMethod', payments: 'payment',
        deployments: 'deployment', deploymentusages: 'deploymentUsage',
      };
      const collections = cfg?.collections?.length ? cfg.collections : ['users', 'activitylogs'];
      const outputDir = path.resolve(cfg?.outputDir || 'backups');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const batchDir = path.join(outputDir, `backup-${timestamp}`);

      // Ensure output directory exists
      fs.mkdirSync(batchDir, { recursive: true });

      for (const collName of collections) {
        const modelKey = TABLE_MAP[String(collName).toLowerCase()];
        if (!modelKey || !prisma[modelKey]) {
          console.error(`[CUSTOM-CRON] Backup: unknown table "${collName}" — skipped`);
          continue;
        }
        try {
          const docs = await prisma[modelKey].findMany();
          const filePath = path.join(batchDir, `${collName}.json`);
          fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
          console.log(`[CUSTOM-CRON] Backup: ${collName} → ${docs.length} rows exported`);
        } catch (err) {
          console.error(`[CUSTOM-CRON] Backup: failed to export "${collName}" — ${err.message}`);
        }
      }
      console.log(`[CUSTOM-CRON] Backup complete → ${batchDir}`);
    };
  }

  // default: log
  return async () => {
    console.log(`[CUSTOM-CRON] ${job.logMessage || 'Custom job executed'}`);
  };
};

const scheduleTask = (key, job, runner) => {
  if (job.task) { job.task.stop(); job.task = null; }
  if (!cron.validate(job.schedule)) {
    console.error(`[CRON] Invalid schedule for ${key}: ${job.schedule}`);
    return;
  }
  job.task = cron.schedule(job.schedule, async () => {
    if (!job.enabled) return;
    console.log(`[CRON] Running ${job.name}...`);
    try {
      await runner();
      job.lastRun = new Date();
      job.lastStatus = 'success';
      job.lastError = null;
      job.runCount++;
      // Persist stats for custom jobs
      if (!job.system) persistStats(key, job);
    } catch (err) {
      job.lastRun = new Date();
      job.lastStatus = 'error';
      job.lastError = err.message;
      console.error(`[CRON] ${job.name} error:`, err.message);
      if (!job.system) persistStats(key, job);
    }
  });
};

const persistStats = async (key, job) => {
  try {
    const cronJobService = require('../services/admin/cronJobService');
    await cronJobService.recordRun(key, {
      lastRun: job.lastRun, lastStatus: job.lastStatus, lastError: job.lastError, runCount: job.runCount,
    });
  } catch { /* best-effort */ }
};

/* ─── Initialization ─── */
const initializeJobs = async () => {
  console.log('⏰ Initializing scheduled jobs...');

  // 1. Start system jobs
  Object.keys(systemJobs).forEach((key) => {
    scheduleTask(key, systemJobs[key], systemRunners[key]);
  });

  // 2. Load & start custom jobs from DB
  try {
    const cronJobService = require('../services/admin/cronJobService');
    const dbJobs = await cronJobService.list();
    for (const doc of dbJobs) {
      const entry = {
        name: doc.name,
        description: doc.description,
        schedule: doc.schedule,
        scheduleLabel: doc.scheduleLabel,
        actionType: doc.actionType,
        httpConfig: doc.httpConfig,
        logMessage: doc.logMessage,
        emailConfig: doc.emailConfig,
        cleanupConfig: doc.cleanupConfig,
        notificationConfig: doc.notificationConfig,
        backupConfig: doc.backupConfig,
        system: false,
        enabled: doc.enabled,
        lastRun: doc.lastRun || null,
        lastStatus: doc.lastStatus || null,
        lastError: doc.lastError || null,
        runCount: doc.runCount || 0,
        task: null,
      };
      customJobs[doc.key] = entry;
      if (entry.enabled) scheduleTask(doc.key, entry, buildCustomRunner(doc));
    }
    if (dbJobs.length) console.log(`   • ${dbJobs.length} custom job(s) loaded from DB`);
  } catch (err) {
    console.error('[CRON] Error loading custom jobs:', err.message);
  }

  // Printed from the job table itself. This used to be a hand-written list,
  // and it went on announcing "Debt collection — daily at 3 AM" and "billing
  // every hour" after both had changed — the one place an operator reads to
  // check a schedule was the one place guaranteed to be out of date.
  console.log('✅ Scheduled jobs initialized:');
  Object.values(systemJobs).forEach((job) => {
    console.log(`   • ${job.name} — ${job.scheduleLabel}`);
  });
};

/* ─── API methods ─── */

/** Get status of ALL jobs (system + custom) */
const getJobStatuses = () => {
  const list = [];
  // System
  Object.entries(systemJobs).forEach(([key, job]) => {
    list.push({
      key, name: job.name, description: job.description,
      schedule: job.schedule, scheduleLabel: job.scheduleLabel,
      enabled: job.enabled, lastRun: job.lastRun,
      lastStatus: job.lastStatus, lastError: job.lastError,
      runCount: job.runCount, system: true,
    });
  });
  // Custom
  Object.entries(customJobs).forEach(([key, job]) => {
    list.push({
      key, name: job.name, description: job.description,
      schedule: job.schedule, scheduleLabel: job.scheduleLabel,
      actionType: job.actionType,
      httpConfig: job.httpConfig,
      logMessage: job.logMessage,
      emailConfig: job.emailConfig,
      cleanupConfig: job.cleanupConfig,
      notificationConfig: job.notificationConfig,
      backupConfig: job.backupConfig,
      enabled: job.enabled, lastRun: job.lastRun,
      lastStatus: job.lastStatus, lastError: job.lastError,
      runCount: job.runCount, system: false,
    });
  });
  return list;
};

/** Toggle a job on/off */
const toggleJob = (key) => {
  const job = systemJobs[key] || customJobs[key];
  if (!job) return null;
  job.enabled = !job.enabled;
  // Persist for custom
  if (!job.system) {
    const cronJobService = require('../services/admin/cronJobService');
    cronJobService.setEnabled(key, job.enabled).catch(() => {});
  }
  return { key, enabled: job.enabled };
};

/** Manually trigger a job */
const triggerJob = async (key) => {
  const sysJob = systemJobs[key];
  const cusJob = customJobs[key];
  const job = sysJob || cusJob;
  if (!job) throw new Error(`Unknown job: ${key}`);

  const runner = sysJob ? systemRunners[key] : buildCustomRunner(cusJob);
  console.log(`[CRON] Manual trigger: ${job.name}`);
  try {
    await runner();
    job.lastRun = new Date();
    job.lastStatus = 'success';
    job.lastError = null;
    job.runCount++;
    if (!job.system) persistStats(key, job);
    return { success: true, lastRun: job.lastRun };
  } catch (err) {
    job.lastRun = new Date();
    job.lastStatus = 'error';
    job.lastError = err.message;
    if (!job.system) persistStats(key, job);
    throw err;
  }
};

/** Create a new custom job (from admin API) */
const createCustomJob = (doc) => {
  const entry = {
    name: doc.name,
    description: doc.description,
    schedule: doc.schedule,
    scheduleLabel: doc.scheduleLabel,
    actionType: doc.actionType,
    httpConfig: doc.httpConfig,
    logMessage: doc.logMessage,
    emailConfig: doc.emailConfig,
    cleanupConfig: doc.cleanupConfig,
    notificationConfig: doc.notificationConfig,
    backupConfig: doc.backupConfig,
    system: false,
    enabled: doc.enabled !== false,
    lastRun: null,
    lastStatus: null,
    lastError: null,
    runCount: 0,
    task: null,
  };
  customJobs[doc.key] = entry;
  if (entry.enabled) scheduleTask(doc.key, entry, buildCustomRunner(doc));
};

/** Update an existing custom job (reschedule) */
const updateCustomJob = (doc) => {
  const existing = customJobs[doc.key];
  if (existing && existing.task) { existing.task.stop(); existing.task = null; }
  const entry = {
    name: doc.name,
    description: doc.description,
    schedule: doc.schedule,
    scheduleLabel: doc.scheduleLabel,
    actionType: doc.actionType,
    httpConfig: doc.httpConfig,
    logMessage: doc.logMessage,
    emailConfig: doc.emailConfig,
    cleanupConfig: doc.cleanupConfig,
    notificationConfig: doc.notificationConfig,
    backupConfig: doc.backupConfig,
    system: false,
    enabled: doc.enabled !== false,
    lastRun: existing?.lastRun || null,
    lastStatus: existing?.lastStatus || null,
    lastError: existing?.lastError || null,
    runCount: existing?.runCount || 0,
    task: null,
  };
  customJobs[doc.key] = entry;
  if (entry.enabled) scheduleTask(doc.key, entry, buildCustomRunner(doc));
};

/** Delete a custom job */
const deleteCustomJob = (key) => {
  const job = customJobs[key];
  if (!job) return false;
  if (job.task) job.task.stop();
  delete customJobs[key];
  return true;
};

module.exports = {
  initializeJobs,
  getJobStatuses,
  toggleJob,
  triggerJob,
  createCustomJob,
  updateCustomJob,
  deleteCustomJob,
};
