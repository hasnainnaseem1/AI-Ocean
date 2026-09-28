/**
 * Design tokens for the admin center.
 *
 * ── Relationship to the customer center ────────────────────────────────────
 * This file WAS a byte-identical mirror of `frontend-customer-center/src/
 * theme/colors.js`, so the two apps read as one product. That is no longer
 * true, and the divergence is deliberate: an operator running the platform
 * and a customer using it are doing different jobs, and an admin console that
 * looks exactly like the customer product gives the operator no signal about
 * which app they are in.
 *
 * What still matches, and must keep matching:
 *   BRAND / BRAND_DARK / ACCENT / GRADIENT / TILE — the brand hues. Same
 *   product, same accent. `npm run verify:tokens` still guards these.
 *
 * What is now admin's own:
 *   SURFACE, the neutral ink/muted/subtle/hairline ramp, ELEVATION, and
 *   ADMIN_DENSITY. The customer center sits on a soft lavender-blue ground
 *   (`#F5F7FD` light, `#0E1120` dark); this console sits on a NEUTRAL ground —
 *   plain grey in light mode, near-black in dark mode. Neutral surfaces also
 *   serve the work better: these pages are dense tables of other people's
 *   money and machines, and a tinted ground puts a colour cast on every status
 *   pill and chart series read against it.
 *
 * The brand indigo survives as the accent precisely BECAUSE the ground went
 * neutral — it now reads as the one deliberate colour on the screen rather
 * than as a slightly stronger version of the background.
 */

export const BRAND = '#4F6BED'; // indigo — primary accent, light mode
export const BRAND_DARK = '#7089F5'; // brighter indigo for dark surfaces

export const ACCENT = '#8B6BE0'; // purple — secondary highlight
export const ACCENT_DARK = '#B79CF0';

/** Blue gradient, tuned to sit in the same family as the solid indigo buttons rather than standing apart. Reserved for the primary CTA on a screen — never decorative. */
export const GRADIENT = 'linear-gradient(135deg, #6EA8FE 0%, #4F6BED 100%)';

/**
 * Pastel icon tiles. Each metric gets its own hue so a row of stat cards
 * reads as four distinct things at a glance rather than four identical
 * boxes — the tile carries the identity, so the number itself can stay in
 * plain ink and remain the most legible element on the card.
 *
 * Shared with the customer center — these are brand hues, not surfaces.
 */
export const TILE = {
  blue:   { bg: (d) => (d ? 'rgba(79,107,237,0.18)' : '#E8EEFE'), fg: (d) => (d ? '#8FA5FF' : '#4F6BED') },
  pink:   { bg: (d) => (d ? 'rgba(244,143,196,0.16)' : '#FDE9F2'), fg: (d) => (d ? '#F7A8D0' : '#DB5FA0') },
  purple: { bg: (d) => (d ? 'rgba(155,125,232,0.18)' : '#F0EAFE'), fg: (d) => (d ? '#B79CF0' : '#8B6BE0') },
  cyan:   { bg: (d) => (d ? 'rgba(56,178,212,0.16)' : '#E3F4FA'), fg: (d) => (d ? '#6FCBE5' : '#2E9CBF') },
  green:  { bg: (d) => (d ? 'rgba(34,165,101,0.18)' : '#E3F7EC'), fg: (d) => (d ? '#4FCB8C' : '#22A565') },
  amber:  { bg: (d) => (d ? 'rgba(240,160,48,0.16)' : '#FDF3E3'), fg: (d) => (d ? '#F5BC66' : '#D98A1F') },
};

/* ────────────────────────────────────────────────────────────────────────────
 * ADMIN-ONLY — everything below this line is this console's own, and is NOT
 * mirrored from the customer center. `verify:tokens` stops comparing here.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Neutral surfaces.
 *
 * Light mode is a grey ground with white cards floating on it — the contrast
 * between the two is what makes a dense page legible, so the ground must not
 * be white itself. Dark mode is a true black ramp (no blue channel lift), so
 * the console reads as a tool rather than as a tinted "night mode" of the
 * customer product.
 *
 * Each step is roughly one perceptual notch from the last: ground → card →
 * elevated (popovers, dropdowns, flyouts) → border.
 */
export const SURFACE = {
  pageBgLight: '#F4F4F5',
  pageBgDark: '#0A0A0A',
  cardBgLight: '#FFFFFF',
  cardBgDark: '#151515',
  siderBgLight: '#FFFFFF',
  siderBgDark: '#0F0F0F',
  elevatedLight: '#FFFFFF',
  elevatedDark: '#1E1E1E',
  borderLight: '#E4E4E7',
  borderDark: '#272727',
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
 * Elevation.
 *
 * Neutral black shadows rather than the customer center's blue-tinted ones —
 * a blue shadow on a neutral grey ground reads as a colour cast. Kept shallow:
 * on a grey ground a card separates by its own white fill, so the shadow only
 * has to do the last 20% of the work.
 */
export const ELEVATION = {
  0: 'none',
  1: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
  2: '0 2px 4px rgba(0,0,0,0.05), 0 8px 20px rgba(0,0,0,0.06)',
  3: '0 4px 8px rgba(0,0,0,0.06), 0 16px 36px rgba(0,0,0,0.10)',
};

/** Elevation for the current mode — dark mode trades shadow for a brighter border. */
export const elevation = (isDark, level = 1) => (isDark ? 'none' : ELEVATION[level] || ELEVATION[1]);

/**
 * Text and hairline colours, as functions of the mode.
 *
 * A neutral grey ramp — the same values antd resolves for `colorText` /
 * `colorTextSecondary` / `colorBorder`. Inside an antd component let it supply
 * them (`<Text type="secondary">` beats restating a hex); these exist for the
 * hand-built markup antd does not reach, like the sidebar dock and custom card
 * headers, which would otherwise inline a literal and break in dark mode.
 */
export const ink = (isDark) => (isDark ? '#EDEDED' : '#18181B');
export const muted = (isDark) => (isDark ? '#A1A1AA' : '#71717A');
export const subtle = (isDark) => (isDark ? '#71717A' : '#A1A1AA');
export const hairline = (isDark) => (isDark ? SURFACE.borderDark : SURFACE.borderLight);

/** Semantic colors for status dots/badges — independent of the brand accent. */
/**
 * A solid fill for a small chip that carries WHITE text — a count badge, a
 * rank badge, an avatar.
 *
 * These were being filled with the palette's *foreground* colours, which are
 * tuned to sit on a surface, not behind white text: white on the amber
 * `#F5BC66` is 1.71:1, well under the 3:1 floor. The darker end of each pair
 * clears it (amber 3.24:1, red 4.38:1, grey 4.83:1, indigo 4.51:1, green
 * 3.79:1), and because the text is always white the fill shouldn't flip with
 * the theme the way a foreground colour does.
 */
export const solidBg = {
  warning: '#C97E14',
  error: '#DC3D42',
  neutral: '#71717A',
  info: '#4F6BED',
  success: '#1A9655',
  purple: '#8B6BE0',
  blue: '#4F6BED',
  pink: '#DB5FA0',
  cyan: '#2E9CBF',
  green: '#22A565',
  amber: '#D98A1F',
};

export const STATUS_COLORS = {
  success: { light: '#1A9655', dark: '#4FCB8C', bg: (isDark) => (isDark ? 'rgba(79,203,140,0.15)' : '#E6F6EE') },
  info:    { light: '#4F6BED', dark: '#8FA5FF', bg: (isDark) => (isDark ? 'rgba(143,165,255,0.15)' : '#EDF1FE') },
  warning: { light: '#C97E14', dark: '#F5BC66', bg: (isDark) => (isDark ? 'rgba(245,188,102,0.15)' : '#FDF4E6') },
  error:   { light: '#DC3D42', dark: '#F47174', bg: (isDark) => (isDark ? 'rgba(244,113,116,0.15)' : '#FDECEC') },
  neutral: { light: '#71717A', dark: '#A1A1AA', bg: (isDark) => (isDark ? 'rgba(161,161,170,0.13)' : '#F4F4F5') },
};

/**
 * The admin center's density.
 *
 * The customer center shows a handful of the viewer's own deployments; this
 * console renders 8–15 column tables over every customer on the platform. At
 * the customer center's spacing those tables overflow their container and show
 * four rows per screen — so the geometry is scaled down across the board, and
 * antd's own `fontSize` / `controlHeight` / Table cell padding are pulled down
 * with it in index.js. Density is one decision in one place; a page author
 * never has to guess which rhythm they are writing against.
 */
export const ADMIN_DENSITY = {
  siderWidth: 220,
  siderCollapsedWidth: 64,
  headerHeight: 52,
  cardRadius: 10,
  contentMargin: '14px 18px',
  rowPaddingY: 8,
  rowPaddingX: 12,
  iconTile: 32,
  statValueSize: 22,
  pageTitleSize: 20,
  /**
   * Forms read as a column, not a stretched band — see FormSection. This is
   * the outer card's cap, not a field's: individual number/date/single-
   * select inputs stay control-sized regardless, via the `.form-section`
   * rules in index.css, so widening this doesn't reopen the original
   * full-width "Free Trial Days" bug. It's set to close most of the gap to
   * Settings' one non-form tab (Email Templates' two-column editor, which
   * fills the whole content pane) — a narrow card floating in a couple
   * hundred spare pixels next to a full-width one, tab to tab, was the
   * actual complaint, not the column width in isolation.
   */
  formMaxWidth: 760,
};

/**
 * Standard card surface. A hairline border plus a shallow neutral shadow —
 * on the grey ground the white fill already does most of the separating.
 */
export const cardStyle = (isDark, elevated = false) => ({
  border: `1px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
  borderRadius: ADMIN_DENSITY.cardRadius,
  background: isDark ? SURFACE.cardBgDark : SURFACE.cardBgLight,
  boxShadow: isDark ? 'none' : elevated ? ELEVATION[2] : ELEVATION[1],
  transition: 'box-shadow 160ms ease, border-color 160ms ease, transform 160ms ease',
});

/**
 * Card surface at the admin center's radius.
 *
 * Retained as a distinct name because ~30 files call it; it is now the same as
 * `cardStyle`, which itself carries the admin radius.
 */
export const adminCardStyle = cardStyle;

/**
 * Small uppercase label used above stat numbers and for sidebar section
 * headings. Tighter and quieter than the customer center's — at this density
 * it is a wayfinding tick, not a heading.
 */
export const microLabelStyle = (isDark) => ({
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: isDark ? '#71717A' : '#A1A1AA',
});

/**
 * Tabular figures for numeric data — prices, rates, ledger amounts. Stays in
 * the UI sans (not a monospace face) so money reads as part of the interface
 * rather than as code; `tabular-nums` alone is enough to keep columns aligned.
 */
export const monoNumeric = {
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
};

/** True monospace — only for genuinely code-like content (API keys, curl snippets). */
export const codeFont = {
  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
};
