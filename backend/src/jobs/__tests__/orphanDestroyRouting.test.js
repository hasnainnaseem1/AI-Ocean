/**
 * Which cloud a "destroy this orphan" press actually reaches.
 *
 * ── The bug this exists to prevent ──
 *
 * The resolve route used to call Google unconditionally. With one cloud that
 * was merely redundant. With two it is the most expensive bug in the codebase:
 *
 *   1. An admin presses Destroy on an AWS orphan.
 *   2. Google is asked to delete an instance it has never heard of.
 *   3. Google answers 404.
 *   4. The handler reads 404 as "already gone — the outcome we wanted".
 *   5. The row is marked `destroyed`, so no future sweep reports it.
 *   6. The AWS machine keeps running and keeps billing, forever, with nothing
 *      left in the system that knows it exists.
 *
 * Every step is individually reasonable, which is why it needs a test rather
 * than care. These assert the dispatch itself, with no network and no database.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const regionMap = require('../../services/aws/awsRegionMap');

/*
 * The dispatch, mirroring `deleteOrphanOnCloud` in
 * `routes/v1/admin/cloudInstances.routes.js`. Written against stand-in clients
 * so the decision can be asserted on its own; the contract tests below prove
 * the real clients still take these arguments.
 */
const makeDispatcher = (gcpClient, awsClient) => async (orphan) => {
  if (orphan.provider === 'aws') {
    const id = orphan.instanceId;
    if (!id) {
      const err = new Error(`No AWS instance id is recorded for ${orphan.instanceName}`);
      err.noHandle = true;
      throw err;
    }
    return awsClient.terminateInstance(id, orphan.zone);
  }
  return gcpClient.deleteInstance({ zone: orphan.zone, name: orphan.instanceName });
};

const spies = () => {
  const calls = { gcp: [], aws: [] };
  const gcpClient = { deleteInstance: async (a) => { calls.gcp.push(a); } };
  const awsClient = { terminateInstance: async (id, az) => { calls.aws.push({ id, az }); } };
  return { calls, destroy: makeDispatcher(gcpClient, awsClient) };
};

describe('a destroy goes to the cloud the machine is recorded on', () => {
  test('an AWS orphan is destroyed on AWS, and Google is never asked', async () => {
    const { calls, destroy } = spies();

    await destroy({
      provider: 'aws',
      instanceName: 'aio-abc',
      instanceId: 'i-0abc12345678',
      zone: 'ap-south-1a',
    });

    assert.equal(calls.aws.length, 1);
    assert.equal(calls.gcp.length, 0, 'Google must not be asked about an AWS machine');
    // By id, not by name: on AWS the name is a tag and a tag can be edited.
    assert.equal(calls.aws[0].id, 'i-0abc12345678');
    // And with the AZ, which is what picks the region for the call.
    assert.equal(calls.aws[0].az, 'ap-south-1a');
  });

  test('a Google orphan is destroyed on Google, and AWS is never asked', async () => {
    const { calls, destroy } = spies();

    await destroy({ provider: 'gcp', instanceName: 'aio-xyz', zone: 'europe-west4-a' });

    assert.equal(calls.gcp.length, 1);
    assert.equal(calls.aws.length, 0);
    assert.deepEqual(calls.gcp[0], { zone: 'europe-west4-a', name: 'aio-xyz' });
  });

  test('a row with no provider falls to Google, matching the schema default', async () => {
    const { calls, destroy } = spies();
    await destroy({ instanceName: 'aio-old', zone: 'europe-west4-a' });
    assert.equal(calls.gcp.length, 1);
  });
});

describe('an AWS orphan with no recorded id refuses rather than pretending', () => {
  test('nothing is sent to either cloud', async () => {
    const { calls, destroy } = spies();

    await assert.rejects(
      () => destroy({ provider: 'aws', instanceName: 'aio-abc', instanceId: null, zone: 'eu-west-1a' }),
      /No AWS instance id is recorded/,
    );

    assert.equal(calls.aws.length, 0);
    assert.equal(calls.gcp.length, 0);
  });

  test('and the error is flagged so the handler cannot read it as "already gone"', async () => {
    const { destroy } = spies();
    /*
     * The handler treats 404 / InvalidInstanceID.NotFound as success. A
     * missing handle must never reach that branch: nothing was asked of any
     * cloud, so "it is already gone" is not something we know.
     */
    const err = await destroy({ provider: 'aws', instanceName: 'x', zone: 'eu-west-1a' })
      .then(() => null, (e) => e);

    assert.equal(err.noHandle, true);

    const alreadyGone = !err.noHandle
      && (err.status === 404 || err.awsCode === 'InvalidInstanceID.NotFound');
    assert.equal(alreadyGone, false);
  });
});

describe('the real clients take the arguments this dispatch passes', () => {
  test('awsClient.terminateInstance takes (instanceId, az)', () => {
    const awsClient = require('../../services/aws/awsClient');
    assert.equal(typeof awsClient.terminateInstance, 'function');
    // (instanceId, az) — an arity of 1 would mean the AZ is being dropped and
    // the call would go to whatever region the client defaulted to.
    assert.equal(awsClient.terminateInstance.length, 2);
  });

  test('every AZ an orphan can be recorded in resolves to a region', () => {
    // The sweep writes `machine.az` into `zone`. If any AZ this platform uses
    // could not be turned back into a region, destroying that orphan would be
    // impossible — and the row would sit unresolved while the machine billed.
    for (const entry of Object.values(regionMap.REGIONS)) {
      for (const az of entry.azs) {
        assert.equal(regionMap.regionOfAz(az).ok, true, `${az} must resolve`);
      }
    }
  });
});
