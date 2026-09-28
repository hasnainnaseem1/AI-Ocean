/**
 * Where the visitor is, as an ISO 3166-1 alpha-2 code — or null when we cannot
 * honestly say.
 *
 * ── Today this always returns null, and that is correct ──
 *
 * There is no country signal anywhere in this stack. The backend has no
 * `cf-ipcountry` or `cloudfront-viewer-country` header to read because nothing
 * sits in front of it; there is no geoip dependency; there is no `country`
 * column. `utils/helpers/ipHelper.js` exists server-side but only feeds
 * activity logging, and `trust proxy` is not set, so `req.ip` behind any proxy
 * would be the proxy's own address.
 *
 * Guessing from `navigator.language` was considered and rejected: it is the
 * language the *browser* was installed in, not where the person is, and it is
 * English on the majority of machines sold worldwide. Using it would make the
 * prompt both wrong and rare, which is the worst of both.
 *
 * So the first-run prompt never fires. Everything downstream of this function
 * — the prompt itself, the country→language map, the trigger rules, the admin
 * switch — is built and reachable, waiting on this one answer.
 *
 * ── The day a country signal exists ──
 *
 * Only this file and one backend line change. Nothing in the modal, the map,
 * the context or the endpoint needs touching:
 *
 *   1. Behind a CDN: add `geo: { country: req.get('cf-ipcountry') || null }` to
 *      the `site` payload in `backend/src/routes/v1/public/marketing.routes.js`,
 *      then return `siteConfig.geo.country` from here.
 *   2. With a geoip library instead: set `app.set('trust proxy', 1)` in
 *      `backend/src/app.js` FIRST. It is not set today, so without it every
 *      lookup resolves to the datacentre rather than the customer. That is the
 *      trap on that day.
 *   3. Turn on "Ask new customers to pick a language" in
 *      Admin Center → Settings → Languages.
 *
 * To see the prompt while developing, return a code such as 'PK' here.
 *
 * @param {Object} [siteConfig] the payload from /api/v1/public/site, which is
 *   where a CDN-provided country would arrive.
 * @returns {Promise<string|null>}
 */
// eslint-disable-next-line no-unused-vars
export const detectCountry = async (siteConfig) => null;

export default detectCountry;
