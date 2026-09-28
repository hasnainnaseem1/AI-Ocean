/**
 * The role × action table (services/team/permissions.js), asserted against
 * the plan's role matrix one row at a time, so a change to the table that
 * does not match the agreed rules fails here.
 *
 * Run with:  node --test src/services/team/__tests__/permissions.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const {
  can, canSeeMoney, canTerminate, actionsFor, ROLES,
} = require('../permissions');

const as = (role) => ({ role });

/** Roles that may do `action`, in the fixed order of ROLES. */
const who = (action) => ROLES.filter((r) => can(as(r), action));

test('everyone in an account can see its deployments', () => {
  assert.deepStrictEqual(who('deployments.view'), ['owner', 'admin', 'billing', 'developer', 'viewer']);
});

test('deploy and operate: owner, admin, developer — not billing, not viewer', () => {
  assert.deepStrictEqual(who('deployments.create'), ['owner', 'admin', 'developer']);
  assert.deepStrictEqual(who('deployments.operate'), ['owner', 'admin', 'developer']);
});

test('API keys: owner, admin, developer', () => {
  assert.deepStrictEqual(who('deployments.apiKey'), ['owner', 'admin', 'developer']);
});

test('money is seen and moved only by owner, admin, billing', () => {
  assert.deepStrictEqual(who('billing.view'), ['owner', 'admin', 'billing']);
  assert.deepStrictEqual(who('billing.manage'), ['owner', 'admin', 'billing']);
  assert.strictEqual(canSeeMoney(as('developer')), false);
  assert.strictEqual(canSeeMoney(as('viewer')), false);
  assert.strictEqual(canSeeMoney(as('billing')), true);
});

test('changing how a deployment is charged: owner and admin only', () => {
  assert.deepStrictEqual(who('deployments.billingMethod'), ['owner', 'admin']);
});

test('team management: owner and admin; ownership and deletion: owner only', () => {
  assert.deepStrictEqual(who('team.members'), ['owner', 'admin']);
  assert.deepStrictEqual(who('team.limits'), ['owner', 'admin']);
  assert.deepStrictEqual(who('team.activity'), ['owner', 'admin']);
  assert.deepStrictEqual(who('team.ownership'), ['owner']);
  assert.deepStrictEqual(who('team.delete'), ['owner']);
});

test('a developer terminates only what they created', () => {
  const mine = { userId: 'u1' };
  const theirs = { userId: 'u2' };
  assert.strictEqual(canTerminate(as('developer'), mine, 'u1'), true);
  assert.strictEqual(canTerminate(as('developer'), theirs, 'u1'), false);
  assert.strictEqual(canTerminate(as('admin'), theirs, 'u1'), true);
  assert.strictEqual(canTerminate(as('viewer'), mine, 'u1'), false);
  assert.strictEqual(canTerminate(as('billing'), mine, 'u1'), false);
});

test('an unknown role or action, or no membership, is always refused', () => {
  assert.strictEqual(can(as('superuser'), 'billing.view'), false);
  assert.strictEqual(can(as('owner'), 'billing.everything'), false);
  assert.strictEqual(can(null, 'deployments.view'), false);
  assert.strictEqual(can({}, 'deployments.view'), false);
});

test('the owner of a personal account can do everything in the table', () => {
  const all = actionsFor('owner');
  assert.ok(all.includes('billing.manage') && all.includes('deployments.create') && all.includes('team.delete'));
});
