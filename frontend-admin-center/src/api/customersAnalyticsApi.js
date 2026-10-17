import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

const base = '/api/v1/admin/analytics/customers';
const get = (path, params = {}) =>
  axiosInstance.get(base + path, { params: buildQueryParams(params) }).then((r) => r.data);

/**
 * Customer and organization analytics. Everything takes `period` (or
 * `from`/`to`) and `fresh: 1` to bypass the server cache.
 *
 * Named `customersAnalyticsApi` rather than `customersApi` because
 * `src/api/customers.js` already exists and is the account directory — a CRUD
 * client for one customer at a time. This is the aggregate side, and the two
 * must not be confused at an import.
 *
 * The money fields in `/mix`, `/organizations` and `/payg` are removed
 * server-side for a caller without `analytics.revenue`. They are absent, not
 * zero, so a page reads `row.amount === undefined` as "not allowed to see it"
 * rather than as "nothing was earned".
 */
const customersAnalyticsApi = {
  getSummary: (params) => get('/summary', params),
  getSignups: (params) => get('/signups', params),
  getActivation: (params) => get('/activation', params),
  getMix: (params) => get('/mix', params),
  getOrganizations: (params) => get('/organizations', params),
  getInvitations: (params) => get('/invitations', params),
  getMemberFlow: (params) => get('/member-flow', params),
  getEngagement: (params) => get('/engagement', params),
  getPayg: (params) => get('/payg', params),
  getAccounts: (params) => get('/accounts', params),
};

export default customersAnalyticsApi;
