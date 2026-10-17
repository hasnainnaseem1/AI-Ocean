import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

const base = '/api/v1/admin/analytics/support';
const get = (path, params = {}) =>
  axiosInstance.get(base + path, { params: buildQueryParams(params) }).then((r) => r.data);

/**
 * Support queue analytics. Everything takes `period` (or `from`/`to`) and
 * `fresh: 1` to bypass the server cache.
 *
 * Named `supportAnalyticsApi` to sit beside `supportApi`, which is the ticket
 * inbox itself — reading one customer's messages is `support.view`, while
 * these aggregates are `analytics.view`, and the two must not be confused at
 * an import.
 *
 * Several responses carry a `caveat`: how many resolution times were
 * reconstructed rather than observed, how many tickets carry no SLA target,
 * and the date reopen tracking began. They are rendered, not dropped — a
 * partly-estimated SLA figure that does not say so is worse than none.
 */
const supportAnalyticsApi = {
  getSummary: (params) => get('/summary', params),
  getVolume: (params) => get('/volume', params),
  getTiming: (params) => get('/timing', params),
  getBacklog: (params) => get('/backlog', params),
  getSla: (params) => get('/sla', params),
  getAgents: (params) => get('/agents', params),
  getReopens: (params) => get('/reopens', params),
};

export default supportAnalyticsApi;
