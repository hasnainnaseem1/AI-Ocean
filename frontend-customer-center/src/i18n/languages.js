/**
 * Every language the customer center can render, and what each one needs.
 *
 * This is the *catalogue* — what the product is capable of. Which of these are
 * actually offered is an admin setting, delivered by `GET /api/v1/public/site`
 * and read through `SiteContext`. The server owns `code`, `englishName`,
 * `nativeName` and `dir` (it is what the admin configures against); this file
 * adds the things only a browser cares about — the antd locale chunk, the
 * `Intl` tag, and the font.
 *
 * ── Adding a language ──
 * 1. Drop `public/locales/<code>/*.json` in.
 * 2. Add one entry here.
 * 3. Add the same code to `SUPPORTED_LANGUAGES` in the backend's
 *    `services/i18n/languageSettingsService.js`.
 * 4. Switch it on in Admin Center → Settings → Languages.
 *
 * Step 2 is the one piece of code a new language touches, and it exists only
 * because webpack must see a literal path inside `import()` to build a chunk —
 * a computed path would silently resolve to nothing. Everything else about a
 * new language is data.
 */

/** A face that is already loaded for the app's Latin text. */
const BASE_STACK = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/**
 * Put the app's Latin face in front of a script font, not behind it.
 *
 * The browser picks a font per character, walking the stack until one has that
 * glyph — so with Latin first, Urdu and Arabic letters fall through to the
 * script face while `A100 80GB`, model names, API keys and deployment ids keep
 * the app's own type.
 *
 * Script-first looks wrong for exactly that reason: Noto Nastaliq Urdu ships
 * its own Latin glyphs, so it would win for every ASCII character and render
 * half the screen — every price, every identifier — in a serif that belongs to
 * a different design. Observed on the sign-in page before this was fixed.
 */
const withLatinFirst = (scriptFace, fallback) =>
  `'Plus Jakarta Sans', ${scriptFace}, ${fallback}`;

export const LANGUAGES = [
  {
    code: 'en',
    englishName: 'English',
    nativeName: 'English',
    dir: 'ltr',
    antdLocale: () => import('antd/locale/en_US'),
    intlLocale: 'en-US',
    fontFamily: BASE_STACK,
    fontHref: null,
    lineHeightScale: 1,
  },
  {
    code: 'ur',
    englishName: 'Urdu',
    nativeName: 'اردو',
    dir: 'rtl',
    antdLocale: () => import('antd/locale/ur_PK'),
    // Latin digits, deliberately — see the note at the bottom of this file.
    intlLocale: 'ur-PK-u-nu-latn',
    /*

     * Nastaliq is the script Urdu is genuinely read in, and using Naskh for it
     * reads the way a serif-only English UI would: legible, but wrong. The cost
     * is vertical: Nastaliq's baseline slopes and its descenders run deep, so
     * it needs roughly twice the leading of Latin text. `lineHeightScale` is
     * what pays that, and without it every table row clips.
     *
     * If it proves unworkable in dense tables, swapping this one entry to the
     * Arabic stack below is the entire fallback.
     */
    fontFamily: withLatinFirst("'Noto Nastaliq Urdu'", "'Noto Sans Arabic', 'Segoe UI', serif"),
    fontHref: 'https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600;700&display=swap',
    lineHeightScale: 1.9,
  },
  {
    code: 'ar',
    englishName: 'Arabic',
    nativeName: 'العربية',
    dir: 'rtl',
    antdLocale: () => import('antd/locale/ar_EG'),
    intlLocale: 'ar-u-nu-latn',
    /*
     * Noto Sans Arabic rather than Noto Naskh Arabic: Naskh is a text face
     * built for running prose, and this product is mostly dense tables and
     * 11.5-13px labels, where the sans cut stays legible and the naskh cut does
     * not.
     */
    fontFamily: withLatinFirst("'Noto Sans Arabic'", "'Segoe UI', Tahoma, sans-serif"),
    fontHref: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap',
    lineHeightScale: 1.15,
  },
  {
    code: 'hi',
    englishName: 'Hindi',
    nativeName: 'हिन्दी',
    dir: 'ltr',
    antdLocale: () => import('antd/locale/hi_IN'),
    intlLocale: 'hi-IN',
    fontFamily: withLatinFirst("'Noto Sans Devanagari'", "'Nirmala UI', sans-serif"),
    fontHref: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap',
    lineHeightScale: 1.25,
  },
  {
    code: 'es',
    englishName: 'Spanish',
    nativeName: 'Español',
    dir: 'ltr',
    antdLocale: () => import('antd/locale/es_ES'),
    intlLocale: 'es-ES',
    // Plus Jakarta Sans already covers every Spanish diacritic.
    fontFamily: BASE_STACK,
    fontHref: null,
    lineHeightScale: 1,
  },
  {
    code: 'zh-CN',
    englishName: 'Chinese (Simplified)',
    nativeName: '简体中文',
    dir: 'ltr',
    antdLocale: () => import('antd/locale/zh_CN'),
    intlLocale: 'zh-CN',
    /*
     * System fonts, and no webfont at all. A CJK webfont is several megabytes
     * even subsetted, which would make Chinese by far the slowest language on
     * the platform — and every device that reads Chinese already ships a good
     * face for it. This is the one language where loading a font is a
     * regression rather than an improvement.
     */
    fontFamily: withLatinFirst(
      "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC'",
      'sans-serif'
    ),
    fontHref: null,
    lineHeightScale: 1.1,
  },
];

export const DEFAULT_LANGUAGE = 'en';

const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));

/** The catalogue entry for a code, falling back to English. */
export const languageOf = (code) => byCode.get(code) || byCode.get(DEFAULT_LANGUAGE);

/** Just the codes, for i18next's `supportedLngs`. */
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

/**
 * The tag to hand `Intl`.
 *
 * Note `-u-nu-latn` on Arabic and Urdu: those locales render Latin digits
 * (1234), not Arabic-Indic ones (١٢٣٤). That is a decision, not an oversight.
 *
 *  - `theme/colors.js`'s `monoNumeric` (`tabular-nums`) is used at over a
 *    hundred places specifically to keep money columns aligned, and the
 *    Nastaliq and Arabic faces do not ship tabular Arabic-Indic figures — so
 *    Eastern digits would quietly destroy the alignment that util exists to
 *    guarantee.
 *  - `Intl.NumberFormat('ar-EG')` defaults to Arabic-Indic while plain `'ar'`
 *    in current ICU gives Latin, so leaving it unstated makes the output depend
 *    on the browser build.
 *  - API keys, model names, GPU counts and deployment ids sit on the same rows
 *    and are Latin regardless; two numbering systems in one line reads as
 *    broken rather than localised.
 *
 * The backend's `languageSettingsService.intlLocale()` carries the identical
 * mapping, because an amount in an email has to match the one on screen.
 */
export const intlLocaleOf = (code) => languageOf(code).intlLocale;

export const directionOf = (code) => languageOf(code).dir;
