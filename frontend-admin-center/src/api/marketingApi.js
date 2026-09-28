import axiosInstance from './axiosInstance';

const marketingApi = {
  /**
   * GET /api/v1/admin/marketing/pages
   */
  getPages: (params) =>
    axiosInstance.get('/api/v1/admin/marketing/pages', { params }).then((r) => r.data),

  /**
   * GET /api/v1/admin/marketing/pages/:id
   */
  getPage: (id) =>
    axiosInstance.get(`/api/v1/admin/marketing/pages/${id}`).then((r) => r.data),

  /**
   * POST /api/v1/admin/marketing/pages
   */
  createPage: (data) =>
    axiosInstance.post('/api/v1/admin/marketing/pages', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/marketing/pages/:id
   */
  updatePage: (id, data) =>
    axiosInstance.put(`/api/v1/admin/marketing/pages/${id}`, data).then((r) => r.data),

  /**
   * DELETE /api/v1/admin/marketing/pages/:id
   */
  deletePage: (id) =>
    axiosInstance.delete(`/api/v1/admin/marketing/pages/${id}`).then((r) => r.data),

  /**
   * PUT /api/v1/admin/marketing/pages/:id/status
   */
  updatePageStatus: (id, status) =>
    axiosInstance.put(`/api/v1/admin/marketing/pages/${id}/status`, { status }).then((r) => r.data),

  /**
   * PUT /api/v1/admin/marketing/pages-reorder
   */
  reorderPages: (pages) =>
    axiosInstance.put('/api/v1/admin/marketing/pages-reorder', { pages }).then((r) => r.data),

  /**
   * POST /api/v1/admin/marketing/pages/:id/clone
   */
  clonePage: (id) =>
    axiosInstance.post(`/api/v1/admin/marketing/pages/${id}/clone`).then((r) => r.data),

  /**
   * GET /api/v1/admin/marketing/navigation
   */
  getNavigation: () =>
    axiosInstance.get('/api/v1/admin/marketing/navigation').then((r) => r.data),

  /**
   * POST /api/v1/admin/marketing/pages/bulk-delete
   */
  bulkDeletePages: (ids) =>
    axiosInstance.post('/api/v1/admin/marketing/pages/bulk-delete', { ids }).then((r) => r.data),
};

export default marketingApi;
