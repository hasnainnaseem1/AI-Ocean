import axiosInstance from './axiosInstance';

const analyticsApi = {
  /**
   * GET /api/v1/admin/analytics/overview
   */
  getOverview: (timeframe = '30d') =>
    axiosInstance
      .get('/api/v1/admin/analytics/overview', { params: { timeframe } })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/analytics/users-growth
   */
  getUsersGrowth: (period = '30d') =>
    axiosInstance
      .get('/api/v1/admin/analytics/users-growth', { params: { period } })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/analytics/deployments-trend
   */
  getDeploymentsTrend: (period = '30d') =>
    axiosInstance
      .get('/api/v1/admin/analytics/deployments-trend', { params: { period } })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/analytics/top-customers
   */
  getTopCustomers: (limit = 10) =>
    axiosInstance
      .get('/api/v1/admin/analytics/top-customers', { params: { limit } })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/analytics/recent-activities
   */
  getRecentActivities: (limit = 20) =>
    axiosInstance
      .get('/api/v1/admin/analytics/recent-activities', { params: { limit } })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/analytics/revenue-stats
   * Revenue details — admin/super_admin only
   */
  getRevenueStats: (period = '30d') =>
    axiosInstance
      .get('/api/v1/admin/analytics/revenue-stats', { params: { period } })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/analytics/login-analytics
   */
  getLoginAnalytics: (period = '30d') =>
    axiosInstance
      .get('/api/v1/admin/analytics/login-analytics', { params: { period } })
      .then((r) => r.data),

  /**
   * GET /api/v1/admin/analytics/revenue-advanced
   * Advanced revenue metrics — admin/super_admin only
   */
  getRevenueAdvanced: (period = '30d') =>
    axiosInstance
      .get('/api/v1/admin/analytics/revenue-advanced', { params: { period } })
      .then((r) => r.data),
};

export default analyticsApi;
