import axiosInstance from './axiosInstance';

const rolesApi = {
  /**
   * GET /api/v1/admin/roles
   */
  getRoles: () =>
    axiosInstance.get('/api/v1/admin/roles').then((r) => r.data),

  /**
   * GET /api/v1/admin/roles/:id
   */
  getRole: (id) =>
    axiosInstance.get(`/api/v1/admin/roles/${id}`).then((r) => r.data),

  /**
   * POST /api/v1/admin/roles
   */
  createRole: (data) =>
    axiosInstance.post('/api/v1/admin/roles', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/roles/:id
   */
  updateRole: (id, data) =>
    axiosInstance.put(`/api/v1/admin/roles/${id}`, data).then((r) => r.data),

  /**
   * DELETE /api/v1/admin/roles/:id
   */
  deleteRole: (id) =>
    axiosInstance.delete(`/api/v1/admin/roles/${id}`).then((r) => r.data),

  /**
   * GET /api/v1/admin/roles/permissions/available
   */
  getAvailablePermissions: () =>
    axiosInstance.get('/api/v1/admin/roles/permissions/available').then((r) => r.data),

  /**
   * POST /api/v1/admin/roles/bulk-delete
   */
  bulkDeleteRoles: (ids) =>
    axiosInstance.post('/api/v1/admin/roles/bulk-delete', { ids }).then((r) => r.data),
};

export default rolesApi;
