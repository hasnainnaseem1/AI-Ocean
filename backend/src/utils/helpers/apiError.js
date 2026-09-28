/**
 * Turning a thrown error into a response.
 *
 * The house pattern used to be:
 *     res.status(500).json({ success: false, message: error.message })
 * across 38 handlers. Because each route catches and responds itself, the
 * global handler in app.js — which masks messages when NODE_ENV is
 * 'production' — was never reached, so raw exception text went to the client
 * in production too. Prisma's exceptions are especially bad here: they embed
 * the absolute server path, a source excerpt, and the full list of columns on
 * the model.
 *
 * `failure()` keeps the useful cases (a deliberate `err.status` / `err.code`
 * thrown by our own validation) and replaces everything else with a generic
 * message, while still logging the real error server-side.
 */

/**
 * A `status` we set ourselves marks an error that was written to be shown.
 * 4xx covers validation; 503 covers "this is configured wrong / unavailable",
 * which is honest in a way a bare 500 is not.
 */
const DELIBERATE_STATUSES = (s) => (s >= 400 && s < 500) || s === 503;
const isClientError = (err) => Number.isInteger(err?.status) && DELIBERATE_STATUSES(err.status);

/**
 * Errors that leak internals if echoed. Prisma's messages are multi-line and
 * carry file paths; a bare `Error` from a library is rarely phrased for a user.
 */
const looksInternal = (message = '') => /\n/.test(message)
  || /prisma|invocation|\.js:\d+|[A-Za-z]:\\|\/home\/|\/usr\//i.test(message);

/**
 * @param {import('express').Response} res
 * @param {Error} err                 the caught error
 * @param {string} fallback           what to tell the caller when the real
 *                                    message isn't safe or isn't useful
 * @param {object} [opts]
 * @param {string} [opts.log]         context prefix for the server-side log
 */
const failure = (res, err, fallback, opts = {}) => {
  // eslint-disable-next-line no-console
  console.error(`${opts.log || 'Error'}:`, err);

  if (isClientError(err)) {
    return res.status(err.status).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      message: looksInternal(err.message) ? fallback : (err.message || fallback),
    });
  }

  return res.status(500).json({ success: false, message: fallback });
};

/** Throw a deliberate, client-safe error: `throw badRequest('Amount is required')`. */
const badRequest = (message, code) => {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
};

module.exports = { failure, badRequest, isClientError, looksInternal };
