import React from 'react';
import { Row, Col } from 'antd';
import { useTheme } from '../contexts/ThemeContext';
import {
  adminCardStyle, TILE, monoNumeric, STATUS_COLORS, ADMIN_DENSITY, ink, muted,
} from '../theme/colors';

/**
 * A row of equal-height stat cards.
 *
 * Ported from the customer center's StatRow with the admin center's tighter
 * geometry: 36px icon tiles instead of 42, 26px values instead of 30, and less
 * internal padding — see ADMIN_DENSITY in theme/colors.js. Same API, so a page
 * migrating onto this needs no prop changes, only a smaller visual footprint.
 */
export const StatRow = ({ children, style }) => (
  <Row gutter={[12, 12]} align="stretch" style={{ marginBottom: 14, ...style }}>
    {children}
  </Row>
);

/** Pastel rounded icon tile — gives each metric its own identity at a glance. */
export const IconTile = ({ icon, tone = 'blue', size = ADMIN_DENSITY.iconTile }) => {
  const { isDark } = useTheme();
  const t = TILE[tone] || TILE.blue;
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.3, flexShrink: 0,
        background: t.bg(isDark), color: t.fg(isDark),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.44,
      }}
    >
      {icon}
    </div>
  );
};

/** Small green/red delta chip shown beside a stat value. */
const DeltaChip = ({ delta }) => {
  const { isDark } = useTheme();
  if (delta === null || delta === undefined) return null;
  const positive = delta >= 0;
  const c = positive ? STATUS_COLORS.success : STATUS_COLORS.error;
  return (
    <span
      style={{
        fontSize: 11, fontWeight: 700, lineHeight: 1,
        padding: '3px 6px', borderRadius: 6, whiteSpace: 'nowrap',
        background: c.bg(isDark), color: isDark ? c.dark : c.light,
        ...monoNumeric,
      }}
    >
      {positive ? '↑' : '↓'} {Math.abs(delta)}
    </span>
  );
};

/**
 * `count` sizes the breakpoint automatically (24/count at the lg breakpoint,
 * halved at sm, full width at xs) — pass it consistently for every card in
 * the same StatRow.
 *
 * Two shapes: pass `children` for a fully custom body, or pass
 * `icon`/`label`/`value`/`caption` for the standard tile-and-number layout.
 */
export const StatCard = ({
  children, count = 4, xs = 24, sm = 12, lg, onClick, className, style, bodyStyle,
  icon, tone = 'blue', label, value, suffix, delta, caption, chart,
}) => {
  const { isDark } = useTheme();
  const card = adminCardStyle(isDark);
  const span = lg ?? Math.round(24 / count);

  const structured = !children && (label !== undefined || value !== undefined);

  return (
    <Col xs={xs} sm={sm} lg={span}>
      <div
        className={['stat-card', className].filter(Boolean).join(' ')}
        onClick={onClick}
        style={{
          ...card,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          /*
           * Top-aligned, not centred.
           *
           * These cards stretch to the tallest in their row, so centring meant
           * a card whose caption wrapped to two lines started HIGHER than its
           * neighbours — in a row of four, the labels and the numbers sat at
           * two different heights and the row stopped reading as one band. A
           * KPI row is scanned across, so the things being compared have to
           * line up; the slack belongs at the bottom, where nothing is.
           */
          justifyContent: 'flex-start',
          padding: '12px 14px',
          cursor: onClick ? 'pointer' : 'default',
          ...style,
          ...bodyStyle,
        }}
      >
        {structured ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
              {icon && <IconTile icon={icon} tone={tone} />}
              <span
                style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
                  textTransform: 'uppercase', lineHeight: 1.35,
                  color: muted(isDark),
                }}
              >
                {label}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
              {/*
                The figure never shrinks — it is text, and a number that is
                squeezed is a number that is overlapped. It is the sparkline
                that gives way, below.
              */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto', whiteSpace: 'nowrap',
              }}
              >
                <span
                  style={{
                    fontSize: ADMIN_DENSITY.statValueSize, fontWeight: 800,
                    letterSpacing: '-0.03em', lineHeight: 1.1,
                    color: ink(isDark),
                    ...monoNumeric,
                  }}
                >
                  {value}
                </span>
                {suffix && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: muted(isDark) }}>
                    {suffix}
                  </span>
                )}
                <DeltaChip delta={delta} />
              </div>
              {/*
                Takes whatever room the figure leaves, up to 96px, and no more.
                `minWidth: 0` is what lets it reach zero instead of holding its
                intrinsic width and pushing into the number.
              */}
              {chart && (
                <div
                  className="stat-card-chart"
                  style={{
                    flex: '0 1 96px', minWidth: 0, display: 'flex', justifyContent: 'flex-end',
                  }}
                >
                  {chart}
                </div>
              )}
            </div>

            {caption && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: muted(isDark) }}>
                {caption}
              </div>
            )}
          </>
        ) : children}
      </div>
    </Col>
  );
};

export default StatRow;
