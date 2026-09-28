import axiosInstance from './axiosInstance';

const seoApi = {
  /**
   * GET /api/v1/admin/seo/settings
   */
  getSettings: () =>
    axiosInstance.get('/api/v1/admin/seo/settings').then((r) => r.data),

  /**
   * PUT /api/v1/admin/seo/settings
   */
  updateSettings: (data) =>
    axiosInstance.put('/api/v1/admin/seo/settings', data).then((r) => r.data),

  // ── Redirects ──

  /**
   * GET /api/v1/admin/seo/redirects
   */
  getRedirects: (params = {}) =>
    axiosInstance.get('/api/v1/admin/seo/redirects', { params }).then((r) => r.data),

  /**
   * POST /api/v1/admin/seo/redirects
   */
  createRedirect: (data) =>
    axiosInstance.post('/api/v1/admin/seo/redirects', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/seo/redirects/:id
   */
  updateRedirect: (id, data) =>
    axiosInstance.put(`/api/v1/admin/seo/redirects/${id}`, data).then((r) => r.data),

  /**
   * DELETE /api/v1/admin/seo/redirects/:id
   */
  deleteRedirect: (id) =>
    axiosInstance.delete(`/api/v1/admin/seo/redirects/${id}`).then((r) => r.data),

  /**
   * PUT /api/v1/admin/seo/redirects/:id/toggle
   */
  toggleRedirect: (id) =>
    axiosInstance.put(`/api/v1/admin/seo/redirects/${id}/toggle`).then((r) => r.data),
};

export default seoApi;
