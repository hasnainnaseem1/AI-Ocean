import React from 'react';
import { Typography, Tooltip } from 'antd';
import { useTheme } from '../../contexts/ThemeContext';
import {
  muted, hairline, monoNumeric, getBrand,
} from '../../theme/colors';

const { Text } = Typography;

/**
 * A cohort grid: one row per signup month, one column per month since.
 *
 * ── The cell that is not there ──
 *
 * The important design decision is what an EMPTY cell means. A cohort that
 * signed up two months ago has no fourth month yet — that is not 0% retention,
 * it is not a measurement. Drawing it as a pale cell makes a young cohort look
 * like a collapsing one, which is the classic way a retention chart lies. A
 * `null` cell is therefore rendered as nothing at all: no fill, no number, no
 * border — the grid simply stops.
 *
 * ── Why intensity, not a rainbow ──
 *
 * One hue at varying opacity, not green-to-red. A diverging palette implies a
 * neutral midpoint, and there is no "neutral" retention percentage — 40% is
 * excellent for one business and fatal for another. Intensity says "more" and
 * "less" and leaves the judgement to the reader, who has the context.
 *
 * Month 0 is included rather than assumed to be 100%: an account that signed
 * up and never did anything is genuinely not retained in its own first month,
 * and hiding that column would hide the single most useful number here.
 */
const CohortHeatmap = ({
  matrix = [],
  periods = 12,
  emptyText = 'No cohorts to show yet',
}) => {
  const { isDark } = useTheme();
  if (!matrix.length) {
    return <Text type="secondary" style={{ fontSize: 12.5 }}>{emptyText}</Text>;
  }

  const brand = getBrand(isDark);
  const grey = muted(isDark);
  const line = hairline(isDark);

  // Opacity floor of 0.08 so a low-but-real percentage is still visibly a
  // cell, distinct from the nothing an unmeasured month renders as.
  const fillFor = (percent) => {
    const t = Math.max(0, Math.min(100, Number(percent) || 0)) / 100;
    return `${brand}${Math.round((0.08 + t * 0.82) * 255).toString(16).padStart(2, '0')}`;
  };

  const cellStyle = {
    width: 46,
    minWidth: 46,
    height: 30,
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    ...monoNumeric,
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 120 + periods * 50 }}>
        {/* Column headers: months since signup */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 5 }}>
          <div style={{ width: 112, minWidth: 112 }} />
          {Array.from({ length: periods }, (_, i) => (
            <div key={i} style={{ ...cellStyle, height: 18, color: grey, fontSize: 10 }}>
              M{i}
            </div>
          ))}
        </div>

        {matrix.map((row) => (
          <div key={row.cohort} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
            <div style={{ width: 112, minWidth: 112 }}>
              <Text style={{ fontSize: 12 }}>{row.cohort}</Text>
              <Text style={{ fontSize: 10.5, color: grey, marginInlineStart: 6 }}>
                {row.size}
              </Text>
            </div>

            {Array.from({ length: periods }, (_, i) => {
              const cell = row.cells?.[i];
              // Not yet measurable — render nothing, not a pale zero.
              if (!cell) {
                return <div key={i} style={{ ...cellStyle, background: 'transparent' }} />;
              }
              return (
                <Tooltip
                  key={i}
                  title={`${row.cohort} · month ${i}: ${cell.accounts} of ${row.size} accounts active (${cell.percent}%)`}
                >
                  <div
                    style={{
                      ...cellStyle,
                      background: fillFor(cell.percent),
                      border: `1px solid ${line}`,
                      color: cell.percent > 55 ? '#fff' : undefined,
                    }}
                  >
                    {cell.percent}%
                  </div>
                </Tooltip>
              );
            })}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, marginTop: 9, alignItems: 'center' }}>
          <Text style={{ fontSize: 10.5, color: grey }}>Lower</Text>
          {[10, 30, 50, 70, 90].map((p) => (
            <div key={p} style={{
              width: 22, height: 10, borderRadius: 2, background: fillFor(p), border: `1px solid ${line}`,
            }}
            />
          ))}
          <Text style={{ fontSize: 10.5, color: grey }}>Higher share still active</Text>
          <Text style={{ fontSize: 10.5, color: grey, marginInlineStart: 8 }}>
            · blank = that month has not happened yet
          </Text>
        </div>
      </div>
    </div>
  );
};

export default CohortHeatmap;
