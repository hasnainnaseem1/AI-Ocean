import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import { LANGUAGE_CODES, DEFAULT_LANGUAGE } from './languages';
import en from './en';

/**
 * i18next, set up for this app.
 *
 * ── How translations are loaded ──
 *
 * English is bundled (imported above); every other language is fetched at
 * runtime from `public/locales/<lng>/<ns>.json`.
 *
 * The alternative — a dynamic `import()` per JSON file — was rejected because
 * webpack turns a computed `import()` path into a *context module*: it
 * enumerates the matching files at build time, so adding a language would still
 * mean a rebuild and a redeploy. Files under `public/` are copied verbatim by
 * `react-scripts build`, so a new language really is a file drop, which is the
 * whole promise of this feature.
 *
 * Bundling English closes the only real downside of fetching: the fallback
 * language can never fail to load, so a flaky network degrades a page to
 * English rather than to blanks.
 */

const NAMESPACES = [
  'common',
  'nav',
  'notifications',
  'auth',
  'dashboard',
  'billing',
  'deployments',
  'deploy',
  'catalog',
  'account',
  'support',
  'teams',
];

/**
 * `react-scripts` does not content-hash anything in `public/`, so a changed
 * translation file would otherwise be served from a browser cache indefinitely.
 * The build id changes per deploy and busts it.
 */
const cacheBuster = process.env.REACT_APP_BUILD_ID || process.env.REACT_APP_VERSION || '1';

const isDev = process.env.NODE_ENV === 'development';

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    // The language is decided by LanguageContext (account → stored choice →
    // platform default), never by i18next itself — which is also why
    // `i18next-browser-languagedetector` is not installed. Starting on English
    // and being told otherwise a moment later is correct: English is bundled,
    // so that first render costs nothing.
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGE_CODES,

    ns: NAMESPACES,
    defaultNS: 'common',

    // English lives in the bundle; the backend plugin is asked only for the
    // languages that are not already here.
    resources: { [DEFAULT_LANGUAGE]: en },
    partialBundledLanguages: true,

    backend: {
      loadPath: `/locales/{{lng}}/{{ns}}.json?v=${cacheBuster}`,
    },

    interpolation: {
      // React escapes for us; letting i18next escape as well double-encodes
      // anything with an apostrophe or an ampersand in it.
      escapeValue: false,
    },

    react: {
      // Pages suspend while their namespace loads, into the <Suspense> that
      // already wraps the router in App.js. No new loading UI is needed.
      useSuspense: true,
    },

    /**
     * A missing key must never reach a customer as `billing:overview.title`.
     *
     * A key missing in Urdu falls back to the bundled English automatically, so
     * this only fires when a key is missing in English too — which is a
     * developer mistake, not a translation gap. Loud in development, invisible
     * in production.
     */
    saveMissing: false,
    parseMissingKeyHandler: (key) => (isDev ? key : ''),
    missingKeyHandler: (lngs, ns, key) => {
      if (isDev) console.warn(`[i18n] missing key "${ns}:${key}" (${lngs.join(', ')})`);
    },

    debug: false,
  });

export default i18n;

/**
 * The translator, for code that runs outside a React component — the shared
 * formatters in `utils/`, mostly.
 *
 * This is react-i18next's documented escape hatch and it is safe here for one
 * specific reason: every function that uses it runs during the render of a
 * component that is itself subscribed to the language, so a language change
 * re-renders the caller and the string is never stale.
 */
export const t = (...args) => i18n.t(...args);
