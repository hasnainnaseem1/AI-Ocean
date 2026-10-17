import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Run several analytics fetches together and report each one's fate separately.
 *
 * `Promise.allSettled` was already the right call here — one failing endpoint
 * must not blank a page where the other five succeeded, and a zero rendered
 * because a request failed is a lie the operator cannot see. What was wrong
 * was reading the results positionally (`results[5]?.status`), so inserting a
 * call at the top silently re-pointed every assignment below it, and the page
 * would render the login data in the revenue card without erroring.
 *
 * Here the caller names each fetch and gets the same names back:
 *
 *   const { data, errors, loading, failedCount, reload } = useAnalyticsQuery({
 *     summary:   () => dashboardApi.getSummary({ period }),
 *     attention: () => dashboardApi.getAttention(),
 *   }, [period]);
 *
 * `data.summary` is undefined until it arrives and stays undefined if it
 * fails; `errors.summary` holds why. Nothing is ever silently zero.
 */
const useAnalyticsQuery = (fetchers, deps = []) => {
  const [data, setData] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);

  // Kept in a ref so the identity of the fetchers object — which is a new
  // object literal on every render — does not re-trigger the effect. The
  // caller's `deps` are the only thing that decides when to refetch.
  const fetchersRef = useRef(fetchers);
  fetchersRef.current = fetchers;

  // Guards against a slow response from a previous window landing after a
  // newer one and overwriting it.
  const runIdRef = useRef(0);

  const run = useCallback(async (opts = {}) => {
    const runId = ++runIdRef.current;
    if (!opts.quiet) setLoading(true);

    const entries = Object.entries(fetchersRef.current);
    const settled = await Promise.allSettled(entries.map(([, fn]) => fn()));

    if (runId !== runIdRef.current) return;   // superseded

    const nextData = {};
    const nextErrors = {};
    settled.forEach((result, i) => {
      const [key] = entries[i];
      if (result.status === 'fulfilled') {
        nextData[key] = result.value;
      } else {
        const err = result.reason;
        // A 403 is not a failure — it is the permission system working. The
        // caller decides whether a missing section matters.
        nextErrors[key] = err?.response?.status === 403
          ? 'You do not have permission to see this'
          : (err?.response?.data?.message || err?.message || 'Could not load');
      }
    });

    setData(nextData);
    setErrors(nextErrors);
    setLoading(false);
  }, []);

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const failedCount = Object.keys(errors).length;

  return {
    data,
    errors,
    loading,
    failedCount,
    /** Refetch. `quiet` leaves the current data on screen while it reloads. */
    reload: run,
  };
};

export default useAnalyticsQuery;
