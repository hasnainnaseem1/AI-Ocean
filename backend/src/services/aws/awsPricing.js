/**
 * AWS pricing.
 *
 * Replaces the placeholder that used to live here. Same interface as
 * `gcpPricing.js` — `isConfigured()` and `fetchRates()` — so `cloudPricing`
 * asks both clouds the same question and neither knows about the other.
 *
 * ── What is different from the Google side, and why it is not a workaround ──
 *
 * Google publishes component prices; AWS publishes whole-instance prices. So
 * this returns `instanceHour` where the Google provider returns `vcpuHour` and
 * `ramGbHour`, and `costModel` understands both.
 *
 * The alternative — dividing an instance price by its vCPU count to synthesise
 * a per-core rate — was considered and rejected. It would invent a number AWS
 * never published and then present it to an operator as a fact, and it would
 * be wrong in a way nobody could check: a `g6.xlarge` is not four cores'
 * worth of money plus a GPU's worth, it is one price.
 *
 * ── The API ──
 *
 * The Price List Query API is JSON-over-POST with an `X-Amz-Target` header,
 * not the EC2 query protocol — so it does not go through `awsClient.call`.
 * It lives only in `us-east-1` and `ap-south-1`; `us-east-1` is used because
 * it is the one that always exists.
 *
 * ── Caching ──
 *
 * Prices change on the order of months, and a `GetProducts` call returns a lot
 * of JSON. Fetching that on the path that provisions a customer's machine
 * would add seconds to an order for an answer that did not change, so a
 * successful fetch is held for `CACHE_TTL_MS` keyed by instance type and
 * region.
 *
 * ── What it never does ──
 *
 * It never guesses. An unavailable price comes back `null`, `costModel`
 * refuses to produce a number from it, and `capGuard` treats an unknown cost
 * as a refusal. A pricing engine that invents a figure is worse than one that
 * admits it does not know, because the invented figure is what somebody
 * prices a product against.
 */
const signer = require('./awsSigner');
const { ratesFromPriceList } = require('./awsPriceParser');

/**
 * The Price List API is not regional in the usual sense — it is served from
 * two endpoints only, and `us-east-1` is the one guaranteed to exist.
 */
const PRICING_REGION = 'us-east-1';
const PRICING_HOST = `api.pricing.${PRICING_REGION}.amazonaws.com`;
const TARGET = 'AWSPriceListService.GetProducts';

/** Prices move on the order of months; an hour is cautious. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_PAGES = 10;

const cache = new Map();
const cacheKey = (region, instanceType) => `${region}::${instanceType}`;

/** One GetProducts call, paged. */
const getProducts = async ({ filters, token, accessKeyId, secretAccessKey, timeoutMs }) => {
  const out = [];
  let nextToken;
  let pages = 0;

  do {
    const body = JSON.stringify({
      ServiceCode: 'AmazonEC2',
      Filters: filters,
      MaxResults: 100,
      ...(nextToken ? { NextToken: nextToken } : {}),
    });

    const signed = signer.sign({
      method: 'POST',
      path: '/',
      headers: {
        host: PRICING_HOST,
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': TARGET,
      },
      body,
      region: PRICING_REGION,
      service: 'pricing',
      accessKeyId,
      secretAccessKey,
      sessionToken: token,
      now: new Date(),
    });

    const res = await fetch(`https://${PRICING_HOST}/`, {
      method: 'POST',
      headers: signed.headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`AWS pricing answered ${res.status}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }

    const data = JSON.parse(text);
    if (Array.isArray(data.PriceList)) out.push(...data.PriceList);
    nextToken = data.NextToken;
    pages += 1;
  } while (nextToken && pages < MAX_PAGES);

  return out;
};

/** `TERM_MATCH` is the only filter type the Price List API supports. */
const term = (Field, Value) => ({ Type: 'TERM_MATCH', Field, Value });

const provider = {
  name: 'aws',
  label: 'Amazon Web Services',

  /**
   * Can this provider be asked for prices at all?
   *
   * False on every install before AWS is configured, and in dry run, where
   * there is no credential. Callers fall back to the manually recorded cost
   * table.
   */
  async isConfigured() {
    try {
      const adminSettingsService = require('../admin/adminSettingsService');
      const settings = await adminSettingsService.getSettings();
      const aws = settings?.awsSettings || {};
      return !!(aws.enabled && aws.accessKeyId && aws.secretAccessKeyEncrypted);
    } catch {
      return false;
    }
  },

  /**
   * Rates for one instance type in one region.
   *
   * @param {object} opts
   * @param {string} opts.region       an AWS region, e.g. "eu-west-1"
   * @param {string} opts.machineType  an instance type, e.g. "m6i.xlarge"
   * @param {boolean} [opts.force]     skip the cache
   */
  async fetchRates({ region, machineType, force = false }) {
    const unavailable = (reason) => ({
      ok: false, rates: null, source: 'aws', fetchedAt: null, notes: [], reason,
    });

    if (!region || !machineType) return unavailable('A region and an instance type are required.');

    const key = cacheKey(region, machineType);
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
      const { rates, notes } = ratesFromPriceList(hit.priceList, {
        instanceType: machineType, regionCode: region,
      });
      return { ok: true, rates, source: 'aws', fetchedAt: new Date(hit.at), notes, cached: true };
    }

    try {
      const adminSettingsService = require('../admin/adminSettingsService');
      const cryptoHelper = require('../../utils/helpers/cryptoHelper');

      const settings = await adminSettingsService.getSettings();
      const aws = settings?.awsSettings || {};
      if (!aws.enabled) return unavailable('AWS is switched off.');
      if (!aws.accessKeyId || !aws.secretAccessKeyEncrypted) {
        return unavailable('No AWS credential is stored, so prices cannot be read.');
      }

      const secret = cryptoHelper.decrypt(aws.secretAccessKeyEncrypted);
      if (!secret) return unavailable('The stored AWS secret key could not be decrypted.');

      const timeoutMs = Math.max(5, Number(aws.requestTimeoutSeconds) || 30) * 1000;
      const creds = { accessKeyId: aws.accessKeyId, secretAccessKey: secret, timeoutMs };

      /*
       * Two calls rather than one. Instances and volumes are different product
       * families with different attributes, and a single filter set that
       * matched both would have to be loose enough to also match a great deal
       * of what we do not want.
       *
       * The instance filters are narrow on purpose — see awsPriceParser's
       * header for what each one excludes.
       */
      const [instanceList, volumeList] = await Promise.all([
        getProducts({
          ...creds,
          filters: [
            term('instanceType', machineType),
            term('regionCode', region),
            term('operatingSystem', 'Linux'),
            term('preInstalledSw', 'NA'),
            term('tenancy', 'Shared'),
            term('capacitystatus', 'Used'),
          ],
        }),
        getProducts({
          ...creds,
          filters: [
            term('productFamily', 'Storage'),
            term('regionCode', region),
          ],
        }),
      ]);

      const priceList = [...instanceList, ...volumeList];
      if (!priceList.length) {
        return unavailable(`AWS returned no prices for "${machineType}" in ${region}.`);
      }

      cache.set(key, { priceList, at: Date.now() });

      const { rates, notes } = ratesFromPriceList(priceList, {
        instanceType: machineType, regionCode: region,
      });

      if (rates.instanceHour === null) {
        return unavailable(
          `AWS published no on-demand Linux price for "${machineType}" in ${region}. `
          + 'The instance type may not be offered in that region.'
        );
      }

      return { ok: true, rates, source: 'aws', fetchedAt: new Date(), notes, cached: false };
    } catch (err) {
      /*
       * A pricing failure must never break provisioning. The caller falls back
       * to the manually recorded cost table, and the margin guard refuses when
       * there is no figure there either — which is the safe direction.
       */
      console.error('[CloudPricing] Could not read AWS prices:', err.message);
      return unavailable(err.message);
    }
  },

  clearCache() {
    cache.clear();
  },
};

module.exports = provider;
module.exports.PRICING_REGION = PRICING_REGION;
module.exports.CACHE_TTL_MS = CACHE_TTL_MS;
