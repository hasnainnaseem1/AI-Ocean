/**
 * The region flow: a deployment's region decides where the machine is built,
 * and where every later call about it is sent.
 *
 * Each test here corresponds to a bug that was actually present, and each one
 * fails loudly if that bug comes back. They are grouped by the thing that goes
 * wrong in production when the behaviour regresses, because that is what makes
 * a failure here worth reading.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const regionMap = require('../awsRegionMap');
const shape = require('../awsSettingsShape');
const cloudRegions = require('../../cloud/cloudRegions');
const awsDriver = require('../awsDriver');
const gcpDriver = require('../../gcp/gcpDriver');

describe('an availability zone maps back to exactly one region', () => {
  test('every AZ in the map resolves to the region that owns it', () => {
    for (const entry of Object.values(regionMap.REGIONS)) {
      for (const az of entry.azs) {
        const got = regionMap.regionOfAz(az);
        assert.equal(got.ok, true, `${az} should resolve`);
        assert.equal(got.awsRegion, entry.awsRegion);
      }
    }
  });

  test('an unknown AZ is REFUSED, never guessed at', () => {
    /*
     * The tempting implementation is `az.slice(0, -1)`. It is wrong for Local
     * Zones (`us-east-1-bos-1a`) and would produce `us-east-1-bos-1` — a
     * region that does not exist, which gets signed for and fails with an
     * opaque credential error instead of a clear one.
     */
    for (const bad of ['us-east-1-bos-1a', 'eu-west-9z', '', null, 'eu-west-1']) {
      const got = regionMap.regionOfAz(bad);
      assert.equal(got.ok, false, `${JSON.stringify(bad)} must not resolve`);
    }
  });

  test('a bare region is not an AZ — it has no subnet and cannot place anything', () => {
    assert.equal(regionMap.regionOfAz('eu-west-1').ok, false);
  });
});

describe('AWS settings hold one block per region, because AWS resources are regional', () => {
  test('a VPC, security group, subnet and AMI are all per region', () => {
    for (const field of ['vpcId', 'securityGroupId', 'imageId', 'subnetIds']) {
      assert.ok(
        shape.REGIONAL_FIELDS.includes(field),
        `${field} is regional on AWS and must not be stored once for every region`,
      );
    }
  });

  test('the IAM instance profile is NOT per region, because IAM is global', () => {
    assert.ok(shape.GLOBAL_FIELDS.includes('instanceProfile'));
    assert.ok(!shape.REGIONAL_FIELDS.includes('instanceProfile'));
  });

  test('two regions can be configured independently', () => {
    const norm = shape.normalize({
      instanceProfile: 'aiocean-customer-vm',
      regions: {
        'eu-west-1': {
          vpcId: 'vpc-0aaa1111', securityGroupId: 'sg-0aaa1111', imageId: 'ami-0aaa1111',
          subnetIds: { 'eu-west-1a': 'subnet-0aaa1111' },
        },
        'ap-south-1': {
          vpcId: 'vpc-0bbb2222', securityGroupId: 'sg-0bbb2222', imageId: 'ami-0bbb2222',
          subnetIds: { 'ap-south-1a': 'subnet-0bbb2222' },
        },
      },
    });

    const eu = shape.infraFor(norm, 'eu-west-1');
    const ap = shape.infraFor(norm, 'ap-south-1');

    assert.equal(eu.ok, true);
    assert.equal(ap.ok, true);
    assert.notEqual(eu.vpcId, ap.vpcId);
    // The AMI differs per region: an ami- id names a different image, usually
    // none at all, in another region.
    assert.notEqual(eu.imageId, ap.imageId);
    // IAM is global, so this one is shared.
    assert.equal(eu.instanceProfile, ap.instanceProfile);
  });

  test('an unbuilt region is refused, and the message says what is missing', () => {
    const norm = shape.normalize({
      regions: { 'eu-west-1': { vpcId: 'vpc-0aaa1111', subnetIds: {} } },
    });
    const got = shape.infraFor(norm, 'eu-west-1');

    assert.equal(got.ok, false);
    assert.equal(got.code, 'REGION_NOT_CONFIGURED');
    assert.ok(got.missing.includes('subnets'));
    assert.ok(got.missing.includes('security group'));
    assert.ok(got.missing.includes('machine image'));
    assert.match(got.message, /eu-west-1/);
  });

  test('a region nobody configured at all is refused, not silently defaulted', () => {
    const norm = shape.normalize({
      regions: {
        'eu-west-1': {
          vpcId: 'vpc-0aaa1111', securityGroupId: 'sg-0aaa1111', imageId: 'ami-0aaa1111',
          subnetIds: { 'eu-west-1a': 'subnet-0aaa1111' },
        },
      },
    });
    // Ireland is built; Mumbai is not. Mumbai must NOT inherit Ireland's ids —
    // that is what sends a launch to a subnet in the wrong region.
    assert.equal(shape.infraFor(norm, 'ap-south-1').ok, false);
    assert.deepEqual(shape.configuredRegions(norm), ['eu-west-1']);
  });
});

describe('the old single-region settings are folded in, not lost', () => {
  test('flat fields move under the region they were configured for', () => {
    const norm = shape.normalize({
      enabled: true,
      accountId: '123456789012',
      region: 'eu-west-1',
      vpcId: 'vpc-0legacy1',
      securityGroupId: 'sg-0legacy1',
      imageId: 'ami-0legacy1',
      subnetIds: { 'eu-west-1a': 'subnet-0legacy1' },
    });

    const infra = shape.infraFor(norm, 'eu-west-1');
    assert.equal(infra.ok, true);
    assert.equal(infra.vpcId, 'vpc-0legacy1');
    assert.equal(infra.subnetIds['eu-west-1a'], 'subnet-0legacy1');
    // The global fields survive too.
    assert.equal(norm.accountId, '123456789012');
  });

  test('normalizing twice changes nothing', () => {
    const once = shape.normalize({
      region: 'eu-west-1',
      vpcId: 'vpc-0legacy1',
      securityGroupId: 'sg-0legacy1',
      imageId: 'ami-0legacy1',
      subnetIds: { 'eu-west-1a': 'subnet-0legacy1' },
    });
    assert.deepEqual(shape.normalize(once), once);
  });

  test('a newer per-region edit beats a stale top-level leftover', () => {
    const norm = shape.normalize({
      region: 'eu-west-1',
      vpcId: 'vpc-0stale00',
      securityGroupId: 'sg-0stale00',
      imageId: 'ami-0stale00',
      subnetIds: { 'eu-west-1a': 'subnet-0stale00' },
      regions: {
        'eu-west-1': {
          vpcId: 'vpc-0fresh11', securityGroupId: 'sg-0fresh11', imageId: 'ami-0fresh11',
          subnetIds: { 'eu-west-1a': 'subnet-0fresh11' },
        },
      },
    });
    assert.equal(shape.infraFor(norm, 'eu-west-1').vpcId, 'vpc-0fresh11');
  });
});

describe('an id typed into the wrong field is caught', () => {
  test('a security group id in the VPC field is rejected', () => {
    const got = shape.validateRegion('eu-west-1', { vpcId: 'sg-0abc12345678' });
    assert.equal(got.ok, false);
    // The message must name the field as the AWS console names it, and show a
    // real example — a slice of the regex source tells an operator nothing.
    assert.ok(got.errors.some((e) => /VPC id/.test(e)), got.errors.join(' '));
    assert.ok(got.errors.some((e) => e.includes(shape.ID_EXAMPLES.vpcId)));
  });

  test('an AMI from another region is rejected, and the message explains why', () => {
    const got = shape.validateRegion('eu-west-1', { imageId: 'not-an-ami' });
    assert.equal(got.ok, false);
    assert.ok(got.errors.some((e) => /specific to one region/.test(e)), got.errors.join(' '));
  });

  test('a subnet in an AZ this platform does not use is rejected', () => {
    const got = shape.validateRegion('eu-west-1', {
      subnetIds: { 'eu-west-1z': 'subnet-0abc12345678' },
    });
    assert.equal(got.ok, false);
    assert.ok(got.errors.some((e) => /eu-west-1z/.test(e)));
  });

  test('a region this platform does not sell is rejected', () => {
    assert.equal(shape.validateRegion('ap-northeast-3', {}).ok, false);
  });

  test('a correct block passes', () => {
    const got = shape.validateRegion('eu-west-1', {
      vpcId: 'vpc-0abc12345678',
      securityGroupId: 'sg-0abc12345678',
      imageId: 'ami-0abc12345678',
      subnetIds: { 'eu-west-1a': 'subnet-0abc12345678' },
    });
    assert.deepEqual(got.errors, []);
    assert.equal(got.ok, true);
  });
});

describe('the catalogue only offers regions BOTH clouds can serve', () => {
  test('the two region maps agree', () => {
    const got = cloudRegions.assertSymmetric();
    assert.equal(got.ok, true, got.message);
  });

  test('the common set is non-empty, or nothing can be sold anywhere', () => {
    assert.ok(cloudRegions.commonRegions().length > 0);
  });

  test('every common region resolves on every cloud', () => {
    for (const region of cloudRegions.commonRegions()) {
      for (const cloud of ['gcp', 'aws']) {
        const got = cloudRegions.canServe(cloud, region);
        assert.equal(got.ok, true, `${cloud} cannot serve ${region}: ${got.reason}`);
      }
    }
  });

  test('a region neither cloud has is refused by both', () => {
    for (const cloud of ['gcp', 'aws']) {
      assert.equal(cloudRegions.canServe(cloud, 'mars-north-1').ok, false);
    }
  });
});

describe('both drivers place a machine from the DEPLOYMENT, not from a setting', () => {
  const deployment = (region) => ({
    id: '11111111-1111-4111-8111-111111111111',
    teamId: '22222222-2222-4222-8222-222222222222',
    deploymentName: 'probe',
    region,
    tierVcpu: 2,
    tierRamGb: 8,
    tierStorageGb: 50,
    tierStorageType: 'SSD',
    tierGpuCount: 0,
  });

  test('each platform region lands in a different cloud region, on both clouds', () => {
    for (const cloud of [{ d: awsDriver, k: 'awsRegion' }, { d: gcpDriver, k: 'gcpRegion' }]) {
      const seen = new Set();
      for (const region of cloudRegions.commonRegions()) {
        const plan = cloud.d.planFor(deployment(region), 0);
        assert.equal(plan.ok, true, `${cloud.d.name} could not plan ${region}: ${plan.message}`);
        const resolved = plan.region[cloud.k];
        assert.ok(resolved, `${cloud.d.name} produced no ${cloud.k} for ${region}`);
        assert.ok(!seen.has(resolved), `${cloud.d.name} sent two platform regions to ${resolved}`);
        seen.add(resolved);
      }
      assert.equal(seen.size, cloudRegions.commonRegions().length);
    }
  });

  test('the AZ a machine is placed in belongs to the region that was asked for', () => {
    for (const region of cloudRegions.commonRegions()) {
      const plan = awsDriver.planFor(deployment(region), 0);
      const owner = regionMap.regionOfAz(plan.az);
      assert.equal(owner.ok, true, `${plan.az} does not map back to a region`);
      assert.equal(
        owner.awsRegion,
        plan.region.awsRegion,
        `a machine for "${region}" was placed in ${plan.az}, which is in ${owner.awsRegion}, `
        + `not ${plan.region.awsRegion} — every later call about it would go to the wrong region`,
      );
    }
  });

  test('a region the platform does not sell is refused, not defaulted', () => {
    const plan = awsDriver.planFor(deployment('mars-north-1'), 0);
    assert.equal(plan.ok, false);
    assert.equal(plan.permanent, true);
  });
});
