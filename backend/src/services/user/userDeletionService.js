/**
 * Permanent user deletion.
 *
 * Every domain that references User does so with a real Postgres foreign key,
 * and eleven of those are `onDelete: Restrict` on purpose — a ledger row must
 * never lose its owner, an activity log must never lose its actor. That makes
 * `userService.deleteUser` on its own insufficient: the referencing rows have
 * to go first, in child-before-parent order, or Postgres rejects the delete.
 *
 * This lived inline in the customer-delete routes and was never applied to the
 * admin-user routes, which is why deleting a staff account always failed — a
 * welcome notification is written the moment an admin is created, and
 * `notifications.recipient_id` is Restrict. Keeping the sequence in one place
 * means the two route families cannot drift apart again.
 *
 * The remaining ~30 references to User (created_by/updated_by/assigned_to and
 * friends) are all `SetNull`, so Postgres clears those itself.
 */
const prisma = require('../../lib/prismaClient');
const userService = require('./userService');
const deploymentService = require('../deployment/deploymentService');
const creditService = require('../billing/creditService');
const paymentMethodService = require('../billing/paymentMethodService');
const paymentService = require('../billing/paymentService');
const activityLogService = require('../admin/activityLogService');
const customerNoteService = require('../admin/customerNoteService');
const notificationService = require('../notification/notificationService');

/**
 * Delete users and everything that would otherwise block them.
 *
 * All eight steps run inside **one** transaction. They used to run as eight
 * independent writes, each internally atomic but not atomic together — so a
 * failure at, say, the activity-log step left a customer whose deployments,
 * wallet, ledger and cards were already gone but whose account still existed
 * and could still be logged into. Half-deleted is a worse state than either
 * deleted or not, and it could not be retried cleanly.
 *
 * Every service's `deleteAllFor…` therefore takes the transaction client
 * as its second argument; none of them opens a transaction of its own, because
 * Prisma does not nest them.
 *
 * The timeout is raised well above Prisma's 5s default deliberately: this is a
 * superadmin action on an account that may own thousands of usage and ledger
 * rows, and timing out halfway is the exact failure this transaction exists to
 * prevent.
 *
 * @param {Array<{_id: string}>} users  wrapped user records (see userService.wrapUser)
 * @returns {Promise<number>} how many users were removed
 */
const deleteUsersCompletely = async (users) => {
  const list = Array.isArray(users) ? users.filter(Boolean) : [users].filter(Boolean);
  if (!list.length) return 0;

  const ids = list.map((u) => u.id);

  /*
   * ── Only a user's own PERSONAL account is erased with them ──
   *
   * A shared team's money is not theirs to take with them. If any of these
   * users created a team, or has left a trace in one (a deployment they made,
   * a payment they made, a ledger row on their behalf), deleting them would
   * either erase another account's records or be refused by the database
   * half-way through. So it is refused up front, with the reason; the team
   * side has to be dealt with first (ownership transfer / leaving the team).
   */
  const personal = await prisma.team.findMany({
    where: { createdById: { in: ids }, kind: 'personal' }, select: { id: true },
  });
  const personalIds = personal.map((t) => t.id);
  const notPersonal = { teamId: { notIn: personalIds } };
  const [ownsTeams, teamTraces] = await Promise.all([
    prisma.team.count({ where: { createdById: { in: ids }, kind: 'team' } }),
    Promise.all([
      prisma.deployment.count({ where: { userId: { in: ids }, ...notPersonal } }),
      prisma.payment.count({ where: { userId: { in: ids }, ...notPersonal } }),
      prisma.paymentMethod.count({ where: { userId: { in: ids }, ...notPersonal } }),
      prisma.creditTransaction.count({ where: { userId: { in: ids }, ...notPersonal } }),
      prisma.deploymentUsage.count({ where: { userId: { in: ids }, ...notPersonal } }),
    ]).then((counts) => counts.reduce((a, b) => a + b, 0)),
  ]);
  if (ownsTeams > 0 || teamTraces > 0) {
    const err = new Error(
      'This customer created a team or has deployments, payments or cards in a team account. '
      + "Transfer or close those first — a team's records cannot be erased along with one member."
    );
    err.status = 409;
    err.code = 'USER_HAS_TEAM_RECORDS';
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    // Child-before-parent. DeploymentUsage goes with Deployment,
    // CreditTransaction with CreditWallet — each service keeps its own
    // internal ordering, and every one of them writes through `tx`.
    await deploymentService.deleteAllForTeams(personalIds, tx);
    await creditService.deleteAllForTeams(personalIds, tx);
    await paymentMethodService.deleteAllForTeams(personalIds, tx);
    await paymentService.deleteAllForTeams(personalIds, tx);
    // The personal accounts themselves (memberships cascade). Memberships in
    // other teams go with the user row below (team_members cascades on user).
    if (personalIds.length) await tx.team.deleteMany({ where: { id: { in: personalIds } } });
    await activityLogService.deleteAllForUsers(ids, tx);
    await customerNoteService.deleteAllForUsers(ids, tx);
    await notificationService.deleteAllForUsers(ids, tx);

    for (const u of list) {
      await userService.deleteUser(u, tx);
    }
  }, { timeout: 30000, maxWait: 10000 });

  return list.length;
};

module.exports = { deleteUsersCompletely };
