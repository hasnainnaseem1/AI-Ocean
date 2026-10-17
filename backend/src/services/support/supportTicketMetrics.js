/**
 * Everything a ticket's status transition implies, in one place.
 *
 * Five call sites move a ticket between statuses — a customer opening one,
 * either side sending a message, and either side setting the status directly.
 * Each of them has to write a history row and may have to stamp a first
 * response, a resolution or a reopen. Letting each decide for itself is how
 * one of them ends up not counting reopens, and nothing fails: the number is
 * simply quietly low forever.
 *
 * So `applyTransition` owns every derived column, and the call sites say only
 * what happened and who did it.
 *
 * ── Transaction client only, deliberately ──
 *
 * Like `analytics/tierCapacityLog.js`, these take a `tx` and never the global
 * client. The history row and the status it describes must commit together; a
 * log written outside the transaction that moved the ticket is a log that
 * disagrees with the ticket the first time something rolls back — and, being a
 * record of the past, it would never be noticed.
 */

/** Minutes between two instants, floored at zero. */
const minutesBetween = (from, to) => Math.max(
  0,
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000),
);

/**
 * The SLA targets for a priority, as the policy has them right now.
 *
 * Returns nulls for a priority the policy does not describe rather than
 * falling back to another tier's promise: an un-promised ticket must not be
 * gradeable, because a breach invented from a default is a breach of nothing.
 */
const slaFor = (policy, priority) => {
  const sla = policy?.support?.sla?.[priority];
  return {
    slaFirstResponseMinutes: Number.isFinite(Number(sla?.firstResponseMinutes))
      ? Number(sla.firstResponseMinutes) : null,
    slaResolutionMinutes: Number.isFinite(Number(sla?.resolutionMinutes))
      ? Number(sla.resolutionMinutes) : null,
  };
};

/** The priority to open a ticket at, if the policy names a valid one. */
const defaultPriority = (policy) => {
  const wanted = policy?.support?.defaultPriority;
  return policy?.support?.sla?.[wanted] ? wanted : 'normal';
};

/**
 * Which priorities exist, in the order an operator listed them.
 *
 * Driven by `sla`, not by `priorityLabels`: a tier with a label but no target
 * could be chosen and then never graded, so only the ones the policy can
 * actually hold a ticket to are offered.
 */
const prioritiesFrom = (policy) => Object.keys(policy?.support?.sla || {});

/** The operator's wording for a priority, falling back to the key itself. */
const labelFor = (policy, key) => policy?.support?.priorityLabels?.[key] || key;

/**
 * Record a transition and return the ticket fields it changes.
 *
 * `previousStatus` is read inside the caller's transaction, never before it —
 * the reopen count depends on it, and a stale read undercounts exactly when
 * the queue is busiest.
 *
 * Returns the `data` object for the caller's `update`, so a caller can merge
 * its own fields (`lastMessageAt`, assignment) into a single write.
 */
const applyTransition = async (tx, ticket, nextStatus, actor, opts = {}) => {
  const {
    note = '', at = new Date(), isAdminMessage = false,
  } = opts;

  const data = { status: nextStatus };

  /*
   * First response is the first message FROM SUPPORT, and it is set once.
   * Not "the first status change by an admin": an admin who triages a ticket
   * into pending without writing anything has not responded to anybody, and
   * counting that would make the headline number look good by doing nothing.
   */
  if (isAdminMessage && !ticket.firstResponseAt) {
    data.firstResponseAt = at;
  }

  if (nextStatus === 'solved') {
    /*
     * Stamped on every transition INTO solved, overwriting an earlier one, so
     * a ticket solved, reopened and solved again reports the last time it was
     * actually finished. `resolutionMinutes` runs from `createdAt`, which
     * means a reopened ticket carries the whole wait rather than the final
     * leg — the customer experienced all of it.
     *
     * `resolvedAtEstimated` is cleared here: whatever the migration guessed,
     * this one we watched happen.
     */
    data.resolvedAt = at;
    data.resolutionMinutes = minutesBetween(ticket.createdAt, at);
    data.resolvedAtEstimated = false;
  } else if (ticket.status === 'solved') {
    // Leaving solved in any direction is a reopen — by the customer replying,
    // or by support taking its own work back.
    data.reopenedCount = Number(ticket.reopenedCount || 0) + 1;
  }

  /*
   * A history row only where the status actually MOVED.
   *
   * This table is a record of transitions, not of activity — two consecutive
   * support replies leave the ticket pending both times, and the second is not
   * a status change. Writing it anyway is not merely noise: `getReopens`
   * identifies a reopen as a non-solved row following a solved one, so a
   * second reply after a reopened ticket would have been counted as a second
   * reopen. The fact that support replied twice is already in the messages
   * table, which is where it belongs.
   */
  if (nextStatus !== ticket.status) {
    await tx.supportTicketStatusHistory.create({
      data: {
        ticketId: ticket.id,
        status: nextStatus,
        at,
        byType: actor?.type || 'system',
        byId: actor?.id || null,
        byName: actor?.name || '',
        note,
      },
    });
  }

  return data;
};

module.exports = {
  minutesBetween, slaFor, defaultPriority, prioritiesFrom, labelFor, applyTransition,
};
