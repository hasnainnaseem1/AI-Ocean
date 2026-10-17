/**
 * Each cloud's reconciler touches only its own cloud's rows.
 *
 * ── The bug this exists to prevent ──
 *
 * `listPending` had no provider filter, so the Google reconciler — which runs
 * every minute — picked up AWS instance rows and handed them to `gcpClient`:
 *
 *   1. An AWS machine is building. Its row is `creating`, holding the AWS
 *      instance id `i-0abc…` and the availability zone `eu-west-1a`.
 *   2. The Google job lists pending rows and gets that one.
 *   3. It calls `gcpClient.getZoneOperation({ zone: 'eu-west-1a',
 *      operationName: 'i-0abc…' })`. Google has heard of neither.
 *   4. The call fails. The error classifier reads it as a failed build.
 *   5. The row is marked failed or retried — for a machine that is running on
 *      AWS right now and billing by the hour.
 *
 * Latent while AWS is in dry run, live the moment it is not. Same shape as the
 * orphan destroy that asked the wrong cloud: a destructive action deciding for
 * itself which cloud a machine is on, instead of reading what was recorded.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const instanceStore = require('../../services/gcp/deploymentInstanceService');

/**
 * Capture the `where` a query would use, without a database.
 *
 * `listPending` builds its filter and hands it straight to Prisma, so the
 * filter is the thing worth asserting — running it against real rows would
 * test Prisma rather than this decision.
 */
const captureWhere = (fn) => {
  const prisma = require('../../lib/prismaClient');
  const real = prisma.deploymentInstance.findMany;
  let captured = null;
  prisma.deploymentInstance.findMany = async (args) => { captured = args; return []; };
  try {
    fn();
  } finally {
    prisma.deploymentInstance.findMany = real;
  }
  return captured;
};

describe('listPending asks for one cloud at a time', () => {
  test('a provider is included in the filter when given', () => {
    const args = captureWhere(() => instanceStore.listPending({ provider: 'gcp' }));
    assert.equal(args.where.provider, 'gcp');
  });

  test('and AWS gets AWS rows, not Google ones', () => {
    const args = captureWhere(() => instanceStore.listPending({ provider: 'aws' }));
    assert.equal(args.where.provider, 'aws');
  });

  test('the phase filter still works alongside it', () => {
    const args = captureWhere(() => instanceStore.listPending({ provider: 'gcp' }));
    // Still only rows with something outstanding — a provider filter that
    // also widened the phases would make the job poll settled machines.
    const phases = args.where.OR.find((c) => c.phase?.in)?.phase.in;
    assert.deepEqual(phases, ['creating', 'stopping']);
  });

  test('omitting it returns every cloud, for a count that acts on nothing', () => {
    const args = captureWhere(() => instanceStore.listPending({}));
    assert.equal(args.where.provider, undefined);
  });
});

describe('the Google reconciler names its cloud', () => {
  test('it passes provider: gcp when listing work', () => {
    /*
     * Read from the source rather than run the job, which needs a database, a
     * settings row and a Google client. The call site is the whole decision:
     * if the argument is dropped, the job silently goes back to picking up
     * AWS rows and nothing else in the system objects.
     */
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../gcpReconciler'), 'utf8');

    const call = src.match(/listPending\(\{[^}]*\}\)/);
    assert.ok(call, 'gcpReconciler must call listPending');
    assert.match(
      call[0],
      /provider:\s*'gcp'/,
      'the Google reconciler must ask for Google rows only — without it, it polls AWS '
      + 'machines against Google and marks running ones failed',
    );
  });

  test('its stale-machine alert is scoped to Google too', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../gcpReconciler'), 'utf8');

    // The alertStale query, which also ran across every cloud.
    const query = src.match(/deploymentInstance\.findMany\(\{[\s\S]{0,400}?\}\)/);
    assert.ok(query, 'alertStale must query deploymentInstance');
    assert.match(query[0], /provider:\s*'gcp'/);
  });
});

describe('the AWS sweep is scoped to AWS rows', () => {
  test('it looks up known instances by provider', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../awsReconciler'), 'utf8');

    // Otherwise a Google machine sharing a name would be read as accounted
    // for, and a real AWS orphan would go unreported.
    assert.match(src, /provider:\s*'aws'/);
  });
});
