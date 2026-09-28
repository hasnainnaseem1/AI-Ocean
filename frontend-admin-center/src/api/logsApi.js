import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

const logsApi = {
  /**
   * GET /api/v1/admin/logs
   */
  getLogs: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/logs', { params: buildQueryParams(params) })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/logs/:id
   */
  getLog: (id) =>
    axiosInstance.get(`/api/v1/admin/logs/${id}`).then((r) => r.data),

  /**
   * GET /api/v1/admin/logs/user/:userId
   */
  getUserLogs: (userId, params = {}) =>
    axiosInstance
      .get(`/api/v1/admin/logs/user/${userId}`, { params: buildQueryParams(params) })
      .then((r) => r.data),

  /**
   * DELETE /api/v1/admin/logs/old
   */
  deleteOldLogs: (days = 90) =>
    axiosInstance.delete('/api/v1/admin/logs/old', { data: { days } }).then((r) => r.data),

  /**
   * DELETE /api/v1/admin/logs/range
   */
  deleteLogsByDateRange: (params = {}) =>
    axiosInstance.delete('/api/v1/admin/logs/range', { data: params }).then((r) => r.data),

  /**
   * GET /api/v1/admin/logs/export/csv
   */
  exportCSV: (params = {}) =>
    axiosInstance
      .get('/api/v1/admin/logs/export/csv', {
        params: buildQueryParams(params),
        responseType: 'blob',
      })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/logs/stats/summary
   */
  getStats: (period = '30d') =>
    axiosInstance
      .get('/api/v1/admin/logs/stats/summary', { params: { period } })
      .then((r) => r.data),
};

export default logsApi;
