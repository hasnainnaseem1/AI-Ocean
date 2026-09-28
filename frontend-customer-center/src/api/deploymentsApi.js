import axiosInstance from './axiosInstance';

const deploymentsApi = {
  /** GET /api/v1/customer/deployments */
  list: (params = {}) =>
    axiosInstance.get('/api/v1/customer/deployments', { params }).then((r) => r.data),

  /** GET /api/v1/customer/deployments/:id */
  get: (id) =>
    axiosInstance.get(`/api/v1/customer/deployments/${id}`).then((r) => r.data),

  /** GET /api/v1/customer/deployments/questionnaire?modelId= */
  getQuestionnaire: (modelId) =>
    axiosInstance
      .get('/api/v1/customer/deployments/questionnaire', { params: { modelId } })
      .then((r) => r.data),

  /**
   * GET /api/v1/customer/deployments/journey?modelId=&mode=
   * The admin-authored deploy flow with its questions hydrated.
   * `journey: null` is a valid response — fall back to a flat question list.
   */
  getJourney: (params = {}) =>
    axiosInstance
      .get('/api/v1/customer/deployments/journey', { params })
      .then((r) => r.data),

  /**
   * POST /api/v1/customer/deployments/recommend
   *
   * Sizing advice from the customer's answers so far. Stateless and safe to
   * call repeatedly — but only re-fire it when an answer to a question with
   * `affectsSizing: true` changes, or the journey will recompute on every
   * keystroke of a free-text box for no benefit.
   *
   * Omit `modelId` to have a model suggested as well.
   */
  recommend: (payload) =>
    axiosInstance.post('/api/v1/customer/deployments/recommend', payload).then((r) => r.data),

  /**
   * Everything the checkout modal needs: pricing, wallet/affordability, and
   * whether prepaid/pay-as-you-go would each be allowed right now — refetch
   * whenever the modal opens, since the customer may have gone back and
   * changed their answers or machine since it last loaded.
   *
   * A catalogue machine goes as `{ modelId, tierId }` on the GET. A machine
   * the customer built themselves is a list of parts, which does not belong in
   * a query string, so `{ modelId, customBuild: { picks } }` goes by POST to
   * the same handler. Same quote either way — deliberately one endpoint, since
   * this price has to match what creation then charges.
   */
  getCheckoutOptions: (params) =>
    (params?.customBuild
      ? axiosInstance.post('/api/v1/customer/deployments/checkout-options', params)
      : axiosInstance.get('/api/v1/customer/deployments/checkout-options', { params })
    ).then((r) => r.data),

  /** POST /api/v1/customer/deployments */
  create: (payload) =>
    axiosInstance.post('/api/v1/customer/deployments', payload).then((r) => r.data),

  /** GET /api/v1/customer/deployments/:id/usage */
  getUsage: (id, days = 30) =>
    axiosInstance
      .get(`/api/v1/customer/deployments/${id}/usage`, { params: { days } })
      .then((r) => r.data),

  /**
   * GET /api/v1/customer/deployments/:id/api-key
   * Deliberately a separate call — revealing a credential is audit-logged.
   */
  revealApiKey: (id) =>
    axiosInstance.get(`/api/v1/customer/deployments/${id}/api-key`).then((r) => r.data),

  pause: (id) => axiosInstance.post(`/api/v1/customer/deployments/${id}/pause`).then((r) => r.data),
  resume: (id) => axiosInstance.post(`/api/v1/customer/deployments/${id}/resume`).then((r) => r.data),
  stop: (id) => axiosInstance.post(`/api/v1/customer/deployments/${id}/stop`).then((r) => r.data),
  terminate: (id) => axiosInstance.post(`/api/v1/customer/deployments/${id}/terminate`).then((r) => r.data),

  /**
   * POST /api/v1/customer/deployments/:id/billing-method
   * Switch between 'prepaid' and 'payg' — works at any time, not only in
   * response to the auto-suspend offer. If this is exactly the deployment
   * that was paused for lack of credit, switching to payg also attempts an
   * immediate resume; the response says whether that succeeded.
   */
  setBillingMethod: (id, method) =>
    axiosInstance.post(`/api/v1/customer/deployments/${id}/billing-method`, { method }).then((r) => r.data),
};

export default deploymentsApi;
