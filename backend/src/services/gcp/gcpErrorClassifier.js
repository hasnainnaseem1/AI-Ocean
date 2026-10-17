/**
 * What a GCP failure means, and what should happen next.
 *
 * This decides, for every way `instances.insert` can fail, whether the
 * reconciler should try again, try somewhere else, give up and tell a human, or
 * treat the failure as success.
 *
 * It is pure and separately tested for the same reason the dunning schedule is:
 * these are the paths that only run when something has already gone wrong, so
 * they are the paths least likely to be exercised by hand and most likely to be
 * wrong when they finally matter. Getting "quota exceeded" classified as
 * retryable would mean hammering GCP every minute forever while no customer
 * gets a machine and nobody is told.
 *
 * ── The four outcomes ──
 *
 *   retry        transient. Same zone, after a backoff.
 *   move_zone    this zone cannot place the machine. Try the next one.
 *   adopt        the machine already exists — this is our own earlier attempt.
 *   fail         no retry will help. A human has to change something.
 *
 * `fail` always carries `requiresHumanAction: true`, which is the same flag the
 * manual provisioning driver raises, so it lands in the admin queue that
 * already exists rather than needing a new one.
 */

/** Pull a usable code out of whatever shape the SDK or the REST API handed back. */
const extract = (error) => {
  const err = error || {};
  const fromErrors = err?.errors?.[0] || {};
  const fromResponse = err?.response?.data?.error || {};
  const operationError = err?.operationError || {};

  const code = String(
    operationError.code
    || fromErrors.reason
    || err.reason
    || fromResponse.status
    || err.code
    || '',
  ).toUpperCase();

  const status = Number(err.status || err.statusCode || fromResponse.code || 0) || 0;
  const message = String(operationError.message || fromErrors.message || err.message || fromResponse.message || '');

  return { code, status, message };
};

/**
 * Codes GCP returns when a zone physically cannot place the machine right now.
 *
 * This is routine rather than exceptional, especially for GPU shapes — a zone
 * runs out of A100s the way a hotel runs out of rooms. Retrying in the same
 * zone is pointless; the next zone is often fine.
 */
const ZONE_CODES = [
  'ZONE_RESOURCE_POOL_EXHAUSTED',
  'ZONE_RESOURCE_POOL_EXHAUSTED_WITH_DETAILS',
  'RESOURCE_POOL_EXHAUSTED',
  'RESOURCE_AVAILABILITY',
];

/** Transient: the API or the zone had a bad moment. */
const RETRY_CODES = [
  'INTERNAL_ERROR',
  'BACKEND_ERROR',
  'SERVICE_UNAVAILABLE',
  'RESOURCE_NOT_READY',
  'OPERATION_CANCELED_BY_USER',
  'DEADLINE_EXCEEDED',
  'UNAVAILABLE',
  'ABORTED',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
];

/** The machine is already there — almost always our own previous attempt. */
const EXISTS_CODES = [
  'RESOURCE_ALREADY_EXISTS',
  'ALREADY_EXISTS',
  'CONFLICT',
];

/** Nothing will change until a person changes it. */
const HUMAN_CODES = {
  QUOTA_EXCEEDED: 'GCP quota is exhausted. Request more in the GCP console (IAM & Admin -> Quotas); no retry will help until then.',
  RESOURCE_EXHAUSTED: 'GCP quota is exhausted. Request more in the GCP console; no retry will help until then.',
  LIMIT_EXCEEDED: 'A GCP limit was hit. Check quotas for this project and region.',
  PERMISSION_DENIED: 'The platform service account is missing a permission. Check it still holds roles/compute.instanceAdmin.v1 and actAs on the customer-vm account.',
  FORBIDDEN: 'GCP refused the call. Usually a missing IAM role or a disabled API on the project.',
  UNAUTHORIZED: 'GCP rejected the credentials. The service account key in Admin -> Integrations may have been revoked or rotated.',
  INVALID_CREDENTIALS: 'GCP rejected the credentials. Re-add the service account key in Admin -> Integrations.',
  NOT_FOUND: 'Something the instance needs does not exist — usually the subnet, the image or the service account. Check the Terragrunt baseline has been applied to this project.',
  INVALID_FIELD_VALUE: 'GCP rejected part of the instance request. This is a bug in the spec mapper or a tier GCP cannot build.',
  INVALID_USAGE: 'GCP rejected the combination requested — commonly a GPU attached to a machine family that cannot carry it.',
  INVALID_ARGUMENT: 'GCP rejected the instance request as malformed.',
  CONDITION_NOT_MET: 'A precondition failed. Usually the project is missing an enabled API.',
  BILLING_DISABLED: 'Billing is not enabled on the GCP project. Nothing can be created until it is.',
  COMPUTE_API_DISABLED: 'The Compute Engine API is not enabled on this project.',
};

/**
 * Classify a failure.
 *
 * @returns {{action: 'retry'|'move_zone'|'adopt'|'fail', code: string, message: string,
 *            retryable: boolean, requiresHumanAction: boolean}}
 */
const classify = (error) => {
  const { code, status, message } = extract(error);
  const haystack = `${code} ${message}`.toUpperCase();

  const hit = (list) => list.some((c) => code === c || haystack.includes(c));

  if (hit(EXISTS_CODES)) {
    return {
      action: 'adopt',
      code: code || 'RESOURCE_ALREADY_EXISTS',
      message: 'The instance already exists — adopting the one from the earlier attempt rather than creating a second.',
      retryable: false,
      requiresHumanAction: false,
    };
  }

  if (hit(ZONE_CODES)) {
    return {
      action: 'move_zone',
      code: code || 'ZONE_RESOURCE_POOL_EXHAUSTED',
      message: `This zone has no capacity for that shape right now. ${message}`.trim(),
      retryable: true,
      requiresHumanAction: false,
    };
  }

  const humanCode = Object.keys(HUMAN_CODES).find((c) => code === c || haystack.includes(c));
  if (humanCode) {
    return {
      action: 'fail',
      code: humanCode,
      message: HUMAN_CODES[humanCode],
      retryable: false,
      requiresHumanAction: true,
    };
  }

  if (hit(RETRY_CODES) || status === 429 || (status >= 500 && status <= 599)) {
    return {
      action: 'retry',
      code: code || `HTTP_${status}`,
      message: `Temporary GCP failure, will try again. ${message}`.trim(),
      retryable: true,
      requiresHumanAction: false,
    };
  }

  /*
   * Unknown. Treated as permanent on purpose.
   *
   * The safe default for an unrecognised failure is to stop and tell someone,
   * not to keep trying: a retry loop against an error nobody has classified is
   * how a platform spends a weekend calling an API that will never say yes,
   * while the customer waits and no alert fires.
   */
  return {
    action: 'fail',
    code: code || (status ? `HTTP_${status}` : 'UNKNOWN'),
    message: `Unrecognised GCP failure, so it is being treated as permanent: ${message || 'no detail returned'}`,
    retryable: false,
    requiresHumanAction: true,
  };
};

/**
 * How long to wait before the next attempt.
 *
 * Exponential with a ceiling, and a deterministic spread so a batch of
 * deployments that all failed on the same GCP hiccup do not come back in
 * lockstep and reproduce it.
 */
const backoffSeconds = (attempt, { base = 30, max = 900, seed = 0 } = {}) => {
  const n = Math.max(0, Number(attempt) || 0);
  const raw = Math.min(max, base * (2 ** n));
  const spread = (Math.abs(Number(seed) || 0) % 20) / 100; // 0 to 19%
  return Math.round(raw * (1 + spread));
};

module.exports = {
  classify,
  backoffSeconds,
  ZONE_CODES,
  RETRY_CODES,
  EXISTS_CODES,
  HUMAN_CODES,
};
