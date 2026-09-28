import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Every button and "learn more" link on this site is admin-configured, so its
 * target can be an internal route (`/pricing`) or an external one (the
 * customer center, a signup link, an off-site URL) — there was no single
 * place deciding which is which, so every one of them rendered as a plain
 * `<a>`. For an internal target that forces a full browser navigation: the
 * whole page unloads and reloads, which is the "blink" a nav-link click no
 * longer has now that those go through React Router.
 *
 * A path starting with a single `/` is a route on this same app; anything
 * else (an absolute URL, `mailto:`, `tel:`) is left as a real anchor.
 */
const SmartLink = ({ href, children, className, style, ...rest }) => {
  const isInternal = !!href && href.startsWith('/') && !href.startsWith('//');

  if (isInternal) {
    return (
      <Link to={href} className={className} style={style} {...rest}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} className={className} style={style} {...rest}>
      {children}
    </a>
  );
};

export default SmartLink;
