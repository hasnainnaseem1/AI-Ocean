import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

const base = '/api/v1/admin/analytics/traffic';
const get = (path, params = {}) =>
  axiosInstance.get(base + path, { params: buildQueryParams(params) }).then((r) => r.data);

/**
 * Traffic, from the platform's own collector — no third-party analytics.
 *
 * Everything takes `period` (or `from`/`to`), an optional `site`
 * ('marketing' | 'customer' | 'admin') and `fresh: 1` to bypass the cache.
 *
 * Every response carries a `source` of `'events'` or `'rollups'` and a
 * sentence explaining which it used. A window inside the operator's retention
 * is answered from individual page views; one reaching further back comes from
 * the nightly rollups, which are coarser. The page shows which, because
 * silently switching between a precise source and an approximate one is how a
 * year-on-year chart ends up comparing two different measurements.
 */
const trafficApi = {
  getSummary: (params) => get('/summary', params),
  getTrend: (params) => get('/trend', params),
  getPages: (params) => get('/pages', params),
  getBreakdown: (params) => get('/breakdown', params),
  getAudience: (params) => get('/audience', params),
  getConversions: (params) => get('/conversions', params),
};

export default trafficApi;
