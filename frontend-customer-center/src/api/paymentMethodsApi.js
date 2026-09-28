import axiosInstance from './axiosInstance';

/**
 * Saved cards. Under Stripe, the card number itself never touches this API —
 * Stripe Elements confirms the SetupIntent directly with Stripe, and only the
 * resulting id is sent here to be recorded. Under Polar, there is no
 * SetupIntent step at all — startPolarPortal hands back a URL to Polar's own
 * hosted Customer Portal, where the card is entered and saved entirely on
 * Polar's side; this API only ever learns about it afterwards, when list()
 * syncs from the gateway.
 */
const paymentMethodsApi = {
  /** GET /api/v1/customer/payment-methods */
  list: () => axiosInstance.get('/api/v1/customer/payment-methods').then((r) => r.data),

  /** POST /api/v1/customer/payment-methods/setup-intent — start adding a card (Stripe) */
  createSetupIntent: () =>
    axiosInstance.post('/api/v1/customer/payment-methods/setup-intent').then((r) => r.data),

  /** POST /api/v1/customer/payment-methods/polar-portal — get the hosted card-management URL (Polar) */
  startPolarPortal: () =>
    axiosInstance.post('/api/v1/customer/payment-methods/polar-portal').then((r) => r.data),

  /** POST /api/v1/customer/payment-methods — record a card once its SetupIntent succeeded */
  attach: (setupIntentId) =>
    axiosInstance.post('/api/v1/customer/payment-methods', { setupIntentId }).then((r) => r.data),

  /** PUT /api/v1/customer/payment-methods/:id/default */
  setDefault: (id) =>
    axiosInstance.put(`/api/v1/customer/payment-methods/${id}/default`).then((r) => r.data),

  /** DELETE /api/v1/customer/payment-methods/:id */
  remove: (id) =>
    axiosInstance.delete(`/api/v1/customer/payment-methods/${id}`).then((r) => r.data),
};

export default paymentMethodsApi;
