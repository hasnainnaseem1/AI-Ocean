import { TILE, ink, muted, hairline } from './colors';

/**
 * Theming for `@ant-design/charts`, so the platform's real charts (Analytics,
 * Dashboard) pick up the same identity as everything hand-built around them
 * instead of the library's default green/blue.
 *
 * This app keeps `@ant-design/charts` rather than moving to hand-rolled SVG —
 * Analytics genuinely needs multi-series lines, pies and stacked columns, and
 * Sparkline (in components/Sparkline.js) already covers the "just show the
 * shape of a short series" case that doesn't need a charting library at all.
 * The two are a division of labour, not a duplication: Sparkline lives inside
 * stat cards, `@ant-design/charts` lives in dedicated chart cards.
 *
 * Wired into TrendChart/GrowthChart/DistributionChart during ADMIN-4-SWEEP,
 * where each of those files' own hardcoded palette gets retired alongside the
 * rest of that page's hex sweep.
 */

/** A colour sequence for multi-series charts, drawn from the pastel tile set. */
export const chartSeries = (isDark) => [
  TILE.blue.fg(isDark),
  TILE.purple.fg(isDark),
  TILE.green.fg(isDark),
  TILE.amber.fg(isDark),
  TILE.cyan.fg(isDark),
  TILE.pink.fg(isDark),
];

/**
 * Spread onto a chart's config: `<Line {...chartConfig(isDark)} {...config} />`.
 * Placed first so a chart's own `config` can still override any of it.
 */
export const chartConfig = (isDark) => ({
  theme: isDark ? 'classicDark' : 'classic',
  scale: { color: { range: chartSeries(isDark) } },
  axis: {
    x: { labelFill: muted(isDark), labelFontSize: 11, line: true, lineStroke: hairline(isDark) },
    y: { labelFill: muted(isDark), labelFontSize: 11, grid: true, gridStroke: hairline(isDark) },
  },
  legend: {
    color: { itemLabelFill: ink(isDark), itemLabelFontSize: 12 },
  },
});
