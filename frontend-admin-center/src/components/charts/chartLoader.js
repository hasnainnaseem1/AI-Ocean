/**
 * The one place that loads `@ant-design/charts`.
 *
 * Every chart in this app already used a defensive `require` in a try/catch —
 * the library pulls in a large WebGL renderer and a failure to load it should
 * degrade one card to an empty state, never white-screen the page. That idiom
 * was repeated at each call site, which meant each site also had to remember
 * its own `{ Line ? <Line/> : <Empty/> }` guard, and a new chart could silently
 * forget to.
 *
 * Importing from here instead means the guard lives in `ChartCard`, once, and
 * a chart component only has to describe the chart.
 */
let charts = {};
try {
  // eslint-disable-next-line global-require
  charts = require('@ant-design/charts') || {};
} catch {
  charts = {};
}

export const Line = charts.Line || null;
export const Area = charts.Area || null;
export const Column = charts.Column || null;
export const Bar = charts.Bar || null;
export const Pie = charts.Pie || null;
export const Heatmap = charts.Heatmap || null;
export const DualAxes = charts.DualAxes || null;
export const Gauge = charts.Gauge || null;

/** True when the library loaded at all — what `ChartCard` checks before it
 *  bothers rendering a chart body. */
export const chartsAvailable = Object.keys(charts).length > 0;

const chartLoader = {
  Line, Area, Column, Bar, Pie, Heatmap, DualAxes, Gauge, chartsAvailable,
};

export default chartLoader;
