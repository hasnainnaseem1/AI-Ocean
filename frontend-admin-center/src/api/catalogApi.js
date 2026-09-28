import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

/**
 * AI model catalog + machine tier administration.
 *
 * Changing a tier's price never affects a running deployment — rates are frozen
 * onto each deployment at order time.
 */
export const modelsApi = {
  /** GET /api/v1/admin/models */
  getModels: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/models', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /** GET /api/v1/admin/models/:id — also returns availableTiers for the form */
  getModel: (id) => axiosInstance.get(`/api/v1/admin/models/${id}`).then((r) => r.data),

  /** POST /api/v1/admin/models */
  createModel: (data) => axiosInstance.post('/api/v1/admin/models', data).then((r) => r.data),

  /** PUT /api/v1/admin/models/:id */
  updateModel: (id, data) => axiosInstance.put(`/api/v1/admin/models/${id}`, data).then((r) => r.data),

  /** PATCH /api/v1/admin/models/:id/toggle */
  toggleModel: (id) => axiosInstance.patch(`/api/v1/admin/models/${id}/toggle`).then((r) => r.data),

  /** DELETE /api/v1/admin/models/:id — 409s if deployments still use it */
  deleteModel: (id) => axiosInstance.delete(`/api/v1/admin/models/${id}`).then((r) => r.data),

  /** PUT /api/v1/admin/models/order/bulk */
  reorder: (order) => axiosInstance.put('/api/v1/admin/models/order/bulk', { order }).then((r) => r.data),
};

export const tiersApi = {
  /** GET /api/v1/admin/tiers */
  getTiers: (params = {}) =>
    axiosInstance.get('/api/v1/admin/tiers', { params }).then((r) => r.data),

  /** GET /api/v1/admin/tiers/:id */
  getTier: (id) => axiosInstance.get(`/api/v1/admin/tiers/${id}`).then((r) => r.data),

  /** POST /api/v1/admin/tiers */
  createTier: (data) => axiosInstance.post('/api/v1/admin/tiers', data).then((r) => r.data),

  /** PUT /api/v1/admin/tiers/:id */
  updateTier: (id, data) => axiosInstance.put(`/api/v1/admin/tiers/${id}`, data).then((r) => r.data),

  /** PATCH /api/v1/admin/tiers/:id/toggle */
  toggleTier: (id) => axiosInstance.patch(`/api/v1/admin/tiers/${id}/toggle`).then((r) => r.data),

  /** DELETE /api/v1/admin/tiers/:id */
  deleteTier: (id) => axiosInstance.delete(`/api/v1/admin/tiers/${id}`).then((r) => r.data),

  /**
   * POST /api/v1/admin/tiers/price-preview
   * What a set of component picks costs, without saving. Same arithmetic the
   * server bills with, so the builder's live total can never drift from it.
   */
  pricePreview: (components, markupPercent = 0) =>
    axiosInstance
      .post('/api/v1/admin/tiers/price-preview', { components, markupPercent })
      .then((r) => r.data),
};

/**
 * The priced building blocks tiers are assembled from — disks, vCPUs, RAM,
 * accelerators — plus the categories tiers are filed under.
 *
 * Editing a component's price reprices every component-built tier that uses
 * it; the update response lists which ones changed.
 */
export const resourceComponentsApi = {
  /** GET /api/v1/admin/resource-components */
  getComponents: (params = {}) =>
    axiosInstance.get('/api/v1/admin/resource-components', { params }).then((r) => r.data),

  /** POST /api/v1/admin/resource-components */
  createComponent: (data) =>
    axiosInstance.post('/api/v1/admin/resource-components', data).then((r) => r.data),

  /** PUT /api/v1/admin/resource-components/:id */
  updateComponent: (id, data) =>
    axiosInstance.put(`/api/v1/admin/resource-components/${id}`, data).then((r) => r.data),

  /** PATCH /api/v1/admin/resource-components/:id/toggle */
  toggleComponent: (id) =>
    axiosInstance.patch(`/api/v1/admin/resource-components/${id}/toggle`).then((r) => r.data),

  /** DELETE /api/v1/admin/resource-components/:id — 409s if a tier uses it */
  deleteComponent: (id) =>
    axiosInstance.delete(`/api/v1/admin/resource-components/${id}`).then((r) => r.data),

  /** GET /api/v1/admin/resource-components/categories */
  getCategories: () =>
    axiosInstance.get('/api/v1/admin/resource-components/categories').then((r) => r.data),

  /** POST /api/v1/admin/resource-components/categories */
  createCategory: (data) =>
    axiosInstance.post('/api/v1/admin/resource-components/categories', data).then((r) => r.data),

  /** PUT /api/v1/admin/resource-components/categories/:id */
  updateCategory: (id, data) =>
    axiosInstance.put(`/api/v1/admin/resource-components/categories/${id}`, data).then((r) => r.data),

  /** DELETE /api/v1/admin/resource-components/categories/:id */
  deleteCategory: (id) =>
    axiosInstance.delete(`/api/v1/admin/resource-components/categories/${id}`).then((r) => r.data),
};

export const questionsApi = {
  /** GET /api/v1/admin/questions */
  getQuestions: () => axiosInstance.get('/api/v1/admin/questions').then((r) => r.data),

  /** POST /api/v1/admin/questions */
  createQuestion: (data) => axiosInstance.post('/api/v1/admin/questions', data).then((r) => r.data),

  /** PUT /api/v1/admin/questions/:id — the key itself is immutable */
  updateQuestion: (id, data) => axiosInstance.put(`/api/v1/admin/questions/${id}`, data).then((r) => r.data),

  /** DELETE /api/v1/admin/questions/:id */
  deleteQuestion: (id) => axiosInstance.delete(`/api/v1/admin/questions/${id}`).then((r) => r.data),

  /** PUT /api/v1/admin/questions/order/bulk */
  reorder: (order) => axiosInstance.put('/api/v1/admin/questions/order/bulk', { order }).then((r) => r.data),
};

export const recommendationPolicyApi = {
  /** GET /api/v1/admin/recommendation-policy */
  getPolicies: () => axiosInstance.get('/api/v1/admin/recommendation-policy').then((r) => r.data),

  /** GET /api/v1/admin/recommendation-policy/defaults — what blank fields fall back to */
  getDefaults: () => axiosInstance.get('/api/v1/admin/recommendation-policy/defaults').then((r) => r.data),

  /** GET /api/v1/admin/recommendation-policy/:id */
  getPolicy: (id) => axiosInstance.get(`/api/v1/admin/recommendation-policy/${id}`).then((r) => r.data),

  /** PUT /api/v1/admin/recommendation-policy/:id */
  updatePolicy: (id, data) =>
    axiosInstance.put(`/api/v1/admin/recommendation-policy/${id}`, data).then((r) => r.data),

  /** POST /api/v1/admin/recommendation-policy/:id/activate */
  activate: (id) =>
    axiosInstance.post(`/api/v1/admin/recommendation-policy/${id}/activate`).then((r) => r.data),

  /** POST /api/v1/admin/recommendation-policy/:id/duplicate */
  duplicate: (id, data) =>
    axiosInstance.post(`/api/v1/admin/recommendation-policy/${id}/duplicate`, data || {}).then((r) => r.data),

  /** POST /api/v1/admin/recommendation-policy/:id/preview — dry run, writes nothing */
  preview: (id, data) =>
    axiosInstance.post(`/api/v1/admin/recommendation-policy/${id}/preview`, data).then((r) => r.data),

  /** DELETE /api/v1/admin/recommendation-policy/:id */
  deletePolicy: (id) =>
    axiosInstance.delete(`/api/v1/admin/recommendation-policy/${id}`).then((r) => r.data),
};

const catalogApi = {
  modelsApi,
  tiersApi,
  resourceComponentsApi,
  questionsApi,
  recommendationPolicyApi,
};

export default catalogApi;
