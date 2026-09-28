import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import config from '../config';

/**
 * Checks the backend for any active SEO redirects on every route change.
 * If a match is found, navigates the user to the target path.
 */
const RedirectHandler = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const checkRedirect = async () => {
      try {
        const res = await fetch(
          `${config.apiUrl}/api/v1/public/seo/check-redirect?path=${encodeURIComponent(location.pathname)}`
        );
        const data = await res.json();

        if (data.success && data.redirect) {
          const { toPath, statusCode } = data.redirect;
          if (toPath) {
            // For external URLs
            if (toPath.startsWith('http://') || toPath.startsWith('https://')) {
              window.location.href = toPath;
            } else {
              // Internal redirect — replace history for 301/308 (permanent), push for 302/307 (temporary)
              navigate(toPath, { replace: statusCode === 301 || statusCode === 308 });
            }
          }
        }
      } catch {
        // Silently fail — redirect checking should never break the site
      }
    };

    checkRedirect();
  }, [location.pathname, navigate]);

  return null;
};

export default RedirectHandler;
