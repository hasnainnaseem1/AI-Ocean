/**
 * Google Cloud pricing
 *
 * Produces the component rate table `costModel` needs, from Google's own price
 * catalogue, for one region and one machine family.
 *
 * ── Two endpoints, and the difference matters ──
 *
 * The **Catalog API** gives list prices: what anyone pays. The **Pricing API**
 * under `billingAccounts/{id}/skus` gives what *this* account pays, with
 * `listPrice`, `contractPrice` and `effectiveDiscountPercent` on each tier.
 *
 * This asks for the account price when a billing account is configured and
 * falls back to the public catalogue when it is not. That is not a detail:
 * sustained-use and committed-use discounts never appear in list prices, so a
 * margin guard driven by list prices is permanently stricter than reality and
 * would refuse tiers that are in fact profitable.
 *
 * ── Why the result is cached ──
 *
 * Compute Engine publishes thousands of SKUs and the catalogue is paged. Prices
 * change on the order of months. Fetching that on the path that provisions a
 * customer's machine would add seconds to an order and hammer an API for an
 * answer that did not change. So a successful fetch is held in memory for
 * `CACHE_TTL_MS`, keyed by region and family.
 *
 * ── What it never does ──
 *
 * It never guesses. No rate is ever defaulted, estimated or carried over from
 * another region — an unavailable price comes back as `null` and `costModel`
 * refuses to produce a number from it. A pricing engine that invents a figure
 * is worse than one that admits it does not know, because the invented figure
 * is the one somebody prices a product against.
 */
const { ratesFromSkus } = require('./gcpSkuParser');

const BILLING_BASE = 'https://cloudbilling.googleapis.com/v1';
/** Compute Engine's service id in Google's catalogue. Fixed and public. */
const COMPUTE_SERVICE = '6F81-5844-456A';
const SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

/** Prices move on the order of months; an hour is cautious. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_PAGES = 20; // 20 × 5000 SKUs is far more than Compute publishes

const cache = new Map();

const cacheKey = (region, machineType) => `${region}::${String(machineType).split('-')[0]}`;

/**
 * Every Compute SKU, paged.
 *
 * The catalogue has no server-side filter worth using — the v1 list method
 * returns the service's whole catalogue — so the filtering is ours, in the
 * parser, where it can be tested.
 */
const fetchSkus = async ({ token, billingAccountId, timeoutMs }) => {
  const skus = [];
  let pageToken = '';
  let pages = 0;

  do {
    /*
     * The account-specific path when we know the billing account, the public
     * one otherwise. Both return the same SKU shape; only the prices differ.
     */
    const base = billingAccountId
      ? `${BILLING_BASE}/billingAccounts/${encodeURIComponent(billingAccountId)}/skus`
      : `${BILLING_BASE}/services/${COMPUTE_SERVICE}/skus`;

    const url = `${base}?pageSize=5000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Google's price catalogue answered ${res.status}: ${body.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    if (Array.isArray(data.skus)) skus.push(...data.skus);
    pageToken = data.nextPageToken || '';
    pages += 1;
  } while (pageToken && pages < MAX_PAGES);

  return skus;
};

const provider = {
  name: 'gcp',
  label: 'Google Cloud',

  /**
   * Can this provider be asked for prices at all?
   *
   * False on every install before Google Cloud is configured, and in dry run,
   * where there is no credential. Callers fall back to the manually recorded
   * cost table.
   */
  async isConfigured() {
    try {
      const adminSettingsService = require('../../admin/adminSettingsService');
      const settings = await adminSettingsService.getSettings();
      const gcp = settings?.gcpSettings || {};
      return !!(gcp.enabled && gcp.serviceAccountKeyEncrypted);
    } catch {
      return false;
    }
  },

  /**
   * Component rates for one machine in one region.
   *
   * @param {object} opts
   * @param {string} opts.region       a GCP region, e.g. "europe-west4"
   * @param {string} opts.machineType  e.g. "e2-medium"; decides the family and
   *                                   whether custom or predefined SKUs apply
   * @param {boolean} [opts.force]     skip the cache
   * @returns {Promise<{ok: boolean, rates: object|null, source: string,
   *   fetchedAt: Date|null, notes: string[], reason?: string}>}
   */
  async fetchRates({ region, machineType, force = false }) {
    const unavailable = (reason) => ({
      ok: false, rates: null, source: 'gcp', fetchedAt: null, notes: [], reason,
    });

    if (!region || !machineType) return unavailable('A region and a machine type are required.');

    const key = cacheKey(region, machineType);
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      // Re-parsed rather than stored parsed: the cached thing is the expensive
      // part (the SKU list), and re-parsing lets a custom and a predefined
      // machine in the same family share one fetch.
      const { rates, notes } = ratesFromSkus(hit.skus, { region, machineType });
      return {
        ok: true, rates, source: hit.source, fetchedAt: new Date(hit.at), notes, cached: true,
      };
    }

    try {
      const adminSettingsService = require('../../admin/adminSettingsService');
      const settings = await adminSettingsService.getSettings();
      const gcp = settings?.gcpSettings || {};
      if (!gcp.enabled) return unavailable('Google Cloud is switched off.');

      const gcpClient = require('../../gcp/gcpClient');
      const token = await gcpClient.accessTokenFor(SCOPES);
      if (!token) return unavailable('No Google Cloud credential is stored, so prices cannot be read.');

      const timeoutMs = Math.max(5, Number(gcp.requestTimeoutSeconds) || 30) * 1000;
      const billingAccountId = String(gcp.billingAccountId || '').trim();

      const skus = await fetchSkus({ token, billingAccountId, timeoutMs });
      if (!skus.length) return unavailable('Google returned no SKUs for Compute Engine.');

      const source = billingAccountId ? 'gcp:account' : 'gcp:list';
      cache.set(key, { skus, at: Date.now(), source });

      const { rates, notes } = ratesFromSkus(skus, { region, machineType });
      return { ok: true, rates, source, fetchedAt: new Date(), notes, cached: false };
    } catch (err) {
      /*
       * A pricing failure must never break provisioning. The caller falls back
       * to the manually recorded cost table, and the margin guard refuses when
       * there is no figure there either — which is the safe direction.
       */
      console.error('[CloudPricing] Could not read Google prices:', err.message);
      return unavailable(err.message);
    }
  },

  /** Drop the cache — called when credentials or the billing account change. */
  clearCache() {
    cache.clear();
  },
};

module.exports = provider;
module.exports.COMPUTE_SERVICE = COMPUTE_SERVICE;
module.exports.CACHE_TTL_MS = CACHE_TTL_MS;
