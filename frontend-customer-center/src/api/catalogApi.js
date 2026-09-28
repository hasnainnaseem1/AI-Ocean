import axiosInstance from './axiosInstance';

/**
 * AI model catalog. Prices come back already adjusted for the customer's plan
 * discount — never recompute them on the client.
 */
const catalogApi = {
  /** GET /api/v1/customer/catalog/models */
  getModels: (params = {}) =>
    axiosInstance.get('/api/v1/customer/catalog/models', { params }).then((r) => r.data),

  /** GET /api/v1/customer/catalog/models/:slug */
  getModel: (slug) =>
    axiosInstance.get(`/api/v1/customer/catalog/models/${slug}`).then((r) => r.data),

  /**
   * GET /api/v1/customer/catalog/tiers — every machine, with its specs, its
   * full price ladder, and which models run on it.
   */
  getTiers: () =>
    axiosInstance.get('/api/v1/customer/catalog/tiers').then((r) => r.data),

  /**
   * GET /api/v1/customer/catalog/tiers/:identifier — one machine in full.
   * Takes a slug or an id; a machine's slug is nullable, so call sites pass
   * `tier.slug || tier.id`.
   */
  getTier: (identifier) =>
    axiosInstance.get(`/api/v1/customer/catalog/tiers/${identifier}`).then((r) => r.data),

  /**
   * GET /api/v1/customer/catalog/custom-build — the parts a customer is
   * allowed to assemble their own machine from, with the min/max/step each
   * slider should use.
   */
  getCustomBuildOptions: () =>
    axiosInstance.get('/api/v1/customer/catalog/custom-build').then((r) => r.data),

  /**
   * POST /api/v1/customer/catalog/custom-build/quote — what a set of picks
   * costs and what machine they add up to.
   *
   * Called on every slider move, so it is deliberately cheap on the server.
   * The price it returns is the only price: never multiply component prices in
   * the browser, because a number the client computed is not one the platform
   * is bound to charge.
   *
   * @param {Object} body `{ picks: [{ componentId, quantity }], modelId? }`
   *   With `modelId`, the answer also says whether the machine has enough
   *   VRAM to load that model at all.
   */
  quoteCustomBuild: (body) =>
    axiosInstance.post('/api/v1/customer/catalog/custom-build/quote', body).then((r) => r.data),
};

export default catalogApi;
