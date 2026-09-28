/**
 * Language Settings Service
 *
 * Single source of truth, server-side, for "which languages does this platform
 * offer and what does this user read in".
 *
 * Two separate lists, and the distinction matters:
 *
 *   SUPPORTED_LANGUAGES — what the product is *capable* of. A code-level
 *     catalogue, because adding one genuinely requires shipping translation
 *     files. Engineering owns this.
 *   settings.enabled    — which of those are *live* right now. An admin setting
 *     (Admin Center → Settings → Languages), because turning a language on or
 *     off the day its translations are reviewed is an operator decision, not a
 *     deploy. The platform owner owns this.
 *
 * That split is why `User.language` is a plain TEXT column rather than a
 * Postgres enum: an enum would tie the operator's list to a migration.
 */
const adminSettingsService = require('../admin/adminSettingsService');

/**
 * Every language the product has translation files for.
 *
 * `dir` lives here rather than being derived, because "is this script
 * right-to-left" is a fact about the language that both the API payload and the
 * email layout need, and deriving it from a hardcoded list of RTL codes in two
 * places is how the two drift.
 *
 * The frontend has its own richer catalogue (fonts, antd locale modules) at
 * `frontend-customer-center/src/i18n/languages.js` — those are rendering
 * concerns the server has no business knowing about. `code`, `englishName`,
 * `nativeName` and `dir` are the overlap, and the server is authoritative for
 * them because it is what the admin configures against.
 */
const SUPPORTED_LANGUAGES = Object.freeze([
  { code: 'en',    englishName: 'English',             nativeName: 'English',  dir: 'ltr' },
  { code: 'ur',    englishName: 'Urdu',                nativeName: 'اردو',      dir: 'rtl' },
  { code: 'ar',    englishName: 'Arabic',              nativeName: 'العربية',   dir: 'rtl' },
  { code: 'hi',    englishName: 'Hindi',               nativeName: 'हिन्दी',      dir: 'ltr' },
  { code: 'es',    englishName: 'Spanish',             nativeName: 'Español',  dir: 'ltr' },
  { code: 'zh-CN', englishName: 'Chinese (Simplified)', nativeName: '简体中文',   dir: 'ltr' },
]);

const BASE_LANGUAGE = 'en';

const DEFAULTS = {
  // Ships with English only. A platform that has not configured languages
  // behaves exactly as it did before this feature existed.
  enabled: [BASE_LANGUAGE],
  default: BASE_LANGUAGE,
  // The first-login "would you like Urdu?" prompt. Off, and it stays off until
  // there is a country signal to drive it — see detectCountry() on the client.
  // Turning this on without one does nothing, which is why the admin UI says so.
  firstVisitPromptEnabled: false,
};

const byCode = new Map(SUPPORTED_LANGUAGES.map((l) => [l.code, l]));

/** The full descriptor for a code, or null if we do not ship that language. */
const describe = (code) => byCode.get(code) || null;

/** Whether a language reads right-to-left. Unknown codes are treated as LTR. */
const directionOf = (code) => describe(code)?.dir || 'ltr';

/**
 * Keep only codes we actually ship, drop duplicates, and always include
 * English.
 *
 * English is non-removable on purpose: it is the fallback every missing
 * translation key resolves to, so a deployment with English switched off would
 * have no language to fall back to and would render blanks.
 */
const sanitizeEnabled = (list) => {
  const seen = new Set([BASE_LANGUAGE]);
  (Array.isArray(list) ? list : []).forEach((code) => {
    if (byCode.has(code)) seen.add(code);
  });
  // Catalogue order, not the order the admin happened to click them in, so the
  // language menu is stable between saves.
  return SUPPORTED_LANGUAGES.map((l) => l.code).filter((code) => seen.has(code));
};

/**
 * The platform's language settings, defaults filled in.
 *
 * The `{ ...DEFAULTS, ...saved }` merge here is LOAD-BEARING, and not
 * redundant with the settings service. `adminSettingsService.getSettings()`
 * only applies `adminSettingsDefaults` when it first creates the singleton row
 * — on every read after that, `toSettingsDoc` does `doc[key] = row[key] ?? {}`
 * and merges nothing. (The settings service's own header comment claims
 * otherwise; it is stale. Do not delete this merge on the strength of it.)
 * `billingModeService.getBillingSettings()` carries the same merge for the same
 * reason.
 */
const getLanguageSettings = async () => {
  let saved = {};
  try {
    const settings = await adminSettingsService.getSettings();
    saved = settings.features?.languages || {};
  } catch (err) {
    console.error('Error reading language settings, falling back to defaults:', err.message);
  }

  const merged = { ...DEFAULTS, ...saved };
  const enabled = sanitizeEnabled(merged.enabled);

  return {
    enabled,
    // A default that is not enabled would leave every user resolving to a
    // language the platform refuses to serve, so it is corrected here rather
    // than trusted.
    default: enabled.includes(merged.default) ? merged.default : BASE_LANGUAGE,
    firstVisitPromptEnabled: !!merged.firstVisitPromptEnabled,
  };
};

/** The enabled languages as full descriptors, for an API payload. */
const enabledDescriptors = (settings) => settings.enabled.map((code) => byCode.get(code));

/**
 * Which language to render for this user.
 *
 * Falls back to the platform default whenever the stored code is unusable —
 * which covers the real case of an operator switching a language off while
 * customers still have it saved on their accounts. Those users quietly move to
 * the default rather than seeing blanks, and their saved preference is left
 * untouched so it comes back if the language is re-enabled.
 *
 * Accepts a whole user (not a code) because every caller has one: `auth`
 * middleware loads the full row on every request, and the cron jobs that send
 * mail already hold the recipient.
 */
const resolveLanguage = async (user, settings = null) => {
  const s = settings || (await getLanguageSettings());
  const wanted = user?.language;
  return wanted && s.enabled.includes(wanted) ? wanted : s.default;
};

/**
 * The BCP 47 tag to hand to `Intl` for a language code.
 *
 * `-u-nu-latn` on Arabic and Urdu forces Latin digits (1234, not ١٢٣٤). That is
 * a deliberate product decision, not an oversight:
 *
 *   - It is what the frontend does too, and the two must agree or an emailed
 *     amount will not match the one on screen.
 *   - `Intl.NumberFormat('ar-EG')` defaults to Arabic-Indic digits while plain
 *     `'ar'` in modern ICU gives Latin, so leaving it unspecified makes the
 *     output depend on the Node build.
 *   - Money, model names, GPU counts and IDs sit on the same line throughout
 *     this product and are Latin regardless; mixing numbering systems in one
 *     sentence reads as broken rather than localised.
 */
const INTL_LOCALES = {
  en: 'en-US',
  ur: 'ur-PK-u-nu-latn',
  ar: 'ar-u-nu-latn',
  hi: 'hi-IN',
  es: 'es-ES',
  'zh-CN': 'zh-CN',
};

const intlLocale = (code) => INTL_LOCALES[code] || INTL_LOCALES[BASE_LANGUAGE];

module.exports = {
  SUPPORTED_LANGUAGES,
  BASE_LANGUAGE,
  DEFAULTS,
  describe,
  directionOf,
  sanitizeEnabled,
  getLanguageSettings,
  enabledDescriptors,
  resolveLanguage,
  intlLocale,
};
