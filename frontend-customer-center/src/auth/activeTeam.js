/**
 * The account (Team) the customer center is acting on — the id sent as
 * `X-Team-Id` with every API request. Nothing stored = the personal account.
 *
 * Kept outside React so the axios interceptor can read it synchronously, and
 * in localStorage so a reload stays in the same account.
 */
export const ACTIVE_TEAM_KEY = 'cc_team';

/** Fired when the server says this account is no longer accessible. */
export const TEAM_ACCESS_LOST = 'cc:team-access-lost';

export const getActiveTeamId = () => {
  try { return localStorage.getItem(ACTIVE_TEAM_KEY) || null; } catch { return null; }
};

export const setActiveTeamId = (teamId) => {
  try {
    if (teamId) localStorage.setItem(ACTIVE_TEAM_KEY, teamId);
    else localStorage.removeItem(ACTIVE_TEAM_KEY);
  } catch { /* storage unavailable — falls back to personal */ }
};
