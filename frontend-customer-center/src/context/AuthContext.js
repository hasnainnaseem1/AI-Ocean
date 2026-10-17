import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import config from '../config';
import { endsSession } from '../auth/sessionPolicy';
import { getToken, getUser, setSession, updateStoredUser, clearSession } from '../auth/tokenStorage';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => getUser());
  const [token, setToken] = useState(() => getToken());
  const [loading, setLoading] = useState(!!getToken());

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
        updateStoredUser(data.user);
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

  // `remember` defaults to true — unless the "Remember me" checkbox is
  // actually unchecked, signing in should keep behaving exactly as it always
  // has (session survives closing the browser).
  const login = (newToken, newUser, remember = true) => {
    setSession(newToken, newUser, remember);
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    clearSession();
    // The next person to sign in on this browser starts in their own
    // personal account, not in the previous person's team.
    localStorage.removeItem('cc_team');
    sessionStorage.clear();
    setToken(null);
    setUser(null);
  };

  const updateUser = (updated) => {
    const merged = { ...user, ...updated };
    updateStoredUser(merged);
    setUser(merged);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, updateUser, fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
