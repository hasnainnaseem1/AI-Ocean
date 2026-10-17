/**
 * The churn scorer, tested without a database.
 *
 * `scoreTeam` is pure precisely so this file can exist: signals and a policy
 * in, score and reasons out. Everything asserted here is a judgement about how
 * the score should behave, and every one of them is a mistake that would
 * otherwise only show up as a quietly wrong list months later.
 */
const test = require('node:test');
const assert = require('node:assert');

const { scoreTeam } = require('../churnRiskService');
const { DEFAULT_ANALYTICS_POLICY } = require('../analyticsPolicyDefaults');

const POLICY = DEFAULT_ANALYTICS_POLICY;

/** A healthy account: everything recent, paid up, running. */
const healthy = (over = {}) => ({
  teamId: 't1',
  teamName: 'Healthy Co',
  teamKind: 'team',
  createdAt: new Date('2025-01-01'),
  accountAgeDays: 400,
  daysSinceLogin: 1,
  daysSinceUsage: 0,
  daysSinceTopUp: 3,
  balance: 120,
  outstanding: 0,
  debtDays: null,
  autoTopUpEnabled: true,
  autoChargeFailures: 0,
  lastAutoChargeError: '',
  suspendedAt: null,
  disputeHold: false,
  deployments: 4,
  running: 2,
  terminated: 1,
  cards: 1,
  cardBrand: 'visa',
  cardLast4: '4242',
  cardExpiresAt: new Date('2030-01-01'),
  cardDaysUntilExpiry: 900,
  openTickets: 0,
  oldestTicketDays: null,
  ...over,
});

test('a healthy account scores zero and gives no reasons', () => {
  const r = scoreTeam(healthy(), POLICY);
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.reasons.length, 0);
  assert.strictEqual(r.band, 'healthy');
});

test('a signal that cannot apply stays out of the denominator', () => {
  // Two accounts, same single problem (90 days with no sign-in). One has a
  // card, one does not. The one with no card cannot trip "card expiring" or
  // "payments failing", so those weights must not sit in its denominator
  // dragging its score down relative to the other.
  const withCard = scoreTeam(healthy({ daysSinceLogin: 90 }), POLICY);
  const noCard = scoreTeam(
    healthy({ daysSinceLogin: 90, cards: 0, cardDaysUntilExpiry: null }),
    POLICY,
  );
  assert.ok(noCard.weightApplicable < withCard.weightApplicable,
    'fewer signals could apply without a card');
  assert.ok(noCard.score > withCard.score,
    'the same problem is a bigger share of what could go wrong');
});

test('"never deployed" and "stopped using" never both fire', () => {
  // An account that has never deployed must not be charged for both having no
  // deployments and for not having used them.
  const never = scoreTeam(healthy({ deployments: 0, running: 0, terminated: 0, daysSinceUsage: null }), POLICY);
  const keys = never.reasons.map((r) => r.key);
  assert.ok(keys.includes('neverActivated'), 'never-activated fires');
  assert.ok(!keys.includes('noUsage'), 'stopped-using does not also fire');
});

test('reasons come back heaviest first', () => {
  const r = scoreTeam(healthy({
    daysSinceLogin: 200, outstanding: 500, debtDays: 90, balance: 0, autoTopUpEnabled: false,
  }), POLICY);
  const weights = r.reasons.map((x) => x.weight);
  assert.deepStrictEqual([...weights].sort((a, b) => b - a), weights,
    'the biggest contributor is listed first');
});

test('every reason is a rendered sentence with its figures in it', () => {
  const r = scoreTeam(healthy({ daysSinceLogin: 45 }), POLICY);
  const dormancy = r.reasons.find((x) => x.key === 'dormancy');
  assert.ok(dormancy, 'dormancy fired');
  assert.match(dormancy.sentence, /45/, 'the real figure is in the sentence');
  assert.ok(!dormancy.sentence.includes('{'), 'no placeholder survived rendering');
});

test('a reader without revenue permission gets the money-free wording', () => {
  const signals = healthy({ outstanding: 1500, debtDays: 40 });
  const withMoney = scoreTeam(signals, POLICY, { canSeeMoney: true });
  const without = scoreTeam(signals, POLICY, { canSeeMoney: false });

  const a = withMoney.reasons.find((x) => x.key === 'debt').sentence;
  const b = without.reasons.find((x) => x.key === 'debt').sentence;

  assert.match(a, /1500/, 'the amount is shown to a permitted reader');
  assert.ok(!/1500/.test(b), 'the amount is not shown to a revenue-blind reader');
  assert.match(b, /40/, 'but the reason is still explained');
  assert.strictEqual(withMoney.score, without.score,
    'wording does not change the score — only who may read the figure');
});

test('a weight of zero switches a signal off without removing it', () => {
  const policy = {
    ...POLICY,
    churn: { ...POLICY.churn, weights: { ...POLICY.churn.weights, dormancy: 0 } },
  };
  const r = scoreTeam(healthy({ daysSinceLogin: 365 }), policy);
  assert.ok(!r.reasons.some((x) => x.key === 'dormancy'), 'it no longer fires');
  assert.strictEqual(r.score, 0, 'and it contributes nothing, rather than counting as passed');
});

test('bands come from the policy ladder, not from hardcoded cut-offs', () => {
  const policy = {
    ...POLICY,
    churn: {
      ...POLICY.churn,
      bands: [{ key: 'fine', label: 'Fine', maxScore: 1 }, { key: 'doomed', label: 'Doomed', maxScore: null }],
    },
  };
  const r = scoreTeam(healthy({ daysSinceLogin: 400 }), policy);
  assert.strictEqual(r.band, 'doomed');
  assert.strictEqual(r.bandLabel, 'Doomed');
});

test('a card already past its expiry month still fires', () => {
  const r = scoreTeam(healthy({ cardDaysUntilExpiry: -20 }), POLICY);
  const card = r.reasons.find((x) => x.key === 'cardExpired');
  assert.ok(card, 'an expired card is flagged, not just an expiring one');
  assert.match(card.sentence, /expired/i);
});

test('the score is always a percentage, never over 100', () => {
  // Everything wrong at once.
  const r = scoreTeam(healthy({
    daysSinceLogin: 999,
    daysSinceUsage: 999,
    outstanding: 9999,
    debtDays: 400,
    balance: 0,
    autoTopUpEnabled: false,
    autoChargeFailures: 9,
    running: 0,
    terminated: 5,
    suspendedAt: new Date(),
    cardDaysUntilExpiry: -5,
    openTickets: 3,
    oldestTicketDays: 40,
  }), POLICY);
  assert.strictEqual(r.score, 100);
  assert.ok(r.score <= 100);
});
