import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

/**
 * Support tickets, from the operator's side. Reads take `support.view`,
 * replying/assigning/status take `support.manage` (server-enforced —
 * matches the billing.view/billing.manage split).
 */
const supportApi = {
  /** GET /api/v1/admin/support/admins — who a ticket can be assigned to */
  getAdmins: () => axiosInstance.get('/api/v1/admin/support/admins').then((r) => r.data),

  /** GET /api/v1/admin/support/tickets — paginated, filterable */
  getTickets: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/support/tickets', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** GET /api/v1/admin/support/tickets/:id */
  getTicket: (id) => axiosInstance.get(`/api/v1/admin/support/tickets/${id}`).then((r) => r.data),

  /** POST /api/v1/admin/support/tickets/:id/messages — resolve:true also marks it solved */
  reply: (id, body, resolve = false) =>
    axiosInstance.post(`/api/v1/admin/support/tickets/${id}/messages`, { body, resolve }).then((r) => r.data),

  /** PATCH /api/v1/admin/support/tickets/:id/status */
  setStatus: (id, status) =>
    axiosInstance.patch(`/api/v1/admin/support/tickets/${id}/status`, { status }).then((r) => r.data),

  /** PATCH /api/v1/admin/support/tickets/:id/assign — null adminId unassigns */
  assign: (id, adminId) =>
    axiosInstance.patch(`/api/v1/admin/support/tickets/${id}/assign`, { adminId }).then((r) => r.data),

  /**
   * GET /api/v1/admin/support/priorities — the tiers and what each promises.
   *
   * Fetched rather than listed here: the tiers, their order, their wording and
   * their SLA targets all live in the analytics policy, and a copy in this
   * file is a second place for them to go stale.
   */
  getPriorities: () => axiosInstance.get('/api/v1/admin/support/priorities').then((r) => r.data),

  /** PATCH /api/v1/admin/support/tickets/:id/priority — re-stamps the SLA targets */
  setPriority: (id, priority) =>
    axiosInstance.patch(`/api/v1/admin/support/tickets/${id}/priority`, { priority }).then((r) => r.data),
};

export default supportApi;
