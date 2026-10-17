/**
 * The support queue: how much comes in, how fast it is answered and closed,
 * what is piling up, who is carrying it, and how often work comes back.
 *
 * ── The honesty problem this module is built around ──
 *
 * Everything here is new. Before `ANLX-SUPPORT` a ticket recorded only its
 * current status, so the whole of its past had to be reconstructed, and the
 * reconstruction is not uniformly trustworthy:
 *
 *   • **First response is exact.** The first admin message was always on the
 *     thread with its own timestamp. Nothing is guessed.
 *   • **Resolution is partly estimated.** For tickets solved before the
 *     columns existed, `resolved_at` was taken from `updated_at` — which also
 *     moves on an assignment. Those rows carry `resolved_at_estimated`, every
 *     response that touches resolution reports how many of them it used, and
 *     the page prints it as a caveat.
 *   • **Reopens start from instrumentation.** They were not derivable at all.
 *     Rather than report zero as if it were a measurement, each response says
 *     the date real tracking began — read from the status history itself, so
 *     it cannot drift from the truth.
 *   • **SLA is graded against the target on the ticket**, stamped when it
 *     opened, never today's policy. A ticket that was never promised anything
 *     is excluded rather than held to a target invented after the fact.
 *
 * ── Medians, not averages ──
 *
 * Every duration here is reported as a median and a p90. One ticket forgotten
 * for three weeks drags a mean far enough to describe a queue that is
 * otherwise answered within the hour, and the mean is the number somebody
 * screenshots.
 */
const prisma = require('../../lib/prismaClient');
const { bucketExpr, fillSeries, describe } = require('./timeWindow');
const {
  num, round2, pct, deltaPct, withShare,
} = require('./numeric');
const { bucketFor } = require('./analyticsPolicyDefaults');

const MINUTE_MS = 60000;

/**
 * When reopen counting actually started: the first status-history row that was
 * not invented by the back-fill.
 *
 * Derived rather than configured. A hardcoded date would be wrong the moment
 * the migration ran at a different time in another environment, and an
 * operator would have no way to know.
 */
const reopenTrackingFrom = async () => {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT MIN("at") AS from_at FROM "support_ticket_status_history" WHERE NOT "backfilled"',
  );
  return rows[0]?.from_at || null;
};

/* ── Headline ─────────────────────────────────────────────────────────── */

const windowTotals = async (from, to) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT
       COUNT(*)::int AS opened,
       COUNT(*) FILTER (WHERE "first_response_at" IS NOT NULL)::int AS answered,
       COUNT(*) FILTER (WHERE "resolved_at" IS NOT NULL)::int AS resolved,
       COUNT(*) FILTER (WHERE "resolved_at" IS NOT NULL AND "resolved_at_estimated")::int AS resolved_estimated,
       COALESCE(SUM("reopened_count"), 0)::int AS reopens,
       COUNT(*) FILTER (WHERE "reopened_count" > 0)::int AS reopened_tickets,
       (percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM ("first_response_at" - "created_at")) / 60)
        FILTER (WHERE "first_response_at" IS NOT NULL))::float AS median_first_response,
       (percentile_cont(0.9) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM ("first_response_at" - "created_at")) / 60)
        FILTER (WHERE "first_response_at" IS NOT NULL))::float AS p90_first_response,
       (percentile_cont(0.5) WITHIN GROUP (ORDER BY "resolution_minutes")
        FILTER (WHERE "resolution_minutes" IS NOT NULL))::float AS median_resolution,
       (percentile_cont(0.9) WITHIN GROUP (ORDER BY "resolution_minutes")
        FILTER (WHERE "resolution_minutes" IS NOT NULL))::float AS p90_resolution
     FROM "support_tickets"
     WHERE "created_at" >= $1 AND "created_at" <= $2`,
    from, to,
  );
  return rows[0] || {};
};

const getSummary = async (window, policy) => {
  const [current, previous, backlogRows, slaRows, trackedFrom] = await Promise.all([
    windowTotals(window.from, window.to),
    windowTotals(window.prevFrom, window.prevTo),
    prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS open_now,
              COUNT(*) FILTER (WHERE "status" = 'open')::int AS awaiting_support,
              COUNT(*) FILTER (WHERE "status" = 'pending')::int AS awaiting_customer,
              COUNT(*) FILTER (WHERE "assigned_admin_id" IS NULL)::int AS unassigned,
              COUNT(*) FILTER (WHERE "first_response_at" IS NULL)::int AS never_answered
       FROM "support_tickets" WHERE "status" <> 'solved'`,
    ),
    /*
     * Grading uses the target stamped on each ticket. A ticket opened before
     * those columns existed has none and is counted separately as `ungraded`
     * rather than quietly treated as having passed — which is what an
     * `IS NULL OR …` would have done, and it would have flattered the queue
     * exactly where the data is weakest.
     */
    prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*) FILTER (WHERE "sla_first_response_minutes" IS NULL)::int AS ungraded_response,
         COUNT(*) FILTER (
           WHERE "sla_first_response_minutes" IS NOT NULL AND "first_response_at" IS NOT NULL
             AND EXTRACT(EPOCH FROM ("first_response_at" - "created_at")) / 60 <= "sla_first_response_minutes"
         )::int AS response_met,
         COUNT(*) FILTER (
           WHERE "sla_first_response_minutes" IS NOT NULL AND "first_response_at" IS NOT NULL
             AND EXTRACT(EPOCH FROM ("first_response_at" - "created_at")) / 60 > "sla_first_response_minutes"
         )::int AS response_missed,
         COUNT(*) FILTER (WHERE "sla_resolution_minutes" IS NULL)::int AS ungraded_resolution,
         COUNT(*) FILTER (
           WHERE "sla_resolution_minutes" IS NOT NULL AND "resolution_minutes" IS NOT NULL
             AND "resolution_minutes" <= "sla_resolution_minutes"
         )::int AS resolution_met,
         COUNT(*) FILTER (
           WHERE "sla_resolution_minutes" IS NOT NULL AND "resolution_minutes" IS NOT NULL
             AND "resolution_minutes" > "sla_resolution_minutes"
         )::int AS resolution_missed
       FROM "support_tickets"
       WHERE "created_at" >= $1 AND "created_at" <= $2`,
      window.from, window.to,
    ),
    reopenTrackingFrom(),
  ]);

  const backlog = backlogRows[0] || {};
  const sla = slaRows[0] || {};
  const opened = num(current.opened);
  const minSample = Number(policy?.customers?.minSampleForRates) || 10;

  const responseGraded = num(sla.response_met) + num(sla.response_missed);
  const resolutionGraded = num(sla.resolution_met) + num(sla.resolution_missed);

  return {
    volume: {
      opened,
      resolved: num(current.resolved),
      answered: num(current.answered),
      // Opened minus resolved in the same window. Positive means the queue
      // grew, whoever closed what.
      net: opened - num(current.resolved),
      delta: {
        opened: deltaPct(opened, num(previous.opened)),
        resolved: deltaPct(num(current.resolved), num(previous.resolved)),
      },
    },
    timing: {
      medianFirstResponseMinutes: current.median_first_response === null ? null : round2(current.median_first_response),
      p90FirstResponseMinutes: current.p90_first_response === null ? null : round2(current.p90_first_response),
      medianResolutionMinutes: current.median_resolution === null ? null : round2(current.median_resolution),
      p90ResolutionMinutes: current.p90_resolution === null ? null : round2(current.p90_resolution),
      delta: {
        firstResponse: deltaPct(current.median_first_response, previous.median_first_response),
        resolution: deltaPct(current.median_resolution, previous.median_resolution),
      },
      // How much of the resolution figure above came from a reconstructed
      // timestamp rather than an observed one.
      resolvedFromEstimate: num(current.resolved_estimated),
      resolvedTotal: num(current.resolved),
    },
    backlog: {
      openNow: num(backlog.open_now),
      awaitingSupport: num(backlog.awaiting_support),
      awaitingCustomer: num(backlog.awaiting_customer),
      unassigned: num(backlog.unassigned),
      neverAnswered: num(backlog.never_answered),
    },
    sla: {
      responseMet: num(sla.response_met),
      responseMissed: num(sla.response_missed),
      responseMetPercent: responseGraded ? pct(sla.response_met, responseGraded) : null,
      resolutionMet: num(sla.resolution_met),
      resolutionMissed: num(sla.resolution_missed),
      resolutionMetPercent: resolutionGraded ? pct(sla.resolution_met, resolutionGraded) : null,
      // Tickets that predate the SLA columns. Named, not hidden: a 100%
      // success rate over three graded tickets out of forty is not a 100%
      // success rate.
      ungradedResponse: num(sla.ungraded_response),
      ungradedResolution: num(sla.ungraded_resolution),
    },
    reopens: {
      total: num(current.reopens),
      tickets: num(current.reopened_tickets),
      ratePercent: opened ? pct(current.reopened_tickets, opened) : null,
      trackedFrom,
    },
    sampleNote: opened >= minSample ? null
      : `Only ${opened} ticket${opened === 1 ? '' : 's'} opened in this window — read the counts, not the percentages.`,
    window: describe(window),
  };
};

/* ── Volume over time ─────────────────────────────────────────────────── */

const getVolume = async (window) => {
  const [openedRows, resolvedRows, categoryRows, priorityRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, '"created_at"', window.timezone)} AS bucket,
              COUNT(*)::int AS opened
       FROM "support_tickets"
       WHERE "created_at" >= $1 AND "created_at" <= $2
       GROUP BY 1`,
      window.from, window.to,
    ),
    /*
     * Bucketed on when each ticket was RESOLVED, not when it was opened — a
     * ticket opened in March and closed today belongs to today's output. The
     * two series therefore answer different questions and are gap-filled onto
     * the same axis so the gap between them is readable.
     */
    prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, '"resolved_at"', window.timezone)} AS bucket,
              COUNT(*)::int AS resolved
       FROM "support_tickets"
       WHERE "resolved_at" >= $1 AND "resolved_at" <= $2
       GROUP BY 1`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT "category",
              COUNT(*)::int AS tickets,
              COUNT(*) FILTER (WHERE "status" <> 'solved')::int AS still_open,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY "resolution_minutes")
               FILTER (WHERE "resolution_minutes" IS NOT NULL))::float AS median_resolution
       FROM "support_tickets"
       WHERE "created_at" >= $1 AND "created_at" <= $2
       GROUP BY 1 ORDER BY 2 DESC`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT "priority",
              COUNT(*)::int AS tickets,
              (percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM ("first_response_at" - "created_at")) / 60)
               FILTER (WHERE "first_response_at" IS NOT NULL))::float AS median_first_response
       FROM "support_tickets"
       WHERE "created_at" >= $1 AND "created_at" <= $2
       GROUP BY 1 ORDER BY 2 DESC`,
      window.from, window.to,
    ),
  ]);

  const opened = fillSeries(openedRows, window, { fields: { opened: 0 } });
  const resolved = fillSeries(resolvedRows, window, { fields: { resolved: 0 } });

  return {
    series: opened.map((p, i) => ({
      bucket: p.bucket,
      opened: p.opened,
      resolved: resolved[i]?.resolved ?? 0,
      net: p.opened - (resolved[i]?.resolved ?? 0),
    })),
    byCategory: withShare(categoryRows.map((r) => ({
      category: r.category,
      tickets: num(r.tickets),
      stillOpen: num(r.still_open),
      medianResolutionMinutes: r.median_resolution === null ? null : round2(r.median_resolution),
    })), 'tickets'),
    byPriority: withShare(priorityRows.map((r) => ({
      priority: r.priority,
      tickets: num(r.tickets),
      medianFirstResponseMinutes: r.median_first_response === null ? null : round2(r.median_first_response),
    })), 'tickets'),
    definition: 'Opened is counted on the day a ticket arrived; resolved on the day it was closed, whenever it arrived.',
    window: describe(window),
  };
};

/* ── Timing over time ─────────────────────────────────────────────────── */

const getTiming = async (window) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT ${bucketExpr(window.granularity, '"created_at"', window.timezone)} AS bucket,
            (percentile_cont(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM ("first_response_at" - "created_at")) / 60)
             FILTER (WHERE "first_response_at" IS NOT NULL))::float AS median_first_response,
            (percentile_cont(0.9) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM ("first_response_at" - "created_at")) / 60)
             FILTER (WHERE "first_response_at" IS NOT NULL))::float AS p90_first_response,
            (percentile_cont(0.5) WITHIN GROUP (ORDER BY "resolution_minutes")
             FILTER (WHERE "resolution_minutes" IS NOT NULL))::float AS median_resolution,
            COUNT(*) FILTER (WHERE "first_response_at" IS NOT NULL)::int AS answered,
            COUNT(*) FILTER (WHERE "resolved_at_estimated")::int AS estimated
     FROM "support_tickets"
     WHERE "created_at" >= $1 AND "created_at" <= $2
     GROUP BY 1`,
    window.from, window.to,
  );

  const series = fillSeries(rows, window, {
    fields: {
      median_first_response: null,
      p90_first_response: null,
      median_resolution: null,
      answered: 0,
      estimated: 0,
    },
  }).map((p) => ({
    bucket: p.bucket,
    // `null`, not 0, where nothing was answered: a gap in the line says "no
    // tickets that day", a zero says "answered instantly".
    medianFirstResponseMinutes: p.median_first_response === null ? null : round2(p.median_first_response),
    p90FirstResponseMinutes: p.p90_first_response === null ? null : round2(p.p90_first_response),
    medianResolutionMinutes: p.median_resolution === null ? null : round2(p.median_resolution),
    answered: p.answered,
    estimated: p.estimated,
  }));

  const estimatedTotal = series.reduce((s, p) => s + p.estimated, 0);
  return {
    series,
    caveat: estimatedTotal
      ? `${estimatedTotal} resolution time${estimatedTotal === 1 ? ' in this window was' : 's in this window were'} reconstructed from the ticket's last update, not observed.`
      : null,
    window: describe(window),
  };
};

/* ── Backlog ──────────────────────────────────────────────────────────── */

/**
 * What is still open, right now.
 *
 * `window` is accepted and deliberately not used: a backlog is a measurement
 * of the present, and "the backlog last March" is not a thing this data can
 * answer. It is taken so every analytics loader has the same signature, and
 * `describe(window)` goes back so the caller can say which window produced the
 * rest of the screen.
 *
 * `limit` caps only the `oldest` list — ten is a sensible table on screen, and
 * an export asks for all of them. The bucket tally is always over everything.
 */
const getBacklog = async (window, policy, { limit = 10 } = {}) => {
  const buckets = policy?.support?.backlogBuckets || [];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, "number", "subject", "status", "priority", "category",
            "created_at", "first_response_at", "assigned_admin_name",
            (EXTRACT(EPOCH FROM (NOW() - "created_at")) / 3600)::float AS age_hours,
            (EXTRACT(EPOCH FROM (NOW() - "last_message_at")) / 3600)::float AS quiet_hours,
            "sla_first_response_minutes", "sla_resolution_minutes"
     FROM "support_tickets"
     WHERE "status" <> 'solved'
     ORDER BY "created_at" ASC`,
  );

  const tally = new Map((buckets || []).map((b) => [b.key, {
    ...b, tickets: 0, unanswered: 0,
  }]));
  const now = Date.now();
  const oldest = [];

  for (const row of rows) {
    const bucket = bucketFor(num(row.age_hours), buckets, 'maxHours');
    const entry = bucket && tally.get(bucket.key);
    if (entry) {
      entry.tickets += 1;
      if (!row.first_response_at) entry.unanswered += 1;
    }
  }

  // The ones that have waited longest, with whether each has already broken
  // what it was promised. An aggregate says the queue is slow; this says which
  // customer is the one being let down.
  for (const row of rows.slice(0, Math.max(1, Number(limit) || 10))) {
    const ageMinutes = (now - new Date(row.created_at).getTime()) / MINUTE_MS;
    const responseTarget = row.sla_first_response_minutes;
    const resolutionTarget = row.sla_resolution_minutes;
    oldest.push({
      id: row.id,
      number: row.number,
      subject: row.subject,
      status: row.status,
      priority: row.priority,
      category: row.category,
      createdAt: row.created_at,
      ageHours: round2(row.age_hours),
      quietHours: round2(row.quiet_hours),
      answered: !!row.first_response_at,
      assignedTo: row.assigned_admin_name || null,
      // `null` where the ticket carries no target — it predates the SLA
      // columns and was never promised anything.
      responseBreached: responseTarget === null ? null
        : (!row.first_response_at && ageMinutes > Number(responseTarget)),
      resolutionBreached: resolutionTarget === null ? null
        : ageMinutes > Number(resolutionTarget),
    });
  }

  return {
    buckets: withShare([...tally.values()], 'tickets'),
    oldest,
    total: rows.length,
    definition: 'Everything not yet solved, by how long it has been open. Age bands come from the analytics policy.',
    window: describe(window),
  };
};

/* ── SLA ──────────────────────────────────────────────────────────────── */

const getSla = async (window) => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "priority",
            COUNT(*)::int AS tickets,
            COUNT(*) FILTER (WHERE "sla_first_response_minutes" IS NULL)::int AS ungraded,
            MIN("sla_first_response_minutes")::int AS response_target,
            MIN("sla_resolution_minutes")::int AS resolution_target,
            COUNT(*) FILTER (
              WHERE "sla_first_response_minutes" IS NOT NULL AND "first_response_at" IS NOT NULL
                AND EXTRACT(EPOCH FROM ("first_response_at" - "created_at")) / 60 <= "sla_first_response_minutes"
            )::int AS response_met,
            COUNT(*) FILTER (
              WHERE "sla_first_response_minutes" IS NOT NULL AND "first_response_at" IS NOT NULL
                AND EXTRACT(EPOCH FROM ("first_response_at" - "created_at")) / 60 > "sla_first_response_minutes"
            )::int AS response_missed,
            COUNT(*) FILTER (
              WHERE "sla_resolution_minutes" IS NOT NULL AND "resolution_minutes" IS NOT NULL
                AND "resolution_minutes" <= "sla_resolution_minutes"
            )::int AS resolution_met,
            COUNT(*) FILTER (
              WHERE "sla_resolution_minutes" IS NOT NULL AND "resolution_minutes" IS NOT NULL
                AND "resolution_minutes" > "sla_resolution_minutes"
            )::int AS resolution_missed
     FROM "support_tickets"
     WHERE "created_at" >= $1 AND "created_at" <= $2
     GROUP BY 1`,
    window.from, window.to,
  );

  /*
   * `MIN(sla_*)` rather than the policy's current value: the targets reported
   * are the ones these tickets were actually held to. If an operator changed a
   * target mid-window the two differ, and showing today's number against last
   * week's results is how an SLA chart starts lying.
   */
  const byPriority = rows.map((r) => {
    const responseGraded = num(r.response_met) + num(r.response_missed);
    const resolutionGraded = num(r.resolution_met) + num(r.resolution_missed);
    return {
      priority: r.priority,
      tickets: num(r.tickets),
      ungraded: num(r.ungraded),
      responseTargetMinutes: r.response_target === null ? null : num(r.response_target),
      resolutionTargetMinutes: r.resolution_target === null ? null : num(r.resolution_target),
      responseMet: num(r.response_met),
      responseMissed: num(r.response_missed),
      responseMetPercent: responseGraded ? pct(r.response_met, responseGraded) : null,
      resolutionMet: num(r.resolution_met),
      resolutionMissed: num(r.resolution_missed),
      resolutionMetPercent: resolutionGraded ? pct(r.resolution_met, resolutionGraded) : null,
    };
  });

  const ungraded = byPriority.reduce((s, r) => s + r.ungraded, 0);
  const graded = byPriority.reduce((s, r) => s + r.tickets, 0) - ungraded;

  return {
    byPriority,
    graded,
    ungraded,
    caveat: ungraded
      ? `${ungraded} of ${graded + ungraded} tickets in this window carry no SLA target — they opened before targets were recorded and are left out of the rates above rather than counted as passes.`
      : null,
    window: describe(window),
  };
};

/* ── Who is carrying the queue ────────────────────────────────────────── */

const getAgents = async (window) => {
  const rows = await prisma.$queryRawUnsafe(
    `WITH replies AS (
       SELECT m."author_id" AS admin_id,
              MAX(m."author_name") AS admin_name,
              COUNT(*)::int AS messages,
              COUNT(DISTINCT m."ticket_id")::int AS tickets_touched
       FROM "support_ticket_messages" m
       WHERE m."author_type" = 'admin'
         AND m."created_at" >= $1 AND m."created_at" <= $2
       GROUP BY 1
     ),
     firsts AS (
       /*
        * Credit for the first response goes to whoever actually sent it, which
        * is not always the admin the ticket is assigned to.
        *
        * Found as the EARLIEST admin message on the ticket, not by matching
        * created_at against first_response_at. That equality looked exact and
        * was not: the column is stamped from the application clock while the
        * message row takes the database's, so they differed by a millisecond
        * or two and the join silently matched almost nothing -- every agent
        * reported exactly one first response however many they had sent. The
        * stamp now carries the message's own timestamp too, but this stays
        * defined by what it means rather than by two clocks agreeing.
        */
       SELECT DISTINCT ON (m."ticket_id") m."ticket_id" AS ticket_id, m."author_id" AS admin_id
       FROM "support_ticket_messages" m
       JOIN "support_tickets" t ON t.id = m."ticket_id"
       WHERE m."author_type" = 'admin'
         AND t."first_response_at" >= $1 AND t."first_response_at" <= $2
       ORDER BY m."ticket_id", m."created_at" ASC
     ),
     first_counts AS (
       SELECT admin_id, COUNT(*)::int AS first_responses FROM firsts GROUP BY 1
     ),
     resolved AS (
       SELECT h."by_id" AS admin_id, COUNT(DISTINCT h."ticket_id")::int AS resolved
       FROM "support_ticket_status_history" h
       WHERE h."status" = 'solved' AND h."by_type" = 'admin'
         AND NOT h."backfilled"
         AND h."at" >= $1 AND h."at" <= $2
       GROUP BY 1
     ),
     assigned AS (
       SELECT "assigned_admin_id" AS admin_id, COUNT(*)::int AS open_assigned
       FROM "support_tickets"
       WHERE "status" <> 'solved' AND "assigned_admin_id" IS NOT NULL
       GROUP BY 1
     )
     SELECT COALESCE(r.admin_id, fc.admin_id, rs.admin_id, a.admin_id) AS admin_id,
            COALESCE(r.admin_name, u."name", '') AS admin_name,
            COALESCE(r.messages, 0)::int AS messages,
            COALESCE(r.tickets_touched, 0)::int AS tickets_touched,
            COALESCE(fc.first_responses, 0)::int AS first_responses,
            COALESCE(rs.resolved, 0)::int AS resolved,
            COALESCE(a.open_assigned, 0)::int AS open_assigned
     FROM replies r
     FULL OUTER JOIN first_counts fc ON fc.admin_id = r.admin_id
     FULL OUTER JOIN resolved rs     ON rs.admin_id = COALESCE(r.admin_id, fc.admin_id)
     FULL OUTER JOIN assigned a      ON a.admin_id = COALESCE(r.admin_id, fc.admin_id, rs.admin_id)
     LEFT JOIN "users" u ON u.id = COALESCE(r.admin_id, fc.admin_id, rs.admin_id, a.admin_id)
     ORDER BY 3 DESC`,
    window.from, window.to,
  );

  const agents = rows
    .filter((r) => r.admin_id)
    .map((r) => ({
      adminId: r.admin_id,
      name: r.admin_name || 'Removed admin',
      messages: num(r.messages),
      ticketsTouched: num(r.tickets_touched),
      firstResponses: num(r.first_responses),
      resolved: num(r.resolved),
      openAssigned: num(r.open_assigned),
    }));

  return {
    agents: withShare(agents, 'messages'),
    /*
     * `resolved` counts only real status-history rows. The rows the migration
     * invented have no author, so an agent's resolved count starts at
     * instrumentation rather than claiming credit the record cannot support.
     */
    definition: 'Replies and first responses are credited to whoever sent them, not to whoever the ticket is assigned to.',
    window: describe(window),
  };
};

/* ── Work that came back ──────────────────────────────────────────────── */

const getReopens = async (window) => {
  const [seriesRows, worstRows, trackedFrom] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT ${bucketExpr(window.granularity, 'h."at"', window.timezone)} AS bucket,
              COUNT(*) FILTER (WHERE h."by_type" = 'customer')::int AS by_customer,
              COUNT(*) FILTER (WHERE h."by_type" = 'admin')::int AS by_support
       FROM "support_ticket_status_history" h
       WHERE h."status" <> 'solved' AND NOT h."backfilled"
         AND h."at" >= $1 AND h."at" <= $2
         AND EXISTS (
           SELECT 1 FROM "support_ticket_status_history" p
           WHERE p."ticket_id" = h."ticket_id" AND p."status" = 'solved' AND p."at" < h."at"
         )
       GROUP BY 1`,
      window.from, window.to,
    ),
    prisma.$queryRawUnsafe(
      `SELECT id, "number", "subject", "status", "priority", "reopened_count", "created_at"
       FROM "support_tickets"
       WHERE "reopened_count" > 0
       ORDER BY "reopened_count" DESC, "created_at" DESC
       LIMIT 10`,
    ),
    reopenTrackingFrom(),
  ]);

  return {
    series: fillSeries(seriesRows, window, { fields: { by_customer: 0, by_support: 0 } })
      .map((p) => ({ bucket: p.bucket, byCustomer: p.by_customer, bySupport: p.by_support })),
    worst: worstRows.map((r) => ({
      id: r.id,
      number: r.number,
      subject: r.subject,
      status: r.status,
      priority: r.priority,
      reopenedCount: num(r.reopened_count),
      createdAt: r.created_at,
    })),
    /*
     * The honesty line. Reopens were not derivable from the old schema, so a
     * zero here before this date means "not recorded", not "never happened".
     */
    trackedFrom,
    caveat: trackedFrom
      ? `Reopens are only counted from ${new Date(trackedFrom).toISOString().slice(0, 10)}, when status history started being kept.`
      : 'No status changes have been recorded yet, so nothing can be counted as a reopen.',
    window: describe(window),
  };
};

module.exports = {
  getSummary,
  getVolume,
  getTiming,
  getBacklog,
  getSla,
  getAgents,
  getReopens,
};
