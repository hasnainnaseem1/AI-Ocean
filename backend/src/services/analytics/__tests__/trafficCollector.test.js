/**
 * The collector's pure decisions, tested without a database.
 *
 * These are the privacy-critical ones. Every assertion here is a promise the
 * platform makes to the people it measures, and a regression in any of them
 * would be silent: the collector would carry on returning 204 while writing
 * something it should not have.
 */
const test = require('node:test');
const assert = require('node:assert');

const collector = require('../trafficCollector');
const { DEFAULT_ANALYTICS_POLICY } = require('../analyticsPolicyDefaults');

const SETTINGS = {
  strippedQueryKeys: ['token', 'invite', 'code', 'key', 'signature', 'email', 'password', 'reset'],
};

/* ── The URL promise ──────────────────────────────────────────────────── */

test('a sensitive query key is removed, not blanked or hashed', () => {
  const { path } = collector.cleanPath('/invite/accept?token=abc123&ref=newsletter', SETTINGS);
  assert.ok(!path.includes('abc123'), 'the value is gone');
  assert.ok(!path.includes('token'), 'and so is the key');
  assert.match(path, /ref=newsletter/, 'the harmless parameter survives');
});

test('the strip list matches keys that CONTAIN a listed word', () => {
  // `reset_token`, `inviteCode`, `user_email` — the real shapes these take.
  const { path } = collector.cleanPath(
    '/x?reset_token=a&inviteCode=b&user_email=c@d.com&page=2', SETTINGS,
  );
  assert.strictEqual(path, '/x?page=2');
});

test('the fragment is never kept — a client router can leave a token there', () => {
  const { path } = collector.cleanPath('/reset#token=secret', SETTINGS);
  assert.strictEqual(path, '/reset');
});

test('a path with no query survives untouched', () => {
  assert.strictEqual(collector.cleanPath('/pricing', SETTINGS).path, '/pricing');
});

test('a path is always rooted, whatever arrives', () => {
  assert.strictEqual(collector.cleanPath('pricing', SETTINGS).path, '/pricing');
});

/* ── The identity promise ─────────────────────────────────────────────── */

test('an IPv4 address keeps its network and loses its host', () => {
  assert.strictEqual(collector.anonymiseIp('203.0.113.47'), '203.0.113.0');
});

test('an IPv6 address is cut to its /64', () => {
  assert.strictEqual(
    collector.anonymiseIp('2001:db8:85a3:8d3:1319:8a2e:370:7348'),
    '2001:db8:85a3:8d3::',
  );
});

test('an IPv4-mapped IPv6 address is treated as IPv4', () => {
  assert.strictEqual(collector.anonymiseIp('::ffff:203.0.113.47'), '203.0.113.0');
});

test('the visitor hash is stable within a day', () => {
  const day = new Date('2026-05-01T09:00:00Z');
  const later = new Date('2026-05-01T23:30:00Z');
  assert.strictEqual(
    collector.visitorHashFor('203.0.113.0', 'UA', day),
    collector.visitorHashFor('203.0.113.0', 'UA', later),
  );
});

test('the visitor hash CHANGES the next day — this is the privacy design', () => {
  const a = collector.visitorHashFor('203.0.113.0', 'UA', new Date('2026-05-01T12:00:00Z'));
  const b = collector.visitorHashFor('203.0.113.0', 'UA', new Date('2026-05-02T12:00:00Z'));
  assert.notStrictEqual(a, b, 'the same person is unlinkable across days');
});

test('the hash reveals nothing about the address it came from', () => {
  const hash = collector.visitorHashFor('203.0.113.0', 'UA', new Date('2026-05-01T12:00:00Z'));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.ok(!hash.includes('203'), 'not reversible by inspection');
});

/* ── Bots ─────────────────────────────────────────────────────────────── */

test('known crawlers and scripting tools are dropped', () => {
  for (const ua of ['Googlebot/2.1', 'curl/8.4.0', 'python-requests/2.31', 'HeadlessChrome/120']) {
    assert.strictEqual(collector.isBot(ua, DEFAULT_ANALYTICS_POLICY), true, ua);
  }
});

test('an empty user agent is treated as a bot', () => {
  // Real browsers always send one; a blank is the cheapest script there is.
  assert.strictEqual(collector.isBot('', DEFAULT_ANALYTICS_POLICY), true);
  assert.strictEqual(collector.isBot(undefined, DEFAULT_ANALYTICS_POLICY), true);
});

test('a real browser is not a bot', () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
  assert.strictEqual(collector.isBot(ua, DEFAULT_ANALYTICS_POLICY), false);
});

/* ── Attribution ──────────────────────────────────────────────────────── */

test('no referrer is direct, not unknown', () => {
  const r = collector.classifySource('', {}, []);
  assert.strictEqual(r.source, 'direct');
  assert.strictEqual(r.medium, 'direct');
});

test('a search engine is organic, not a referral', () => {
  const r = collector.classifySource('www.google.com', {}, []);
  assert.strictEqual(r.medium, 'organic');
  assert.strictEqual(r.source, 'google.com', 'the www. is dropped');
});

test('another site is a referral', () => {
  const r = collector.classifySource('news.ycombinator.com', {}, []);
  assert.strictEqual(r.medium, 'referral');
});

test('our own host is internal navigation, never a self-referral', () => {
  const r = collector.classifySource('app.example.com', {}, ['app.example.com']);
  assert.strictEqual(r.medium, 'internal');
  assert.strictEqual(r.source, 'direct');
});

test('a UTM tag beats the referrer — an explicit tag is not an inference', () => {
  const r = collector.classifySource('news.ycombinator.com', {
    utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'launch',
  }, []);
  assert.strictEqual(r.source, 'newsletter');
  assert.strictEqual(r.medium, 'email');
  assert.strictEqual(r.campaign, 'launch');
});

/* ── User agents ──────────────────────────────────────────────────────── */

test('Edge is not reported as Chrome, and Chrome is not reported as Safari', () => {
  const edge = collector.classifyAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120');
  assert.strictEqual(edge.browser, 'Edge');
  const chrome = collector.classifyAgent('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36');
  assert.strictEqual(chrome.browser, 'Chrome');
  const safari = collector.classifyAgent('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17 Safari/605.1.15');
  assert.strictEqual(safari.browser, 'Safari');
});

test('a phone is mobile and an iPad is a tablet', () => {
  assert.strictEqual(collector.classifyAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148').deviceType, 'mobile');
  assert.strictEqual(collector.classifyAgent('Mozilla/5.0 (iPad; CPU OS 17_0) Safari').deviceType, 'tablet');
  assert.strictEqual(collector.classifyAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/120').deviceType, 'desktop');
});

/* ── Path patterns ────────────────────────────────────────────────────── */

test('high-cardinality paths collapse to the policy pattern', () => {
  assert.strictEqual(
    collector.patternFor('/blog/how-we-built-it', DEFAULT_ANALYTICS_POLICY),
    '/blog/:slug',
  );
  assert.strictEqual(
    collector.patternFor('/invite/abc123token', DEFAULT_ANALYTICS_POLICY),
    '/invite/:token',
  );
});

test('a path with no matching rule keeps itself', () => {
  assert.strictEqual(collector.patternFor('/pricing', DEFAULT_ANALYTICS_POLICY), '/pricing');
});

test('a broken regex in an operator policy does not take the collector down', () => {
  const policy = { traffic: { pathPatternRules: [{ match: '([', pattern: '/x' }] } };
  assert.doesNotThrow(() => collector.patternFor('/anything', policy));
  assert.strictEqual(collector.patternFor('/anything', policy), '/anything');
});

/* ── The switches ─────────────────────────────────────────────────────── */

test('ingest refuses when tracking is off, when the site is off, and on DNT', async () => {
  const payload = { site: 'marketing', events: [{ p: '/' }] };
  const ctx = { ip: '203.0.113.5', userAgent: 'Mozilla/5.0 Chrome/120', selfHosts: [] };

  assert.strictEqual(
    await collector.ingest(payload, ctx, { enableTracking: false }, DEFAULT_ANALYTICS_POLICY),
    'tracking-disabled',
  );
  assert.strictEqual(
    await collector.ingest(payload, ctx,
      { enableTracking: true, trackedSites: { marketing: false } }, DEFAULT_ANALYTICS_POLICY),
    'site-not-tracked',
  );
  assert.strictEqual(
    await collector.ingest(payload, { ...ctx, dnt: '1' },
      { enableTracking: true, respectDoNotTrack: true }, DEFAULT_ANALYTICS_POLICY),
    'do-not-track',
  );
});

test('ingest refuses an unknown site rather than inventing one', async () => {
  const result = await collector.ingest(
    { site: 'wordpress', events: [{ p: '/' }] },
    { ip: '203.0.113.5', userAgent: 'Mozilla/5.0 Chrome/120', selfHosts: [] },
    { enableTracking: true },
    DEFAULT_ANALYTICS_POLICY,
  );
  assert.strictEqual(result, 'unknown-site');
});
