/**
 * "Can this account still hold a session?"
 *
 * There is exactly one list of account states that end a session, and it lives
 * here. Before this, the list existed in three places: these checks in
 * `auth.js`, and two hand-copied arrays in the customer frontend
 * (`api/axiosInstance.js` and `context/AuthContext.js`), kept in step only by a
 * comment saying they had to be. Three copies of one rule is how the next
 * status value gets added to two of them.
 *
 * The frontends no longer carry the list at all. Every response built here
 * carries `endsSession: true`, so a client's rule is simply "a 403 that says
 * `endsSession` signs the user out" — which stays correct when a new status is
 * added here, with no client change.
 *
 * `pending_verification` is deliberately absent: an unverified customer is
 * expected to be signed in and using the app, that is how they reach the
 * resend-verification screen.
 */

const ENDED_STATUSES = {
  suspended: {
    code: 'ACCOUNT_SUSPENDED',
    message: 'Your account has been suspended. Please contact support.',
  },
  banned: {
    code: 'ACCOUNT_BANNED',
    message: 'Your account has been banned.',
  },
};

const USABLE_STATUSES = ['active', 'pending_verification'];

const INACTIVE = {
  code: 'ACCOUNT_INACTIVE',
  message: 'Your account is not active. Please contact support.',
};

/**
 * @param {string} status  the user's current status
 * @returns {{code: string, message: string, endsSession: true} | null}
 *   the body to send with a 403, or null when the account may continue
 */
const accountEnded = (status) => {
  const named = ENDED_STATUSES[status];
  if (named) return { ...named, endsSession: true };
  if (!USABLE_STATUSES.includes(status)) return { ...INACTIVE, endsSession: true };
  return null;
};

module.exports = { accountEnded, ENDED_STATUSES, USABLE_STATUSES };
