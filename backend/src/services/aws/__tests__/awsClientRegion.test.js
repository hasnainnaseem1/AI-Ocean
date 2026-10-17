/**
 * Where an AWS call actually goes.
 *
 * `fetch` is replaced so the endpoint and the signed region can be inspected
 * without sending anything. This is the test for the bug that made every
 * non-default region unusable: the client held one configured region and used
 * it for every call, so a machine placed in a Mumbai subnet had its launch
 * sent to the Ireland endpoint, where AWS answers `InvalidSubnetID.NotFound`.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

const awsClient = require('../awsClient');

/** Settings with two regions genuinely built, as a real multi-region setup is. */
const TWO_REGIONS = {
  enabled: true,
  dryRun: false,
  accountId: '123456789012',
  accessKeyId: 'AKIATESTEXAMPLE12345',
  instanceProfile: 'aiocean-customer-vm',
  regions: {
    'eu-west-1': {
      vpcId: 'vpc-0eu1', securityGroupId: 'sg-0eu1', imageId: 'ami-0eu1',
      subnetIds: { 'eu-west-1a': 'subnet-0eu1a', 'eu-west-1b': 'subnet-0eu1b' },
    },
    'ap-south-1': {
      vpcId: 'vpc-0ap1', securityGroupId: 'sg-0ap1', imageId: 'ami-0ap1',
      subnetIds: { 'ap-south-1a': 'subnet-0ap1a', 'ap-south-1b': 'subnet-0ap1b' },
    },
  },
};

let sent;
let realFetch;

const prime = (settings = TWO_REGIONS) => {
  awsClient.clearCache();
  awsClient._settings = require('../awsSettingsShape').normalize(settings);
  awsClient._secret = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
  awsClient._initialized = true;
};

beforeEach(() => {
  sent = [];
  realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    sent.push({ url: String(url), headers: opts.headers });
    return { ok: true, status: 200, text: async () => '<r><instanceId>i-0real</instanceId></r>' };
  };
});

afterEach(() => {
  global.fetch = realFetch;
  awsClient.clearCache();
});

describe('a call goes to the region of the machine it is about', () => {
  const plan = { instanceType: 'm6i.large', bootDisk: { sizeGb: 50, type: 'gp3' } };

  test('a launch in Mumbai hits the Mumbai endpoint, signed for Mumbai', async () => {
    prime();
    await awsClient.runInstance({
      plan, az: 'ap-south-1a', deploymentId: 'd-1', teamId: 't-1',
    });

    assert.equal(sent.length, 1);
    assert.match(sent[0].url, /^https:\/\/ec2\.ap-south-1\.amazonaws\.com\//);
    // The signature covers the region; a mismatch is rejected by AWS outright.
    assert.match(sent[0].headers.Authorization, /Credential=[^/]+\/\d{8}\/ap-south-1\/ec2\/aws4_request/);
  });

  test('a launch in Ireland hits the Ireland endpoint — the same client, a different region', async () => {
    prime();
    await awsClient.runInstance({ plan, az: 'eu-west-1a', deploymentId: 'd-2', teamId: 't-1' });

    assert.match(sent[0].url, /^https:\/\/ec2\.eu-west-1\.amazonaws\.com\//);
    assert.match(sent[0].headers.Authorization, /\/eu-west-1\/ec2\//);
  });

  test("the launch uses the subnet, security group and AMI of ITS region", async () => {
    prime();
    const infra = await awsClient.infraFor('ap-south-1');
    const params = awsClient.buildRunInstancesParams({
      plan, az: 'ap-south-1a', infra, deploymentId: 'd-3', teamId: 't-1',
    });

    assert.equal(params['NetworkInterface.1.SubnetId'], 'subnet-0ap1a');
    assert.equal(params['NetworkInterface.1.SecurityGroupId.1'], 'sg-0ap1');
    // The bug most easily missed: an AMI id is regional too.
    assert.equal(params.ImageId, 'ami-0ap1');
    // IAM is global, so the profile is the shared one.
    assert.equal(params['IamInstanceProfile.Name'], 'aiocean-customer-vm');
  });

  test('Ireland and Mumbai never borrow each other\'s ids', async () => {
    prime();
    const eu = awsClient.buildRunInstancesParams({
      plan, az: 'eu-west-1a', infra: await awsClient.infraFor('eu-west-1'),
      deploymentId: 'd-4', teamId: 't-1',
    });
    const ap = awsClient.buildRunInstancesParams({
      plan, az: 'ap-south-1a', infra: await awsClient.infraFor('ap-south-1'),
      deploymentId: 'd-4', teamId: 't-1',
    });

    for (const key of ['NetworkInterface.1.SubnetId', 'NetworkInterface.1.SecurityGroupId.1', 'ImageId']) {
      assert.notEqual(eu[key], ap[key], `${key} must differ between regions`);
    }
  });
});

describe('a destroy goes where the machine IS, not where the deployment says', () => {
  test('terminate follows the recorded availability zone', async () => {
    prime();
    await awsClient.terminateInstance('i-0abc', 'ap-south-1a');
    assert.match(sent[0].url, /ec2\.ap-south-1\.amazonaws\.com/);
  });

  test('stop and start follow it too', async () => {
    prime();
    await awsClient.stopInstance('i-0abc', 'eu-west-1b');
    await awsClient.startInstance('i-0abc', 'ap-south-1b');

    assert.match(sent[0].url, /ec2\.eu-west-1\./);
    assert.match(sent[1].url, /ec2\.ap-south-1\./);
  });

  test('an unmappable zone REFUSES rather than picking a region', async () => {
    prime();
    await assert.rejects(
      () => awsClient.terminateInstance('i-0abc', 'us-east-1-bos-1a'),
      /not an availability zone this platform uses/,
    );
    assert.equal(sent.length, 0, 'nothing may be sent when the region is unknown');
  });
});

describe('the orphan sweep covers every region, and says so when it cannot', () => {
  test('it asks each configured region', async () => {
    prime();
    const result = await awsClient.listManagedInstances();

    assert.deepEqual(result.regions, ['ap-south-1', 'eu-west-1']);
    assert.equal(sent.length, 2);
    assert.ok(sent.some((s) => /ap-south-1/.test(s.url)));
    assert.ok(sent.some((s) => /eu-west-1/.test(s.url)));
    assert.equal(result.partial, false);
  });

  test('a region that fails makes the whole sweep PARTIAL', async () => {
    prime();
    global.fetch = async (url) => {
      if (/ap-south-1/.test(String(url))) {
        return { ok: false, status: 403, text: async () => '<Code>AuthFailure</Code>' };
      }
      return { ok: true, status: 200, text: async () => '<r></r>' };
    };

    const result = await awsClient.listManagedInstances();

    /*
     * This flag is load-bearing. "No live deployment owns this instance" and
     * "we could not ask the region it is in" produce the same empty list, and
     * deleting on the second destroys a running customer's machine.
     */
    assert.equal(result.partial, true);
    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0].region, 'ap-south-1');
  });
});

describe('a call with no region is refused', () => {
  test('because there is no safe region to fall back to', async () => {
    prime();
    await assert.rejects(
      () => awsClient.call('DescribeInstances', {}),
      /without a region/,
    );
    assert.equal(sent.length, 0);
  });
});

describe('dry run still works with nothing configured', () => {
  test('a launch is planned without any region being built', async () => {
    // The lesson from gcpClient, which once demanded a project id in dry run
    // and so made dry run useless.
    prime({ enabled: true, dryRun: true });

    const r = await awsClient.runInstance({
      plan: { instanceType: 'm6i.large', bootDisk: { sizeGb: 50, type: 'gp3' } },
      az: 'ap-south-1a',
      deploymentId: 'd-dry',
      teamId: 't-1',
    });

    assert.equal(r.dryRun, true);
    assert.equal(r.region, 'ap-south-1');
    assert.equal(sent.length, 0, 'dry run must send nothing');
    // The placeholder ids are obviously fake, so nobody mistakes them for real.
    assert.match(r.params['NetworkInterface.1.SubnetId'], /dryrun/);
  });
});
