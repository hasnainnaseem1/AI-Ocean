/**
 * What a customer is told while their order waits.
 *
 * The platform refuses to build a machine that would earn less than it needs.
 * That refusal is right, and the order is kept rather than failed. But "kept"
 * used to be all that happened: the customer saw "Pending review" with no
 * reason and no end to it, and the only way out was to give up.
 *
 * Every test here is a way that silence comes back, or a way the message says
 * something it should not.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const hold = require('../deploymentHold');

/** A deployment as the ORM hands it over, with a save that records calls. */
const deployment = (over = {}) => {
  const saves = [];
  return Object.assign({
    id: 'd-1',
    deploymentName: 'probe',
    region: 'ap-south',
    holdKind: '',
    holdReason: '',
    heldAt: null,
    saves,
    async save() { saves.push({ ...this }); },
  }, over);
};

describe('a guard refusal becomes a wait the customer can read', () => {
  test('every money refusal maps to a kind', () => {
    for (const code of ['BELOW_FLOOR', 'MARGIN_TOO_LOW', 'COST_UNKNOWN']) {
      assert.equal(hold.FROM_GUARD_CODE[code], hold.KINDS.REPRICING, code);
    }
  });

  test('a capacity refusal is a different kind, with a different way out', () => {
    assert.equal(hold.FROM_GUARD_CODE.TEAM_CAP_REACHED, hold.KINDS.CAPACITY);
    assert.equal(hold.FROM_GUARD_CODE.PLATFORM_CAP_REACHED, hold.KINDS.CAPACITY);
  });

  test('a funding refusal is its own kind', () => {
    assert.equal(hold.FROM_GUARD_CODE.NOT_FUNDED, hold.KINDS.FUNDS);
  });

  test('a code with no customer-facing wording maps to nothing', () => {
    // Better no hold than a hold whose message was written for another case.
    assert.equal(hold.FROM_GUARD_CODE.GCP_DISABLED, undefined);
    assert.equal(hold.FROM_GUARD_CODE.ALREADY_HAS_INSTANCE, undefined);
  });
});

describe('the message tells them what to do, not what we pay', () => {
  const repricing = hold.messageFor(hold.KINDS.REPRICING, { region: 'ap-south', minutesWaiting: 5 });

  test('it names a real timeframe, not "soon"', () => {
    assert.equal(repricing.expectedWithinMinutes, hold.REPRICE_WINDOW_MINUTES);
    assert.match(repricing.body, /within the\s+hour/);
  });

  test('it offers a way out that works right now', () => {
    assert.equal(repricing.canSwitchMachine, true);
    assert.match(repricing.body, /pick a different machine/);
  });

  test('it says nothing has been charged', () => {
    assert.match(repricing.body, /nothing has been charged/i);
  });

  test('and it NEVER mentions our cost, margin or floor', () => {
    /*
     * What a machine costs us is not the customer's business, and a message
     * that explains our pricing invites an argument about our pricing rather
     * than about their machine.
     */
    for (const kind of Object.values(hold.KINDS)) {
      const m = hold.messageFor(kind, { region: 'ap-south' });
      const text = `${m.title} ${m.body}`;
      for (const leak of [/margin/i, /\bfloor\b/i, /costs? us/i, /our cost/i, /profit/i]) {
        assert.ok(!leak.test(text), `"${text}" leaks ${leak}`);
      }
    }
  });

  test('it does not blame the customer', () => {
    for (const kind of Object.values(hold.KINDS)) {
      const m = hold.messageFor(kind, {});
      assert.ok(!/you (did|chose|selected) .*(wrong|incorrect)/i.test(m.body));
    }
  });

  test('the region is named when there is one, and left out when not', () => {
    assert.match(hold.messageFor(hold.KINDS.REPRICING, { region: 'ap-south' }).body, /in ap-south/);
    assert.ok(!/ in \b/.test(hold.messageFor(hold.KINDS.REPRICING, {}).body.split('.')[0]));
  });
});

describe('a promise stops being made once it is broken', () => {
  test('inside the hour, it says within the hour', () => {
    const m = hold.messageFor(hold.KINDS.REPRICING, { minutesWaiting: 20 });
    assert.match(m.body, /within the\s+hour/);
    assert.equal(m.expectedWithinMinutes, 60);
  });

  test('past the hour, it admits somebody is looking', () => {
    // Repeating "within the hour" into the second hour is worse than saying
    // the truth: the job did not fix it and a person is involved.
    const m = hold.messageFor(hold.KINDS.REPRICING, { minutesWaiting: 95 });

    assert.ok(!/within the\s+hour/.test(m.body), m.body);
    assert.match(m.body, /taking longer than it usually does/);
    assert.match(m.body, /looking at it now/);
    assert.equal(m.expectedWithinMinutes, null);
  });
});

describe('each kind offers the way out that actually helps', () => {
  test('a price wait: pick another machine', () => {
    assert.equal(hold.messageFor(hold.KINDS.REPRICING, {}).canSwitchMachine, true);
  });

  test('a capacity wait: another machine or another region', () => {
    const m = hold.messageFor(hold.KINDS.CAPACITY, { region: 'ap-south' });
    assert.equal(m.canSwitchMachine, true);
    assert.match(m.body, /another region/);
  });

  test('a funding wait does NOT suggest a different machine', () => {
    // Changing machine does not help an account that cannot pay; saying so
    // would send them round a loop that ends where it started.
    const m = hold.messageFor(hold.KINDS.FUNDS, {});
    assert.equal(m.canSwitchMachine, false);
    assert.match(m.body, /Add credit or a payment method/);
    assert.match(m.body, /do not need to order again/);
  });
});

describe('the clock is the truth, not the last time a job looked', () => {
  test('placing a hold records when it started', async () => {
    const d = deployment();
    const got = await hold.place(d, { kind: hold.KINDS.REPRICING, reason: 'internal detail' });

    assert.equal(got.held, true);
    assert.ok(d.heldAt instanceof Date);
    assert.equal(d.holdKind, hold.KINDS.REPRICING);
  });

  test('placing the SAME hold again does not reset it', async () => {
    /*
     * The provisioning job runs every minute. Without this the clock would
     * reset sixty times an hour, "how long have I been waiting" would always
     * answer "a moment", and the message would promise "within the hour"
     * forever.
     */
    const started = new Date(Date.now() - 90 * 60000);
    const d = deployment({ holdKind: hold.KINDS.REPRICING, holdReason: 'same', heldAt: started });

    const got = await hold.place(d, { kind: hold.KINDS.REPRICING, reason: 'same' });

    assert.equal(got.unchanged, true);
    assert.equal(d.heldAt.getTime(), started.getTime());
    assert.equal(d.saves.length, 0, 'an unchanged hold must not write');
  });

  test('a DIFFERENT reason starts a new wait', async () => {
    const old = new Date(Date.now() - 90 * 60000);
    const d = deployment({ holdKind: hold.KINDS.REPRICING, holdReason: 'old', heldAt: old });

    await hold.place(d, { kind: hold.KINDS.CAPACITY, reason: 'new' });

    assert.ok(d.heldAt.getTime() > old.getTime());
    assert.equal(d.holdKind, hold.KINDS.CAPACITY);
  });

  test('clearing removes every trace', async () => {
    const d = deployment({ holdKind: hold.KINDS.REPRICING, holdReason: 'x', heldAt: new Date() });
    const got = await hold.clear(d);

    assert.equal(got.cleared, true);
    assert.equal(d.holdKind, '');
    assert.equal(d.holdReason, '');
    assert.equal(d.heldAt, null);
  });

  test('clearing a deployment with no hold writes nothing', async () => {
    const d = deployment();
    assert.equal((await hold.clear(d)).cleared, false);
    assert.equal(d.saves.length, 0);
  });
});

describe('what the screen is handed', () => {
  test('no hold means null, so a screen can ask in one go', () => {
    assert.equal(hold.describe(deployment()), null);
    assert.equal(hold.describe(null), null);
  });

  test('a hold carries how long it has been waiting', () => {
    const d = deployment({
      holdKind: hold.KINDS.REPRICING,
      holdReason: 'costs us 0.10, floor is 0.13',
      heldAt: new Date(Date.now() - 25 * 60000),
    });

    const got = hold.describe(d);
    assert.equal(got.kind, hold.KINDS.REPRICING);
    assert.ok(got.minutesWaiting >= 24 && got.minutesWaiting <= 26, String(got.minutesWaiting));
  });

  test('and NEVER the internal reason', () => {
    const d = deployment({
      holdKind: hold.KINDS.REPRICING,
      holdReason: '"m6i.large" costs us 0.1/hr and needs to sell for at least 0.1300/hr',
      heldAt: new Date(),
    });

    const got = hold.describe(d);
    const text = JSON.stringify(got);

    assert.ok(!/costs us/.test(text), 'the guard\'s own wording must not reach the customer');
    assert.ok(!/0\.1300/.test(text));
    // The admin can still see it.
    assert.match(hold.internalReason(d), /costs us/);
  });

  test('"default" is not shown as a region name', () => {
    const d = deployment({ region: 'default', holdKind: hold.KINDS.REPRICING, heldAt: new Date() });
    assert.ok(!/in default/.test(hold.describe(d).body));
  });
});
