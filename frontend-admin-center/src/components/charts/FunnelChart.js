import React from 'react';
import { Typography, Tooltip } from 'antd';
import { useTheme } from '../../contexts/ThemeContext';
import {
  TILE, muted, hairline, monoNumeric, STATUS_COLORS,
} from '../../theme/colors';

const { Text } = Typography;

/**
 * An ordered funnel: how many entered each stage, and where people fell out.
 *
 * Hand-drawn rather than a charting geom on purpose. The thing worth reading
 * in a funnel is the DROP between two stages, and a bar chart makes a reader
 * compare two heights and do the subtraction themselves. Here each stage
 * states its conversion from the one before it, and the drop is called out in
 * words — "3 did not get approved" — because that is the sentence an operator
 * is actually trying to arrive at.
 *
 * `medianMinutesFromPrev` is shown where it exists, since "90% convert" and
 * "90% convert, eventually, after two days" are different situations.
 */
const formatDuration = (mins) => {
  if (mins === null || mins === undefined) return null;
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
};

const FunnelChart = ({ stages = [], dropLabel = 'dropped out' }) => {
  const { isDark } = useTheme();
  if (!stages.length) return null;

  const top = stages[0]?.count || 0;
  const tones = ['blue', 'cyan', 'purple', 'green', 'amber'];

  return (
    <div>
      {stages.map((stage, i) => {
        const widthPercent = top > 0 ? Math.max(4, Math.round((stage.count / top) * 100)) : 0;
        const colour = TILE[tones[i % tones.length]].fg(isDark);
        const prev = i > 0 ? stages[i - 1] : null;
        const lost = prev ? prev.count - stage.count : 0;
        const duration = formatDuration(stage.medianMinutesFromPrev);

        return (
          <div key={stage.stage} style={{ marginBottom: i === stages.length - 1 ? 0 : 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <Text strong style={{ fontSize: 12.5 }}>{stage.stage}</Text>
              <span style={{ ...monoNumeric, fontSize: 13, fontWeight: 700 }}>{stage.count}</span>
            </div>

            <Tooltip title={`${stage.count} of ${top} reached this stage`}>
              <div style={{ height: 10, background: hairline(isDark), borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
                <div style={{ width: `${widthPercent}%`, height: '100%', background: colour, borderRadius: 4 }} />
              </div>
            </Tooltip>

            <div style={{ marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {stage.conversionFromPrev !== null && stage.conversionFromPrev !== undefined && (
                <Text style={{ fontSize: 11, color: muted(isDark) }}>
                  {stage.conversionFromPrev}% of the previous stage
                </Text>
              )}
              {lost > 0 && (
                <Text style={{ fontSize: 11, color: STATUS_COLORS.warning[isDark ? 'dark' : 'light'] }}>
                  {lost} {dropLabel}
                </Text>
              )}
              {duration && (
                <Text style={{ fontSize: 11, color: muted(isDark) }}>
                  median {duration} to get here
                </Text>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default FunnelChart;
