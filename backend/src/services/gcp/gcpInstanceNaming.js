/**
 * What a customer's machine is called on GCP, and how it is labelled.
 *
 * ── Why the name is derived, not generated ──
 *
 * GCP instance names are unique per zone, and that uniqueness is the platform's
 * idempotency. If `instances.insert` is called twice for one deployment — a
 * double-click, a retry after a timeout whose write never landed, two processes
 * racing — the second call must fail with `ALREADY_EXISTS` rather than
 * succeeding and leaving two machines billing against one order.
 *
 * A random name would make that impossible. A derived one makes it free: the
 * same deployment always produces the same name, so GCP itself refuses the
 * duplicate and the caller can treat that refusal as "already done".
 *
 * ── What the name may and may not say ──
 *
 * Instance names are visible in internal DNS (`<name>.c.<project>.internal`),
 * and every customer VM shares a project. So the name must not carry anything
 * that identifies a customer: no team name, no email, no deployment label the
 * customer chose. A deployment's UUID is safe — it identifies a row in our
 * database and is useless to anyone without access to it — and keeping it in
 * the name is what lets an admin match a running instance to an order without
 * a lookup table.
 *
 * Pure: no SDK, no database, no clock.
 */

/**
 * GCP's rules for an instance name: 1-63 characters, lowercase letters, digits
 * and hyphens, must start with a letter, must not end with a hyphen.
 */
const MAX_NAME_LENGTH = 63;
const NAME_PATTERN = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;

/** Everything this platform creates carries this, and the orphan sweep looks for it. */
const MANAGED_BY = 'aiocean';

const PREFIX = 'aio';

/**
 * The instance name for a deployment.
 *
 * `aio-<deployment uuid>` — 40 characters, well inside GCP's limit, stable for
 * the life of the deployment.
 */
const instanceName = (deploymentId) => {
  const id = String(deploymentId || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!id) throw new Error('instanceName requires a deployment id');
  return `${PREFIX}-${id}`.slice(0, MAX_NAME_LENGTH).replace(/-+$/, '');
};

/** The boot disk's name. Same derivation, same idempotency. */
const bootDiskName = (deploymentId) => `${instanceName(deploymentId)}-boot`;

/**
 * Is this a name this platform would have produced?
 *
 * Used by the orphan sweep: an instance in our project whose name does not look
 * like ours is somebody's manual experiment, and deleting it would be a
 * surprise. Labels are the primary signal; this is the second opinion.
 */
const isOurs = (name) => typeof name === 'string' && name.startsWith(`${PREFIX}-`);

/**
 * Recover the deployment id from an instance name.
 *
 * The orphan sweep needs this: it lists instances from GCP and has to ask the
 * database "is this one still wanted". Returns null for anything that is not
 * ours, so a foreign instance can never be mistaken for a deployment.
 */
const deploymentIdFromName = (name) => {
  if (!isOurs(name)) return null;
  const rest = String(name).slice(PREFIX.length + 1);
  return rest || null;
};

/**
 * Labels GCP will carry on the instance.
 *
 * Labels do three jobs, and all three matter:
 *  - **Cost attribution.** GCP billing export can group by label, so what a
 *    deployment actually cost us is answerable without guessing.
 *  - **The orphan sweep.** Listing by `managed-by=aiocean` is how we find
 *    machines that outlived their deployment and are quietly billing.
 *  - **Debugging.** An admin looking at the GCP console can get back to the
 *    order without a lookup.
 *
 * GCP requires lowercase letters, digits, hyphens and underscores, 63
 * characters each, so values are normalised rather than assumed to be clean.
 */
const labelValue = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);

const instanceLabels = ({ deploymentId, teamId, environment = 'staging' }) => {
  const labels = {
    'managed-by': MANAGED_BY,
    'deployment-id': labelValue(deploymentId),
    environment: labelValue(environment) || 'unknown',
  };
  // The team id is for cost attribution only. It is a UUID, so it names a row
  // rather than a person or a company.
  if (teamId) labels['team-id'] = labelValue(teamId);
  return labels;
};

/** The filter the orphan sweep passes to `instances.aggregatedList`. */
const managedInstanceFilter = (environment) => {
  const env = labelValue(environment);
  return env
    ? `labels.managed-by=${MANAGED_BY} AND labels.environment=${env}`
    : `labels.managed-by=${MANAGED_BY}`;
};

/** Would GCP accept this name? Checked before calling, so the error is ours and legible. */
const isValidName = (name) =>
  typeof name === 'string' && name.length <= MAX_NAME_LENGTH && NAME_PATTERN.test(name);

module.exports = {
  MANAGED_BY,
  MAX_NAME_LENGTH,
  instanceName,
  bootDiskName,
  isOurs,
  deploymentIdFromName,
  instanceLabels,
  managedInstanceFilter,
  labelValue,
  isValidName,
};
