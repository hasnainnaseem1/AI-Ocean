/**
 * The check that makes a build credential acceptable to hold at all.
 *
 * ── Why these tests carry more weight than most ──
 *
 * The region build worker holds a credential that can create network ACLs. On
 * AWS that unavoidably means it can also REWRITE them: there is no way to
 * grant "may create this rule but never change it". So one word in one rule —
 * `deny` to `allow` — opens every customer machine in a region to every other,
 * and nothing else about the account changes. No instance is created, no
 * setting moves, nothing alarms.
 *
 * Prevention being impossible, the control is verification: read back what AWS
 * is actually enforcing and refuse to use a region whose answer is wrong. That
 * makes the logic below the thing standing between a stolen key and the
 * platform's hardest promise. Every test here is a way a broken region could
 * pass as a healthy one.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const { deniesVpcRange, parseAclRules } = require('../isolationCheck');

const VPC = '10.32.0.0/16';

/** The rule set the security module is supposed to produce. */
const healthy = () => [
  { ruleNumber: 100, action: 'deny', egress: true, cidrBlock: VPC, isDefault: false },
  { ruleNumber: 200, action: 'allow', egress: true, cidrBlock: '0.0.0.0/0', isDefault: false },
  { ruleNumber: 100, action: 'deny', egress: false, cidrBlock: VPC, isDefault: false },
  { ruleNumber: 200, action: 'allow', egress: false, cidrBlock: '0.0.0.0/0', isDefault: false },
  // AWS's own catch-all, present on every NACL.
  { ruleNumber: 32767, action: 'deny', egress: true, cidrBlock: '0.0.0.0/0', isDefault: true },
  { ruleNumber: 32767, action: 'deny', egress: false, cidrBlock: '0.0.0.0/0', isDefault: true },
];

describe('a correctly isolated region passes', () => {
  test('both directions deny the VPC range', () => {
    for (const egress of [true, false]) {
      const verdict = deniesVpcRange(healthy(), VPC, egress);
      assert.ok(verdict.ok, `${egress ? 'outbound' : 'inbound'}: ${verdict.reason}`);
      assert.equal(verdict.ruleNumber, 100);
    }
  });
});

describe('the ways isolation gets broken', () => {
  test('the deny is simply gone', () => {
    // The single most likely result of a stolen credential: delete the rule.
    const rules = healthy().filter((r) => !(r.action === 'deny' && r.cidrBlock === VPC && r.egress));
    const verdict = deniesVpcRange(rules, VPC, true);

    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /no rule denies/);
  });

  test('the deny was flipped to allow', () => {
    /*
     * The quietest change available. The rule is still there, still numbered
     * 100, still naming the VPC range — a console listing looks almost
     * identical, and every machine can now reach every other.
     */
    const rules = healthy().map((r) => (
      r.ruleNumber === 100 && r.egress ? { ...r, action: 'allow' } : r
    ));
    const verdict = deniesVpcRange(rules, VPC, true);

    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /no rule denies/);
  });

  test('an allow was inserted BELOW the deny, defeating it', () => {
    /*
     * The subtle one, and the reason this check cannot simply ask "does a deny
     * exist". AWS evaluates rules low to high and the first match wins, so an
     * allow at 50 means the deny at 100 is never reached. Both rules are
     * present and correct-looking; the ORDER is the attack.
     */
    const rules = [
      { ruleNumber: 50, action: 'allow', egress: true, cidrBlock: '0.0.0.0/0', isDefault: false },
      ...healthy(),
    ];
    const verdict = deniesVpcRange(rules, VPC, true);

    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /before the deny/);
    assert.match(verdict.reason, /50/);
  });

  test('an allow for the VPC range itself, below the deny', () => {
    const rules = [
      { ruleNumber: 10, action: 'allow', egress: true, cidrBlock: VPC, isDefault: false },
      ...healthy(),
    ];
    const verdict = deniesVpcRange(rules, VPC, true);

    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /before the deny/);
  });

  test('one direction is broken and the other is not', () => {
    /*
     * Isolation is only as good as its weaker direction, and a half-broken
     * rule set is what a partial apply or a careless hand-edit produces.
     */
    const rules = healthy().filter((r) => !(r.ruleNumber === 100 && !r.egress));

    assert.ok(deniesVpcRange(rules, VPC, true).ok, 'outbound should still pass');
    assert.equal(deniesVpcRange(rules, VPC, false).ok, false, 'inbound must fail');
  });

  test('AWS\'s own catch-all does not count as our deny', () => {
    /*
     * Rule 32767 denies everything that reached the end of the list, and it is
     * on every NACL ever created. Counting it would make a region with NO
     * rules of ours look perfectly isolated — the exact state a wiped NACL is
     * in.
     */
    const onlyDefaults = healthy().filter((r) => r.isDefault);
    const verdict = deniesVpcRange(onlyDefaults, VPC, true);

    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /no rule denies/);
  });

  test('a deny for the wrong range does not count', () => {
    // A rule denying some other VPC's range protects nothing here.
    const rules = healthy().map((r) => (
      r.ruleNumber === 100 && r.egress ? { ...r, cidrBlock: '10.99.0.0/16' } : r
    ));
    assert.equal(deniesVpcRange(rules, VPC, true).ok, false);
  });

  test('an empty rule set fails rather than passing vacuously', () => {
    assert.equal(deniesVpcRange([], VPC, true).ok, false);
  });
});

describe('reading what AWS actually said', () => {
  const XML = `
    <DescribeNetworkAclsResponse>
      <networkAclSet><item>
        <networkAclId>acl-0123</networkAclId>
        <entrySet>
          <item>
            <ruleNumber>100</ruleNumber><protocol>-1</protocol>
            <ruleAction>deny</ruleAction><egress>true</egress>
            <cidrBlock>10.32.0.0/16</cidrBlock>
          </item>
          <item>
            <ruleNumber>200</ruleNumber><protocol>-1</protocol>
            <ruleAction>allow</ruleAction><egress>true</egress>
            <cidrBlock>0.0.0.0/0</cidrBlock>
          </item>
          <item>
            <ruleNumber>32767</ruleNumber><protocol>-1</protocol>
            <ruleAction>deny</ruleAction><egress>true</egress>
            <cidrBlock>0.0.0.0/0</cidrBlock>
          </item>
        </entrySet>
      </item></networkAclSet>
    </DescribeNetworkAclsResponse>`;

  test('every rule is read', () => {
    assert.equal(parseAclRules(XML).length, 3);
  });

  test('the action and direction survive the parse', () => {
    const [first] = parseAclRules(XML);
    assert.equal(first.ruleNumber, 100);
    assert.equal(first.action, 'deny');
    assert.equal(first.egress, true);
    assert.equal(first.cidrBlock, '10.32.0.0/16');
  });

  test('AWS\'s catch-all is marked as such', () => {
    const rules = parseAclRules(XML);
    assert.equal(rules.find((r) => r.ruleNumber === 32767).isDefault, true);
    assert.equal(rules.find((r) => r.ruleNumber === 100).isDefault, false);
  });

  test('and the parsed rules reach the right verdict', () => {
    // End to end over the real XML shape, not the hand-built fixtures above.
    assert.ok(deniesVpcRange(parseAclRules(XML), '10.32.0.0/16', true).ok);
  });

  test('nothing parseable means no rules, not a crash', () => {
    for (const junk of ['', '<Response/>', null, undefined, '{}']) {
      assert.deepEqual(parseAclRules(junk), []);
    }
  });
});

describe('what the worker must never be able to do', () => {
  test('the check does not use the build credential', () => {
    /*
     * The point of reading back is that it is an INDEPENDENT answer. A check
     * performed with the same elevated credential it is checking up on proves
     * less — so this reads through the runtime's own client, which has no
     * power to change anything it finds.
     */
    const src = require('fs')
      .readFileSync(require.resolve('../isolationCheck.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    assert.ok(!/AIOCEAN_BUILD_AWS/.test(src), 'the verifier must not read the build credential');
    assert.match(src, /awsClient/, 'it reads through the runtime client');
  });
});
