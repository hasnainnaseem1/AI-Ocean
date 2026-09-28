import React from 'react';
import { Row, Col } from 'antd';
import { useTheme } from '../context/ThemeContext';
import { cardStyle, TILE, monoNumeric, STATUS_COLORS } from '../theme/colors';

/**
 * A row of equal-height stat cards with one shared responsive contract,
 * instead of every page inventing its own Col breakpoints and forgetting to
 * equalize height across siblings with different content. `align="stretch"`
 * makes each Col match the tallest sibling; StatCard fills that height so a
 * card with fewer content lines doesn't come up short.
 */
export const StatRow = ({ children, style }) => (
  <Row gutter={[18, 18]} align="stretch" style={{ marginBottom: 22, ...style }}>
    {children}
  </Row>
);

/** Pastel rounded icon tile — gives each metric its own identity at a glance. */
export const IconTile = ({ icon, tone = 'blue', size = 42 }) => {
  const { isDark } = useTheme();
  const t = TILE[tone] || TILE.blue;
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.3, flexShrink: 0,
      background: t.bg(isDark), color: t.fg(isDark),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.44,
    }}>
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
    <span style={{
      fontSize: 11.5, fontWeight: 700, lineHeight: 1,
      padding: '4px 7px', borderRadius: 6, whiteSpace: 'nowrap',
      background: c.bg(isDark), color: isDark ? c.dark : c.light,
      ...monoNumeric,
    }}>
      {positive ? '↑' : '↓'} {Math.abs(delta)}
    </span>
  );
};

/**
 * `count` sizes the breakpoint automatically (24/count at the lg breakpoint,
 * halved at sm, full width at xs) — pass it consistently for every card in
 * the same StatRow.
 *
 * Two shapes are supported: pass `children` for a fully custom body, or pass
 * `icon`/`label`/`value`/`caption` for the standard tile-and-number layout.
 */
export const StatCard = ({
  children, count = 4, xs = 24, sm = 12, lg, onClick, className, style, bodyStyle,
  icon, tone = 'blue', label, value, suffix, delta, caption, chart,
}) => {
  const { isDark } = useTheme();
  const card = cardStyle(isDark);
  const span = lg ?? Math.round(24 / count);

  const structured = !children && (label !== undefined || value !== undefined);

  return (
    <Col xs={xs} sm={sm} lg={span}>
      <div
        className={className}
        onClick={onClick}
        style={{
          ...card,
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '20px 22px',
          cursor: onClick ? 'pointer' : 'default',
          ...style,
          ...bodyStyle,
        }}
      >
        {structured ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              {icon && <IconTile icon={icon} tone={tone} />}
              {/*
                * `pre-line` is what lets a two-line label be ONE translatable
                * phrase. These labels used to be written as
                * `<>{t('…')}<br />balance</>` — a translated first line welded
                * to a hardcoded English second line, which rendered as
                * "موجودہ BALANCE" on an otherwise Urdu screen. A phrase cannot
                * be split like that and survive translation, because the word
                * order is not the same in every language.
                *
                * So the whole label is one key, and a translator puts the line
                * break where their language wants it — or leaves it out.
                */}
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.07em',
                textTransform: 'uppercase', lineHeight: 1.35,
                whiteSpace: 'pre-line',
                color: isDark ? '#9BA1BC' : '#8A90AB',
              }}>
                {label}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
              {/*
                * The figure and its unit are one measurement, so they stay
                * left-to-right. These are flex children, and under
                * `direction: rtl` flex lays its children out right-to-left —
                * which put the unit before the number and rendered "0 days"
                * as "days 0" on every Urdu and Arabic stat card.
                */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, direction: 'ltr' }}>
                <span style={{
                  fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.1,
                  color: isDark ? '#E8EAF4' : '#1B1F35',
                  ...monoNumeric,
                }}>
                  {value}
                </span>
                {suffix && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: isDark ? '#9BA1BC' : '#8A90AB' }}>
                    {suffix}
                  </span>
                )}
                <DeltaChip delta={delta} />
              </div>
              {chart}
            </div>

            {caption && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: isDark ? '#9BA1BC' : '#8A90AB' }}>
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
