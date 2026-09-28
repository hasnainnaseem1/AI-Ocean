import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

const usersApi = {
  /**
   * GET /api/v1/admin/users
   */
  getUsers: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/users', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/users/:id
   */
  getUser: (id) =>
    axiosInstance.get(`/api/v1/admin/users/${id}`).then((r) => r.data),

  /**
   * POST /api/v1/admin/users
   */
  createUser: (data) =>
    axiosInstance.post('/api/v1/admin/users', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/users/:id
   */
  updateUser: (id, data) =>
    axiosInstance.put(`/api/v1/admin/users/${id}`, data).then((r) => r.data),

  /**
   * DELETE /api/v1/admin/users/:id
   */
  deleteUser: (id) =>
    axiosInstance.delete(`/api/v1/admin/users/${id}`).then((r) => r.data),

  /**
   * POST /api/v1/admin/users/:id/suspend
   */
  suspendUser: (id, reason) =>
    axiosInstance.post(`/api/v1/admin/users/${id}/suspend`, { reason }).then((r) => r.data),

  /**
   * POST /api/v1/admin/users/:id/activate
   */
  activateUser: (id) =>
    axiosInstance.post(`/api/v1/admin/users/${id}/activate`).then((r) => r.data),

  /**
   * GET /api/v1/admin/users/export/csv
   * Export users to CSV with current filters
   */
  exportUsers: (params = {}) => {
    const queryParams = buildQueryParams(params);
    const queryString = new URLSearchParams(queryParams).toString();
    const url = `/api/v1/admin/users/export/csv${queryString ? '?' + queryString : ''}`;
    
    return axiosInstance
      .get(url, {
        responseType: 'blob',
      })
      .then((response) => {
        // Create download link
        const blob = new Blob([response.data], { type: 'text/csv' });
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        
        // Extract filename from header or use default
        const contentDisposition = response.headers['content-disposition'];
        const filename = contentDisposition
          ? contentDisposition.split('filename=')[1].replace(/"/g, '')
          : `users-export-${new Date().toISOString().split('T')[0]}.csv`;
        
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
        
        return { success: true };
      });
  },

  /**
   * GET /api/v1/admin/users/:id/activity/export
   * Export user activity logs to CSV with date range filter
   */
  exportUserActivity: (params = {}) => {
    const { userId, ...queryParams } = params;
    const queryString = new URLSearchParams(buildQueryParams(queryParams)).toString();
    const url = `/api/v1/admin/users/${userId}/activity/export${queryString ? '?' + queryString : ''}`;
    
    return axiosInstance
      .get(url, {
        responseType: 'blob',
      })
      .then((response) => {
        const blob = new Blob([response.data], { type: 'text/csv' });
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        
        const contentDisposition = response.headers['content-disposition'];
        const filename = contentDisposition
          ? contentDisposition.split('filename=')[1].replace(/"/g, '')
          : `user-activity-${userId}-${new Date().toISOString().split('T')[0]}.csv`;
        
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
        
        return { success: true };
      });
  },

  /**
   * GET /api/v1/admin/users/:id/login-history
   * Get login history for a specific user
   */
  getLoginHistory: (userId, limit = 20) =>
    axiosInstance
      .get(`/api/v1/admin/users/${userId}/login-history`, {
        params: { limit }
      })
      .then((r) => r.data),

  /**
   * POST /api/v1/admin/auth/reset-password-for-user
   * Reset password for a user (super admin only)
   */
  resetUserPassword: (userId, newPassword) =>
    axiosInstance
      .post('/api/v1/auth/admin/reset-password-for-user', {
        userId,
        newPassword
      })
      .then((r) => r.data),

  /**
   * POST /api/v1/admin/users/bulk-delete
   */
  bulkDeleteUsers: (ids) =>
    axiosInstance.post('/api/v1/admin/users/bulk-delete', { ids }).then((r) => r.data),
};

export default usersApi;
