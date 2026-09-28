/**
 * Wallet Provisioning
 *
 * Provisions the credit wallet and grants the configured signup bonus, so a
 * customer is billing-ready however they signed up (email or Google).
 */

/**
 * Create the customer's wallet and grant the signup bonus, if one is configured.
 * Call AFTER the user has been saved so the wallet can reference a real _id.
 *
 * Never throws — a wallet problem must not break signup.
 */
const provisionWallet = async (user) => {
  try {
    const creditService = require('../billing/creditService');
    // The wallet is the customer's personal account's (created with the user
    // in userService.createUser); the bonus goes there too.
    const personal = await require('../team/teamService').findPersonal(user.id);
    if (personal) await creditService.getOrCreateWallet(personal.id);
    await creditService.grantSignupBonus(user.id);
  } catch (err) {
    console.error('[PlanAssignment] Could not provision wallet:', err.message);
  }
};

module.exports = {
  provisionWallet,
};
