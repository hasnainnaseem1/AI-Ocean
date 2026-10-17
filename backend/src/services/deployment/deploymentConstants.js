/**
 * Deployment status vocabulary — kept as a leaf module with zero dependencies
 * (no database dependency at all) so every file that only needs to classify a status
 * (billing, endpoints, jobs, the admin queue) can depend on it without risking
 * a require cycle with deploymentService.js, which depends on most of them.
 *
 * Ported from the original Deployment.js statics — see that
 * file's comments for the reasoning behind each list.
 */

const STATUSES = [
  'pending_review',
  'approved',
  'rejected',
  'provisioning',
  'running',
  'paused',
  'stopped',
  'failed',
  'terminated',
];

const BILLABLE_STATUSES = ['running'];
const STORAGE_BILLABLE_STATUSES = ['paused', 'stopped'];
const ACTIVE_STATUSES = ['pending_review', 'approved', 'provisioning', 'running', 'paused'];
const ACCESS_STATUSES = ['running'];
const TERMINAL_STATUSES = ['terminated', 'rejected', 'failed'];

/** Works on any plain deployment-shaped object. */
const hasLiveAccess = (deployment) =>
  ACCESS_STATUSES.includes(deployment?.status) && deployment?.endpoint?.active !== false;

/** Prisma hands money back as Decimal objects; everything here wants numbers. */
const num = (d) => (d === null || d === undefined
  ? 0
  : (typeof d === 'object' && d.toNumber ? d.toNumber() : Number(d)));

const applyDiscount = (rate, discountPercent) =>
  Math.round(num(rate) * (1 - (num(discountPercent) || 0) / 100) * 10000) / 10000;

/**
 * ── Is the customer being charged the compute rate right now? ──
 *
 * For most of this platform's life the answer was simply `status === 'running'`,
 * because a human built the machine and flipped the status in the same minute.
 * Automatic provisioning pulls those apart: GCP reports a VM RUNNING, and the
 * deployment stays `provisioning` until the model inside it is configured,
 * which on a large model is a long time. The platform pays Google for every
 * minute of that gap.
 *
 * So the meter follows the hardware. `computeClockStartedAt` is set from GCP's
 * own timestamp when the instance reaches RUNNING and cleared when it stops;
 * while it is set, the compute rate applies whatever the status says.
 *
 * Terminal statuses win over the clock. A deployment that has been terminated
 * bills nothing even if a clock was somehow left behind — the alternative is
 * charging for a machine that no longer exists, which is the one error this
 * whole mechanism exists to avoid making in the other direction.
 *
 * Works on a bare Prisma row as well as a wrapped doc, which is why it reads
 * the column name rather than anything the wrapper adds.
 */
const isComputeBillable = (deployment) => {
  if (!deployment || TERMINAL_STATUSES.includes(deployment.status)) return false;
  if (BILLABLE_STATUSES.includes(deployment.status)) return true;
  return !!deployment.computeClockStartedAt;
};

/**
 * Storage: the disk a stopped machine still occupies.
 *
 * A running compute clock takes precedence — a machine cannot be charged both
 * rates at once, and if real hardware is running then compute is what it costs.
 */
const isStorageBillable = (deployment) => {
  if (!deployment || TERMINAL_STATUSES.includes(deployment.status)) return false;
  if (deployment.computeClockStartedAt) return false;
  return STORAGE_BILLABLE_STATUSES.includes(deployment.status);
};

/**
 * The Prisma `where` that selects everything currently earning.
 *
 * It has to be a disjunction rather than a status list, because a deployment
 * with a running compute clock may be sitting in `provisioning` — a status that
 * has never been billable before and still is not, on its own.
 *
 * Exported as a value rather than inlined at the four call sites so that
 * "what counts as billable" is one definition rather than four that can drift.
 */
const BILLABLE_WHERE = {
  OR: [
    { status: { in: [...BILLABLE_STATUSES, ...STORAGE_BILLABLE_STATUSES] } },
    { computeClockStartedAt: { not: null }, status: { notIn: TERMINAL_STATUSES } },
  ],
};

/**
 * The rate in force for a deployment *right now*: the full compute price while
 * real hardware is running, the much lower storage price while it is paused or
 * stopped, and nothing at all once it is terminated or was never live.
 *
 * It lives in this leaf module rather than on the wrapped deployment document
 * so the modules below deploymentService — the usage summary, in particular —
 * can price un-billed time without requiring deploymentService back and
 * creating a cycle (deploymentService → deploymentBilling →
 * deploymentUsageService). Works on any plain deployment-shaped object,
 * including a bare Prisma row.
 */
const currentRateFor = (deployment) => {
  if (isComputeBillable(deployment)) {
    return applyDiscount(deployment.pricePerHour, deployment.planDiscountPercent);
  }
  if (isStorageBillable(deployment)) {
    return applyDiscount(deployment.stoppedPricePerHour, deployment.planDiscountPercent);
  }
  return 0;
};

module.exports = {
  STATUSES,
  BILLABLE_STATUSES,
  STORAGE_BILLABLE_STATUSES,
  ACTIVE_STATUSES,
  ACCESS_STATUSES,
  TERMINAL_STATUSES,
  BILLABLE_WHERE,
  hasLiveAccess,
  applyDiscount,
  isComputeBillable,
  isStorageBillable,
  currentRateFor,
};
