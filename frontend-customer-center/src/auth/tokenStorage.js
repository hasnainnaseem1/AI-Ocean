/**
 * Where the session lives — `localStorage` (survives closing the browser) or
 * `sessionStorage` (gone once the tab/browser closes), depending on whether
 * "Remember me" was checked at sign-in. Everything that needs to read or
 * write the token/user goes through here rather than calling `localStorage`
 * directly, so the two storages can never drift into holding different
 * values — AuthContext and the axios interceptor both use this.
 */
const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
};

export const getUser = () => {
  try {
    const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

/**
 * `remember: true` (the default — matches the "Remember me" checkbox's own
 * default) keeps the session past a browser restart; `false` keeps it only
 * for this tab. Writing to one storage clears the other, so signing in twice
 * on the same browser with a different choice each time never leaves a stale
 * copy of the old session sitting in whichever one isn't active — the axios
 * interceptor and `getToken`/`getUser` above would otherwise happily read
 * that stale copy back.
 */
export const setSession = (token, user, remember = true) => {
  const active = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;
  try {
    active.setItem(TOKEN_KEY, token);
    active.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* storage unavailable — session just won't persist */ }
  try {
    other.removeItem(TOKEN_KEY);
    other.removeItem(USER_KEY);
  } catch { /* ignore */ }
};

/** Updates the stored user in whichever storage currently holds the session. */
export const updateStoredUser = (user) => {
  const active = (() => { try { return localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage; } catch { return sessionStorage; } })();
  try { active.setItem(USER_KEY, JSON.stringify(user)); } catch { /* ignore */ }
};

export const clearSession = () => {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY); } catch { /* ignore */ }
};
