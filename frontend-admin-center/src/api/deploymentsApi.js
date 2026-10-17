import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

/**
 * Deployment fulfillment queue.
 *
 * Phase 1: an admin provisions the model by hand and records the result here.
 * Every status change fires the customer's email/notification and moves the
 * billing watermark, so always go through these endpoints rather than editing
 * the record directly.
 */
const deploymentsApi = {
  /** GET /api/v1/admin/deployments */
  getDeployments: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/deployments', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** GET /api/v1/admin/deployments/:id — includes the questionnaire answers */
  getDeployment: (id) =>
    axiosInstance.get(`/api/v1/admin/deployments/${id}`).then((r) => r.data),

  /**
   * PUT /api/v1/admin/deployments/:id/status
   * Moving to 'running' requires an endpoint URL; 'rejected' requires a note,
   * which is shown to the customer.
   */
  setStatus: (id, status, note) =>
    axiosInstance
      .put(`/api/v1/admin/deployments/${id}/status`, { status, note })
      .then((r) => r.data),

  /**
   * PUT /api/v1/admin/deployments/:id/endpoint
   * Pass generateKey: true to have the server mint an API key — it is returned
   * once in the response and encrypted at rest thereafter.
   */
  setEndpoint: (id, data) =>
    axiosInstance.put(`/api/v1/admin/deployments/${id}/endpoint`, data).then((r) => r.data),

  /** PUT /api/v1/admin/deployments/:id/notes — internal only, never shown to customers */
  setNotes: (id, data) =>
    axiosInstance.put(`/api/v1/admin/deployments/${id}/notes`, data).then((r) => r.data),

  /* ── Cloud machines ───────────────────────────────────────────────────── */

  /**
   * Mounted at /admin/cloud, not under /admin/deployments, so that `/orphans`
   * can never be swallowed by `/deployments/:id`.
   *
   * `getDeployment` above already returns `cloudInstance`, so this is only for
   * refreshing the machine on its own after an action — the page should not
   * reload the whole deployment to find out a stop went through.
   */
  getInstance: (deploymentId) =>
    axiosInstance
      .get(`/api/v1/admin/cloud/deployments/${deploymentId}/instance`)
      .then((r) => r.data),

  /** POST /api/v1/admin/cloud/deployments/:id/instance/:action — retry | stop | start | destroy */
  instanceAction: (deploymentId, action) =>
    axiosInstance
      .post(`/api/v1/admin/cloud/deployments/${deploymentId}/instance/${action}`)
      .then((r) => r.data),

  /** GET /api/v1/admin/cloud/orphans — machines Google is charging for that nobody owns */
  getOrphans: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/cloud/orphans', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** POST /api/v1/admin/cloud/orphans/:id/resolve — destroyed | kept | not_ours */
  resolveOrphan: (id, resolution) =>
    axiosInstance
      .post(`/api/v1/admin/cloud/orphans/${id}/resolve`, { resolution })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/cloud/accounts — accounts that can go on the provisioning
   * allowlist. Pass `search` to look one up by name or owner email, or `ids` to
   * turn ids that are already stored back into names.
   */
  getCloudAccounts: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/cloud/accounts', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /**
   * PUT /api/v1/admin/cloud/accounts/:id/auto-deploy
   *
   * Turn automatic provisioning off for one account, or back on. Works for a
   * personal account as well as an organization — deployments belong to both.
   */
  setAccountAutoDeploy: (accountId, { autoDeploy, reason }) =>
    axiosInstance
      .put(`/api/v1/admin/cloud/accounts/${accountId}/auto-deploy`, { autoDeploy, reason })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/cloud/pricing-status
   *
   * Where cost figures are coming from right now — the provider's live API, or
   * a table typed by hand. Does a real lookup, not just a settings read:
   * "credentials are stored" and "prices actually come back" are different
   * things.
   */
  getPricingStatus: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/cloud/pricing-status', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /**
   * POST /api/v1/admin/cloud/price-quote
   *
   * What a machine with these specs would cost, and the least it may be sold
   * for. Read-only and safe to call while someone is typing.
   */
  priceQuote: (specs) =>
    axiosInstance.post('/api/v1/admin/cloud/price-quote', specs).then((r) => r.data),

  /** POST /api/v1/admin/cloud/sweep — run the reconciler now instead of waiting a minute */
  /**
   * POST /api/v1/admin/cloud/sweep — check one cloud now.
   * Each cloud runs whatever job it has; the question the admin is asking is
   * the same either way: is anything running here that nobody owns?
   */
  sweepCloud: (cloud = 'gcp') =>
    axiosInstance.post('/api/v1/admin/cloud/sweep', { cloud }).then((r) => r.data),
};

export default deploymentsApi;
