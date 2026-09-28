import axiosInstance from './axiosInstance';

const billingApi = {
  /** POST /api/v1/customer/billing/verify-session — confirm a credit top-up from session_id */
  verifySession: (sessionId) =>
    axiosInstance
      .post('/api/v1/customer/billing/verify-session', { sessionId })
      .then((r) => r.data),

  /**
   * GET /api/v1/customer/billing/usage — this month's charges per deployment,
   * split into compute (while running) and storage (while stopped).
   *
   * The billing page used to work that split out itself by dividing cost by the
   * hourly rate, which assumed every charge was compute. It isn't: a stopped
   * deployment still pays for its disk. The server does the split now.
   *
   * @param {string|{from: string, to: string}} [period] 'YYYY-MM' for a
   *   calendar month, or `{ from, to }` as inclusive 'YYYY-MM-DD' dates for
   *   any window (a day, a month, a year); defaults to the current month
   */
  getUsage: (period) => {
    let params = {};
    if (typeof period === 'string') params = { month: period };
    else if (period && period.from && period.to) params = { from: period.from, to: period.to };
    return axiosInstance
      .get('/api/v1/customer/billing/usage', { params })
      .then((r) => r.data);
  },

  /**
   * GET /api/v1/customer/billing/invoices — usage statements + top-up
   * receipts, real data (this used to be a frontend-only localStorage mock
   * that showed the same seeded fake documents to every customer).
   */
  getInvoices: () =>
    axiosInstance.get('/api/v1/customer/billing/invoices').then((r) => r.data),
};

export default billingApi;
