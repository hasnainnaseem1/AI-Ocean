import axios from 'axios';
import config from '../config';
import { endsSession, endReason } from '../auth/sessionPolicy';
import { getActiveTeamId, setActiveTeamId, TEAM_ACCESS_LOST } from '../auth/activeTeam';

const axiosInstance = axios.create({
  baseURL: config.apiUrl,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — inject auth token
axiosInstance.interceptors.request.use(
  (cfg) => {
    const token = localStorage.getItem('token');
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
    // Which account this request acts on (see auth/activeTeam.js). A call
    // that names its account itself — e.g. inviting into a team just created
    // — keeps its own header.
    const teamId = getActiveTeamId();
    if (teamId && !cfg.headers['X-Team-Id']) cfg.headers['X-Team-Id'] = teamId;
    return cfg;
  },
  (error) => Promise.reject(error)
);

// Response interceptor — 401, and the 403s the backend marks as ending a
// session. See auth/sessionPolicy.js for why that decision is not made here.
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const { status, data } = error.response || {};

    // Removed from the team (or it was deleted) while using it: drop back to
    // the personal account instead of failing every request from now on.
    if (status === 403 && data?.code === 'TEAM_ACCESS_DENIED' && getActiveTeamId()) {
      setActiveTeamId(null);
      window.dispatchEvent(new Event(TEAM_ACCESS_LOST));
    }

    if (endsSession(status, data)) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        const reason = endReason(data);
        window.location.href = reason
          ? `/login?reason=${encodeURIComponent(reason)}`
          : '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default axiosInstance;
