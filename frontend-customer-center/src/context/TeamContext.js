import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { useAuth } from './AuthContext';
import teamsApi from '../api/teamsApi';
import { getActiveTeamId, setActiveTeamId, TEAM_ACCESS_LOST } from '../auth/activeTeam';

/**
 * Which account (personal or a team) the customer center is acting on, and
 * what the customer's role in it allows.
 *
 * The chosen account lives in localStorage (auth/activeTeam.js) so every
 * request carries it as `X-Team-Id` (api/axiosInstance.js), and it survives a
 * reload. No choice = the personal account — so an individual customer, who
 * belongs to no team, sees nothing new anywhere.
 *
 * `can(action)` mirrors the server's permission table for the current account
 * (services/team/permissions.js on the backend), so the UI can hide what the
 * role cannot do. It is only a courtesy: the server refuses those actions and
 * strips money from its responses regardless of what the UI shows.
 */
const TeamContext = createContext(null);

const PERSONAL_DEFAULT = {
  team: null, role: 'owner', actions: null, canSeeMoney: true,
};

export const TeamProvider = ({ children }) => {
  const { user, token } = useAuth();
  const [teams, setTeams] = useState([]);
  const [current, setCurrent] = useState(PERSONAL_DEFAULT);
  const [ready, setReady] = useState(!getActiveTeamId());
  // Bumped on every switch; the app remounts its pages on it so nothing from
  // the previous account's data is left on screen.
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    if (!token) {
      setTeams([]); setCurrent(PERSONAL_DEFAULT); setReady(true);
      return;
    }
    try {
      const [list, cur] = await Promise.all([teamsApi.list(), teamsApi.current()]);
      const all = list.teams || [];
      setTeams(all);
      // A stored team the customer no longer belongs to: back to personal.
      const stored = getActiveTeamId();
      if (stored && !all.some((t) => t.id === stored)) {
        setActiveTeamId(null);
        setVersion((v) => v + 1);
        return;
      }
      setCurrent({
        team: cur.team, role: cur.role, actions: cur.actions, canSeeMoney: cur.canSeeMoney,
      });
    } catch {
      // Keep what we have; the pages still work against the personal account.
    } finally {
      setReady(true);
    }
  }, [token]);

  useEffect(() => { load(); }, [load, version, user?.id]);

  // The server said this account is no longer ours (removed, or it was deleted).
  useEffect(() => {
    const onLost = () => { setActiveTeamId(null); setReady(false); setVersion((v) => v + 1); };
    window.addEventListener(TEAM_ACCESS_LOST, onLost);
    return () => window.removeEventListener(TEAM_ACCESS_LOST, onLost);
  }, []);

  const switchTeam = useCallback((teamId) => {
    const target = teamId && teams.find((t) => t.id === teamId && t.kind !== 'personal');
    setActiveTeamId(target ? target.id : null);
    setReady(false);
    setVersion((v) => v + 1);
  }, [teams]);

  const value = useMemo(() => {
    const personal = teams.find((t) => t.kind === 'personal') || null;
    const activeTeam = current.team || personal;
    return {
      teams,
      personal,
      activeTeam,
      isPersonal: !activeTeam || activeTeam.kind === 'personal',
      hasTeams: teams.some((t) => t.kind === 'team'),
      role: current.role,
      canSeeMoney: current.canSeeMoney !== false,
      can: (action) => (current.actions ? current.actions.includes(action) : true),
      ready,
      version,
      switchTeam,
      reload: () => setVersion((v) => v + 1),
    };
  }, [teams, current, ready, version, switchTeam]);

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
};

export const useTeam = () => useContext(TeamContext) || {
  teams: [], personal: null, activeTeam: null, isPersonal: true, hasTeams: false,
  role: 'owner', canSeeMoney: true, can: () => true, ready: true, version: 0,
  switchTeam: () => {}, reload: () => {},
};
