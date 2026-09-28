/**
 * Where to send someone after they sign in or sign up, from a `?next=` query
 * parameter — but only if it is a path inside this app. Anything else
 * (`https://evil.example`, `//evil.example`, `/\evil`) is ignored, so the
 * parameter cannot be used to bounce a freshly signed-in customer to another
 * site (an open redirect).
 */
export const safeNext = (search) => {
  const next = new URLSearchParams(search || '').get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  return next;
};

/**
 * An invitation the visitor opened before they had an account. Signing up
 * goes through email verification — often in another tab or on another
 * device — which loses the `?next=`; this remembers the invitation until
 * they next sign in.
 */
const PENDING_INVITE = 'cc_pending_invite';

export const rememberInvite = (path) => {
  try { localStorage.setItem(PENDING_INVITE, path); } catch { /* storage unavailable */ }
};

export const takePendingInvite = () => {
  try {
    const path = localStorage.getItem(PENDING_INVITE);
    localStorage.removeItem(PENDING_INVITE);
    return path && path.startsWith('/invite/') ? path : null;
  } catch {
    return null;
  }
};

/** After a sign-in: the requested page, else a waiting invitation, else home. */
export const afterSignIn = (search) => safeNext(search) || takePendingInvite() || '/dashboard';
