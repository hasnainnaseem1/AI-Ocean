import React, { useId, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { getBrand } from '../theme/colors';

/**
 * A small inline trend line — no charting library, just an SVG path. For a
 * stat card's tiny sparkline, mounting `@ant-design/charts` (which this app
 * keeps for the real charts on Analytics/Dashboard — see theme/chartTheme.js)
 * would be disproportionate to what it draws.
 *
 * Ported from the customer center. Deliberately does not fabricate data: pass
 * real values or omit the sparkline entirely. Renders nothing for fewer than 2
 * points.
 *
 * ── `fluid` ──
 *
 * A fixed 84px sparkline beside a stat value is fine on a wide screen and
 * wrong on a narrow one: the value is text and cannot shrink, so on a 1280px
 * display six KPI cards are ~130px wide and the sparkline simply sat on top of
 * the number. With `fluid` the drawing keeps its proportions but is allowed to
 * scale DOWN into whatever room the container leaves — `meet` rather than
 * `none`, so the end-point dot stays a circle and the line weight is not
 * stretched — pinned to the right edge, and vanishing entirely when there is
 * no room rather than colliding with the figure it decorates.
 */
const Sparkline = ({
  values = [], width = 120, height = 36, color, filled = true, fluid = false,
}) => {
  const { isDark } = useTheme();
  const gradientId = useId();
  const stroke = color || getBrand(isDark);

  const path = useMemo(() => {
    if (!values || values.length < 2) return null;

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = width / (values.length - 1);
    const pad = 3;

    const points = values.map((v, i) => {
      const x = i * stepX;
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return [x, y];
    });

    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;

    return { line, area, last: points[points.length - 1] };
  }, [values, width, height]);

  if (!path) return null;

  return (
    <svg
      width={fluid ? '100%' : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'xMaxYMid meet' : undefined}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {filled && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={isDark ? 0.28 : 0.18} />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {filled && <path d={path.area} fill={`url(#${gradientId})`} stroke="none" />}
      <path d={path.line} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={path.last[0]} cy={path.last[1]} r={2.75} fill={stroke} />
    </svg>
  );
};

export default Sparkline;
