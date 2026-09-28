import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import config from '../config';
import { endsSession } from '../auth/sessionPolicy';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [loading, setLoading] = useState(!!localStorage.getItem('token'));

  const fetchMe = useCallback(async (tk) => {
    if (!tk) { setLoading(false); return; }
    try {
      setLoading(true);
      const res = await fetch(`${config.apiUrl}/api/v1/auth/customer/me`, {
        headers: { Authorization: `Bearer ${tk}` }
      });
      const data = await res.json();
      if (data.success) {
        setUser(data.user);
        localStorage.setItem('user', JSON.stringify(data.user));
      } else if (endsSession(res.status, data)) {
        logout();
      }
      /**
       * Anything else — maintenance mode (503), a server error, a disabled
       * feature — leaves the session alone. Treating every unsuccessful
       * response as a failed login is what used to sign every customer out the
       * moment an operator turned maintenance mode on.
       */
    } catch {
      // network failure — keep existing user from localStorage
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchMe(token);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = (newToken, newUser) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    // The next person to sign in on this browser starts in their own
    // personal account, not in the previous person's team.
    localStorage.removeItem('cc_team');
    sessionStorage.clear();
    setToken(null);
    setUser(null);
  };

  const updateUser = (updated) => {
    const merged = { ...user, ...updated };
    localStorage.setItem('user', JSON.stringify(merged));
    setUser(merged);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, updateUser, fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
