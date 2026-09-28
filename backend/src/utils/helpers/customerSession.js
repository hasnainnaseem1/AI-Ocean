/**
 * The customer object every authenticated session response returns.
 *
 * This existed five times as a hand-written literal in
 * `routes/v1/auth/customer.routes.js` — Google SSO, signup auto-login, login,
 * `GET /me` and `PUT /me` — and the five had already drifted: Google SSO
 * returned five fields where the others returned nine, so a customer who signed
 * in with Google had no `role` or `status` in `localStorage` until the client's
 * next `/me` call landed. Adding a field meant remembering all five.
 *
 * One function instead, so the session payload is one decision. The Google SSO
 * response gets wider as a result, which is the fix, not a side effect.
 *
 * Deliberately a whitelist rather than a spread of the wrapped user: that object
 * carries password-reset tokens, lock state, login-attempt counters and gateway
 * customer ids, none of which belong in a response body or in the browser's
 * localStorage.
 */
const customerSessionUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone || '',
  avatar: user.avatar || null,
  accountType: user.accountType,
  role: user.role,
  isEmailVerified: user.isEmailVerified,
  status: user.status,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,

  // Which language to render in, and whether the customer has ever actually
  // chosen. Both travel with the session so the client can settle its language
  // and decide about the first-run prompt on load, without a second round trip.
  language: user.language || 'en',
  languagePreferenceSet: !!user.languagePreferenceSet,

  // Chose "my team / company" at signup and has not yet created (or skipped)
  // their organization — the client shows the team onboarding while true.
  teamOnboardingPending: !!user.teamOnboardingPending,
});

module.exports = { customerSessionUser };
