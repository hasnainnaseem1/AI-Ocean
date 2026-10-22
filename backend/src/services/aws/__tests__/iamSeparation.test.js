/**
 * Two AWS identities, and the line between them.
 *
 * ── The rule this defends ──
 *
 * No customer's machine may reach any other customer's machine. On AWS that
 * rests on a network ACL rule denying the VPC range, and on the fact that the
 * credential the platform runs with cannot change it.
 *
 * Building a region, however, means CREATING those rules — and AWS cannot
 * grant creation without granting modification. So there are two identities:
 *
 *   platform-runtime   runs machines. Explicitly denied every mutating
 *                      network action. This is the key the API holds.
 *   region-builder     builds networks. Can, unavoidably, undo isolation.
 *                      This key belongs only to the build worker's process.
 *
 * The separation is the whole protection. These tests read the real Terraform
 * and fail if the two ever converge — if the runtime gains a network verb, or
 * the builder gains the ability to run machines or mint credentials.
 *
 * Reading the HCL rather than a copy of it, for the same reason as
 * `infraMatchesRegionMap`: a policy and its description drift silently, and
 * the symptom of that drift is a guarantee that quietly stopped being true.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const IAM = path.resolve(__dirname, '../../../../../infra/aws/modules/iam/main.tf');

const hcl = () => fs.readFileSync(IAM, 'utf8');

/**
 * The actions inside one `data "aws_iam_policy_document"` statement.
 *
 * Crude on purpose: it reads the block between a `sid` and the `resources`
 * line that closes it, which is enough to tell an allow from a deny and to
 * list the verbs, without pulling in an HCL parser.
 */
const statement = (sid) => {
  const text = hcl();
  const at = text.indexOf(`sid    = "${sid}"`);
  if (at < 0) return null;

  /*
   * To the next statement, not to the `resources` line.
   *
   * Cutting at `resources = ["*"]` drops everything after it — including the
   * `condition` block, which is where the region fence lives. The actions are
   * read from the part before `resources`; the body keeps the whole statement
   * so a condition can be asserted on.
   */
  const rest = text.slice(at);
  const nextSid = rest.indexOf('sid    = "', 10);
  const body = nextSid > 0 ? rest.slice(0, nextSid) : rest;

  const actionsPart = body.slice(0, body.indexOf('resources = ["*"]') + 1 || undefined);

  return {
    effect: /effect\s*=\s*"(\w+)"/.exec(body)?.[1],
    actions: [...actionsPart.matchAll(/"((?:ec2|iam|s3|kms|pricing|dynamodb):[\w*]+)"/g)]
      .map((m) => m[1]),
    body,
  };
};

/** The mutating NACL verbs — the ones that can undo customer isolation. */
const ISOLATION_VERBS = [
  'ec2:CreateNetworkAclEntry',
  'ec2:DeleteNetworkAclEntry',
  'ec2:ReplaceNetworkAclEntry',
  'ec2:DeleteNetworkAcl',
];

describe('the platform runtime credential — what the API holds', () => {
  test('it can run machines', () => {
    const s = statement('ManageCustomerInstances');
    assert.equal(s.effect, 'Allow');
    for (const verb of ['ec2:RunInstances', 'ec2:TerminateInstances']) {
      assert.ok(s.actions.includes(verb), `the API must be able to ${verb}`);
    }
  });

  test('and it is explicitly denied every way of changing the isolation', () => {
    const deny = statement('NeverChangeTheIsolation');
    assert.equal(deny.effect, 'Deny');

    for (const verb of ISOLATION_VERBS) {
      assert.ok(
        deny.actions.includes(verb),
        `${verb} must be denied to the runtime credential — a key leaked from the API would `
        + 'otherwise be able to let every customer machine reach every other',
      );
    }
  });

  test('it CAN read the isolation, which is how the check works', () => {
    /*
     * The verification after every build has to run with a credential that
     * demonstrably cannot change what it is inspecting. That needs the read
     * granted and every write denied — and the read is easy to forget, which
     * fails closed: the check reports "could not verify" and every region is
     * held forever.
     */
    const allow = statement('ManageCustomerInstances');
    assert.ok(
      allow.actions.includes('ec2:DescribeNetworkAcls'),
      'without this the isolation check cannot run at all',
    );

    const deny = statement('NeverChangeTheIsolation');
    assert.ok(
      !deny.actions.includes('ec2:DescribeNetworkAcls'),
      'reading is always fine; denying the read would stop the check, not help it',
    );
  });

  test('the denies name verbs, never wildcards that catch reads', () => {
    /*
     * `ec2:*SecurityGroup*` would also match `DescribeSecurityGroups`, which
     * the launch path needs — and deny beats allow, so the platform would be
     * unable to read the network it launches into.
     */
    const deny = statement('NeverChangeTheIsolation');
    for (const action of deny.actions) {
      assert.ok(
        !/^ec2:\*/.test(action),
        `"${action}" is a leading wildcard and will catch Describe calls the API needs`,
      );
    }
  });
});

describe('the region builder credential — what the worker holds', () => {
  test('it can create the isolation rules', () => {
    const s = statement('BuildTheNetwork');
    assert.equal(s.effect, 'Allow');
    assert.ok(s.actions.includes('ec2:CreateNetworkAclEntry'));
  });

  test('and is fenced to the regions the platform sells', () => {
    /*
     * This does not protect the regions in the list — inside them the key can
     * still rewrite the isolation. It stops a leaked key raising
     * infrastructure somewhere nobody is watching the bill or the rules.
     */
    assert.match(statement('BuildTheNetwork').body, /aws:RequestedRegion/);
    assert.match(hcl(), /values\s*=\s*var\.build_regions/);
  });

  test('it cannot run a single machine', () => {
    /*
     * The second half of the separation. Neither key alone can both create a
     * network and put a machine in it, so a leak of either is survivable in a
     * way a leak of one combined key would not be.
     */
    const deny = statement('NeverBecomeSomethingElse');
    assert.equal(deny.effect, 'Deny');

    for (const verb of ['ec2:RunInstances', 'ec2:TerminateInstances']) {
      assert.ok(deny.actions.includes(verb), `the builder must be denied ${verb}`);
    }
  });

  test('and cannot mint itself a better credential', () => {
    const deny = statement('NeverBecomeSomethingElse');
    for (const verb of ['iam:Create*', 'iam:Attach*', 'iam:PassRole']) {
      assert.ok(
        deny.actions.includes(verb),
        `${verb} must be denied — otherwise a leaked build key becomes a permanent admin key `
        + 'and the region fence is irrelevant',
      );
    }
  });
});

describe('the two identities stay two', () => {
  test('they are separate IAM users, not one with both policies', () => {
    const text = hcl();
    assert.match(text, /resource "aws_iam_user" "platform_runtime"/);
    assert.match(text, /resource "aws_iam_user" "region_builder"/);
  });

  test('no action is both allowed to the runtime and needed only by the builder', () => {
    const runtimeAllow = statement('ManageCustomerInstances').actions;

    for (const verb of ISOLATION_VERBS) {
      assert.ok(
        !runtimeAllow.includes(verb),
        `${verb} is allowed to the API's own credential — the separation is gone`,
      );
    }
  });

  test('the builder policy says where its key may and may not live', () => {
    /*
     * The policy cannot enforce this — no IAM condition can express "not in
     * that process". It is enforced by the OS user the worker runs as, so the
     * reason has to survive in the place somebody will read it when they are
     * deciding where to put the key.
     */
    assert.match(hcl(), /NEVER be in the API process/i);
  });
});
