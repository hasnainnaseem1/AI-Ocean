import axiosInstance from './axiosInstance';

const blogApi = {
  /**
   * GET /api/v1/admin/blog/posts
   */
  getPosts: (params) =>
    axiosInstance.get('/api/v1/admin/blog/posts', { params }).then((r) => r.data),

  /**
   * GET /api/v1/admin/blog/posts/:id
   */
  getPost: (id) =>
    axiosInstance.get(`/api/v1/admin/blog/posts/${id}`).then((r) => r.data),

  /**
   * POST /api/v1/admin/blog/posts
   */
  createPost: (data) =>
    axiosInstance.post('/api/v1/admin/blog/posts', data).then((r) => r.data),

  /**
   * PUT /api/v1/admin/blog/posts/:id
   */
  updatePost: (id, data) =>
    axiosInstance.put(`/api/v1/admin/blog/posts/${id}`, data).then((r) => r.data),

  /**
   * DELETE /api/v1/admin/blog/posts/:id
   */
  deletePost: (id) =>
    axiosInstance.delete(`/api/v1/admin/blog/posts/${id}`).then((r) => r.data),

  /**
   * PUT /api/v1/admin/blog/posts/:id/status
   */
  updatePostStatus: (id, status) =>
    axiosInstance.put(`/api/v1/admin/blog/posts/${id}/status`, { status }).then((r) => r.data),

  /**
   * GET /api/v1/admin/blog/categories
   */
  getCategories: () =>
    axiosInstance.get('/api/v1/admin/blog/categories').then((r) => r.data),

  /**
   * GET /api/v1/admin/blog/stats
   */
  getStats: () =>
    axiosInstance.get('/api/v1/admin/blog/stats').then((r) => r.data),

  /**
   * POST /api/v1/admin/blog/posts/bulk-delete
   */
  bulkDeletePosts: (ids) =>
    axiosInstance.post('/api/v1/admin/blog/posts/bulk-delete', { ids }).then((r) => r.data),
};

export default blogApi;
