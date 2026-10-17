/**
 * Names and tags for the instances this platform creates.
 *
 * ── Why the name is derived from the deployment id ──
 *
 * Same reasoning as the GCP side: a deterministic name turns "did my earlier
 * request get through?" from a question into a fact. But AWS answers it
 * differently from GCP, and the difference is worth stating.
 *
 * On GCP the instance name is unique per zone, so a duplicate `insert` is
 * rejected with ALREADY_EXISTS and the cloud itself enforces idempotency.
 * **AWS has no such constraint** — `RunInstances` twice creates two instances
 * with the same Name tag and no complaint. So on AWS idempotency has to be
 * asked for explicitly, via the `ClientToken` parameter, which AWS honours for
 * 24 hours. That token is derived here from the same deployment id, which is
 * what makes a double-fire safe.
 *
 * ── Why names carry no customer identifier ──
 *
 * Instance names and tags are visible to anything with read access to the
 * account, and leak into logs and bills. A name is an opaque id; who it belongs
 * to is a tag that is useful internally and meaningless outside.
 */

const PREFIX = 'aio';
const MANAGED_BY = 'aiocean';

/** `aio-<deployment uuid>`. Deterministic, opaque, and stable across retries. */
const instanceName = (deploymentId) => `${PREFIX}-${String(deploymentId || '').trim()}`;

/**
 * The idempotency token for RunInstances.
 *
 * AWS treats two RunInstances calls with the same ClientToken as one request
 * for 24 hours, returning the original instance rather than making a second.
 * Without it, a retry after a timeout — where the first call actually
 * succeeded — silently doubles a customer's bill.
 *
 * `attempt` is deliberately part of it: a DELIBERATE retry after a real
 * failure must be allowed to create an instance, while an accidental
 * double-fire of the same attempt must not.
 */
const clientToken = (deploymentId, attempt = 0) =>
  `${PREFIX}-${String(deploymentId || '').trim()}-${Math.max(0, Number(attempt) || 0)}`;

/** Is this one of ours? The orphan sweep's first question. */
const isOurs = (name) => typeof name === 'string' && name.startsWith(`${PREFIX}-`);

/** The deployment this name claims to belong to, or null. */
const deploymentIdFromName = (name) => {
  if (!isOurs(name)) return null;
  const id = name.slice(PREFIX.length + 1);
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
};

/**
 * Tags every instance carries.
 *
 * `managed-by` is what the orphan sweep filters on — by tag rather than by
 * name, so an instance somebody renamed is still recognised as ours.
 */
const instanceTags = ({ deploymentId, teamId, environment }) => [
  { Key: 'Name', Value: instanceName(deploymentId) },
  { Key: 'managed-by', Value: MANAGED_BY },
  { Key: 'deployment-id', Value: String(deploymentId || '') },
  // For cost allocation. AWS surfaces tags in Cost Explorer, so this is how
  // "what did this customer actually cost us" gets answered from the bill.
  { Key: 'team-id', Value: String(teamId || '') },
  { Key: 'environment', Value: String(environment || 'staging') },
];

module.exports = {
  PREFIX,
  MANAGED_BY,
  instanceName,
  clientToken,
  isOurs,
  deploymentIdFromName,
  instanceTags,
};
