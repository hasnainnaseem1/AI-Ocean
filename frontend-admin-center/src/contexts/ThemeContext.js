import React, { createContext, useContext, useState, useEffect } from 'react';

/**
 * Light/dark mode for the admin center.
 *
 * Mirrors the customer center's provider (`frontend-customer-center/src/
 * context/ThemeContext.js`) with its own storage key, so the two apps remember
 * their themes independently — an operator may well want a dark admin console
 * and a light customer view, or vice versa.
 *
 * Two consumers, both already wired:
 *   • antd, via `ConfigProvider`'s algorithm + token objects in `index.js`
 *   • custom markup, via `useTheme()` → `cardStyle(isDark)`, `TILE.x.bg(isDark)`…
 *
 * The `.dark` class on <html> exists for the handful of CSS rules in index.css
 * that antd computes badly on its own (menu selected fill, table row hover).
 *
 * With the Phase 4 hex sweep done, every page now reads its colours from
 * `isDark` rather than hardcoding light ones, so — same as the customer
 * center — an admin whose OS is set to dark sees a dark console on first
 * visit, and an explicit toggle (top-right header) overrides that from then on.
 */
const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem('ac_theme');
      return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false; // private mode / storage blocked — light is the safe default
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('ac_theme', isDark ? 'dark' : 'light');
    } catch {
      /* non-fatal: the theme just won't persist across reloads */
    }
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const toggleTheme = () => setIsDark((prev) => !prev);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
