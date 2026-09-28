import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

/**
 * Customer credit wallets. Adjustments go through the ledger, so every change
 * is reconcilable and shows up in the customer's transaction history.
 */
const walletsApi = {
  /** GET /api/v1/admin/wallets — list with platform-wide totals */
  getWallets: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/wallets', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** GET /api/v1/admin/wallets/:userId — balance, ledger and a reconciliation check */
  getWallet: (userId) =>
    axiosInstance.get(`/api/v1/admin/wallets/${userId}`).then((r) => r.data),

  /**
   * POST /api/v1/admin/wallets/:userId/adjust
   * `amount` is signed — positive credits, negative debits. A positive
   * adjustment also resumes any deployment paused for lack of credit.
   */
  adjust: (userId, { amount, description, type }) =>
    axiosInstance
      .post(`/api/v1/admin/wallets/${userId}/adjust`, { amount, description, type })
      .then((r) => r.data),

  /** GET /api/v1/admin/wallets/debt — every customer currently owing money */
  getDebt: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/wallets/debt', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** POST /api/v1/admin/wallets/:userId/collect — charge the saved card now */
  collect: (userId) =>
    axiosInstance.post(`/api/v1/admin/wallets/${userId}/collect`).then((r) => r.data),

  /**
   * POST /api/v1/admin/wallets/:userId/write-off
   * Erases the outstanding balance without collecting it. A reason is
   * required — this is the only way debt is ever forgiven on this platform.
   */
  writeOff: (userId, reason) =>
    axiosInstance
      .post(`/api/v1/admin/wallets/${userId}/write-off`, { reason })
      .then((r) => r.data),
};

export default walletsApi;
