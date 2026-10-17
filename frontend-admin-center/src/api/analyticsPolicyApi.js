import axiosInstance from './axiosInstance';

const base = '/api/v1/admin/analytics-policy';

/**
 * Analytics policies: what the numbers MEAN.
 *
 * On `settings.view` / `settings.edit`, not on `analytics.view` — reading a
 * dashboard and deciding how its figures are interpreted are different rights.
 * Changing `dormantDays` from 30 to 90 reveals nothing and silently re-grades
 * every account on the platform.
 *
 * `getDefaults()` is what makes editing one field safe: the form shows the
 * shipped value a blank field falls back to, so nobody has to guess what else
 * an override affects.
 */
const analyticsPolicyApi = {
  getDefaults: () => axiosInstance.get(`${base}/defaults`).then((r) => r.data),
  list: () => axiosInstance.get(base).then((r) => r.data),
  get: (id) => axiosInstance.get(`${base}/${id}`).then((r) => r.data),
  create: (payload) => axiosInstance.post(base, payload).then((r) => r.data),
  update: (id, payload) => axiosInstance.put(`${base}/${id}`, payload).then((r) => r.data),
  activate: (id) => axiosInstance.post(`${base}/${id}/activate`).then((r) => r.data),
  duplicate: (id, payload) => axiosInstance.post(`${base}/${id}/duplicate`, payload).then((r) => r.data),
  remove: (id) => axiosInstance.delete(`${base}/${id}`).then((r) => r.data),
};

export default analyticsPolicyApi;
