/**
 * Request validation at the boundary.
 *
 * Before this, every endpoint validated its own input inline — 148 hand-written
 * `res.status(400)` branches across the routes and controllers. They mostly
 * worked, but each one started from zero, so the gaps were per-endpoint rather
 * than systemic, and four separate bugs came out of exactly that: BUG-008 (no
 * numeric bounds — `1e308` crashed the wallet adjust, `-999999` silently
 * created a $1M debt), BUG-012 (undeliverable email shapes accepted at signup),
 * BUG-013 (a NUL byte returned a 500), BUG-014 (a non-string `email` returned a
 * 500). Each was fixed where it was found; nothing stopped the next endpoint
 * from repeating it.
 *
 * This is the place a new endpoint declares its input shape instead.
 *
 * ── Scope, deliberately ─────────────────────────────────────────────────
 * This is applied to the boundaries where bad input is most likely and most
 * costly: anything unauthenticated (signup, login, password reset) and
 * anything that moves money. The remaining inline checks on authenticated
 * admin routes were left alone — they work, they are covered by the QA pass,
 * and rewriting 148 of them carries more risk than it removes. New endpoints
 * should use this; old ones can migrate when they are next touched.
 *
 * ── Shape of a failure ──────────────────────────────────────────────────
 * Always a 400 with the same body, so clients can rely on one shape:
 *
 *   { success: false, action: 'retry',
 *     message: <first problem, in plain words>,
 *     errors: { field: message, ... } }
 *
 * The message is written for the person filling in the form, not for a
 * developer reading a stack trace — Zod's own text ("Expected string, received
 * number") is replaced wherever a schema supplies its own.
 *
 * `action: 'retry'` is carried over from the hand-written 400s this replaces.
 * The customer frontend branches on `action` for `signup`/`verify_email`/
 * `login` and ignores `retry`, but keeping it means the response shape is
 * unchanged for anything already reading it.
 */
const { z } = require('zod');

/** Turn a ZodError into `{ field: message }`, keeping the first per field. */
const toFieldErrors = (error) => {
  const out = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
};

/**
 * @param {import('zod').ZodTypeAny} schema  shape for the chosen source
 * @param {'body'|'query'|'params'} [source]
 *
 * On success the parsed (and coerced) value replaces `req[source]`, so
 * handlers read numbers as numbers and trimmed strings as trimmed strings
 * rather than re-coercing them.
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});

  if (!result.success) {
    const errors = toFieldErrors(result.error);
    return res.status(400).json({
      success: false,
      action: 'retry',
      message: Object.values(errors)[0] || 'Some of the details you entered are not valid.',
      errors,
    });
  }

  /*
   * `req.query` and `req.params` are getter-only on Express 5 and read-only in
   * some Express 4 setups, so assign through the descriptor rather than
   * failing silently on a frozen object.
   */
  if (source === 'body') {
    req.body = result.data;
  } else {
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
  }

  return next();
};

/* ── Reusable field types ────────────────────────────────────────────────
 *
 * These exist so "what is a valid email here" has one answer across every
 * endpoint. `email` matches the shape already enforced by emailValidator.js —
 * that middleware still runs after this one and additionally checks the
 * admin-configured disposable-domain blocklist and MX records.
 */

const EMAIL_SHAPE = /^[^\s@]+@(?:[^\s@.]+\.)+[A-Za-z]{2,}$/;

const email = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .min(1, 'Enter your email address.')
  .max(254, 'That email address is too long.')
  .regex(EMAIL_SHAPE, 'Enter a valid email address.')
  .transform((s) => s.toLowerCase());

const password = z
  .string({ error: 'Enter your password.' })
  .min(1, 'Enter your password.')
  .max(200, 'That password is too long.');

/** For signup, where the password is being chosen rather than typed back. */
const newPassword = z
  .string({ error: 'Choose a password.' })
  .min(8, 'Your password must be at least 8 characters.')
  .max(200, 'That password is too long.');

const personName = z
  .string({ error: 'Enter your name.' })
  .trim()
  .min(1, 'Enter your name.')
  .max(120, 'That name is too long.');

/**
 * Money — shape only.
 *
 * These assert that the value is a real, finite, non-zero number, which is what
 * stops `"abc"`, `null`, an object or `1e308` reaching the database (BUG-008
 * was `1e308` crashing the adjust endpoint with a raw 500). They do **not**
 * impose a ceiling: every money limit in this product is admin-configurable
 * (`maxManualAdjustment`, the top-up min/max, the credit limit) and is enforced
 * in the handler that reads those settings. A number baked in here would be a
 * second limit the operator cannot see or change.
 *
 * `min` is available for the rare case where a floor is structural rather than
 * policy — it defaults to "greater than zero".
 */
const money = ({ min = 0.01, label = 'amount' } = {}) => z
  .coerce.number({ error: `Enter a valid ${label}.` })
  .refine(Number.isFinite, `Enter a valid ${label}.`)
  .refine((n) => n >= min, `The ${label} must be at least ${min}.`);

/** A signed adjustment — may be negative, but never zero and never non-finite. */
const signedMoney = ({ label = 'amount' } = {}) => z
  .coerce.number({ error: `Enter a valid ${label}.` })
  .refine(Number.isFinite, `Enter a valid ${label}.`)
  .refine((n) => Math.abs(n) >= 0.01, `The ${label} cannot be zero.`);

/** The app's public id: the row's UUID (see utils/helpers/publicId.js). */
const publicId = z
  .string({ error: 'A valid id is required.' })
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'A valid id is required.');

const shortText = (label, max = 200) => z
  .string({ error: `Enter a ${label}.` })
  .trim()
  .min(1, `Enter a ${label}.`)
  .max(max, `That ${label} is too long.`);

module.exports = {
  validate,
  z,
  fields: {
    email, password, newPassword, personName, money, signedMoney, publicId, shortText,
  },
};
