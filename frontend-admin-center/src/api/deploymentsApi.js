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
};

export default deploymentsApi;
