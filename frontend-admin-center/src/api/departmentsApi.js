import axiosInstance from './axiosInstance';

const departmentsApi = {
  /**
   * GET /api/v1/admin/departments
   * Get all departments
   */
  getDepartments: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/departments', { params })
      .then((res) => res.data),

  /**
   * GET /api/v1/admin/departments/active
   * Get active departments only (for dropdowns)
   */
  getActiveDepartments: () =>
    axiosInstance
      .get('/api/v1/admin/departments/active')
      .then((res) => res.data),

  /**
   * GET /api/v1/admin/departments/:id
   * Get department by ID
   */
  getDepartment: (id) =>
    axiosInstance
      .get(`/api/v1/admin/departments/${id}`)
      .then((res) => res.data),

  /**
   * POST /api/v1/admin/departments
   * Create new department
   */
  createDepartment: (data) =>
    axiosInstance
      .post('/api/v1/admin/departments', data)
      .then((res) => res.data),

  /**
   * PUT /api/v1/admin/departments/:id
   * Update department
   */
  updateDepartment: (id, data) =>
    axiosInstance
      .put(`/api/v1/admin/departments/${id}`, data)
      .then((res) => res.data),

  /**
   * DELETE /api/v1/admin/departments/:id
   * Delete department
   */
  deleteDepartment: (id) =>
    axiosInstance
      .delete(`/api/v1/admin/departments/${id}`)
      .then((res) => res.data),

  /**
   * POST /api/v1/admin/departments/seed/default
   * Seed default departments (super admin only)
   */
  seedDefaultDepartments: () =>
    axiosInstance
      .post('/api/v1/admin/departments/seed/default')
      .then((res) => res.data),
};

export default departmentsApi;
