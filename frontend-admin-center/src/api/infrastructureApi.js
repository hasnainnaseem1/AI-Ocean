import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

const base = '/api/v1/admin/analytics/infrastructure';
const get = (path, params = {}) =>
  axiosInstance.get(base + path, { params: buildQueryParams(params) }).then((r) => r.data);

/**
 * Infrastructure analytics. Everything takes `period` (or `from`/`to`) and
 * `fresh: 1` to bypass the server cache.
 *
 * Money is stripped server-side for a caller without `analytics.revenue` —
 * the amount fields are simply absent rather than zeroed, so the page renders
 * the hours columns and omits the rest.
 */
const infrastructureApi = {
  getTiers: (params) => get('/tiers', params),
  getCapacityTrend: (params) => get('/capacity-trend', params),
  getStockOutages: (params) => get('/stock-outages', params),
  getConsumption: (params) => get('/consumption', params),
  getComponents: (params) => get('/components', params),
  getLifecycle: (params) => get('/lifecycle', params),
  getSizingEffectiveness: (params) => get('/sizing-effectiveness', params),
  getCustomBuilds: (params) => get('/custom-builds', params),
};

export default infrastructureApi;
