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
 * The rate in force for a deployment *right now*, given its status: the full
 * compute price while it runs, the much lower storage price while it is paused
 * or stopped, and nothing at all once it is terminated or was never live.
 *
 * It lives in this leaf module rather than on the wrapped deployment document
 * so the modules below deploymentService — the usage summary, in particular —
 * can price un-billed time without requiring deploymentService back and
 * creating a cycle (deploymentService → deploymentBilling →
 * deploymentUsageService). Works on any plain deployment-shaped object,
 * including a bare Prisma row.
 */
const currentRateFor = (deployment) => {
  if (BILLABLE_STATUSES.includes(deployment?.status)) {
    return applyDiscount(deployment.pricePerHour, deployment.planDiscountPercent);
  }
  if (STORAGE_BILLABLE_STATUSES.includes(deployment?.status)) {
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
  hasLiveAccess,
  applyDiscount,
  currentRateFor,
};
