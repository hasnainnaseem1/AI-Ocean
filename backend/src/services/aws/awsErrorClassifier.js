/**
 * What to do about an error from AWS.
 *
 * The AWS twin of `gcpErrorClassifier.js`, answering the same four-way
 * question — retry, move somewhere else, adopt what already exists, or stop
 * and tell a human — from AWS's own error codes.
 *
 * ── The rule that decides the default ──
 *
 * An error this file does not recognise is treated as **permanent**. That is
 * deliberate and it is the safe direction: retrying an unknown failure forever
 * burns quota, fills logs, and hides the real problem, while stopping and
 * raising it costs one deployment and gets somebody looking. The opposite
 * default turns one bad tier into a retry storm nobody notices until the bill.
 *
 * Pure: no network, no clock.
 */

/** Capacity. Another availability zone may well have room. */
const AZ_CODES = [
  'InsufficientInstanceCapacity',
  'InsufficientHostCapacity',
  'InsufficientReservedInstanceCapacity',
  'Unsupported', // the instance type is not offered in this AZ
];

/** Transient. The same request will probably work shortly. */
const RETRY_CODES = [
  'RequestLimitExceeded',
  'Throttling',
  'ThrottlingException',
  'ServiceUnavailable',
  'InternalError',
  'InternalFailure',
  'Unavailable',
  // The instance exists but is still settling; the next poll will find it.
  'InvalidInstanceID.NotFound',
];

/** It already exists. Our earlier attempt got further than we recorded. */
const EXISTS_CODES = [
  'IdempotentParameterMismatch',
  'InvalidClientToken.Duplicate',
];

/**
 * Things a human has to fix. The value is what to tell them — these reach the
 * admin screen, so they say what to do rather than restating the code.
 */
const HUMAN_CODES = {
  UnauthorizedOperation:
    'The AWS credentials are not allowed to do this. Check the platform-runtime policy in '
    + 'infra/aws/modules/iam.',
  'AuthFailure':
    'AWS rejected the credentials. Re-add the access key under Cloud → AWS → Connection.',
  'InvalidClientTokenId':
    'The AWS access key id is not recognised. Re-add it under Cloud → AWS → Connection.',
  'SignatureDoesNotMatch':
    'AWS rejected the request signature. The secret access key is probably wrong or truncated.',
  'VcpuLimitExceeded':
    'This AWS account is at its vCPU quota for that instance family. Request an increase in '
    + 'Service Quotas — note AWS counts vCPUs, not instances.',
  'InstanceLimitExceeded':
    'This AWS account is at its instance limit. Request an increase in Service Quotas.',
  'InvalidParameterValue':
    'AWS rejected one of the launch parameters. The instance type, AMI or subnet is probably '
    + 'wrong for this region.',
  'InvalidSubnetID.NotFound':
    'The configured subnet does not exist. Check the subnet ids under Cloud → AWS → Connection '
    + 'against what infra/aws built.',
  'InvalidGroup.NotFound':
    'The configured security group does not exist. Check it under Cloud → AWS → Connection.',
  'InvalidAMIID.NotFound':
    'The configured AMI does not exist in this region. AMI ids are per-region.',
  'OptInRequired':
    'This AWS account has not been enabled for that instance type or region.',
};

/** Pull a code and message out of whatever shape the caller caught. */
const extract = (error) => {
  if (!error) return { code: '', message: '', status: null };

  // The EC2 query API returns XML; awsClient parses the code out and attaches
  // it. Everything else is best-effort.
  const code = error.awsCode || error.code || error.Code || '';
  const message = error.awsMessage || error.message || '';
  const status = error.status || error.statusCode || null;

  return { code: String(code), message: String(message), status };
};

/**
 * @returns {{action: 'retry'|'move_az'|'adopt'|'fail', code, message,
 *   retryable: boolean, requiresHumanAction: boolean}}
 */
const classify = (error) => {
  const { code, message, status } = extract(error);
  const haystack = `${code} ${message}`;

  const hit = (list) => list.some((c) => code === c || haystack.includes(c));

  if (hit(EXISTS_CODES)) {
    return {
      action: 'adopt',
      code: code || 'AlreadyExists',
      message: 'The instance already exists — adopting the one from the earlier attempt rather '
        + 'than creating a second.',
      retryable: false,
      requiresHumanAction: false,
    };
  }

  if (hit(AZ_CODES)) {
    return {
      action: 'move_az',
      code: code || 'InsufficientInstanceCapacity',
      message: `This availability zone has no capacity for that instance type right now. ${message}`.trim(),
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

  if (hit(RETRY_CODES) || status === 429 || (status >= 500 && status < 600)) {
    return {
      action: 'retry',
      code: code || `HTTP_${status}`,
      message: `AWS could not answer right now. ${message}`.trim(),
      retryable: true,
      requiresHumanAction: false,
    };
  }

  /*
   * Unknown. Permanent on purpose — see the file header.
   */
  return {
    action: 'fail',
    code: code || 'UNKNOWN',
    message: `Unrecognised AWS failure, so it is being treated as permanent: ${message || 'no detail given'}`,
    retryable: false,
    requiresHumanAction: true,
  };
};

/**
 * How long to wait before attempt N.
 *
 * Exponential with a ceiling, plus a deterministic spread from the deployment
 * id so that twenty deployments failing at once do not all retry on the same
 * second and fail again together.
 */
const backoffSeconds = (attempt, { seed = 0 } = {}) => {
  const n = Math.max(1, Number(attempt) || 1);
  const raw = Math.min(300, 15 * 2 ** (n - 1));
  const spread = (Math.abs(Number(seed) || 0) % 20) / 100; // 0 to 19%
  return Math.round(raw * (1 + spread));
};

module.exports = {
  classify,
  backoffSeconds,
  AZ_CODES,
  RETRY_CODES,
  EXISTS_CODES,
  HUMAN_CODES,
};
