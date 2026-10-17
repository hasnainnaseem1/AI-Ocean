import React, { useMemo } from 'react';
import { Typography, Tooltip } from 'antd';
import { useTheme } from '../../contexts/ThemeContext';
import { chartSeries } from '../../theme/chartTheme';
import { muted, hairline, monoNumeric } from '../../theme/colors';

const { Text } = Typography;

/**
 * How a total splits across categories — by tier, by model, by gateway.
 *
 * `theme/chartTheme.js` has named this component in its header comment since
 * the admin redesign; it was never written, so every breakdown on the
 * Analytics page was either a table or a hand-rolled row of divs.
 *
 * Deliberately a ranked bar list rather than a pie. The questions asked of a
 * breakdown here are "which is biggest" and "how much bigger" — both of which
 * a reader answers from a pie by comparing angles, badly, and from a ranked
 * bar instantly. A pie also collapses once there are more than five slices,
 * which "by model" already exceeds.
 *
 * Long tails are folded into a single "Other" row rather than cut off, so the
 * shares always add to 100 and nothing silently disappears.
 */
const DistributionChart = ({
  rows = [],
  labelField = 'label',
  valueField = 'amount',
  valueFormat = (v) => v,
  limit = 8,
  emptyText = 'Nothing to break down in this period',
}) => {
  const { isDark } = useTheme();

  const { bars, total } = useMemo(() => {
    const cleaned = (rows || [])
      .map((r) => ({ label: r[labelField], value: Number(r[valueField]) || 0, raw: r }))
      .sort((a, b) => b.value - a.value);
    const sum = cleaned.reduce((s, r) => s + r.value, 0);

    if (cleaned.length <= limit) return { bars: cleaned, total: sum };

    const head = cleaned.slice(0, limit - 1);
    const tail = cleaned.slice(limit - 1);
    return {
      bars: [...head, {
        label: `Other (${tail.length})`,
        value: tail.reduce((s, r) => s + r.value, 0),
        isOther: true,
      }],
      total: sum,
    };
  }, [rows, labelField, valueField, limit]);

  if (!bars.length || total === 0) {
    return <Text type="secondary" style={{ fontSize: 12.5 }}>{emptyText}</Text>;
  }

  const palette = chartSeries(isDark);
  const biggest = bars[0].value || 1;

  return (
    <div>
      {bars.map((bar, i) => {
        const sharePercent = Math.round((bar.value / total) * 1000) / 10;
        return (
          <div key={bar.label} style={{ marginBottom: i === bars.length - 1 ? 0 : 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: bar.isOther ? 400 : 500 }} ellipsis>
                {bar.label}
              </Text>
              <Tooltip title={`${sharePercent}% of the total`}>
                <span style={{ ...monoNumeric, fontSize: 12, whiteSpace: 'nowrap' }}>
                  {valueFormat(bar.value)}
                  <Text style={{ fontSize: 10.5, color: muted(isDark), marginInlineStart: 6 }}>
                    {sharePercent}%
                  </Text>
                </span>
              </Tooltip>
            </div>
            <div style={{ height: 6, background: hairline(isDark), borderRadius: 999, marginTop: 3, overflow: 'hidden' }}>
              <div
                style={{
                  // Scaled against the biggest row, not against the total —
                  // otherwise a long tail renders as a row of invisible slivers.
                  width: `${Math.max(2, (bar.value / biggest) * 100)}%`,
                  height: '100%',
                  background: bar.isOther ? muted(isDark) : palette[i % palette.length],
                  borderRadius: 999,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default DistributionChart;
