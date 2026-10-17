/*
 * AI-Ocean traffic tracker.
 *
 * ── Why this lives on the server and not in each frontend ──
 *
 * The marketing site and the customer center both need it. Two copies in two
 * React apps is two files that drift, and changing the tracker would mean
 * rebuilding and redeploying both. Served from the backend it is one file,
 * and it reaches every surface the moment it changes.
 *
 * Loaded as:
 *   <script defer src="<api>/api/v1/public/track/tracker.js" data-site="marketing"></script>
 *
 * ── What it does NOT do ──
 *
 *  • No cookie, no localStorage, no device fingerprinting. The visitor is
 *    identified server-side by a hash that is re-salted every midnight, so
 *    this script stores nothing at all and needs no consent banner.
 *  • No personal data. It sends the path, the referrer and how long the page
 *    was open. The server strips sensitive query keys from the path before
 *    storing it — this script does not decide what is sensitive, because a
 *    script anybody can edit is not an enforcement point.
 *  • Nothing if it cannot work. Every failure is swallowed: a tracker that
 *    throws is a red error in the console of somebody's marketing site.
 */
(function trackerIIFE() {
  'use strict';

  var script = document.currentScript
    || (function last() {
      var all = document.getElementsByTagName('script');
      return all[all.length - 1];
    }());
  if (!script) return;

  var site = script.getAttribute('data-site') || 'marketing';
  // Same origin as the script itself, so there is one thing to configure.
  var endpoint = script.src.replace(/\/tracker\.js.*$/, '');

  /*
   * Do Not Track is honoured here as well as on the server. The server is the
   * enforcement point, but there is no reason to send a beacon we already know
   * will be discarded — and a request that is never made cannot be logged by
   * anything in between.
   */
  var dnt = navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack;
  if (dnt === '1' || dnt === 'yes') return;

  var enabled = null;          // null until the config call answers
  var queue = [];
  var current = null;          // { path, referrer, startedAt }

  function send(events) {
    if (!events.length) return;
    var payload = JSON.stringify({ site: site, events: events });
    try {
      /*
       * `sendBeacon` with a `text/plain` blob, deliberately. A JSON blob makes
       * the request non-simple, which triggers a CORS preflight — and a
       * preflight fired while the page is unloading is routinely cancelled, so
       * the last view of every visit would be lost. `text/plain` is a simple
       * content type and needs no preflight.
       */
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(endpoint, blob)) return;
      }
      // `keepalive` so the request survives the page going away, for the
      // browsers that have fetch but not a working sendBeacon.
      fetch(endpoint, {
        method: 'POST',
        body: payload,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        keepalive: true,
        mode: 'cors',
        credentials: 'omit',
      }).catch(function ignore() {});
    } catch (e) { /* a tracker must never break the page it is on */ }
  }

  function flush() {
    if (enabled === false) { queue = []; return; }
    if (enabled === null) return;        // still asking; events stay queued
    var batch = queue.splice(0, 20);
    send(batch);
  }

  /** Close the page we were on, recording how long it was open. */
  function closeCurrent() {
    if (!current) return;
    queue.push({
      p: current.path,
      r: current.referrer,
      d: Date.now() - current.startedAt,
    });
    current = null;
  }

  function open(path, referrer) {
    closeCurrent();
    current = {
      path: path,
      referrer: referrer,
      startedAt: Date.now(),
    };
  }

  function pathNow() {
    // The hash is never sent: on this platform it carries nothing a report
    // needs, and it is where a client-side router can leave a token.
    return window.location.pathname + window.location.search;
  }

  /* ── Config: is tracking on, and is this surface tracked? ── */
  try {
    fetch(endpoint + '/config', { credentials: 'omit' })
      .then(function parse(r) { return r.json(); })
      .then(function apply(cfg) {
        enabled = !!(cfg && cfg.enabled && (!cfg.sites || cfg.sites[site] !== false));
        if (!enabled) { queue = []; return; }
        flush();
      })
      .catch(function fallback() {
        /*
         * Fail CLOSED. If the platform cannot tell us whether tracking is on,
         * the answer is no — switching tracking off must not depend on every
         * visitor's network being healthy.
         */
        enabled = false;
        queue = [];
      });
  } catch (e) { enabled = false; }

  /* ── Page lifecycle ── */
  open(pathNow(), document.referrer || '');

  /*
   * Single-page navigation. Both apps are React Router, so a route change is
   * a `pushState` and fires no navigation event of its own — without this the
   * tracker would record one page view per full page load and nothing else,
   * which on an SPA is almost nothing.
   */
  ['pushState', 'replaceState'].forEach(function patch(name) {
    var original = history[name];
    if (typeof original !== 'function') return;
    history[name] = function patched() {
      var result = original.apply(this, arguments);
      try {
        var next = pathNow();
        if (!current || current.path !== next) {
          // Internal navigation: the page we just left is the referrer.
          open(next, window.location.origin + (current ? current.path : ''));
          flush();
        }
      } catch (e) { /* never break navigation */ }
      return result;
    };
  });

  window.addEventListener('popstate', function onPop() {
    var next = pathNow();
    if (!current || current.path !== next) { open(next, ''); flush(); }
  });

  /*
   * `pagehide` rather than `unload`: `unload` prevents the browser's
   * back/forward cache and is ignored outright on iOS. `visibilitychange` on
   * top of it, because a tab switched away from on mobile is often never
   * given a `pagehide` at all.
   */
  window.addEventListener('pagehide', function onHide() { closeCurrent(); flush(); });
  document.addEventListener('visibilitychange', function onVis() {
    if (document.visibilityState === 'hidden') {
      var path = current && current.path;
      var ref = current && current.referrer;
      closeCurrent();
      flush();
      // Still here, just not looked at — resume timing so coming back does
      // not report the whole away-time as reading time.
      if (path) open(path, ref || '');
    }
  });
}());
