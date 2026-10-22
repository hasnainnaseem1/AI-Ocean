/**
 * The first order in a region nobody has used yet.
 *
 * ── What was wrong, and what it cost ──
 *
 * The platform costs and sells a region before it builds one, deliberately:
 * that is what puts a region's standing cost (on AWS, its NAT gateways —
 * charged per zone whether anything uses them or not) inside every price from
 * the day the region is costed, so the customer who happens to be first there
 * pays the same rate as the hundredth.
 *
 * What was missing was the other half. "We sell this region" and "we have
 * built this region" are different facts, and the second one was recorded
 * nowhere. The first order into an unbuilt region was marked `failed` — a dead
 * end for an order that only needed to wait — with a message naming an
 * `infra/aws/live/...` path that the customer could read.
 *
 * Every test here is one way that comes back, or one way the fix loses money.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const hold = require('../../deployment/deploymentHold');
const demand = require('../regionDemand');

describe('what the customer is told while a region is built', () => {
  const msg = hold.messageFor(hold.KINDS.REGION, { region: 'ap-south-1' });

  test('the guard code maps to its own kind of wait', () => {
    assert.equal(hold.FROM_GUARD_CODE.REGION_NOT_CONFIGURED, hold.KINDS.REGION);
  });

  test('it does not read as an error, because it is not one', () => {
    for (const bad of [/error/i, /failed/i, /problem/i, /sorry/i, /unable/i]) {
      assert.ok(!bad.test(`${msg.title} ${msg.body}`), `"${msg.title}" reads as a failure (${bad})`);
    }
  });

  test('it gives a real timeframe rather than "soon"', () => {
    assert.equal(msg.expectedWithinMinutes, hold.REGION_BUILD_WINDOW_MINUTES);
    assert.match(msg.body, new RegExp(String(hold.REGION_BUILD_WINDOW_MINUTES)));
  });

  test('it says nothing is charged while they wait', () => {
    // The platform charges from the moment the CLOUD reports the machine
    // running. A customer waiting on a region has no machine, so there is
    // nothing to charge — and saying so is what stops the support ticket.
    assert.match(msg.body, /nothing is charged|nothing has been charged/i);
  });

  test('it offers a way out that works today', () => {
    assert.ok(msg.canSwitchMachine);
    assert.match(msg.body, /already run in/i);
  });

  test('and it never names our own infrastructure', () => {
    /*
     * The message this replaced put `infra/aws/live/<env>/ap-south-1` in front
     * of the customer, along with the words VPC and security group. Where our
     * networks live, and what they are made of, is not something a customer
     * should learn from a status message.
     */
    for (const kind of Object.values(hold.KINDS)) {
      const m = hold.messageFor(kind, { region: 'ap-south-1' });
      const text = `${m.title} ${m.body}`;
      for (const leak of [/\bvpc\b/i, /terragrunt/i, /terraform/i, /infra\//i,
        /security group/i, /\bnat\b/i, /subnet/i, /\bami\b/i]) {
        assert.ok(!leak.test(text), `"${text}" leaks ${leak}`);
      }
    }
  });

  test('past the window it stops repeating a promise it is not keeping', () => {
    const late = hold.messageFor(hold.KINDS.REGION, {
      region: 'ap-south-1',
      minutesWaiting: hold.REGION_BUILD_WINDOW_MINUTES + 1,
    });

    assert.equal(late.expectedWithinMinutes, null, 'a missed promise must not be repeated');
    assert.match(late.body, /someone on our side/i);
    // Still a way out, which is the whole point of not failing the order.
    assert.ok(late.canSwitchMachine);
  });

  test('no timeframe is promised when nothing is acting on the wait', () => {
    /*
     * "about 30 minutes, it will start on its own" is true only while the
     * build worker is running — it picks the region up within the minute.
     * With no worker, the same sentence is a promise nobody is keeping and
     * the order waits until a person notices a screen.
     *
     * A missed estimate costs more trust than no estimate, so the honest
     * version gives none and leads with the alternative instead.
     */
    const manual = hold.messageFor(hold.KINDS.REGION, {
      region: 'ap-south-1', automatic: false,
    });

    assert.equal(manual.expectedWithinMinutes, null);
    assert.ok(
      !new RegExp(String(hold.REGION_BUILD_WINDOW_MINUTES)).test(manual.body),
      'no number may be quoted when nothing is keeping it',
    );
    assert.ok(!/on its own/.test(manual.body), 'nothing is going to do it on its own');
    // The way out still has to be there — it is the only thing that works now.
    assert.match(manual.body, /already run in/);
    assert.ok(manual.canSwitchMachine);
  });

  test('and the automatic wait still promises one', () => {
    const auto = hold.messageFor(hold.KINDS.REGION, { region: 'ap-south-1' });
    assert.equal(auto.expectedWithinMinutes, hold.REGION_BUILD_WINDOW_MINUTES);
  });

  test('a region with no name still produces a sentence that reads', () => {
    const anon = hold.messageFor(hold.KINDS.REGION, {});
    assert.ok(!/ {2}/.test(anon.body), 'a missing region left a double space');
    assert.ok(!/use,/.test(anon.body), 'a missing region left a dangling clause');
    assert.match(anon.body, /this region/i);
  });
});

describe('the states a region can be in', () => {
  test('built is not one a build can be asked for', () => {
    // Asking to build a region that works would mark it `building` and make
    // every order there wait for an apply nobody needs to run.
    assert.ok(!demand.BUILDABLE.includes(demand.STATES.BUILT));
    assert.ok(!demand.BUILDABLE.includes(demand.STATES.BUILDING));
  });

  test('a failed build can be asked for again', () => {
    assert.ok(demand.BUILDABLE.includes(demand.STATES.FAILED));
  });

  test('unbuilt and wanted are both buildable', () => {
    assert.ok(demand.BUILDABLE.includes(demand.STATES.UNBUILT));
    assert.ok(demand.BUILDABLE.includes(demand.STATES.WANTED));
  });

  test('the stored hold kind and the state name agree', () => {
    /*
     * `countWaiting` queries `holdKind: 'region'` as a literal. If the hold
     * kind were ever renamed, every region would read as having nobody waiting
     * on it — the admin's work list would go quiet while orders sat still.
     */
    assert.equal(hold.KINDS.REGION, 'region');
  });
});

/**
 * The module's source with its comments removed.
 *
 * The tripwires below search for things the code must not do. Searching the
 * raw file searches the comments too — and this module's header is largely an
 * explanation of why it must never run `terragrunt apply`, which made the
 * tripwire fire on the very argument for having it. So the comments come out
 * and what is left is what actually runs.
 */
const code = () => require('fs')
  .readFileSync(require.resolve('../regionDemand.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('what the platform refuses to do in order to build a region', () => {
  test('the service holds nothing that could change a network', () => {
    /*
     * The hardest guarantee this platform makes is that one customer's machine
     * can never reach another's, and it rests on the runtime having no power
     * to change a network at all. A credential able to apply this stack owns
     * the VPC, the firewall and the security groups of every region — so a key
     * readable out of this process, by any bug anywhere in it, would make that
     * guarantee unprovable.
     *
     * This test is a tripwire on that decision, not a proof: it fails if
     * somebody later teaches this module to run an apply or read such a
     * credential, which is the change that would need the argument re-made.
     */
    for (const forbidden of [/child_process/, /\bexecFile\b/, /\bexecSync\b/, /\bspawn\b/,
      /terragrunt/, /\bterraform\b/]) {
      assert.ok(
        !forbidden.test(code()),
        `regionDemand must not be able to apply infrastructure (${forbidden})`,
      );
    }
  });

  test('and it concludes "built" only from the ids a launch would use', () => {
    /*
     * `sync` must reach `configuredRegions`, which checks the VPC, security
     * group, AMI and subnets actually saved in settings. Any other basis for
     * `built` — an apply reporting success, an operator asserting it — can be
     * true while the ids are missing, and then an order is routed at a network
     * that does not exist.
     */
    assert.match(code(), /configuredRegions/);

    // No exported way to simply declare a region built.
    assert.equal(demand.markBuilt, undefined);
    assert.ok(!/const markBuilt/.test(code()), 'nothing may assert "built" without reading the ids');
  });
});
