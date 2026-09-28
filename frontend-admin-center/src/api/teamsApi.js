import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

/**
 * Customer organizations — the shared accounts that own wallets, cards and
 * deployments. Personal accounts are not here: they are the customer, and the
 * Customers pages already show them.
 */
const teamsApi = {
  /** GET /api/v1/admin/teams — every organization, with size and money */
  getTeams: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/teams', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** GET /api/v1/admin/teams/:id — members, wallet, doors and recent history */
  getTeam: (id) => axiosInstance.get(`/api/v1/admin/teams/${id}`).then((r) => r.data),

  /**
   * PUT /api/v1/admin/teams/:id/payg-access
   * Taking pay-as-you-go away moves what is already running onto prepaid at
   * once, rather than letting it bill to debt until the next hourly pass.
   */
  setPaygAccess: (id, { access, reason }) =>
    axiosInstance.put(`/api/v1/admin/teams/${id}/payg-access`, { access, reason }).then((r) => r.data),

  /** PUT /api/v1/admin/teams/:id/dispute-hold — a chargeback hold, or lifting one */
  setDisputeHold: (id, { disputeHold, reason }) =>
    axiosInstance.put(`/api/v1/admin/teams/${id}/dispute-hold`, { disputeHold, reason }).then((r) => r.data),

  /** GET /api/v1/admin/teams/:id/seat-charges — what its seats have cost, day by day */
  getSeatCharges: (id, params = {}) =>
    axiosInstance
      .get(`/api/v1/admin/teams/${id}/seat-charges`, { params: buildQueryParams(params) })
      .then((r) => r.data),

  /*
   * Members, from support's side. The same three things an owner can do and
   * nothing more — ownership moves only by an offer the new owner accepts.
   */
  addMember: (id, { email, role }) =>
    axiosInstance.post(`/api/v1/admin/teams/${id}/members`, { email, role }).then((r) => r.data),
  setMemberRole: (id, userId, role) =>
    axiosInstance.patch(`/api/v1/admin/teams/${id}/members/${userId}`, { role }).then((r) => r.data),
  removeMember: (id, userId) =>
    axiosInstance.delete(`/api/v1/admin/teams/${id}/members/${userId}`).then((r) => r.data),

  /** GET /api/v1/admin/customers/:id/teams — the organizations one person is in */
  getCustomerTeams: (customerId) =>
    axiosInstance.get(`/api/v1/admin/customers/${customerId}/teams`).then((r) => r.data),
};

export default teamsApi;
