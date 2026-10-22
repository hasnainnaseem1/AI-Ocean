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

/**
 * One cache entry for the whole catalogue, not one per machine type.
 *
 * `fetchSkus` downloads Google's **entire** Compute Engine catalogue — every
 * region, every machine family, in one paged call — because the v1 list method
 * has no server-side filter worth using. Every region's prices are therefore
 * already inside the response.
 *
 * The cache was keyed by `(region, family)`, which meant that one download was
 * repeated for each key: three regions times five families is fifteen full
 * catalogue downloads an hour, all of them returning the same bytes. Keyed
 * once, the first caller pays for the download and every other region, family
 * and the region-cost lookup parse from the same copy.
 *
 * The billing account is part of the key because a SKU list fetched against an
 * account carries that account's negotiated prices, which must never be served
 * to a platform reading public list prices.
 */
const skuCacheKey = (billingAccountId) => `skus::${billingAccountId || 'list'}`;

/**
 * Every Compute SKU, paged.
 *
 * The catalogue has no server-side filter worth using — the v1 list method
 * returns the service's whole catalogue — so the filtering is ours, in the
 * parser, where it can be tested.
 */
/**
 * How many times one page of the catalogue is tried before giving up.
 *
 * Four, not two, because the observed failure is not a one-off: calling this
 * API repeatedly from one machine produced runs where ten consecutive
 * attempts were reset at the ten-second mark, followed a minute later by
 * calls that succeeded in two seconds. Whatever sits between here and Google
 * — a proxy, a firewall, a carrier — drops the connection in bursts, and a
 * burst outlasts a single retry.
 */
const FETCH_ATTEMPTS = 4;

/**
 * Base gap between those attempts, multiplied by the attempt number.
 *
 * Two seconds, so four attempts span roughly twelve — long enough to outlive
 * the bursts seen in practice. Linear rather than exponential: the fault is a
 * dropped connection, not a server asking to be left alone, and somebody may
 * be waiting on this read.
 */
const FETCH_RETRY_MS = 2000;

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

    /*
     * Retried, because one dropped connection used to cost the whole catalogue.
     *
     * This walks seven pages of roughly five thousand SKUs each. A single
     * TCP reset on any one of them threw, and the throw discarded every page
     * already downloaded — so the next caller started from page one and had
     * the same chance of failing again. In practice that left whole regions
     * `unpriced` while single small calls to the same API succeeded every
     * time: the failure scaled with how much was being transferred, not with
     * whether the credential worked.
     *
     * Only the transport is retried. An HTTP error is the server's considered
     * answer — 403 means the API is off, 404 means the billing account is
     * wrong — and repeating the request cannot change it.
     */
    let res;
    let lastErr = null;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(timeoutMs),
        });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt === FETCH_ATTEMPTS) break;
        console.warn(
          `[GcpPricing] page ${pages + 1} attempt ${attempt} failed (${err.message}); retrying`
        );
        // Linear, not exponential: the fault here is a dropped connection, not
        // a server asking to be left alone, and the whole read is on a path a
        // human may be waiting on.
        await new Promise((r) => setTimeout(r, FETCH_RETRY_MS * attempt));
      }
    }

    if (lastErr) {
      const err = new Error(
        `Google's price catalogue could not be read after ${FETCH_ATTEMPTS} attempts `
        + `(page ${pages + 1}): ${lastErr.message}`
      );
      err.cause = lastErr;
      throw err;
    }

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
  /**
   * The catalogue, from cache when it is warm.
   *
   * Shared by every price lookup on this provider, so a refresh that prices
   * twenty tiers across three regions downloads Google's catalogue once rather
   * than sixty times.
   *
   * @returns {{ok, skus, source, at, reason}}
   */
  async _skus({ force = false } = {}) {
    const adminSettingsService = require('../../admin/adminSettingsService');
    const settings = await adminSettingsService.getSettings();
    const gcp = settings?.gcpSettings || {};
    if (!gcp.enabled) return { ok: false, reason: 'Google Cloud is switched off.' };

    const billingAccountId = String(gcp.billingAccountId || '').trim();
    const key = skuCacheKey(billingAccountId);

    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ok: true, skus: hit.skus, source: hit.source, at: hit.at, cached: true };
    }

    const gcpClient = require('../../gcp/gcpClient');
    const token = await gcpClient.accessTokenFor(SCOPES);
    if (!token) {
      return { ok: false, reason: 'No Google Cloud credential is stored, so prices cannot be read.' };
    }

    const timeoutMs = Math.max(5, Number(gcp.requestTimeoutSeconds) || 30) * 1000;

    /*
     * ── A failed refresh falls back to the last catalogue we got ──
     *
     * This downloads roughly 33,000 SKUs across several pages. On a flaky
     * link that is minutes of transfer with many chances to be reset, and the
     * resets come in bursts: ten consecutive attempts failed here, then calls
     * a minute later succeeded in two seconds.
     *
     * Without this, such a burst made the platform act as though it had no
     * prices at all — which is a refusal, because an unknown cost must never
     * become a guess. Correct, and the wrong outcome: a customer's order was
     * held over a network blip while a perfectly good catalogue sat in memory,
     * minutes old.
     *
     * So an expired entry is kept rather than discarded, and used when the
     * refresh fails. Google's published prices change on the order of months;
     * a catalogue a few hours stale is a far better answer than none. What is
     * NOT done is inventing a price — if there has never been a successful
     * read, this still refuses.
     */
    let skus;
    try {
      skus = await fetchSkus({ token, billingAccountId, timeoutMs });
    } catch (err) {
      if (hit?.skus?.length) {
        const ageMinutes = Math.round((Date.now() - hit.at) / 60000);
        console.warn(
          `[GcpPricing] Could not refresh the catalogue (${err.message}); using the copy from `
          + `${ageMinutes} minute(s) ago. Prices are stale, not missing.`
        );
        return { ok: true, skus: hit.skus, source: hit.source, at: hit.at, cached: true, stale: true };
      }
      throw err;
    }

    if (!skus.length) {
      if (hit?.skus?.length) {
        return { ok: true, skus: hit.skus, source: hit.source, at: hit.at, cached: true, stale: true };
      }
      return { ok: false, reason: 'Google returned no SKUs for Compute Engine.' };
    }

    const source = billingAccountId ? 'gcp:account' : 'gcp:list';
    const at = Date.now();
    cache.set(key, { skus, at, source });

    return { ok: true, skus, source, at, cached: false };
  },

  async fetchRates({ region, machineType, force = false }) {
    const unavailable = (reason) => ({
      ok: false, rates: null, source: 'gcp', fetchedAt: null, notes: [], reason,
    });

    if (!region || !machineType) return unavailable('A region and a machine type are required.');

    try {
      const got = await this._skus({ force });
      if (!got.ok) return unavailable(got.reason);

      /*
       * Parsed on every call rather than stored parsed: the expensive part is
       * the download, and parsing per call is what lets one copy of the
       * catalogue answer for every region and machine type.
       */
      const { rates, notes } = ratesFromSkus(got.skus, { region, machineType });
      return {
        ok: true,
        rates,
        source: got.source,
        fetchedAt: new Date(got.at),
        notes,
        cached: !!got.cached,
      };
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

  /**
   * What this region costs per hour before a customer machine runs in it.
   *
   * ── Why Google's figure is so much smaller than AWS's ──
   *
   * Google bills Cloud NAT by the VM attached to it rather than by the
   * gateway, so a region nobody is using costs almost nothing: only the NAT's
   * own address stands, and the rest arrives with each machine. On AWS a
   * gateway is charged per availability zone whether anything uses it or not.
   *
   * The two halves come back separately because they behave differently — see
   * `services/cloud/regionCost.js`.
   *
   * @param {object} opts
   * @param {string} opts.region  a GCP region, e.g. "europe-west4"
   */
  async fetchRegionFixedCost({ region, force = false }) {
    const unavailable = (reason) => ({
      ok: false,
      fixedCostPerHour: null,
      perMachineCostPerHour: null,
      source: 'gcp',
      fetchedAt: null,
      notes: [],
      reason,
    });

    if (!region) return unavailable('A region is required.');

    try {
      // The same catalogue the machine prices come from — no second download.
      const got = await this._skus({ force });
      if (!got.ok) return unavailable(got.reason);

      const { regionFixedCostFromSkus } = require('./gcpSkuParser');
      const parsed = regionFixedCostFromSkus(got.skus, { region });
      if (!parsed.ok) return unavailable(parsed.reason);

      return {
        ok: true,
        fixedCostPerHour: parsed.fixedCostPerHour,
        perMachineCostPerHour: parsed.perMachineCostPerHour,
        source: got.source,
        fetchedAt: new Date(got.at),
        notes: parsed.notes,
        cached: !!got.cached,
      };
    } catch (err) {
      console.error('[CloudPricing] Could not read Google region cost:', err.message);
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
