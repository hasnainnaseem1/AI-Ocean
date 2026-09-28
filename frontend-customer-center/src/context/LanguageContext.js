import React, {
  createContext, useContext, useState, useEffect, useCallback, useMemo, useRef,
} from 'react';
import i18n from '../i18n';
import { languageOf, DEFAULT_LANGUAGE, LANGUAGE_CODES } from '../i18n/languages';
import { useSite } from './SiteContext';
import { useAuth } from './AuthContext';
import { detectCountry } from '../i18n/detectCountry';
import { languageForCountry } from '../i18n/countryLanguageMap';
import config from '../config';

const LanguageContext = createContext();

export const STORAGE_KEY = 'cc_lang';

/**
 * Which language the app is in, and everything that follows from it.
 *
 * Written as a deliberate sibling of ThemeContext: same synchronous read of
 * localStorage on first render, same job of pushing a decision onto
 * `document.documentElement`. A reader who understands one understands this.
 *
 * ── How the language is decided, in order ──
 *
 *   1. The signed-in customer's saved preference (`user.language`). The account
 *      is the source of truth, so the choice follows them to any device.
 *   2. A choice made while signed out, kept in localStorage. This is what
 *      carries a language picked on /login through to the app — the sign-in
 *      page and the app are the same origin, so nothing more elaborate (a
 *      cookie, a query param) is needed.
 *   3. The platform default, which the admin sets.
 *
 * A detected country is NOT in that list, and must never be: guessing wrong
 * puts a customer into a script they cannot read. Country is used only to
 * decide which language the first-run prompt offers, and the customer still
 * has to say yes.
 */
export const LanguageProvider = ({ children }) => {
  const { siteConfig, loaded: siteLoaded, authoritative: siteAuthoritative } = useSite();
  const { user, token, updateUser } = useAuth();

  /*
   * Read synchronously so the very first paint is already in the right
   * language and direction — the same reason ThemeContext reads `cc_theme`
   * this way. `public/index.html` sets <html lang/dir> from this same key
   * before React boots, which is what stops an RTL page flashing LTR.
   */
  const [language, setLanguageState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved && LANGUAGE_CODES.includes(saved) ? saved : DEFAULT_LANGUAGE;
    } catch {
      return DEFAULT_LANGUAGE;
    }
  });

  const [antdLocale, setAntdLocale] = useState(null);

  /**
   * The languages this platform actually offers, from the admin's settings.
   *
   * Falls back to English-only until the site config has loaded, so the
   * switcher stays hidden rather than flashing a list that might be wrong.
   */
  const enabled = useMemo(() => {
    const fromServer = siteConfig?.languages?.enabled;
    if (!Array.isArray(fromServer) || !fromServer.length) {
      return [{ code: DEFAULT_LANGUAGE, englishName: 'English', nativeName: 'English', dir: 'ltr' }];
    }
    // Keep only what this build actually ships files for — the server could be
    // ahead of a stale frontend bundle after a partial deploy.
    return fromServer.filter((l) => LANGUAGE_CODES.includes(l.code));
  }, [siteConfig]);

  const platformDefault = siteConfig?.languages?.default || DEFAULT_LANGUAGE;
  const meta = languageOf(language);
  const dir = meta.dir;

  /* ── Push the language out to i18next, the DOM and antd ──────────────── */

  /**
   * Where the customer was reading when they changed language, held only for
   * the few frames it takes antd to swap stylesheets. Null at every other
   * moment, so nothing else — a route change, the handoff after sign-in — ever
   * has its scroll position moved.
   */
  const pendingScroll = useRef(null);

  useEffect(() => {
    if (i18n.language !== language) i18n.changeLanguage(language);

    const root = document.documentElement;
    root.setAttribute('lang', language);
    root.setAttribute('dir', meta.dir);

    /*
     * Put the customer back where they were reading.
     *
     * antd's style engine swaps its generated <style> tags when `locale` or
     * `direction` changes, and for a single frame one of them is gone: the
     * page is briefly unstyled, the document collapses to viewport height, and
     * the browser clamps scrollY to 0 because the old position no longer
     * exists. The next frame restores the styles and the full height — but the
     * scroll position is gone, so a customer who switched language halfway
     * down a page lands back at the top with no idea why.
     *
     * Measured on /models: scrollHeight 1455 → 900 → 1455 across ~40ms, with
     * the page's own content present and correct the whole time. So this is
     * not a re-render to fix, and not something to work around in the router;
     * it is one frame of missing CSS, and the honest repair is to put the
     * scroll position back after it.
     *
     * How long that takes is not ours to predict — it was two frames going
     * into Spanish and more coming out of Arabic, where the font also changes.
     * So rather than guessing a frame count, this retries each frame until the
     * document is tall enough to hold the position again, and gives up after a
     * fifth of a second so a genuinely shorter page never gets fought over.
     */
    if (pendingScroll.current !== null) {
      const y = pendingScroll.current;
      pendingScroll.current = null;
      const deadline = performance.now() + 200;
      const restore = () => {
        const reachable = document.documentElement.scrollHeight - window.innerHeight;
        if (reachable >= y) {
          window.scrollTo(0, y);
          return;
        }
        if (performance.now() < deadline) requestAnimationFrame(restore);
      };
      requestAnimationFrame(restore);
    }

    /*
     * Most text in this app sits in inline-styled divs rather than antd
     * components, so antd's `token.fontFamily` does not reach it — it inherits
     * from `body`. These two custom properties are what `index.css` reads, so
     * setting them here covers everything antd's token does not.
     */
    root.style.setProperty('--app-font', meta.fontFamily);
    root.style.setProperty('--app-line-height-scale', String(meta.lineHeightScale));

    try { localStorage.setItem(STORAGE_KEY, language); } catch { /* private mode */ }

    /*
     * Exactly one font link, swapped in place. Latin languages need nothing —
     * the app's own face already covers them — so the link is removed rather
     * than pointed at a stylesheet that would do nothing.
     */
    const LINK_ID = 'i18n-font';
    let link = document.getElementById(LINK_ID);
    if (meta.fontHref) {
      if (!link) {
        link = document.createElement('link');
        link.id = LINK_ID;
        link.rel = 'stylesheet';
        document.head.appendChild(link);
      }
      if (link.href !== meta.fontHref) link.href = meta.fontHref;
    } else if (link) {
      link.remove();
    }
  }, [language, meta]);

  /*
   * antd's own strings (pagination, date pickers, empty states) come from a
   * locale chunk. Loaded lazily and independently: while it is in flight antd
   * falls back to its built-in English, which is a sub-second window on a few
   * component labels and not worth blocking a render for.
   */
  useEffect(() => {
    let cancelled = false;
    meta.antdLocale()
      .then((mod) => { if (!cancelled) setAntdLocale(mod.default || mod); })
      .catch(() => { if (!cancelled) setAntdLocale(null); });
    return () => { cancelled = true; };
  }, [meta]);

  /* ── Reconcile with what the admin allows and what the account says ───── */

  useEffect(() => {
    /*
     * `authoritative`, not `loaded`.
     *
     * This effect takes the customer's language away from them, so it may only
     * run on the server's real answer. `loaded` is also true when the request
     * failed and `siteConfig` fell back to the built-in defaults — which list
     * no languages at all — and this then read that as "the admin switched
     * your language off". A backend restart mid-session was enough: Spanish
     * customers were silently dropped to English for the rest of the visit.
     */
    if (!siteAuthoritative) return;
    // An operator switched off the language this browser had stored. Move to
    // the platform default rather than rendering a language the server will
    // not serve translations for.
    if (!enabled.some((l) => l.code === language)) setLanguageState(platformDefault);
  }, [siteAuthoritative, enabled, language, platformDefault]);

  /**
   * Carry an anonymous choice onto the account, once, at sign-in.
   *
   * If someone picked Urdu on the sign-in page, that is a real preference and
   * should outlive the browser — so it is written to their account and the
   * first-run prompt is skipped. If they picked nothing, the account wins.
   */
  const handoffDone = useRef(false);

  const persist = useCallback(async (code) => {
    if (!token) return { ok: false, reason: 'anonymous' };
    try {
      const res = await fetch(`${config.apiUrl}/api/v1/auth/customer/me/language`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ language: code }),
      });
      const data = await res.json();
      if (data.success && data.user) {
        updateUser(data.user);
        return { ok: true };
      }
      return { ok: false, reason: data.message };
    } catch {
      // Offline, or the server is down. The language is already applied
      // locally and stored; it will be retried the next time it is set.
      return { ok: false, reason: 'network' };
    }
  }, [token, updateUser]);

  useEffect(() => {
    /*
     * `siteLoaded` is part of the guard, not an optimisation. This decision
     * asks "is the stored choice one this platform allows", and before the site
     * config arrives `enabled` is the English-only placeholder — so running
     * early makes every stored language look disabled and silently discards it
     * in favour of the account's. Since the handoff runs once, that discard
     * would be permanent for the session.
     */
    if (!user || !siteLoaded || handoffDone.current) return;
    handoffDone.current = true;

    let stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }

    if (stored && stored !== user.language && enabled.some((l) => l.code === stored)) {
      // They chose before signing in — that choice is the newer one.
      persist(stored);
      setLanguageState(stored);
    } else {
      // Nothing chosen here, so the account decides.
      setLanguageState(
        enabled.some((l) => l.code === user.language) ? user.language : platformDefault
      );
    }
  }, [user, siteLoaded, enabled, platformDefault, persist]);

  /* ── The first-run prompt ─────────────────────────────────────────────── */

  /**
   * Should we offer this customer a language, once?
   *
   * Every condition has to hold, and each one is there for a reason:
   *
   *   - the admin switched the prompt on;
   *   - the platform offers more than one language;
   *   - the customer is signed in (the "asked already" flag lives on their
   *     account, which is what makes this once-ever rather than once-per-browser);
   *   - they have never answered — `languagePreferenceSet === false`;
   *   - their country maps to a language we actually offer;
   *   - and it is not the language they are already reading.
   *
   * `detectCountry()` returns null today, so this never fires. That is
   * deliberate, not unfinished — see the file for what changes on the day a
   * country signal exists.
   */
  const [promptFor, setPromptFor] = useState(null);
  const promptChecked = useRef(false);

  useEffect(() => {
    if (promptChecked.current) return;
    if (!siteLoaded || !user) return;
    if (!siteConfig?.languages?.firstVisitPromptEnabled) return;
    if (user.languagePreferenceSet) return;
    if (enabled.length < 2) return;

    promptChecked.current = true;
    let cancelled = false;

    detectCountry(siteConfig).then((country) => {
      if (cancelled) return;
      const code = languageForCountry(country);
      if (!code || code === language) return;
      const match = enabled.find((l) => l.code === code);
      if (match) setPromptFor(match);
    }).catch(() => { /* no country, no prompt — the switcher still works */ });

    return () => { cancelled = true; };
  }, [siteLoaded, user, siteConfig, enabled, language]);

  const dismissPrompt = useCallback(() => setPromptFor(null), []);

  /* ── The one way anything changes the language ────────────────────────── */

  /**
   * Applied locally first, then saved.
   *
   * Local-first is what keeps a language switch from ever feeling like a
   * network operation, and it is also the honest behaviour when the save
   * fails: the customer asked for Urdu, so they get Urdu, and the account
   * catches up later. The caller is told whether the save landed so it can say
   * so without blocking the change.
   *
   * ── Why the files are fetched BEFORE the language changes ──
   *
   * Flipping the language first makes every page suspend while its namespace
   * JSON is still in flight. React then shows the route's Suspense fallback,
   * the document collapses to the height of a spinner, and the browser clamps
   * the scroll position to 0 — so the customer is thrown back to the top of
   * whatever they were reading. Measured: the document went 1457px → 900px for
   * roughly 80ms, which was enough.
   *
   * That was easy to miss because component state survives it (React hides the
   * subtree rather than unmounting it). A half-filled form still had every
   * value in it; you just could not see where you were any more.
   *
   * A `useTransition` around the state update does not help, because the
   * suspension is not caused by this update. It is caused by i18next emitting
   * `languageChanged` from the effect below, which re-renders every subscribed
   * component from outside React's transition scope.
   *
   * So the fix is to have nothing left to wait for: `loadLanguages` resolves
   * once every namespace for the new language is in the store, and only then
   * does the language flip. Nothing suspends, nothing collapses, and the whole
   * switch lands in one paint. `ns` is the full namespace list, so this is a
   * single pass rather than one request per page the customer later visits.
   *
   * A failed fetch is deliberately not fatal: the language still changes, and
   * i18next falls back to English per key. Blocking the switch over one
   * unreachable JSON file would be worse than a partly-English screen.
   */
  const changeLanguage = useCallback(async (code) => {
    if (!LANGUAGE_CODES.includes(code)) return { ok: false, reason: 'unknown' };
    try {
      await i18n.loadLanguages(code);
    } catch {
      /* fall through — see above */
    }
    // Read where they are before anything moves; the effect above puts it back
    // once antd has finished swapping its stylesheets.
    pendingScroll.current = window.scrollY;
    setLanguageState(code);
    return persist(code);
  }, [persist]);

  const value = useMemo(() => ({
    language,
    meta,
    dir,
    isRtl: dir === 'rtl',
    antdLocale,
    enabled,
    platformDefault,
    changeLanguage,
    // The language the first-run prompt should offer, or null when it should
    // not appear — which is every case today, since no country signal exists.
    promptFor,
    dismissPrompt,
  }), [language, meta, dir, antdLocale, enabled, platformDefault, changeLanguage, promptFor, dismissPrompt]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => useContext(LanguageContext);
