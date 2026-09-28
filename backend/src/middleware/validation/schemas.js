/**
 * Input shapes for the boundaries that are validated declaratively.
 *
 * Kept together rather than beside each route so that "what does this endpoint
 * accept" is answerable in one place, and so two endpoints taking the same
 * thing (an email, an amount) cannot disagree about what is valid.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────
 *
 * Password *strength* — length, character classes, and so on — is not in these
 * schemas, and must not be. It is admin-controlled
 * (`AdminSettings.securitySettings`) and enforced by `validatePassword()` in
 * the signup and reset handlers. Putting a `min(8)` here would hardcode a
 * policy the operator is supposed to own, and would silently override whatever
 * they configured. These schemas only assert that a password is a string of
 * sane length, so that a number or an object cannot reach the hashing code.
 *
 * Likewise the disposable-domain blocklist and MX check stay in
 * `emailValidator.js`, which reads them from settings and runs after this.
 */
const { z, fields } = require('./validate');

const {
  email, password, personName, money, signedMoney,
} = fields;

/* ── Auth ──────────────────────────────────────────────────────────────── */

const signup = z.object({
  name: personName,
  email,
  password,
}).passthrough();

const login = z.object({
  email,
  password,
}).passthrough();

const forgotPassword = z.object({
  email,
}).passthrough();

const resendVerification = z.object({
  email,
}).passthrough();

const resetPassword = z.object({
  password,
}).passthrough();

const changePassword = z.object({
  currentPassword: z.string({ error: 'Enter your current password.' })
    .min(1, 'Enter your current password.')
    .max(200, 'That password is too long.'),
  newPassword: password,
}).passthrough();

/* ── Preferences ───────────────────────────────────────────────────────── */

/**
 * Shape only: a plausible BCP 47 tag such as `en`, `ur` or `zh-CN`.
 *
 * Which languages are actually available is an admin setting
 * (`AdminSettings.features.languages`), so the allowlist is enforced in the
 * handler, not here — the same division of labour as the wallet limits below.
 * Listing the six current codes in a `z.enum` would hardcode a list the
 * operator owns and would need a code change every time they added one.
 */
const setLanguage = z.object({
  language: z.string({ error: 'Choose a language.' })
    .trim()
    .regex(/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/, 'That is not a valid language code.'),
}).passthrough();

/* ── Money ─────────────────────────────────────────────────────────────── */

/**
 * A wallet adjustment may be positive or negative — that is the point of it.
 *
 * The schema asserts only that the amount is a real, non-zero, finite number,
 * so that `"abc"`, `null`, an object or `Infinity` cannot reach the handler.
 * It deliberately does **not** cap the magnitude: that cap is
 * `AdminSettings.billingSettings.maxManualAdjustment`, enforced in the handler,
 * and an operator is meant to be able to raise it. A number here would be a
 * second, invisible limit that silently overrode theirs.
 */
const walletAdjust = z.object({
  amount: signedMoney({ label: 'adjustment' }),
  description: z.string().trim().max(500, 'That description is too long.').optional(),
  type: z.string().trim().max(50).optional(),
}).passthrough();

/** Same division of labour: shape here, the configured min/max in the handler. */
const walletTopUp = z.object({
  amount: money({ label: 'top-up amount' }),
}).passthrough();

const writeOff = z.object({
  reason: z.string().trim().max(500, 'That reason is too long.').optional(),
}).passthrough();

module.exports = {
  signup,
  login,
  forgotPassword,
  resendVerification,
  resetPassword,
  changePassword,
  setLanguage,
  walletAdjust,
  walletTopUp,
  writeOff,
};
