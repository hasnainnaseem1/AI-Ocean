/**
 * The email address to prefill the sign-in form with next time — never the
 * password. A plaintext password sitting in browser storage is a real risk
 * (anyone who can run script on this origin, e.g. via an XSS bug, reads it
 * straight out), whereas the browser's own password manager stores it
 * encrypted and scoped to the OS keychain. "Remember me" here only saves the
 * email for a faster start; the password field is left for the browser's
 * native save-password prompt to fill in (see the `autoComplete` attributes
 * on LoginPage's inputs, which is what makes that prompt appear reliably).
 */
const KEY = 'cc_remembered_email';

export const getRememberedEmail = () => {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
};

export const setRememberedEmail = (email) => {
  try {
    if (email) localStorage.setItem(KEY, email);
    else localStorage.removeItem(KEY);
  } catch { /* storage unavailable — just won't be remembered */ }
};
