import { useEffect, useRef, useState } from 'react';

/**
 * Fires once, the first time the element scrolls into view, then stops
 * watching — a re-visit on scrolling back up does not replay it. Respects
 * prefers-reduced-motion by reporting "already visible" immediately, so a
 * reduced-motion visitor never has to wait on a scroll trigger to read
 * content that a motion-enabled visitor sees appear on its own.
 */
const useReveal = (options) => {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -80px 0px', ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, visible };
};

export default useReveal;
