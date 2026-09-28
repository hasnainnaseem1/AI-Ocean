/**
 * Shared design tokens for the customer center.
 *
 * A light, airy cloud-console look: white surfaces on a soft lavender-blue
 * page, indigo as the primary accent, pastel icon tiles to give each metric
 * its own identity, and a pink→purple gradient reserved for the single most
 * important action on a screen. Pages pull colors and surface styles from
 * here rather than hardcoding hex values, so the identity can be retuned in
 * one place instead of a dozen.
 */

export const BRAND = '#4F6BED'; // indigo — primary accent, light mode
export const BRAND_DARK = '#7089F5'; // brighter indigo for dark surfaces

export const ACCENT = '#8B6BE0'; // purple — secondary highlight
export const ACCENT_DARK = '#B79CF0';

/** Blue gradient, tuned to sit in the same family as the solid indigo buttons rather than standing apart. Reserved for the primary CTA on a screen — never decorative. */
export const GRADIENT = 'linear-gradient(135deg, #6EA8FE 0%, #4F6BED 100%)';

export const SURFACE = {
  pageBgLight: '#F5F7FD',
  pageBgDark: '#0E1120',
  cardBgLight: '#FFFFFF',
  cardBgDark: '#171B2E',
  siderBgLight: '#FFFFFF',
  siderBgDark: '#12162A',
  borderLight: '#ECEFF8',
  borderDark: '#242942',
};

/** The primary accent color for the current mode. */
export const getBrand = (isDark) => (isDark ? BRAND_DARK : BRAND);

/** The secondary accent color for the current mode. */
export const getAccent = (isDark) => (isDark ? ACCENT_DARK : ACCENT);

/** The page background behind cards. */
export const pageBg = (isDark) => (isDark ? SURFACE.pageBgDark : SURFACE.pageBgLight);

/** Soft tinted background for the active nav pill and other brand-tinted chips. */
export const brandSoft = (isDark) => (isDark ? 'rgba(112,137,245,0.16)' : '#EEF2FF');

/**
 * Pastel icon tiles. Each metric gets its own hue so a row of stat cards
 * reads as four distinct things at a glance rather than four identical
 * boxes — the tile carries the identity, so the number itself can stay in
 * plain ink and remain the most legible element on the card.
 */
export const TILE = {
  blue:   { bg: (d) => (d ? 'rgba(79,107,237,0.18)' : '#E8EEFE'), fg: (d) => (d ? '#8FA5FF' : '#4F6BED') },
  pink:   { bg: (d) => (d ? 'rgba(244,143,196,0.16)' : '#FDE9F2'), fg: (d) => (d ? '#F7A8D0' : '#DB5FA0') },
  purple: { bg: (d) => (d ? 'rgba(155,125,232,0.18)' : '#F0EAFE'), fg: (d) => (d ? '#B79CF0' : '#8B6BE0') },
  cyan:   { bg: (d) => (d ? 'rgba(56,178,212,0.16)' : '#E3F4FA'), fg: (d) => (d ? '#6FCBE5' : '#2E9CBF') },
  green:  { bg: (d) => (d ? 'rgba(34,165,101,0.18)' : '#E3F7EC'), fg: (d) => (d ? '#4FCB8C' : '#22A565') },
  amber:  { bg: (d) => (d ? 'rgba(240,160,48,0.16)' : '#FDF3E3'), fg: (d) => (d ? '#F5BC66' : '#D98A1F') },
};

/**
 * Standard card surface: generous 16px radius and a soft, wide, low-opacity
 * shadow rather than a hard border — what makes the light theme read as
 * "airy" instead of "outlined boxes".
 */
export const cardStyle = (isDark, elevated = false) => ({
  border: `1px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
  borderRadius: 16,
  background: isDark ? SURFACE.cardBgDark : SURFACE.cardBgLight,
  boxShadow: isDark
    ? 'none'
    : elevated
      ? '0 2px 6px rgba(30,40,90,0.05), 0 12px 32px rgba(30,40,90,0.07)'
      : '0 1px 3px rgba(30,40,90,0.04), 0 4px 16px rgba(30,40,90,0.04)',
  transition: 'box-shadow 160ms ease, border-color 160ms ease, transform 160ms ease',
});

/**
 * A layered elevation scale — for surfaces that should read as genuinely
 * "lifted" (hovered catalog cards, popovers) rather than merely outlined.
 */
export const ELEVATION = {
  0: 'none',
  1: '0 1px 3px rgba(30,40,90,0.04), 0 4px 16px rgba(30,40,90,0.04)',
  2: '0 2px 6px rgba(30,40,90,0.05), 0 12px 32px rgba(30,40,90,0.07)',
  3: '0 4px 10px rgba(30,40,90,0.06), 0 20px 48px rgba(30,40,90,0.10)',
};

/** Elevation for the current mode — dark mode trades shadow for a brighter border. */
export const elevation = (isDark, level = 1) => (isDark ? 'none' : ELEVATION[level] || ELEVATION[1]);

/** Small uppercase label used above stat numbers and for sidebar section headings. */
export const microLabelStyle = (isDark) => ({
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: isDark ? '#6E7597' : '#9BA1BC',
});

/**
 * Tabular figures for numeric data — prices, rates, ledger amounts. Stays in
 * the UI sans (not a monospace face) so money reads as part of the interface
 * rather than as code; `tabular-nums` alone is enough to keep columns aligned.
 */
/**
 * Figures: tabular so columns line up, and pinned left-to-right.
 *
 * The direction half is not cosmetic. An element built from several JSX
 * expressions — `{currency} {formatAmount(x)}`, `{gb} GB` — renders as several
 * inline boxes, and under `direction: rtl` those boxes lay out right-to-left.
 * Bidi keeps a single text node in order, but separate boxes are separate runs,
 * so "USD 2,185.84" reached Urdu customers as "2,185.84 USD" and "24 GB" as
 * "GB 24". Nothing warns you: the DOM text is correct, only the paint is wrong.
 *
 * A number, a price, a card number and a hardware spec read left-to-right in
 * every locale, so `isolate` here is the accurate description of the content
 * rather than a workaround — and it is inert under LTR.
 */
export const monoNumeric = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
  direction: 'ltr',
  unicodeBidi: 'isolate',
};

/**
 * Technical text that is not a figure but is still inherently left-to-right:
 * hardware specs, endpoints, model ids, API keys. Same reasoning as above,
 * without forcing tabular digits on prose-shaped content.
 */
export const ltrTechnical = {
  direction: 'ltr',
  unicodeBidi: 'isolate',
};

/** True monospace — only for genuinely code-like content (API keys, curl snippets). */
export const codeFont = {
  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};

/** Semantic colors for status dots/badges — independent of the brand accent. */
export const STATUS_COLORS = {
  success: { light: '#22A565', dark: '#4FCB8C', bg: (isDark) => (isDark ? 'rgba(79,203,140,0.16)' : '#E3F7EC') },
  info:    { light: '#4F6BED', dark: '#8FA5FF', bg: (isDark) => (isDark ? 'rgba(143,165,255,0.16)' : '#EEF2FF') },
  warning: { light: '#D98A1F', dark: '#F5BC66', bg: (isDark) => (isDark ? 'rgba(245,188,102,0.16)' : '#FDF3E3') },
  error:   { light: '#E5484D', dark: '#F47174', bg: (isDark) => (isDark ? 'rgba(244,113,116,0.16)' : '#FDEBEC') },
  neutral: { light: '#8A90AB', dark: '#9BA1BC', bg: (isDark) => (isDark ? 'rgba(155,161,188,0.14)' : '#F1F3F9') },
};
