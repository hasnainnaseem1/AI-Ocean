import React, { useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { chartConfig } from '../../theme/chartTheme';
import { Line, Area, Column } from './chartLoader';

/**
 * One time series chart, for every time series on the platform.
 *
 * It replaces `GrowthChart` and `TrendChart`, which were the same chart twice
 * with their titles and field names hardcoded — which is why `TrendChart`
 * quietly dropped the `gpuHours` and `revenue` the endpoint had been sending
 * it all along: adding a series meant editing the component, so nobody did.
 *
 * Here the caller names the series it wants and that is the whole contract:
 *
 *   <TimeSeriesChart
 *     data={trends.activity}
 *     xField="bucket"
 *     series={[
 *       { field: 'signups',     label: 'Signups' },
 *       { field: 'deployments', label: 'Deployments' },
 *     ]}
 *   />
 *
 * `@ant-design/charts` v2 wants long-format rows (`{x, value, type}`) for a
 * multi-series chart, so the wide rows the API returns are melted here rather
 * than at each call site.
 */
/**
 * Bucket keys as the server sends them are machine-shaped — `2026-09-09`,
 * `2026-09-09 14:00`, `2026-09` — which is 10 to 16 characters per tick. On a
 * half-width chart with a 30-day window the ticks are close enough that the
 * labels touch end to end and read as one string (`2026-09-092026-09-12`):
 * the library's overlap detection only hides labels that actually intersect,
 * so labels that merely abut are kept.
 *
 * The short forms say the same thing in about half the width. The year is
 * dropped from day and hour ticks because the window is one the reader just
 * chose, and the tooltip still carries the full bucket key.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortBucket = (key) => {
  const s = String(key);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00$/);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[4]}:00`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return s;
};

const TimeSeriesChart = ({
  data = [],
  xField = 'bucket',
  series = [],
  kind = 'line',
  height = 280,
  stack = false,
  smooth = true,
  valueFormat,
}) => {
  const { isDark } = useTheme();

  const chartData = useMemo(() => {
    const out = [];
    for (const row of data) {
      for (const s of series) {
        out.push({
          x: row[xField],
          value: Number(row[s.field] ?? 0),
          type: s.label || s.field,
        });
      }
    }
    return out;
  }, [data, series, xField]);

  const Geom = kind === 'area' ? Area : (kind === 'column' ? Column : Line);
  if (!Geom || !chartData.length) return null;

  const config = {
    // Spread the shared theme FIRST so anything below can override it — the
    // established idiom in this app's existing charts.
    ...chartConfig(isDark),
    data: chartData,
    xField: 'x',
    yField: 'value',
    colorField: 'type',
    height,
    ...(kind === 'line' ? { smooth, style: { lineWidth: 2 } } : {}),
    ...(kind === 'area' ? { smooth, stack } : {}),
    ...(kind === 'column' ? { stack } : {}),
    // A single-series chart has nothing to disambiguate, so the legend is
    // just a label taking up plot height.
    legend: series.length > 1 ? chartConfig(isDark).legend : false,
    axis: {
      ...chartConfig(isDark).axis,
      x: {
        ...chartConfig(isDark).axis.x,
        /*
         * A 30- or 90-bucket window produces more date labels than fit, and
         * the default response is to rotate them vertically — which turns the
         * axis into a wall of sideways text that nobody reads. Dropping the
         * ones that collide keeps the labels horizontal and legible; the
         * tooltip still names the exact bucket on hover, so nothing is lost.
         */
        labelAutoHide: true,
        labelAutoRotate: false,
        labelFormatter: shortBucket,
      },
      y: {
        ...chartConfig(isDark).axis.y,
        ...(valueFormat ? { labelFormatter: valueFormat } : {}),
      },
    },
    interaction: { tooltip: { marker: true } },
    ...(valueFormat ? { tooltip: { items: [{ channel: 'y', valueFormatter: valueFormat }] } } : {}),
  };

  return <Geom {...config} />;
};

export default TimeSeriesChart;
