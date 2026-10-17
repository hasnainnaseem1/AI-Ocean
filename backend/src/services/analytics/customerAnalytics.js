/**
 * Who the customers are, how many of them become real customers, and what
 * organizations do once they exist.
 *
 * ── The distinction this module is built around ──
 *
 * A **user** is a person with a password. An **account** is a `Team` — the
 * thing that owns a wallet, a card, a deployment and a debt. They are not
 * interchangeable, and almost every wrong customer number on this platform has
 * come from treating them as if they were:
 *
 *  • Signup, email verification and login are USER events. There is no such
 *    thing as "an organization signed up".
 *  • Money, usage, seats and churn are ACCOUNT facts. An organization with
 *    nine developers is one customer, not nine.
 *
 * So the funnel below counts people, the mix and engagement views count
 * accounts, and every response says which it is. Nothing here reports a figure
 * that silently mixes the two.
 *
 * ── Right-censoring, said out loud ──
 *
 * An activation funnel over "the last 30 days" includes somebody who signed up
 * four hours ago. They have not failed to deploy; they have not had time to.
 * Every funnel response therefore carries the cohort's own age and a
 * `maturity` block, and the page prints it. A funnel that quietly counts youth
 * as drop-off is worse than no funnel, because it reads as a product problem
 * and sends somebody to fix a conversion rate that was never broken.
 *
 * ── Where the data comes from ──
 *
 * Nothing new is recorded for this phase. Signups are `users.created_at`,
 * seats are the daily `TeamSeatCharge` snapshot the seat-fee job already
 * writes, member arrivals and departures are `TeamActivity` rows the team
 * service already records, and logins are `activity_logs` rows with
 * `user_role = 'customer'`. The one thing genuinely missing — *when* an email
 * was verified, as opposed to whether it is — is called out as a caveat rather
 * than estimated.
 */
const prisma = require('../../lib/prismaClient');
const { bucketExpr, fillSeries, describe } = require('./timeWindow');
const {
  num, round2, pct, deltaPct, withShare,
} = require('./numeric');
const { bucketFor } = require('./analyticsPolicyDefaults');

const DAY_MS = 86400000;

/**
 * Last-activity expressions, keyed by the signal names the policy uses.
 *
 * A closed map, deliberately. `policy.engagement.activitySignals` is operator
 * input, and the only thing taken from it is which of THESE keys to use — the
 * SQL itself is never built from a policy string. An unknown signal is ignored
 * rather than interpolated.
 *
 * `login` reaches an account through its members, which means a person who
 * belongs to two organizations marks both as active. That is a real limit, not
 * a bug we can fix: a sign-in happens to a person, not to an account, and the
 * session carries no team. An operator who would rather not have it counted
 * removes `login` from `activitySignals`.
 */
const LAST_ACTIVITY_SQL = {
  usage: 'SELECT MAX(du."created_at") FROM "deployment_usages" du WHERE du."team_id" = t.id',
  payment: 'SELECT MAX(ct."created_at") FROM "credit_transactions" ct WHERE ct."team_id" = t.id',
  deployment: 'SELECT MAX(d."created_at") FROM "deployments" d WHERE d."team_id" = t.id',
  login: `SELECT MAX(us."last_login") FROM "team_members" tm
            JOIN "users" us ON us.id = tm."user_id" WHERE tm."team_id" = t.id`,
};

/** Per-bucket activity events, by account. Same signal set as above. */
const ACTIVITY_EVENT_SQL = {
  usage: 'SELECT du."team_id" AS team_id, du."created_at" AS at FROM "deployment_usages" du WHERE du."created_at" >= $1 AND du."created_at" <= $2',
  payment: 'SELECT ct."team_id", ct."created_at" FROM "credit_transactions" ct WHERE ct."created_at" >= $1 AND ct."created_at" <= $2',
  deployment: 'SELECT d."team_id", d."created_at" FROM "deployments" d WHERE d."created_at" >= $1 AND d."created_at" <= $2',
  login: `SELECT tm."team_id", al."created_at" FROM "activity_logs" al
            JOIN "team_members" tm ON tm."user_id" = al."user_id"
            WHERE al."user_role" = 'customer' AND al."created_at" >= $1 AND al."created_at" <= $2`,
};

const signalsFrom = (policy, map) => {
  const wanted = policy?.engagement?.activitySignals || Object.keys(map);
  const used = wanted.filter((s) => map[s]);
  // Never return an empty signal set — that would report every account dormant
  // because of a policy typo, which looks exactly like a real collapse.
  return used.length ? used : Object.keys(map);
};

/** How confident a rate is allowed to sound, given how many accounts it rests on. */
const sampleNote = (n, policy) => {
  const min = Number(policy?.customers?.minSampleForRates) || 10;
  return num(n) >= min
    ? null
    : `Only ${num(n)} in this window — read the counts, not the percentages.`;
};

/* ── Headline ─────────────────────────────────────────────────────────── */

const getSummary = async (window, policy) => {
  const [
    signupRows, prevSignupRows, totals, teamRows, prevTeamRows,
    memberRows, paygRows, seatRow,
  ] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS signups,
              COUNT(*) FILTER (WHERE "is_email_verified")::int AS verified,
              COUNT(*) FILTER (WHERE "google_id" IS NOT NULL)::int AS via_google,
              COUNT(*) FILTER (WHERE "team_onboarding_pending")::int AS onboarding_stuck
       FROM "users"
       WHERE "account_type" = 'customer' AND "created_at" >= $1 AND "created_at" <= $2`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS signups
       FROM "users"
       WHERE "account_type" = 'customer' AND "created_at" >= $1 AND "created_at" <= $2`,
      window.prevFrom, window.prevTo,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS all_users,
              COUNT(*) FILTER (WHERE "status" = 'active')::int AS active_users,
              COUNT(*) FILTER (WHERE "status" = 'pending_verification')::int AS unverified,
              COUNT(*) FILTER (WHERE "status" IN ('suspended','banned'))::int AS blocked
       FROM "users" WHERE "account_type" = 'customer'`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT "kind"::text AS kind,
              COUNT(*)::int AS accounts,
              COUNT(*) FILTER (WHERE "created_at" >= $1 AND "created_at" <= $2)::int AS created_in_window
       FROM "teams" WHERE "deleted_at" IS NULL GROUP BY 1`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS orgs
       FROM "teams"
       WHERE "kind" = 'team' AND "created_at" >= $1 AND "created_at" <= $2`,
      window.prevFrom, window.prevTo,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS memberships,
              COUNT(DISTINCT tm."user_id")::int AS people
       FROM "team_members" tm
       JOIN "teams" t ON t.id = tm."team_id"
       WHERE t."kind" = 'team' AND t."deleted_at" IS NULL`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*) FILTER (WHERE "payg_access" = 'allowed')::int AS allowed,
              COUNT(*) FILTER (WHERE "payg_access" = 'blocked')::int AS blocked,
              COUNT(*) FILTER (WHERE "payg_access" = 'default')::int AS follows_platform
       FROM "teams" WHERE "deleted_at" IS NULL`,
    ),
    prisma.teamSeatCharge.aggregate({
      where: { day: { gte: window.from, lte: window.to } },
      _sum: { seats: true, freeSeats: true },
      _count: { _all: true },
    }),
  ]);

  const signups = signupRows[0] || {};
  const byKind = {};
  for (const row of teamRows) byKind[row.kind] = row;
  const orgs = byKind.team || { accounts: 0, created_in_window: 0 };
  const personal = byKind.personal || { accounts: 0, created_in_window: 0 };
  const members = memberRows[0] || {};

  // Average over the days the seat job actually ran, not over calendar days —
  // a job that was off for a week must not halve the headcount it reports.
  const seatDays = seatRow._count._all || 0;
  const avgSeats = seatDays ? num(seatRow._sum.seats) / seatDays : null;

  return {
    signups: {
      count: num(signups.signups),
      verified: num(signups.verified),
      verifiedPercent: pct(signups.verified, signups.signups),
      viaGoogle: num(signups.via_google),
      viaPassword: num(signups.signups) - num(signups.via_google),
      // Chose "my company" at signup and never finished creating it. A real
      // leak: these people are stuck on a screen, not undecided.
      onboardingUnfinished: num(signups.onboarding_stuck),
      delta: deltaPct(num(signups.signups), num(prevSignupRows[0]?.signups)),
      sampleNote: sampleNote(signups.signups, policy),
    },
    customers: {
      total: num(totals[0]?.all_users),
      active: num(totals[0]?.active_users),
      awaitingVerification: num(totals[0]?.unverified),
      suspendedOrBanned: num(totals[0]?.blocked),
    },
    accounts: {
      personal: num(personal.accounts),
      organizations: num(orgs.accounts),
      newPersonal: num(personal.created_in_window),
      newOrganizations: num(orgs.created_in_window),
      organizationSharePercent: pct(orgs.accounts, num(orgs.accounts) + num(personal.accounts)),
      newOrganizationsDelta: deltaPct(num(orgs.created_in_window), num(prevTeamRows[0]?.orgs)),
    },
    organizations: {
      memberships: num(members.memberships),
      distinctPeople: num(members.people),
      averageSize: orgs.accounts ? round2(num(members.memberships) / num(orgs.accounts)) : 0,
      // Seats the platform charged for, averaged over the days it charged.
      averageBilledSeats: avgSeats === null ? null : round2(avgSeats),
      seatSnapshotDays: seatDays,
    },
    paygAccess: paygRows[0] || {},
    window: describe(window),
  };
};

/* ── Signups over time ───────────────────────────────────────────────── */

const getSignupTrend = async (window) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${bucketExpr(window.granularity, 'u."created_at"', window.timezone)} AS bucket,
            COUNT(*)::int AS signups,
            COUNT(*) FILTER (WHERE u."is_email_verified")::int AS verified,
            COUNT(*) FILTER (WHERE u."google_id" IS NOT NULL)::int AS via_google,
            COUNT(*) FILTER (WHERE u."google_id" IS NULL)::int AS via_password
     FROM "users" u
     WHERE u."account_type" = 'customer' AND u."created_at" >= $1 AND u."created_at" <= $2
     GROUP BY 1`,
    window.from, window.to,
  );

  const accountRows = await prisma.$queryRawUnsafe(
    `SELECT ${bucketExpr(window.granularity, 't."created_at"', window.timezone)} AS bucket,
            COUNT(*) FILTER (WHERE t."kind" = 'personal')::int AS personal,
            COUNT(*) FILTER (WHERE t."kind" = 'team')::int AS organizations
     FROM "teams" t
     WHERE t."deleted_at" IS NULL AND t."created_at" >= $1 AND t."created_at" <= $2
     GROUP BY 1`,
    window.from, window.to,
  );

  return {
    signups: fillSeries(rows, window, {
      fields: {
        signups: 0, verified: 0, via_google: 0, via_password: 0,
      },
    }).map((p) => ({
      bucket: p.bucket,
      signups: p.signups,
      verified: p.verified,
      viaGoogle: p.via_google,
      viaPassword: p.via_password,
    })),
    accountsCreated: fillSeries(accountRows, window, {
      fields: { personal: 0, organizations: 0 },
    }),
    /*
     * `verified` is counted from the flag on the row, not from a timestamp:
     * the schema records WHETHER an email is verified, never WHEN. So a
     * customer who signed up on the 1st and verified on the 9th counts as
     * verified on the 1st, and this series cannot show how long verification
     * takes. Said here rather than quietly implied.
     */
    caveat: 'Verification is counted on the signup date — the platform does not record when an email was verified.',
    window: describe(window),
  };
};

/* ── Activation funnel ───────────────────────────────────────────────── */

const getActivation = async (window, policy) => {
  const rows = await prisma.$queryRawUnsafe(
    `WITH cohort AS (
       SELECT u.id, u."created_at", u."is_email_verified"
       FROM "users" u
       WHERE u."account_type" = 'customer'
         AND u."created_at" >= $1 AND u."created_at" <= $2
     ),
     stages AS (
       SELECT c.id,
              c."created_at",
              c."is_email_verified" AS verified,
              d.first_request,
              d.first_running,
              b.first_billed,
              f.first_funded
       FROM cohort c
       LEFT JOIN LATERAL (
         SELECT MIN(dd."created_at") AS first_request,
                MIN(dd."started_at") AS first_running
         FROM "deployments" dd WHERE dd."user_id" = c.id
       ) d ON TRUE
       LEFT JOIN LATERAL (
         SELECT MIN(du."created_at") AS first_billed
         FROM "deployment_usages" du WHERE du."user_id" = c.id
       ) b ON TRUE
       LEFT JOIN LATERAL (
         SELECT MIN(ct."created_at") AS first_funded
         FROM "credit_transactions" ct
         JOIN "team_members" tm ON tm."team_id" = ct."team_id"
         WHERE tm."user_id" = c.id AND ct."type" IN ('topup','bonus','signup_credit')
       ) f ON TRUE
     )
     SELECT COUNT(*)::int AS signed_up,
            COUNT(*) FILTER (WHERE verified)::int AS verified,
            COUNT(*) FILTER (WHERE verified AND first_request IS NOT NULL)::int AS requested,
            COUNT(*) FILTER (WHERE verified AND first_running IS NOT NULL)::int AS running,
            COUNT(*) FILTER (WHERE verified AND first_running IS NOT NULL AND first_billed IS NOT NULL)::int AS billed,
            COUNT(*) FILTER (WHERE first_funded IS NOT NULL)::int AS funded_wallet,
            (percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (first_request - "created_at")) / 3600)
             )::float AS median_hours_to_request,
            (percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (first_running - "created_at")) / 3600)
             )::float AS median_hours_to_running,
            (percentile_cont(0.9) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (first_running - "created_at")) / 3600)
             )::float AS p90_hours_to_running,
            (percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (first_funded - "created_at")) / 3600)
             )::float AS median_hours_to_funding,
            -- Stage-to-stage, for the funnel itself: how long the step from
            -- the PREVIOUS stage took, which is a different question from how
            -- long it took since signing up.
            (percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (first_running - first_request)) / 60)
             )::float AS minutes_request_to_running,
            (percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (first_billed - first_running)) / 60)
             )::float AS minutes_running_to_billed,
            MIN("created_at") AS oldest_signup,
            MAX("created_at") AS newest_signup,
            COUNT(*) FILTER (WHERE "created_at" > $3)::int AS too_young
     FROM stages`,
    window.from, window.to,
    new Date(window.to.getTime() - (Number(policy?.customers?.activationMaturityDays) || 7) * DAY_MS),
  );

  const r = rows[0] || {};
  const configured = (policy?.customers?.activationStages
    || [{ key: 'signedUp' }, { key: 'verified' }, { key: 'requested' }, { key: 'running' }, { key: 'billed' }])
    .filter((s) => s.enabled !== false);

  const counts = {
    signedUp: num(r.signed_up),
    verified: num(r.verified),
    requested: num(r.requested),
    running: num(r.running),
    billed: num(r.billed),
  };

  /*
   * Emitted in the shape `FunnelChart` already consumes — `stage`, `count`,
   * `conversionFromPrev`, `medianMinutesFromPrev` — the same contract the
   * deployment lifecycle funnel uses. Two funnels with two field vocabularies
   * would mean either two components or an adapter in the page; one contract
   * means neither.
   *
   * `medianMinutesFromPrev` is only filled in where the gap really is measured
   * from the previous stage. Email verification has no timestamp anywhere in
   * the schema — only a boolean — so the step into and out of it is left null
   * rather than filled with the time since signup, which would be a different
   * measurement wearing this one's label.
   */
  const INTER_STAGE_MINUTES = {
    running: r.minutes_request_to_running,
    billed: r.minutes_running_to_billed,
  };

  const top = counts.signedUp;
  let previous = null;
  const stages = configured.map((stage) => {
    const count = num(counts[stage.key]);
    const gap = INTER_STAGE_MINUTES[stage.key];
    const row = {
      key: stage.key,
      stage: stage.label || stage.key,
      count,
      // Share of the whole cohort, and of the stage immediately before — the
      // second is the one that localises where people are actually lost.
      percentOfCohort: pct(count, top),
      conversionFromPrev: previous === null ? null : pct(count, previous),
      lostFromPrevious: previous === null ? null : Math.max(0, previous - count),
      medianMinutesFromPrev: gap === null || gap === undefined ? null : Math.round(gap),
    };
    previous = count;
    return row;
  });

  const maturityDays = Number(policy?.customers?.activationMaturityDays) || 7;
  const tooYoung = num(r.too_young);

  return {
    stages,
    // Not a funnel stage: a PAYG account can run a machine without ever
    // topping up, so funding is a parallel fact, not a gate.
    fundedWallet: num(r.funded_wallet),
    fundedPercent: pct(r.funded_wallet, top),
    timings: {
      medianHoursToRequest: r.median_hours_to_request === null ? null : round2(r.median_hours_to_request),
      medianHoursToRunning: r.median_hours_to_running === null ? null : round2(r.median_hours_to_running),
      p90HoursToRunning: r.p90_hours_to_running === null ? null : round2(r.p90_hours_to_running),
      medianHoursToFunding: r.median_hours_to_funding === null ? null : round2(r.median_hours_to_funding),
    },
    /*
     * The honesty block. `tooYoung` is how many of this cohort have not yet
     * had `maturityDays` to finish, so the page can say "x of these signed up
     * too recently to have deployed" instead of presenting their absence as a
     * conversion failure.
     */
    maturity: {
      maturityDays,
      tooYoung,
      tooYoungPercent: pct(tooYoung, top),
      oldestSignup: r.oldest_signup || null,
      newestSignup: r.newest_signup || null,
      note: tooYoung
        ? `${tooYoung} of ${top} signed up within the last ${maturityDays} days and may simply not have got there yet.`
        : null,
    },
    sampleNote: sampleNote(top, policy),
    window: describe(window),
  };
};

/* ── Personal vs organization ────────────────────────────────────────── */

const getAccountMix = async (window) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT t."kind"::text AS kind,
            COUNT(*)::int AS accounts,
            COUNT(*) FILTER (WHERE t."created_at" >= $1 AND t."created_at" <= $2)::int AS new_accounts,
            COALESCE(SUM(m.members), 0)::int AS members,
            COALESCE(SUM(d.deployments), 0)::int AS deployments,
            COALESCE(SUM(d.running), 0)::int AS running_deployments,
            COALESCE(SUM(u.hours), 0)::float AS hours,
            COALESCE(SUM(u.amount), 0)::float AS amount,
            COALESCE(SUM(w.balance), 0)::float AS wallet_balance,
            COALESCE(SUM(w.outstanding), 0)::float AS outstanding,
            COUNT(*) FILTER (WHERE pm.has_card)::int AS with_card
     FROM "teams" t
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS members FROM "team_members" tm WHERE tm."team_id" = t.id
     ) m ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS deployments,
              COUNT(*) FILTER (WHERE dd."status" = 'running')::int AS running
       FROM "deployments" dd
       WHERE dd."team_id" = t.id AND dd."created_at" >= $1 AND dd."created_at" <= $2
     ) d ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(du."hours"), 0)::float AS hours,
              COALESCE(SUM(du."amount"), 0)::float AS amount
       FROM "deployment_usages" du
       WHERE du."team_id" = t.id AND du."period_start" >= $1 AND du."period_start" <= $2
     ) u ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(cw."balance", 0)::float AS balance,
              COALESCE(cw."outstanding_balance", 0)::float AS outstanding
       FROM "credit_wallets" cw WHERE cw."team_id" = t.id
     ) w ON TRUE
     LEFT JOIN LATERAL (
       SELECT EXISTS (SELECT 1 FROM "payment_methods" p WHERE p."team_id" = t.id) AS has_card
     ) pm ON TRUE
     WHERE t."deleted_at" IS NULL
     GROUP BY 1`,
    window.from, window.to,
  );

  const mix = rows.map((row) => ({
    kind: row.kind,
    label: row.kind === 'team' ? 'Organizations' : 'Personal accounts',
    accounts: num(row.accounts),
    newAccounts: num(row.new_accounts),
    members: num(row.members),
    averageMembers: row.accounts ? round2(num(row.members) / num(row.accounts)) : 0,
    deployments: num(row.deployments),
    runningDeployments: num(row.running_deployments),
    hours: round2(row.hours),
    amount: round2(row.amount),
    walletBalance: round2(row.wallet_balance),
    outstanding: round2(row.outstanding),
    withCard: num(row.with_card),
    cardPercent: pct(row.with_card, row.accounts),
    // What one account of this kind is worth in the window. The whole reason
    // this view exists: if organizations are 10% of accounts and 70% of
    // revenue, that changes where the platform spends its effort.
    revenuePerAccount: row.accounts ? round2(num(row.amount) / num(row.accounts)) : 0,
  }));

  /*
   * The share column is named for what it is a share OF. `share` would be
   * stripped by the money filter on the route alongside the amounts — which is
   * right here, where it IS a revenue share, and wrong in the org-size view
   * where the same helper produces a share of headcount. Naming it per use
   * keeps one filter honest in both places.
   */
  return {
    mix: withShare(mix, 'amount').map(({ share, ...row }) => ({ ...row, revenueSharePercent: share })),
    window: describe(window),
  };
};

/* ── Organizations in detail ─────────────────────────────────────────── */

const getOrganizations = async (window, policy) => {
  const [sizeRows, roleRows, seatRows, domainRows, topRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT t.id, t."name",
              COALESCE(m.members, 0)::int AS members
       FROM "teams" t
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS members FROM "team_members" tm WHERE tm."team_id" = t.id
       ) m ON TRUE
       WHERE t."kind" = 'team' AND t."deleted_at" IS NULL`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT tm."role"::text AS role, COUNT(*)::int AS people
       FROM "team_members" tm
       JOIN "teams" t ON t.id = tm."team_id"
       WHERE t."kind" = 'team' AND t."deleted_at" IS NULL
       GROUP BY 1 ORDER BY 2 DESC`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, 'sc."day"', window.timezone)} AS bucket,
              COALESCE(SUM(sc."seats"), 0)::int AS seats,
              COALESCE(SUM(sc."free_seats"), 0)::int AS free_seats,
              COUNT(DISTINCT sc."team_id")::int AS organizations,
              COALESCE(SUM(sc."amount"), 0)::float AS amount
       FROM "team_seat_charges" sc
       WHERE sc."day" >= $1 AND sc."day" <= $2
       GROUP BY 1`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS organizations,
              COUNT(*) FILTER (WHERE "verified_domain" IS NOT NULL AND "domain_verified_at" IS NOT NULL)::int AS domain_verified,
              COUNT(*) FILTER (WHERE "discoverable_by_domain")::int AS discoverable,
              COUNT(*) FILTER (WHERE "domain_join_mode" = 'auto')::int AS join_auto,
              COUNT(*) FILTER (WHERE "domain_join_mode" = 'request')::int AS join_request,
              COUNT(*) FILTER (WHERE "domain_join_mode" = 'off')::int AS join_off
       FROM "teams" WHERE "kind" = 'team' AND "deleted_at" IS NULL`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT t.id, t."name",
              COALESCE(m.members, 0)::int AS members,
              t."created_at",
              COALESCE(a.active_members, 0)::int AS active_members
       FROM "teams" t
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS members FROM "team_members" tm WHERE tm."team_id" = t.id
       ) m ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(DISTINCT tm."user_id")::int AS active_members
         FROM "team_members" tm JOIN "users" us ON us.id = tm."user_id"
         WHERE tm."team_id" = t.id AND us."last_login" >= $1
       ) a ON TRUE
       WHERE t."kind" = 'team' AND t."deleted_at" IS NULL
       ORDER BY 3 DESC LIMIT 10`,
      window.from,
    ),
  ]);

  // Size distribution bucketed in JS rather than SQL: the ladder is operator
  // data, and a CASE built from it would be policy text inside a query string.
  const buckets = policy?.customers?.orgSizeBuckets || [];
  const tally = new Map(buckets.map((b) => [b.key, { ...b, organizations: 0, people: 0 }]));
  for (const org of sizeRows) {
    const bucket = bucketFor(num(org.members), buckets, 'maxMembers');
    if (!bucket) continue;
    const entry = tally.get(bucket.key);
    if (!entry) continue;
    entry.organizations += 1;
    entry.people += num(org.members);
  }

  const seats = fillSeries(seatRows, window, {
    fields: {
      seats: 0, free_seats: 0, organizations: 0, amount: 0,
    },
  }).map((p) => ({
    bucket: p.bucket,
    seats: p.seats,
    freeSeats: p.free_seats,
    billableSeats: Math.max(0, p.seats - p.free_seats),
    organizations: p.organizations,
    amount: round2(p.amount),
  }));

  return {
    sizeDistribution: withShare([...tally.values()], 'organizations'),
    roleMix: withShare(roleRows.map((r) => ({ role: r.role, people: num(r.people) })), 'people'),
    seats,
    /*
     * Seats come from `team_seat_charges`, which is written once a day by the
     * seat-fee job. So this series has one point per day the job ran — on a
     * day it did not run there is no row, and the chart shows a gap rather
     * than a zero. A flat zero would read as "every organization emptied".
     */
    seatsCaveat: 'Seat counts are the daily snapshot taken by the seat-fee job; a day the job did not run has no point.',
    domains: domainRows[0] || {},
    largest: topRows.map((r) => ({
      id: r.id,
      name: r.name,
      members: num(r.members),
      activeMembers: num(r.active_members),
      dormantMembers: Math.max(0, num(r.members) - num(r.active_members)),
      createdAt: r.created_at,
    })),
    window: describe(window),
  };
};

/* ── Invitations and the other ways in ───────────────────────────────── */

const getInvitations = async (window, policy) => {
  const [outcomeRows, roleRows, inviterRows, linkRows, requestRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS sent,
              COUNT(*) FILTER (WHERE "accepted_at" IS NOT NULL)::int AS accepted,
              COUNT(*) FILTER (WHERE "declined_at" IS NOT NULL)::int AS declined,
              COUNT(*) FILTER (WHERE "revoked_at" IS NOT NULL)::int AS revoked,
              COUNT(*) FILTER (
                WHERE "accepted_at" IS NULL AND "declined_at" IS NULL
                  AND "revoked_at" IS NULL AND "expires_at" < NOW()
              )::int AS expired,
              COUNT(*) FILTER (
                WHERE "accepted_at" IS NULL AND "declined_at" IS NULL
                  AND "revoked_at" IS NULL AND "expires_at" >= NOW()
              )::int AS still_open,
              (percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM ("accepted_at" - "created_at")) / 3600)
               )::float AS median_hours_to_accept,
              (percentile_cont(0.9) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM ("accepted_at" - "created_at")) / 3600)
               )::float AS p90_hours_to_accept
       FROM "team_invitations"
       WHERE "created_at" >= $1 AND "created_at" <= $2`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT "role"::text AS role,
              COUNT(*)::int AS sent,
              COUNT(*) FILTER (WHERE "accepted_at" IS NOT NULL)::int AS accepted
       FROM "team_invitations"
       WHERE "created_at" >= $1 AND "created_at" <= $2
       GROUP BY 1 ORDER BY 2 DESC`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT t.id AS team_id, t."name" AS team_name,
              COUNT(*)::int AS sent,
              COUNT(*) FILTER (WHERE i."accepted_at" IS NOT NULL)::int AS accepted
       FROM "team_invitations" i
       JOIN "teams" t ON t.id = i."team_id"
       WHERE i."created_at" >= $1 AND i."created_at" <= $2
       GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS issued,
              COALESCE(SUM("used_count"), 0)::int AS uses,
              COUNT(*) FILTER (WHERE "revoked_at" IS NOT NULL)::int AS revoked,
              COUNT(*) FILTER (WHERE "revoked_at" IS NULL AND "expires_at" >= NOW())::int AS live
       FROM "team_join_links"
       WHERE "created_at" >= $1 AND "created_at" <= $2`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS requested,
              COUNT(*) FILTER (WHERE "approved_at" IS NOT NULL)::int AS approved,
              COUNT(*) FILTER (WHERE "declined_at" IS NOT NULL)::int AS declined,
              COUNT(*) FILTER (WHERE "cancelled_at" IS NOT NULL)::int AS cancelled,
              COUNT(*) FILTER (
                WHERE "approved_at" IS NULL AND "declined_at" IS NULL AND "cancelled_at" IS NULL
              )::int AS waiting
       FROM "team_join_requests"
       WHERE "created_at" >= $1 AND "created_at" <= $2`,
      window.from, window.to,
    ),
  ]);

  const o = outcomeRows[0] || {};
  const sent = num(o.sent);

  return {
    sent,
    /*
     * A breakdown, not a funnel. An invitation has exactly one outcome, so the
     * five below are mutually exclusive and sum to what was sent — a funnel
     * would imply a sequence that does not exist here.
     */
    outcomes: withShare([
      { key: 'accepted', label: 'Accepted', count: num(o.accepted) },
      { key: 'declined', label: 'Declined', count: num(o.declined) },
      { key: 'revoked', label: 'Revoked by the team', count: num(o.revoked) },
      { key: 'expired', label: 'Expired unanswered', count: num(o.expired) },
      { key: 'still_open', label: 'Still open', count: num(o.still_open) },
    ], 'count'),
    acceptanceRate: pct(o.accepted, sent),
    /*
     * Expiry is the number worth watching. A declined invitation is a
     * decision; an expired one is an email that was never opened, or a link
     * that arrived after the person had already given up — a delivery problem
     * wearing a conversion problem's clothes.
     */
    expiryRate: pct(o.expired, sent),
    medianHoursToAccept: o.median_hours_to_accept === null ? null : round2(o.median_hours_to_accept),
    p90HoursToAccept: o.p90_hours_to_accept === null ? null : round2(o.p90_hours_to_accept),
    byRole: roleRows.map((r) => ({
      role: r.role,
      sent: num(r.sent),
      accepted: num(r.accepted),
      acceptanceRate: pct(r.accepted, r.sent),
    })),
    topInviters: inviterRows.map((r) => ({
      teamId: r.team_id,
      teamName: r.team_name,
      sent: num(r.sent),
      accepted: num(r.accepted),
      acceptanceRate: pct(r.accepted, r.sent),
    })),
    // The other two doors into an organization, so the invitation rate is not
    // read as the whole story of how people get in.
    joinLinks: linkRows[0] || {},
    joinRequests: requestRows[0] || {},
    sampleNote: sampleNote(sent, policy),
    window: describe(window),
  };
};

/* ── Members arriving and leaving ────────────────────────────────────── */

const getMemberFlow = async (window, policy) => {
  const flow = policy?.customers?.memberFlow || {};
  const joinActions = Object.values(flow.joinActions || {}).flat();
  const leaveActions = Object.values(flow.leaveActions || {}).flat();
  const all = [...joinActions, ...leaveActions];
  if (!all.length) {
    return {
      series: [], byChannel: [], totals: { joined: 0, left: 0, net: 0 }, window: describe(window),
    };
  }

  // Actions are policy data, so they are passed as a parameter array rather
  // than interpolated — the only thing built into the SQL is the placeholder.
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${bucketExpr(window.granularity, 'ta."created_at"', window.timezone)} AS bucket,
            COUNT(*) FILTER (WHERE ta."action" = ANY($3::text[]))::int AS joined,
            COUNT(*) FILTER (WHERE ta."action" = ANY($4::text[]))::int AS departed
     FROM "team_activity" ta
     WHERE ta."created_at" >= $1 AND ta."created_at" <= $2
       AND ta."action" = ANY($5::text[])
     GROUP BY 1`,
    window.from, window.to, joinActions, leaveActions, all,
  );

  const channelRows = await prisma.$queryRawUnsafe(
    `SELECT ta."action" AS action, COUNT(*)::int AS events
     FROM "team_activity" ta
     WHERE ta."created_at" >= $1 AND ta."created_at" <= $2 AND ta."action" = ANY($3::text[])
     GROUP BY 1 ORDER BY 2 DESC`,
    window.from, window.to, all,
  );

  const series = fillSeries(rows, window, { fields: { joined: 0, departed: 0 } })
    .map((p) => ({ ...p, net: p.joined - p.departed }));

  const joined = series.reduce((s, p) => s + p.joined, 0);
  const departed = series.reduce((s, p) => s + p.departed, 0);

  // Name each action by the channel the policy filed it under, so a new join
  // route added to the policy later appears here without a code change.
  const channelOf = (action) => {
    for (const [channel, actions] of Object.entries(flow.joinActions || {})) {
      if (actions.includes(action)) return { channel, direction: 'in' };
    }
    for (const [channel, actions] of Object.entries(flow.leaveActions || {})) {
      if (actions.includes(action)) return { channel, direction: 'out' };
    }
    return { channel: action, direction: 'in' };
  };

  // Average headcount over the window, from the seat snapshot — the only
  // honest denominator for a churn rate. Departures / current headcount would
  // flatter a shrinking platform and punish a growing one.
  const seatAvg = await prisma.teamSeatCharge.aggregate({
    where: { day: { gte: window.from, lte: window.to } },
    _sum: { seats: true },
    _count: { _all: true },
  });
  const days = seatAvg._count._all || 0;
  const avgHeadcount = days ? num(seatAvg._sum.seats) / days : 0;

  return {
    series,
    byChannel: channelRows.map((r) => ({
      action: r.action,
      events: num(r.events),
      ...channelOf(r.action),
    })),
    totals: {
      joined,
      departed,
      net: joined - departed,
      averageHeadcount: round2(avgHeadcount),
      // Departures as a share of average headcount, over this window only —
      // not annualised, because annualising a 7-day window produces a number
      // that looks authoritative and means nothing.
      departureRatePercent: avgHeadcount ? pct(departed, avgHeadcount) : null,
    },
    window: describe(window),
  };
};

/* ── Engagement ──────────────────────────────────────────────────────── */

const getEngagement = async (window, policy) => {
  const eventSignals = signalsFrom(policy, ACTIVITY_EVENT_SQL);
  const lastSignals = signalsFrom(policy, LAST_ACTIVITY_SQL);
  const eventsUnion = eventSignals.map((s) => ACTIVITY_EVENT_SQL[s]).join('\n       UNION ALL\n       ');

  const to = window.to;
  const [seriesRows, rollingRows, userRows, dormancyRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `WITH events AS (
         ${eventsUnion}
       )
       SELECT ${bucketExpr(window.granularity, 'e.at', window.timezone)} AS bucket,
              COUNT(DISTINCT e.team_id)::int AS accounts
       FROM events e GROUP BY 1`,
      window.from, to,
    ),
    // DAU / WAU / MAU are fixed trailing windows ending at the window's end,
    // not the selected period — "monthly active" means thirty days whatever
    // the toolbar says, or the ratio below is meaningless.
    prisma.$queryRawUnsafe(
      `WITH events AS (
         ${eventsUnion}
       )
       SELECT COUNT(DISTINCT CASE WHEN e.at >= $3 THEN e.team_id END)::int AS dau,
              COUNT(DISTINCT CASE WHEN e.at >= $4 THEN e.team_id END)::int AS wau,
              COUNT(DISTINCT e.team_id)::int AS mau
       FROM events e`,
      new Date(to.getTime() - 30 * DAY_MS), to,
      new Date(to.getTime() - DAY_MS), new Date(to.getTime() - 7 * DAY_MS),
    ),
    prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, 'al."created_at"', window.timezone)} AS bucket,
              COUNT(DISTINCT al."user_id")::int AS people,
              COUNT(DISTINCT CASE WHEN al."action" = 'login' THEN al."user_id" END)::int AS signed_in
       FROM "activity_logs" al
       WHERE al."user_role" = 'customer' AND al."created_at" >= $1 AND al."created_at" <= $2
       GROUP BY 1`,
      window.from, to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT t."kind"::text AS kind,
              GREATEST(${lastSignals.map((s) => `COALESCE((${LAST_ACTIVITY_SQL[s]}), 'epoch'::timestamp)`).join(', ')}) AS last_at
       FROM "teams" t WHERE t."deleted_at" IS NULL`,
    ),
  ]);

  const rolling = rollingRows[0] || {};
  const bands = policy?.engagement || {};
  const ladder = [
    { key: 'active', label: `Active (under ${bands.activeDays || 7} days)`, maxDays: bands.activeDays || 7 },
    { key: 'cooling', label: `Cooling (${bands.activeDays || 7}–${bands.coolingDays || 30} days)`, maxDays: bands.coolingDays || 30 },
    { key: 'dormant', label: `Dormant (${bands.coolingDays || 30}–${bands.dormantDays || 60} days)`, maxDays: bands.dormantDays || 60 },
    { key: 'deep_dormant', label: `Long dormant (${bands.dormantDays || 60}–${bands.deepDormantDays || 120} days)`, maxDays: bands.deepDormantDays || 120 },
    { key: 'gone', label: `No sign of life (over ${bands.deepDormantDays || 120} days)`, maxDays: null },
  ];
  const tally = new Map(ladder.map((b) => [b.key, { ...b, accounts: 0, personal: 0, organizations: 0 }]));
  let neverActive = 0;

  for (const row of dormancyRows) {
    const at = row.last_at ? new Date(row.last_at) : null;
    // 'epoch' means every signal was null — the account has never done
    // anything at all. A separate answer from "dormant for 200 days".
    if (!at || at.getFullYear() <= 1970) { neverActive += 1; continue; }
    const days = Math.max(0, (to.getTime() - at.getTime()) / DAY_MS);
    const bucket = bucketFor(days, ladder, 'maxDays');
    const entry = tally.get(bucket?.key);
    if (!entry) continue;
    entry.accounts += 1;
    if (row.kind === 'team') entry.organizations += 1; else entry.personal += 1;
  }

  return {
    series: fillSeries(seriesRows, window, { fields: { accounts: 0 } }),
    users: fillSeries(userRows, window, { fields: { people: 0, signed_in: 0 } })
      .map((p) => ({ bucket: p.bucket, people: p.people, signedIn: p.signed_in })),
    rolling: {
      dau: num(rolling.dau),
      wau: num(rolling.wau),
      mau: num(rolling.mau),
      /*
       * DAU/MAU. The one ratio worth having: it answers "of the accounts that
       * touched us this month, what fraction touched us today". 100% would
       * mean everybody comes back daily; a few percent means they come once
       * and leave. It is a ratio of ACCOUNTS, not people.
       */
      stickinessPercent: pct(rolling.dau, rolling.mau),
    },
    dormancy: withShare([...tally.values()], 'accounts'),
    neverActive,
    signalsUsed: eventSignals,
    /*
     * An account counts as active because something happened ON it, which
     * includes the hourly usage tick of a machine nobody has looked at in
     * weeks. That is deliberate — a deployment serving traffic is the opposite
     * of churn — but it means "active" here is not "logged in", and the two
     * series above are shown side by side for exactly that reason.
     */
    caveat: `Activity means any of: ${eventSignals.join(', ')}. A running deployment keeps its account active without anyone signing in.`,
    window: describe(window),
  };
};

/* ── Pay-as-you-go adoption ──────────────────────────────────────────── */

const getPaygAdoption = async (window) => {
  const [accessRows, deployRows, trendRows, fundingRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT t."payg_access" AS access,
              t."kind"::text AS kind,
              COUNT(*)::int AS accounts,
              COUNT(*) FILTER (WHERE pm.has_card)::int AS with_card
       FROM "teams" t
       LEFT JOIN LATERAL (
         SELECT EXISTS (SELECT 1 FROM "payment_methods" p WHERE p."team_id" = t.id) AS has_card
       ) pm ON TRUE
       WHERE t."deleted_at" IS NULL
       GROUP BY 1, 2`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT "billing_method"::text AS method,
              COUNT(*)::int AS deployments,
              COUNT(DISTINCT "team_id")::int AS accounts
       FROM "deployments"
       WHERE "created_at" >= $1 AND "created_at" <= $2
       GROUP BY 1`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, '"created_at"', window.timezone)} AS bucket,
              COUNT(*) FILTER (WHERE "billing_method" = 'prepaid')::int AS prepaid,
              COUNT(*) FILTER (WHERE "billing_method" = 'payg')::int AS payg
       FROM "deployments"
       WHERE "created_at" >= $1 AND "created_at" <= $2
       GROUP BY 1`,
      window.from, window.to,
    ),
    /*
     * How usage was actually funded, split by the deployment's billing method.
     * `to_wallet` / `to_debt` is what happened at the moment of the charge;
     * `billing_method` is what the deployment says today. They disagree
     * whenever a customer switched method, and the pair is the interesting
     * part — a prepaid deployment with debt means the wallet ran dry mid-hour.
     */
    prisma.$queryRawUnsafe(
      `SELECT d."billing_method"::text AS method,
              COALESCE(SUM(du."to_wallet"), 0)::float AS to_wallet,
              COALESCE(SUM(du."to_debt"), 0)::float AS to_debt,
              COALESCE(SUM(du."amount"), 0)::float AS amount
       FROM "deployment_usages" du
       JOIN "deployments" d ON d.id = du."deployment_id"
       WHERE du."period_start" >= $1 AND du."period_start" <= $2
       GROUP BY 1`,
      window.from, window.to,
    ),
  ]);

  const access = {};
  for (const row of accessRows) {
    const entry = access[row.access] || { access: row.access, accounts: 0, withCard: 0, personal: 0, organizations: 0 };
    entry.accounts += num(row.accounts);
    entry.withCard += num(row.with_card);
    if (row.kind === 'team') entry.organizations += num(row.accounts);
    else entry.personal += num(row.accounts);
    access[row.access] = entry;
  }

  return {
    access: withShare(Object.values(access), 'accounts'),
    byMethod: withShare(deployRows.map((r) => ({
      method: r.method,
      deployments: num(r.deployments),
      accounts: num(r.accounts),
    })), 'deployments'),
    trend: fillSeries(trendRows, window, { fields: { prepaid: 0, payg: 0 } }),
    funding: fundingRows.map((r) => ({
      method: r.method,
      toWallet: round2(r.to_wallet),
      toDebt: round2(r.to_debt),
      amount: round2(r.amount),
      debtSharePercent: pct(r.to_debt, r.amount),
    })),
    window: describe(window),
  };
};

/* ── Accounts worth looking at ───────────────────────────────────────── */

/**
 * The customer list, ordered by whatever the operator is asking about.
 *
 * Deliberately not a copy of the revenue view's top accounts: that one ranks
 * by money and is gated on `analytics.revenue`. This one ranks by people and
 * activity, so somebody who may not see the books can still answer "which of
 * our organizations is actually being used".
 */
const getAccounts = async (window, { limit = 20, kind = null, sort = 'members' } = {}) => {
  const SORTS = {
    members: 'members DESC',
    deployments: 'deployments DESC',
    hours: 'hours DESC',
    newest: 't."created_at" DESC',
    dormant: 'last_seen ASC NULLS FIRST',
  };
  const orderBy = SORTS[sort] || SORTS.members;
  const kindFilter = kind === 'team' || kind === 'personal' ? `AND t."kind" = '${kind}'` : '';

  const rows = await prisma.$queryRawUnsafe(
    `SELECT t.id, t."name", t."kind"::text AS kind, t."created_at",
            COALESCE(m.members, 0)::int AS members,
            COALESCE(d.deployments, 0)::int AS deployments,
            COALESCE(d.running, 0)::int AS running,
            COALESCE(u.hours, 0)::float AS hours,
            GREATEST(
              COALESCE(u.last_usage, 'epoch'::timestamp),
              COALESCE(l.last_login, 'epoch'::timestamp)
            ) AS last_seen
     FROM "teams" t
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS members FROM "team_members" tm WHERE tm."team_id" = t.id
     ) m ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS deployments,
              COUNT(*) FILTER (WHERE dd."status" = 'running')::int AS running
       FROM "deployments" dd WHERE dd."team_id" = t.id
     ) d ON TRUE
     LEFT JOIN LATERAL (
       SELECT COALESCE(SUM(du."hours"), 0)::float AS hours,
              MAX(du."created_at") AS last_usage
       FROM "deployment_usages" du
       WHERE du."team_id" = t.id AND du."period_start" >= $1 AND du."period_start" <= $2
     ) u ON TRUE
     LEFT JOIN LATERAL (
       SELECT MAX(us."last_login") AS last_login
       FROM "team_members" tm JOIN "users" us ON us.id = tm."user_id"
       WHERE tm."team_id" = t.id
     ) l ON TRUE
     WHERE t."deleted_at" IS NULL ${kindFilter}
     ORDER BY ${orderBy} LIMIT ${Math.min(100, Math.max(1, Number(limit) || 20))}`,
    window.from, window.to,
  );

  const now = window.to.getTime();
  return {
    accounts: rows.map((r) => {
      const seen = r.last_seen ? new Date(r.last_seen) : null;
      const everSeen = seen && seen.getFullYear() > 1970;
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        createdAt: r.created_at,
        members: num(r.members),
        deployments: num(r.deployments),
        running: num(r.running),
        hours: round2(r.hours),
        lastSeen: everSeen ? seen.toISOString() : null,
        daysSinceSeen: everSeen ? Math.floor((now - seen.getTime()) / DAY_MS) : null,
      };
    }),
    sort,
    window: describe(window),
  };
};

module.exports = {
  getSummary,
  getSignupTrend,
  getActivation,
  getAccountMix,
  getOrganizations,
  getInvitations,
  getMemberFlow,
  getEngagement,
  getPaygAdoption,
  getAccounts,
};
