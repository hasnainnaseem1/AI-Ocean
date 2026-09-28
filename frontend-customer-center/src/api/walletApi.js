import axiosInstance from './axiosInstance';

/**
 * Prepaid credit wallet.
 */
const walletApi = {
  /** GET /api/v1/customer/wallet */
  get: () => axiosInstance.get('/api/v1/customer/wallet').then((r) => r.data),

  /** GET /api/v1/customer/wallet/transactions */
  getTransactions: (params = {}) =>
    axiosInstance.get('/api/v1/customer/wallet/transactions', { params }).then((r) => r.data),

  /** POST /api/v1/customer/wallet/topup — returns a gateway checkout URL */
  createTopUp: (amount) =>
    axiosInstance.post('/api/v1/customer/wallet/topup', { amount }).then((r) => r.data),

  /**
   * POST /api/v1/customer/wallet/topup/instant
   * Charges the saved default card immediately and credits the wallet in the
   * same request — no redirect. Requires a verified card on file.
   */
  createInstantTopUp: (amount) =>
    axiosInstance.post('/api/v1/customer/wallet/topup/instant', { amount }).then((r) => r.data),

  /** PUT /api/v1/customer/wallet/auto-topup */
  updateAutoTopUp: (payload) =>
    axiosInstance.put('/api/v1/customer/wallet/auto-topup', payload).then((r) => r.data),
};

export default walletApi;
