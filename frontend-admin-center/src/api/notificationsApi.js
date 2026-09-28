import axiosInstance from './axiosInstance';

const notificationsApi = {
  /**
   * GET /api/v1/notifications
   * Get all notifications for current user
   */
  getNotifications: (params = {}) =>
    axiosInstance
      .get('/api/v1/notifications', { params })
      .then((r) => r.data),

  /**
   * GET /api/v1/notifications/unread-count
   * Get unread notification count
   */
  getUnreadCount: () =>
    axiosInstance
      .get('/api/v1/notifications/unread-count')
      .then((r) => r.data),

  /**
   * PUT /api/v1/notifications/:id/read
   * Mark notification as read
   */
  markAsRead: (notificationId) =>
    axiosInstance
      .put(`/api/v1/notifications/${notificationId}/read`)
      .then((r) => r.data),

  /**
   * DELETE /api/v1/notifications/:id
   * Delete notification
   */
  deleteNotification: (notificationId) =>
    axiosInstance
      .delete(`/api/v1/notifications/${notificationId}`)
      .then((r) => r.data),

  /**
   * PUT /api/v1/notifications/mark-all-read
   * Mark all notifications as read
   */
  markAllAsRead: () =>
    axiosInstance
      .put('/api/v1/notifications/mark-all-read')
      .then((r) => r.data),
};

export default notificationsApi;
