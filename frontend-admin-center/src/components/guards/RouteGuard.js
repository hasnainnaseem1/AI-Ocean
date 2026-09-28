import React from 'react';
import PermissionGuard from './PermissionGuard';

/**
 * PermissionGuard, pinned to `showForbidden` for route-level use.
 *
 * `PermissionGuard`'s default (`fallback: null`) is right for hiding a button
 * or a menu item, but wrong for an entire page: a denied route rendered
 * `null` inside `AppLayout` for a blank shell with a sidebar and nothing
 * else — no explanation, no way back. Every `<Route>` in App.js should use
 * this instead of `PermissionGuard` directly; in-page conditional rendering
 * (buttons, sections) should keep using `PermissionGuard`.
 */
const RouteGuard = ({ permission, requireAll, children }) => (
  <PermissionGuard permission={permission} requireAll={requireAll} showForbidden>
    {children}
  </PermissionGuard>
);

export default RouteGuard;
