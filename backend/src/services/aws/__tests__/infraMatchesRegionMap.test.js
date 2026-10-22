/**
 * The region map in code and the Terragrunt stack on disk agree.
 *
 * ── Why this is a test and not a comment ──
 *
 * These two lists have to match and live in different languages, in different
 * folders, maintained at different times. When they drifted the symptom was
 * the worst kind: `awsRegionMap` happily resolved `ap-south` to `ap-south-1`,
 * the catalogue sold a tier there, a customer ordered one, and the launch
 * failed at AWS with `InvalidSubnetID.NotFound` — because no VPC had ever been
 * built in that region. Nothing earlier in the chain had any reason to object.
 *
 * So the test reads the real HCL rather than a copy of it. A region added to
 * one side and not the other fails here, in the second it is added, instead of
 * at a customer's first deployment.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const regionMap = require('../awsRegionMap');

const INFRA = path.resolve(__dirname, '../../../../../infra/aws/live/staging');

/** The region folders on disk — anything with a `region.hcl` in it. */
const infraRegions = () => {
  if (!fs.existsSync(INFRA)) return null;

  return fs.readdirSync(INFRA, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(INFRA, e.name, 'region.hcl')))
    .map((e) => e.name)
    // `iam` is global on AWS and carries a region.hcl only so the provider has
    // somewhere to talk to. Nothing it builds lives in a region.
    .filter((name) => name !== 'iam');
};

const readRegionHcl = (region) => {
  const text = fs.readFileSync(path.join(INFRA, region, 'region.hcl'), 'utf8');
  return {
    region: (text.match(/region\s*=\s*"([^"]+)"/) || [])[1],
    azs: [...text.matchAll(/"([a-z]{2}-[a-z]+-\d[a-z])"/g)].map((m) => m[1]),
    vpcCidr: (text.match(/vpc_cidr\s*=\s*"([^"]+)"/) || [])[1],
  };
};

describe('every region the code sells has a stack on disk', () => {
  test('the infra folder is where the test expects it', () => {
    assert.ok(infraRegions(), `no region folders under ${INFRA}`);
  });

  test('each AWS region in the map has its own folder', () => {
    const onDisk = infraRegions();
    for (const awsRegion of regionMap.supportedAwsRegions()) {
      assert.ok(
        onDisk.includes(awsRegion),
        `${awsRegion} is sold by awsRegionMap but has no infra/aws/live/staging/${awsRegion}. `
        + 'A tier sold there would be ordered and then fail at launch.',
      );
    }
  });

  test('and nothing is built that the code cannot route to', () => {
    const sold = regionMap.supportedAwsRegions();
    for (const region of infraRegions()) {
      assert.ok(
        sold.includes(region),
        `${region} has infrastructure but awsRegionMap cannot route to it — it is being paid `
        + 'for and cannot be sold.',
      );
    }
  });
});

describe('the availability zones match', () => {
  test('each folder names the same zones the code places machines in', () => {
    for (const [, entry] of Object.entries(regionMap.REGIONS)) {
      const onDisk = readRegionHcl(entry.awsRegion);
      assert.deepEqual(
        onDisk.azs.sort(),
        [...entry.azs].sort(),
        `${entry.awsRegion}: code places machines in ${entry.azs.join(', ')} but the stack builds `
        + `subnets in ${onDisk.azs.join(', ')}. A machine placed in a zone with no subnet cannot start.`,
      );
    }
  });

  test('and the folder name is the region it declares', () => {
    for (const region of infraRegions()) {
      assert.equal(readRegionHcl(region).region, region);
    }
  });
});

describe('the address ranges cannot collide', () => {
  test('every region has its own /16', () => {
    const cidrs = infraRegions().map((r) => readRegionHcl(r).vpcCidr);

    assert.equal(new Set(cidrs).size, cidrs.length, `two regions share a range: ${cidrs.join(', ')}`);
    for (const cidr of cidrs) assert.match(cidr, /^10\.\d+\.0\.0\/16$/, cidr);
  });

  test('and none of them lands on the Google side', () => {
    // infra/gcp uses 10.20-10.22. Peering the two clouds one day must not mean
    // renumbering a live subnet, which recreates every machine in it.
    for (const region of infraRegions()) {
      const second = Number(readRegionHcl(region).vpcCidr.split('.')[1]);
      assert.ok(second < 20 || second > 22, `${region} uses 10.${second}.x, which Google's side holds`);
    }
  });
});

describe('what each unit is, and is not', () => {
  test('IAM sits outside the regions, because IAM is global', () => {
    /*
     * A role and an instance profile are account-wide. The same names applied
     * in three regions does not make three of them — the second apply fails
     * with EntityAlreadyExists, and so does every one after.
     */
    assert.ok(fs.existsSync(path.join(INFRA, 'iam', 'terragrunt.hcl')));
    for (const region of infraRegions()) {
      assert.ok(
        !fs.existsSync(path.join(INFRA, region, 'iam')),
        `${region} has its own iam unit; IAM is global and must be applied once`,
      );
    }
  });

  test('every region builds the three units that ARE regional', () => {
    for (const region of infraRegions()) {
      for (const unit of ['network', 'security', 'nat']) {
        assert.ok(
          fs.existsSync(path.join(INFRA, region, unit, 'terragrunt.hcl')),
          `${region} is missing its ${unit} unit`,
        );
      }
    }
  });

  test('the NAT unit can resolve the gateway it depends on', () => {
    /*
     * `nat` has always asked `network` for `internet_gateway_id`, and
     * `network` did not export it. Terragrunt allows a mock to stand in for
     * `validate` and `plan`, so the stack planned cleanly and failed on the
     * first real apply.
     */
    const outputs = fs.readFileSync(
      path.resolve(__dirname, '../../../../../infra/aws/modules/network/outputs.tf'),
      'utf8',
    );
    assert.match(outputs, /output "internet_gateway_id"/);
  });
});
