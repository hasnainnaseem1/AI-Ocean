import axiosInstance from './axiosInstance';

const authApi = {
  /**
   * POST /api/v1/auth/admin/login
   */
  login: (email, password) =>
    axiosInstance.post('/api/v1/auth/admin/login', { email, password }).then((r) => r.data),

  /**
   * GET /api/v1/auth/admin/me
   */
  getMe: () =>
    axiosInstance.get('/api/v1/auth/admin/me').then((r) => r.data),

  /**
   * POST /api/v1/auth/admin/logout
   */
  logout: () =>
    axiosInstance.post('/api/v1/auth/admin/logout').then((r) => r.data),

  /**
   * POST /api/v1/auth/admin/change-password
   */
  changePassword: (currentPassword, newPassword) =>
    axiosInstance
      .post('/api/v1/auth/admin/change-password', { currentPassword, newPassword })
      .then((r) => r.data),

  /**
   * PUT /api/v1/auth/admin/profile
   */
  updateProfile: (data) =>
    axiosInstance
      .put('/api/v1/auth/admin/profile', data)
      .then((r) => r.data),

  /**
   * POST /api/v1/auth/admin/request-password-reset
   */
  requestPasswordReset: () =>
    axiosInstance
      .post('/api/v1/auth/admin/request-password-reset')
      .then((r) => r.data),

  /**
   * POST /api/v1/auth/admin/forgot-password
   * Public endpoint - request password reset via email
   */
  forgotPassword: (email) =>
    axiosInstance
      .post('/api/v1/auth/admin/forgot-password', { email })
      .then((r) => r.data),

  /**
   * POST /api/v1/auth/admin/reset-password
   * Reset password using token (for superadmin)
   */
  resetPassword: (resetToken, newPassword, confirmPassword) =>
    axiosInstance
      .post('/api/v1/auth/admin/reset-password', { resetToken, newPassword, confirmPassword })
      .then((r) => r.data),
};

export default authApi;
