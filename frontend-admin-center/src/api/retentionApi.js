import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';
import exportApi from './exportApi';

const base = '/api/v1/admin/analytics';
const get = (path, params = {}) =>
  axiosInstance.get(base + path, { params: buildQueryParams(params) }).then((r) => r.data);

/**
 * Retention and churn risk.
 *
 * Three permissions meet in here, and they are genuinely different rights:
 *
 *   analytics.view     cohorts, lifecycle, the risk trend, the at-risk list
 *   analytics.revenue  GRR and NRR — the endpoint returns 403 without it, and
 *                      the churn list's money fields are simply absent
 *   analytics.export   downloading the at-risk list as a file. Being allowed
 *                      to look at the customer list and being allowed to walk
 *                      out with it are not the same permission.
 */
const retentionApi = {
  getCohorts: (params) => get('/retention/cohorts', params),
  getLifecycle: (params) => get('/retention/lifecycle', params),
  getRiskTrend: (params) => get('/retention/risk-trend', params),
  getRevenueRetention: (params) => get('/retention/revenue', params),

  getChurnRisk: (params) => get('/churn-risk', params),

  /**
   * The CSV — delegated to the shared export client.
   *
   * This used to be its own download implementation against
   * `/churn-risk/export`. Every analytics export now goes through one gated
   * endpoint and one registry, so there is a single place that knows how to
   * turn a blob into a file, strip money columns and write the audit line.
   */
  exportChurnRisk: (params) => exportApi.download('churn-risk', params),
};

export default retentionApi;
