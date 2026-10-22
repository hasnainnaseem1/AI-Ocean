/**
 * Proving, from the outside, that a region's isolation is actually in place.
 *
 * ── Why this has to exist ──
 *
 * The platform's hardest promise is that no customer's machine can reach any
 * other customer's machine. On AWS that promise rests on one thing: a network
 * ACL rule that DENIES the whole VPC range, in both directions, at the subnet
 * boundary (`infra/aws/modules/security/main.tf`). An instance cannot opt out
 * of a NACL, which is exactly why the rule lives there and not in a security
 * group.
 *
 * The build worker holds a credential that can create that rule. AWS has no
 * way to grant "may create this rule but may never change it" — the same
 * permission that writes a NACL entry can rewrite it, and flipping one word
 * from `deny` to `allow` opens every machine in the region to every other.
 * Nothing else changes: no instance is created, no setting moves, no alarm
 * fires. It is the quietest possible catastrophe.
 *
 * So the permission cannot be narrowed, and the check has to be elsewhere:
 * after every apply, and on a schedule, ask AWS what the rules actually say
 * and refuse to use a region whose answer is wrong.
 *
 * ── Why it reads from AWS and not from Terraform ──
 *
 * Terraform state says what Terraform last wrote. The question here is what
 * AWS is enforcing right now, which is a different question whenever anything
 * has touched the account outside Terraform — including a stolen credential,
 * which is the case this exists for. So it uses `DescribeNetworkAcls`, with
 * the runtime's own read-only path, and believes only that.
 *
 * ── What a failure means ──
 *
 * Not "the build failed". It means the region is unsafe to place customers in,
 * so the region is taken out of service: no machine is built there until a
 * human has looked. A false positive costs a region's availability; a false
 * negative costs the one promise the platform cannot break.
 */
const awsClient = require('./awsClient');

/** Both directions have to deny, so both are checked and named separately. */
const DIRECTIONS = [
  { egress: true, label: 'outbound' },
  { egress: false, label: 'inbound' },
];

/**
 * Pull the NACL rules AWS is enforcing for a VPC, right now.
 *
 * `DescribeNetworkAcls` is a read, and the runtime credential already has it —
 * the worker's elevated key is deliberately NOT used here. A check that runs
 * with the same credential it is checking up on proves less: this way the
 * answer comes through the same read-only path the platform uses for
 * everything else.
 */
const readAcls = async (awsRegion, vpcId) => {
  const xml = await awsClient.call('DescribeNetworkAcls', {
    'Filter.1.Name': 'vpc-id',
    'Filter.1.Value.1': vpcId,
  }, { region: awsRegion });

  return xml;
};

/**
 * Does a rule set actually deny the VPC range in one direction?
 *
 * The rule that matters is a `deny` on the VPC's own CIDR, numbered BELOW any
 * allow that would cover the same traffic — AWS evaluates low to high and the
 * first match wins, so a deny at 200 behind an allow at 100 denies nothing.
 * Checking only that a deny exists would pass a rule set that has been
 * reordered into uselessness.
 */
const deniesVpcRange = (rules, vpcCidr, isEgress) => {
  const mine = rules
    .filter((r) => !!r.egress === isEgress && !r.isDefault)
    .sort((a, b) => a.ruleNumber - b.ruleNumber);

  const deny = mine.find((r) => r.action === 'deny' && r.cidrBlock === vpcCidr);
  if (!deny) {
    return {
      ok: false,
      reason: `no rule denies the VPC range ${vpcCidr}`,
    };
  }

  /*
   * Anything that allows traffic inside the VPC range and is evaluated FIRST
   * defeats the deny. A `0.0.0.0/0` allow numbered below the deny is the
   * obvious way this gets broken, and it looks entirely reasonable in a
   * console listing.
   */
  const defeating = mine.find((r) => (
    r.action === 'allow'
    && r.ruleNumber < deny.ruleNumber
    && (r.cidrBlock === '0.0.0.0/0' || r.cidrBlock === vpcCidr)
  ));

  if (defeating) {
    return {
      ok: false,
      reason: `rule ${defeating.ruleNumber} allows ${defeating.cidrBlock} before the deny at `
        + `${deny.ruleNumber}, so the deny never matches`,
    };
  }

  return { ok: true, ruleNumber: deny.ruleNumber };
};

/**
 * Is this region safe to place customer machines in?
 *
 * Returns `{ok:false, …}` rather than throwing: every caller is either a job
 * or a build step that has to record the verdict and carry on to the next
 * region.
 */
const verify = async ({ awsRegion, vpcId, vpcCidr } = {}) => {
  if (!awsRegion || !vpcId || !vpcCidr) {
    return {
      ok: false,
      code: 'NOT_ENOUGH_TO_CHECK',
      message: 'The region, its VPC and its address range are all needed to verify isolation.',
    };
  }

  let acls;
  try {
    acls = await readAcls(awsRegion, vpcId);
  } catch (err) {
    /*
     * Could not ask. NOT treated as "isolation is fine" — an unreachable check
     * and a failed check are different facts, and only one of them is safe to
     * ignore. The caller holds the region rather than clearing it.
     */
    return {
      ok: false,
      code: 'COULD_NOT_CHECK',
      message: `Could not read the network rules in ${awsRegion}: ${err.message}`,
    };
  }

  const rules = parseAclRules(acls);
  if (!rules.length) {
    return {
      ok: false,
      code: 'NO_RULES',
      message: `${awsRegion} has a VPC but no network ACL rules on it. Customer machines there `
        + 'would be able to reach each other.',
    };
  }

  const failures = [];
  for (const { egress, label } of DIRECTIONS) {
    const verdict = deniesVpcRange(rules, vpcCidr, egress);
    if (!verdict.ok) failures.push(`${label}: ${verdict.reason}`);
  }

  if (failures.length) {
    return {
      ok: false,
      code: 'ISOLATION_BROKEN',
      message: `${awsRegion} is not isolating customer machines from each other — `
        + `${failures.join('; ')}. No machine may be placed there until this is fixed.`,
      failures,
    };
  }

  return { ok: true, awsRegion, vpcId, checkedAt: new Date() };
};

/**
 * EC2's XML into the handful of fields this check needs.
 *
 * Exported so the parsing can be tested against real AWS responses without a
 * network call — the shape of this XML is the part most likely to be wrong.
 */
const parseAclRules = (xml) => {
  const text = typeof xml === 'string' ? xml : JSON.stringify(xml || {});
  const out = [];

  // Each <item> inside <entrySet> is one rule.
  const entries = text.match(/<item>(?:(?!<\/item>)[\s\S])*?<\/item>/g) || [];
  for (const entry of entries) {
    const pick = (tag) => {
      const m = entry.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1] : null;
    };

    const ruleNumber = Number(pick('ruleNumber'));
    if (!Number.isFinite(ruleNumber)) continue;

    out.push({
      ruleNumber,
      action: (pick('ruleAction') || '').toLowerCase(),
      egress: pick('egress') === 'true',
      cidrBlock: pick('cidrBlock') || '',
      /*
       * AWS's own catch-all rule, number 32767, which denies everything that
       * reached the end of the list. It is not ours and must not be mistaken
       * for the deny this platform relies on — it would make a region with no
       * rules at all look correctly isolated.
       */
      isDefault: ruleNumber === 32767,
    });
  }

  return out;
};

module.exports = {
  verify,
  // Exported for tests: the decisions with no network in them.
  deniesVpcRange,
  parseAclRules,
};
