import React, { createContext, useReducer, useEffect, useCallback } from 'react';
import authApi from '../api/authApi';

export const AuthContext = createContext(null);

// Actions
const AUTH_ACTIONS = {
  SET_LOADING: 'SET_LOADING',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  SET_USER: 'SET_USER',
  LOGOUT: 'LOGOUT',
  AUTH_ERROR: 'AUTH_ERROR',
};

// Ensure user object has valid permissions array
const normalizeUser = (user) => {
  if (!user) return null;
  return {
    ...user,
    permissions: Array.isArray(user.permissions) ? user.permissions : []
  };
};

// Reducer
const authReducer = (state, action) => {
  switch (action.type) {
    case AUTH_ACTIONS.SET_LOADING:
      return { ...state, loading: action.payload };
    case AUTH_ACTIONS.LOGIN_SUCCESS:
      return {
        ...state,
        user: normalizeUser(action.payload.user),
        token: action.payload.token,
        isAuthenticated: true,
        loading: false,
      };
    case AUTH_ACTIONS.SET_USER:
      return { ...state, user: normalizeUser(action.payload), loading: false };
    case AUTH_ACTIONS.LOGOUT:
      return { user: null, token: null, isAuthenticated: false, loading: false };
    case AUTH_ACTIONS.AUTH_ERROR:
      return { user: null, token: null, isAuthenticated: false, loading: false };
    default:
      return state;
  }
};

// Initial state
const getInitialState = () => {
  const token = localStorage.getItem('admin_token');
  return {
    user: null,
    token: token || null,
    isAuthenticated: false,
    loading: !!token, // if token exists, we need to validate it
  };
};

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, null, getInitialState);

  // On mount: validate existing token
  useEffect(() => {
    const validateToken = async () => {
      const token = localStorage.getItem('admin_token');
      if (!token) {
        dispatch({ type: AUTH_ACTIONS.AUTH_ERROR });
        return;
      }
      try {
        const data = await authApi.getMe();
        if (data.success && data.user) {
          const normalizedUser = normalizeUser(data.user);
          dispatch({
            type: AUTH_ACTIONS.LOGIN_SUCCESS,
            payload: { user: normalizedUser, token },
          });
        } else {
          throw new Error('Invalid session');
        }
      } catch {
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        dispatch({ type: AUTH_ACTIONS.AUTH_ERROR });
      }
    };
    validateToken();
  }, []);

  // Login
  const login = useCallback(async (email, password) => {
    dispatch({ type: AUTH_ACTIONS.SET_LOADING, payload: true });
    const data = await authApi.login(email, password);
    if (data.success) {
      localStorage.setItem('admin_token', data.token);
      const normalizedUser = normalizeUser(data.user);
      localStorage.setItem('admin_user', JSON.stringify(normalizedUser));
      dispatch({
        type: AUTH_ACTIONS.LOGIN_SUCCESS,
        payload: { user: normalizedUser, token: data.token },
      });
    }
    return data;
  }, []);

  // Logout
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore logout API error
    }
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    dispatch({ type: AUTH_ACTIONS.LOGOUT });
  }, []);

  // Change password
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const data = await authApi.changePassword(currentPassword, newPassword);
    return data;
  }, []);

  // Refresh user data
  const refreshUser = useCallback(async () => {
    try {
      const data = await authApi.getMe();
      if (data.success && data.user) {
        dispatch({ type: AUTH_ACTIONS.SET_USER, payload: data.user });
      }
    } catch {
      // ignore
    }
  }, []);

  // Update user data
  const updateUserData = useCallback(async (updates) => {
    try {
      const data = await authApi.updateProfile(updates);
      if (data.success && data.user) {
        const normalizedUser = normalizeUser(data.user);
        dispatch({ type: AUTH_ACTIONS.SET_USER, payload: normalizedUser });
        localStorage.setItem('admin_user', JSON.stringify(normalizedUser));
      }
      return data;
    } catch (error) {
      throw error;
    }
  }, []);

  const value = {
    user: state.user,
    token: state.token,
    isAuthenticated: state.isAuthenticated,
    loading: state.loading,
    login,
    logout,
    changePassword,
    refreshUser,
    updateUserData,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
