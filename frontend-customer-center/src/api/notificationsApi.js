import axiosInstance from './axiosInstance';

/**
 * The customer's own notifications — the same endpoints the Admin Center uses.
 * Every route scopes to the signed-in user server-side, so there is nothing to
 * pass but paging.
 */
const notificationsApi = {
  /** GET /api/v1/notifications */
  list: (params = {}) =>
    axiosInstance.get('/api/v1/notifications', { params }).then((r) => r.data),

  /** GET /api/v1/notifications/unread-count */
  getUnreadCount: () =>
    axiosInstance.get('/api/v1/notifications/unread-count').then((r) => r.data),

  /** PUT /api/v1/notifications/:id/read */
  markAsRead: (id) =>
    axiosInstance.put(`/api/v1/notifications/${id}/read`).then((r) => r.data),

  /** PUT /api/v1/notifications/mark-all-read */
  markAllAsRead: () =>
    axiosInstance.put('/api/v1/notifications/mark-all-read').then((r) => r.data),

  /** DELETE /api/v1/notifications/:id */
  remove: (id) =>
    axiosInstance.delete(`/api/v1/notifications/${id}`).then((r) => r.data),
};

export default notificationsApi;
