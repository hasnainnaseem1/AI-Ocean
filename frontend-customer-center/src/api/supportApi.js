import axiosInstance from './axiosInstance';

const supportApi = {
  /** GET /api/v1/customer/support/tickets */
  list: () =>
    axiosInstance.get('/api/v1/customer/support/tickets').then((r) => r.data),

  /** GET /api/v1/customer/support/tickets/:id */
  get: (id) =>
    axiosInstance.get(`/api/v1/customer/support/tickets/${id}`).then((r) => r.data),

  /** POST /api/v1/customer/support/tickets — { subject, category, message } */
  create: (payload) =>
    axiosInstance.post('/api/v1/customer/support/tickets', payload).then((r) => r.data),

  /** POST /api/v1/customer/support/tickets/:id/messages — reopens the ticket */
  reply: (id, body) =>
    axiosInstance.post(`/api/v1/customer/support/tickets/${id}/messages`, { body }).then((r) => r.data),

  /** PATCH /api/v1/customer/support/tickets/:id/status — 'open' | 'solved' */
  setStatus: (id, status) =>
    axiosInstance.patch(`/api/v1/customer/support/tickets/${id}/status`, { status }).then((r) => r.data),
};

export default supportApi;
