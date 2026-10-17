import axiosInstance from './axiosInstance';
import { buildQueryParams } from '../utils/helpers';

const base = '/api/v1/admin/analytics/export';

/**
 * Analytics exports.
 *
 * The whole router is gated on `analytics.export` server-side — a separate
 * right from looking at the screen, because being allowed to read a figure and
 * being allowed to walk out with the customer list behind it are not the same
 * thing. A caller without it gets 403 on every call here.
 *
 * Money columns are dropped for a caller without `analytics.revenue` rather
 * than the whole export being refused: the non-money half is usually what they
 * were after.
 */
const exportApi = {
  /** What can be exported, so the UI lists datasets instead of hardcoding them. */
  list: () => axiosInstance.get(base).then((r) => r.data),

  /**
   * Download one dataset. Fetched as a blob and handed to the browser here
   * rather than opening the URL in a tab — the request needs the
   * Authorization header, which a plain link cannot carry.
   */
  download: (dataset, params = {}) =>
    axiosInstance
      .get(`${base}/${dataset}`, { params: buildQueryParams(params), responseType: 'blob' })
      .then((r) => {
        const name = (r.headers['content-disposition'] || '')
          .match(/filename="?([^"]+)"?/)?.[1] || `${dataset}.csv`;
        const url = window.URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoked on the next tick: Safari has not finished reading the blob
        // when click() returns, and revoking immediately yields an empty file.
        setTimeout(() => window.URL.revokeObjectURL(url), 1000);
        return name;
      }),
};

export default exportApi;
