import { useEffect, useState } from 'react';
import config from '../config';
import { getCached, isStale, setCached } from '../utils/dataCache';

/**
 * Fetch helper for the public catalogue endpoints, with a stale-while-
 * revalidate cache so navigating back to a page already visited (models,
 * use cases, pricing all render this) shows the catalogue instantly instead
 * of blanking out and re-fetching every time.
 *
 * Lives in its own module because both BlockRenderer and CatalogBlocks need it:
 * any block that names a model or quotes a price must read it from the
 * catalogue rather than from page content an admin typed, or the marketing site
 * starts advertising models that were removed and prices we no longer charge.
 *
 * Returns `null` while loading (no cache hit yet) and `[]` on failure, so a
 * caller can render nothing rather than an empty-looking section.
 */
const useCatalogData = (path, pick) => {
  const [data, setData] = useState(() => (path ? getCached(path) : undefined) ?? null);

  useEffect(() => {
    // A null path means this caller does not want live data on this render —
    // hooks cannot be called conditionally, so the condition lives here.
    if (!path) return undefined;

    if (!isStale(path)) return undefined; // fresh cache hit — nothing to do

    let cancelled = false;
    fetch(`${config.apiUrl}${path}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const result = json.success ? (pick(json) || []) : [];
        setCached(path, result);
        setData(result);
      })
      .catch(() => { if (!cancelled) setData((prev) => prev ?? []); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return data;
};

export default useCatalogData;
