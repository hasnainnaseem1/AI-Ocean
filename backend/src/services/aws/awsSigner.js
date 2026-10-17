/**
 * AWS Signature Version 4.
 *
 * ── Why this is written out rather than installed ──
 *
 * The obvious alternative is `@aws-sdk/client-ec2`. It was not chosen for the
 * same reason `@google-cloud/compute` was not: this backend has sixteen
 * dependencies, it already talks to Google over plain `fetch` with a small
 * auth layer, and the EC2 calls this platform makes are four verbs against one
 * endpoint. Pulling a modular SDK and its transitive tree in for that is a lot
 * of surface for a little convenience.
 *
 * That trade is only defensible because SigV4 is **verifiable**: AWS publishes
 * a worked example with a known-good signature, and `awsSigner.test.js` checks
 * this implementation against it. A hand-rolled signer that is merely *believed*
 * correct would be the wrong call — every mistake in here surfaces as an opaque
 * 403 with no hint which of the four steps was wrong.
 *
 * ── The four steps, which is all this file is ──
 *
 *   1. Canonical request — the request rewritten in one exact agreed form
 *   2. String to sign    — a hash of that, plus when and where
 *   3. Signing key       — the secret, beaten through HMAC four times
 *   4. Signature         — HMAC of (3) over (2)
 *
 * Every byte matters: a header out of order, a space not trimmed, an escape
 * done the wrong way, and the whole thing fails identically.
 *
 * Pure: no network, no clock of its own (the caller passes the instant), no
 * database.
 */
const crypto = require('crypto');

const ALGORITHM = 'AWS4-HMAC-SHA256';

const sha256Hex = (data) => crypto.createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

/** SHA-256 of an empty body, which AWS's own examples use as a literal. */
const EMPTY_PAYLOAD_HASH = sha256Hex('');

/**
 * RFC 3986 escaping, which is NOT what `encodeURIComponent` does.
 *
 * `encodeURIComponent` leaves `!'()*` alone; AWS requires them escaped. Getting
 * this wrong only shows up on the requests that happen to contain one of those
 * five characters — so most things work, and a filter expression with a
 * parenthesis in it mysteriously 403s.
 */
const uriEscape = (value) =>
  encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );

/**
 * The path, escaped segment by segment.
 *
 * The slashes separating segments must stay slashes, which is why this cannot
 * just escape the whole string. EC2's query API only ever uses "/", but the
 * signer is written for the general case so it is not quietly wrong the first
 * time something else uses it.
 */
const canonicalUri = (path) => {
  const p = String(path || '/');
  if (p === '/' || p === '') return '/';
  return p.split('/').map(uriEscape).join('/');
};

/**
 * Query parameters sorted and escaped.
 *
 * Sorted by the ESCAPED name, byte by byte, because that is what AWS compares
 * against — sorting the raw names gives a different order whenever escaping
 * changes the ordering, which is exactly the kind of bug that works until it
 * does not.
 */
const canonicalQuery = (params) => {
  const entries = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [uriEscape(k), uriEscape(v)]);

  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
};

/**
 * Headers lowercased, trimmed, sorted — and their inner whitespace collapsed.
 *
 * That last part is easy to miss: AWS folds runs of spaces inside a header
 * value down to one before signing, so a value with two spaces in it signs as
 * if it had one.
 */
const canonicalHeaders = (headers) => {
  const normalised = Object.entries(headers || {})
    .map(([k, v]) => [String(k).toLowerCase().trim(), String(v).trim().replace(/\s+/g, ' ')])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  return {
    canonical: normalised.map(([k, v]) => `${k}:${v}\n`).join(''),
    signed: normalised.map(([k]) => k).join(';'),
  };
};

/** `20150830T123600Z` and `20150830` — the two forms AWS wants. */
const amzDate = (date) => {
  const iso = new Date(date).toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { full: iso, short: iso.slice(0, 8) };
};

/**
 * Step 1: the canonical request.
 *
 * Exported so the test can check it on its own — when a signature does not
 * match, knowing whether step 1 was already wrong is the difference between a
 * minute and an afternoon.
 */
const buildCanonicalRequest = ({ method, path, query, headers, payloadHash }) => {
  const { canonical, signed } = canonicalHeaders(headers);
  return {
    request: [
      String(method).toUpperCase(),
      canonicalUri(path),
      canonicalQuery(query),
      canonical,
      signed,
      payloadHash,
    ].join('\n'),
    signedHeaders: signed,
  };
};

/** Step 3: the secret, beaten through HMAC once per scope component. */
const signingKey = ({ secretAccessKey, dateStamp, region, service }) => {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
};

/**
 * Sign a request, returning the headers to send with it.
 *
 * @param {object} input
 * @param {string} input.method
 * @param {string} input.path            usually "/" for the EC2 query API
 * @param {object} [input.query]
 * @param {object} input.headers         must include `host`
 * @param {string} [input.body]          the raw body, for the payload hash
 * @param {string} input.region
 * @param {string} input.service         "ec2", "pricing", …
 * @param {string} input.accessKeyId
 * @param {string} input.secretAccessKey
 * @param {string} [input.sessionToken]  for temporary credentials
 * @param {Date|string} [input.now]      the signing instant. Passed in rather
 *   than read here so the test can pin it — and so a caller signing several
 *   requests at once cannot have them drift across a second boundary.
 *
 * @returns {{headers: object, canonicalRequest: string, stringToSign: string,
 *   signature: string}}
 */
const sign = (input) => {
  const {
    method, path = '/', query = {}, headers = {}, body = '',
    region, service, accessKeyId, secretAccessKey, sessionToken,
    now = new Date(),
  } = input;

  const { full, short } = amzDate(now);
  const payloadHash = body ? sha256Hex(body) : EMPTY_PAYLOAD_HASH;

  /*
   * `x-amz-date` is signed rather than `date`, and the session token has to be
   * in the signed set too when present — AWS rejects a signature computed
   * without it even though the token is carried in its own header.
   */
  const allHeaders = {
    ...headers,
    'x-amz-date': full,
    ...(sessionToken ? { 'x-amz-security-token': sessionToken } : {}),
  };

  const { request: canonicalRequest, signedHeaders } = buildCanonicalRequest({
    method, path, query, headers: allHeaders, payloadHash,
  });

  const scope = `${short}/${region}/${service}/aws4_request`;

  const stringToSign = [
    ALGORITHM,
    full,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = crypto
    .createHmac('sha256', signingKey({ secretAccessKey, dateStamp: short, region, service }))
    .update(stringToSign, 'utf8')
    .digest('hex');

  return {
    headers: {
      ...allHeaders,
      Authorization: `${ALGORITHM} Credential=${accessKeyId}/${scope}, `
        + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
    signature,
  };
};

module.exports = {
  ALGORITHM,
  EMPTY_PAYLOAD_HASH,
  sha256Hex,
  uriEscape,
  canonicalUri,
  canonicalQuery,
  canonicalHeaders,
  amzDate,
  buildCanonicalRequest,
  signingKey,
  sign,
};
