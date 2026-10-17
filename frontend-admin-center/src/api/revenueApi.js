import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

const base = '/api/v1/admin/analytics/revenue';
const get = (path, params = {}) =>
  axiosInstance.get(base + path, { params: buildQueryParams(params) }).then((r) => r.data);

/**
 * Revenue, wallets, receivables and dunning.
 *
 * The entire router is gated on `analytics.revenue` server-side, so every call
 * here returns 403 for a caller without it — the page guards on the same
 * permission rather than rendering a locked placeholder.
 */
const revenueApi = {
  getSummary: (params) => get('/summary', params),
  getTrend: (params) => get('/trend', params),
  getRecurring: (params) => get('/recurring', params),
  getByDimension: (params) => get('/by-dimension', params),
  getWallets: (params) => get('/wallets', params),
  getReceivables: (params) => get('/receivables', params),
  getPayments: (params) => get('/payments', params),
  getDunning: (params) => get('/dunning', params),
  getTopAccounts: (params) => get('/top-accounts', params),
};

export default revenueApi;
