import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Resets scroll to the top of the new page on every route change.
 *
 * A real multi-page site does this for free on full navigation; a
 * client-rendered SPA has to do it explicitly, or clicking a nav link while
 * scrolled down on the previous page leaves the new page scrolled to that
 * same pixel offset — which reads as broken, not merely inelegant.
 */
const ScrollToTop = () => {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

export default ScrollToTop;
