import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * A thin bar that sweeps across the top of the viewport on every internal
 * route change — purely cosmetic, on top of an already-instant transition.
 *
 * Page content here is cache-warm by the time a click happens (see
 * SiteContext's prefetch), so there is no real loading state left to show.
 * Without any indicator at all, a switch this fast can read as having done
 * nothing; this gives it the same sense of motion the sign-in/sign-up
 * redirect already has, without adding a single millisecond of actual wait —
 * it is timed, not tied to any fetch.
 *
 * Skipped on the very first render so it never appears on initial page load,
 * only on a route change after that.
 */
const RouteProgressBar = () => {
  const { pathname } = useLocation();
  const isFirstRender = useRef(true);
  const [playKey, setPlayKey] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return undefined;
    }
    setVisible(true);
    setPlayKey((k) => k + 1);
    const timer = setTimeout(() => setVisible(false), 420);
    return () => clearTimeout(timer);
  }, [pathname]);

  if (!visible) return null;

  return <div key={playKey} className="route-progress-bar" />;
};

export default RouteProgressBar;
