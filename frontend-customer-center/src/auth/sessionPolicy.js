/**
 * The one rule for "throw away the stored session".
 *
 * Two transports need this decision — the axios instance used by the API layer
 * and the bare `fetch` in AuthContext — and they used to answer it with two
 * hand-copied arrays of account-status codes, kept in step by a comment. The
 * backend is the authority on which statuses end a session, so it now says so
 * directly: the 403 body carries `endsSession: true`.
 *
 * Adding a new "account is over" status is therefore a backend-only change.
 *
 * Note what is deliberately NOT here: an ordinary 403 (a disabled feature, a
 * permission the customer doesn't hold) and a 503 (maintenance mode) must never
 * sign anyone out. Being too broad here is what made turning maintenance mode
 * on log every customer out.
 */

/**
 * @param {number} status  HTTP status
 * @param {object} [body]  parsed response body
 */
export const endsSession = (status, body) =>
  status === 401 || (status === 403 && body?.endsSession === true);

/** The `?reason=` value to carry to /login, when there is one. */
export const endReason = (body) => body?.code || null;
