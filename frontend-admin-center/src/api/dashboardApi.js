import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

/**
 * The Dashboard's own endpoints.
 *
 * Separate from the analytics domain clients because the Dashboard is a
 * composition surface rather than a domain: it assembles several of them into
 * one answer to "does anything need me today", and it stays reachable with
 * plain `analytics.view` while the money inside it is gated figure by figure.
 *
 * Every read takes `period` (or `from`/`to`), and `fresh: 1` to bypass the
 * server-side cache — which is what the Refresh button sends, because a number
 * that does not move when somebody asks it to reads as broken.
 */
const dashboardApi = {
  /** GET /api/v1/admin/dashboard/summary — KPIs, each with its own delta and sparkline */
  getSummary: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/dashboard/summary', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** GET /api/v1/admin/dashboard/attention — what needs a human, worst first */
  getAttention: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/dashboard/attention', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** GET /api/v1/admin/dashboard/trends — the series behind the KPIs */
  getTrends: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/dashboard/trends', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** GET /api/v1/admin/dashboard/top-accounts — by ACCOUNT, not by person */
  getTopAccounts: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/dashboard/top-accounts', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** GET /api/v1/admin/dashboard/activity — recent staff activity (logs.view) */
  getActivity: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/dashboard/activity', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** GET /api/v1/admin/dashboard/health — whether today's numbers can be trusted */
  getHealth: () =>
    axiosInstance.get('/api/v1/admin/dashboard/health').then((r) => r.data),
};

export default dashboardApi;
