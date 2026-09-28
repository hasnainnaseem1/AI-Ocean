/**
 * Team permissions — what each role in an account may do.
 *
 * The one table every customer route asks (through `can` / the
 * `requirePermission` middleware). A route never compares role names itself:
 * a rule that lives in one place cannot be half-applied, and the table below
 * reads the same as the plan's role matrix, so it can be checked by eye.
 *
 * A personal account has exactly one member, its owner, who can do
 * everything — so for an individual customer nothing here ever says no.
 *
 * ── Money ──
 * Developer and Viewer see NO money: not the balance, not what anything cost,
 * not invoices, not debt. That is enforced by the server (billing routes are
 * refused, money fields are stripped from deployment responses — see
 * `canSeeMoney`), not merely hidden in the UI. Catalog list prices stay
 * visible to everyone: choosing a machine needs them, and they are the same
 * public prices the marketing site shows.
 */

const ROLES = ['owner', 'admin', 'billing', 'developer', 'viewer'];

/** Rank for "may not grant or manage a role above your own". */
const RANK = { owner: 5, admin: 4, billing: 3, developer: 2, viewer: 1 };

const ACTIONS = {
  // Deployments
  'deployments.view': ['owner', 'admin', 'billing', 'developer', 'viewer'],
  'deployments.create': ['owner', 'admin', 'developer'],
  'deployments.operate': ['owner', 'admin', 'developer'], // pause / resume / stop
  'deployments.terminate': ['owner', 'admin'],
  'deployments.terminateOwn': ['owner', 'admin', 'developer'], // only what they created
  'deployments.apiKey': ['owner', 'admin', 'developer'],
  // Changing prepaid ↔ pay-as-you-go decides how the account is charged AND
  // can restart a paused machine — both an operation and a money decision.
  'deployments.billingMethod': ['owner', 'admin'],

  // Money
  'billing.view': ['owner', 'admin', 'billing'],
  'billing.manage': ['owner', 'admin', 'billing'], // top up, cards

  // The team itself (phases INVITE onwards)
  'team.view': ['owner', 'admin', 'billing', 'developer', 'viewer'],
  'team.members': ['owner', 'admin'],
  'team.limits': ['owner', 'admin'],
  'team.settings': ['owner', 'admin'],
  'team.activity': ['owner', 'admin'],
  'team.ownership': ['owner'],
  'team.delete': ['owner'],
};

/** May a member with this role do this? Unknown actions and roles are always no. */
const can = (membership, action) => {
  const role = membership?.role;
  const allowed = ACTIONS[action];
  return !!(role && allowed && allowed.includes(role));
};

/** Whether money figures may be shown to this member at all. */
const canSeeMoney = (membership) => can(membership, 'billing.view');

/**
 * Terminate is allowed for a Developer only on a deployment they created
 * themselves; Owner/Admin may terminate any.
 */
const canTerminate = (membership, deployment, userId) => can(membership, 'deployments.terminate')
  || (can(membership, 'deployments.terminateOwn') && String(deployment?.userId) === String(userId));

/** Every action a role has — sent to the client so the UI hides what it cannot do. */
const actionsFor = (role) => Object.keys(ACTIONS).filter((a) => ACTIONS[a].includes(role));

module.exports = {
  ROLES,
  RANK,
  ACTIONS,
  can,
  canSeeMoney,
  canTerminate,
  actionsFor,
};
