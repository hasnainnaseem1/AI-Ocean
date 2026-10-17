/**
 * Tests for AWS Signature Version 4.
 *
 * ── Why the first test is the whole justification for this file existing ──
 *
 * Writing a signer by hand is only defensible if it can be PROVEN right, not
 * believed right. Every mistake in SigV4 — a header out of order, a space not
 * collapsed, `!` escaped the wrong way, one HMAC round missed — surfaces as the
 * same opaque 403 from AWS with no clue which step was wrong.
 *
 * So the anchor is AWS's own published worked example: the IAM ListUsers
 * request, with a known access key, secret, instant and expected signature.
 * The signature is the END of a four-step chain, so reproducing it byte for
 * byte means the canonical request, the string to sign, the key derivation and
 * the final HMAC are all correct. Nothing short of that proves anything.
 *
 * The rest of the tests cover the details that are easy to get wrong in ways
 * that work most of the time — which is worse than failing always.
 *
 * Pure: no network, no clock.
 *
 * Run with:  node --test src/services/aws/__tests__/awsSigner.test.js
 */
const test = require('node:test');
const assert = require('node:assert');

const signer = require('../awsSigner');

/*
 * AWS's documented example, verbatim.
 *   GET https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08
 *   Host: iam.amazonaws.com
 *   Content-Type: application/x-www-form-urlencoded; charset=utf-8
 *   X-Amz-Date: 20150830T123600Z
 */
const AWS_EXAMPLE = {
  method: 'GET',
  path: '/',
  query: { Action: 'ListUsers', Version: '2010-05-08' },
  headers: {
    host: 'iam.amazonaws.com',
    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
  },
  body: '',
  region: 'us-east-1',
  service: 'iam',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  now: '2015-08-30T12:36:00Z',
};

const EXPECTED_CANONICAL_HASH = 'f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59';
const EXPECTED_SIGNATURE = '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7';

/* ── The anchor ──────────────────────────────────────────────────────────── */

test("AWS's own worked example signs to AWS's own published signature", () => {
  const r = signer.sign(AWS_EXAMPLE);
  assert.strictEqual(
    r.signature,
    EXPECTED_SIGNATURE,
    'If this fails, every AWS call this platform makes will come back 403 with no explanation.'
  );
});

test('…and each step of it matches too, so a future failure says WHICH step', () => {
  const r = signer.sign(AWS_EXAMPLE);

  assert.strictEqual(
    r.canonicalRequest,
    [
      'GET',
      '/',
      'Action=ListUsers&Version=2010-05-08',
      'content-type:application/x-www-form-urlencoded; charset=utf-8',
      'host:iam.amazonaws.com',
      'x-amz-date:20150830T123600Z',
      '',
      'content-type;host;x-amz-date',
      signer.EMPTY_PAYLOAD_HASH,
    ].join('\n')
  );

  assert.strictEqual(signer.sha256Hex(r.canonicalRequest), EXPECTED_CANONICAL_HASH);

  assert.strictEqual(
    r.stringToSign,
    [
      'AWS4-HMAC-SHA256',
      '20150830T123600Z',
      '20150830/us-east-1/iam/aws4_request',
      EXPECTED_CANONICAL_HASH,
    ].join('\n')
  );
});

test('the Authorization header carries the scope and signed headers AWS expects', () => {
  const { headers } = signer.sign(AWS_EXAMPLE);
  assert.strictEqual(
    headers.Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, '
      + `SignedHeaders=content-type;host;x-amz-date, Signature=${EXPECTED_SIGNATURE}`
  );
  assert.strictEqual(headers['x-amz-date'], '20150830T123600Z');
});

/* ── The details that work most of the time ──────────────────────────────── */

test('escaping is RFC 3986, not encodeURIComponent', () => {
  // `encodeURIComponent` leaves these five alone and AWS requires them
  // escaped. A filter expression with a parenthesis in it is the request that
  // would otherwise 403 while everything else kept working.
  assert.strictEqual(signer.uriEscape("!'()*"), '%21%27%28%29%2A');
  assert.strictEqual(signer.uriEscape('a b'), 'a%20b');
  assert.strictEqual(signer.uriEscape('a/b'), 'a%2Fb');
});

test('the path keeps its slashes while each segment is escaped', () => {
  assert.strictEqual(signer.canonicalUri('/'), '/');
  assert.strictEqual(signer.canonicalUri(''), '/');
  assert.strictEqual(signer.canonicalUri('/a b/c'), '/a%20b/c');
});

test('query parameters sort by their ESCAPED name', () => {
  // Sorting the raw names gives a different order whenever escaping changes
  // the ordering — a bug that works until the day it does not.
  const q = signer.canonicalQuery({ b: '2', a: '1', 'a b': '3' });
  assert.strictEqual(q, 'a=1&a%20b=3&b=2');
});

test('a null or undefined query value is dropped, not signed as "undefined"', () => {
  assert.strictEqual(signer.canonicalQuery({ a: '1', b: undefined, c: null }), 'a=1');
  assert.strictEqual(signer.canonicalQuery({}), '');
  assert.strictEqual(signer.canonicalQuery(null), '');
});

test('headers are lowercased, trimmed, sorted, and inner whitespace collapsed', () => {
  // The collapsing is the easy one to miss: AWS folds runs of spaces inside a
  // value down to one before signing.
  const { canonical, signed } = signer.canonicalHeaders({
    'X-B': '  two   spaces  ',
    'x-a': 'one',
  });
  assert.strictEqual(canonical, 'x-a:one\nx-b:two spaces\n');
  assert.strictEqual(signed, 'x-a;x-b');
});

test('a body changes the payload hash, and an empty body uses the known constant', () => {
  const withBody = signer.sign({ ...AWS_EXAMPLE, body: 'Action=RunInstances' });
  const without = signer.sign(AWS_EXAMPLE);
  assert.notStrictEqual(withBody.signature, without.signature);
  assert.ok(without.canonicalRequest.endsWith(signer.EMPTY_PAYLOAD_HASH));
  assert.strictEqual(
    signer.EMPTY_PAYLOAD_HASH,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test('a session token is signed, not merely sent alongside', () => {
  // AWS rejects a signature computed without it, even though the token travels
  // in its own header — so it has to be in the signed set.
  const r = signer.sign({ ...AWS_EXAMPLE, sessionToken: 'TOKEN' });
  assert.ok(r.canonicalRequest.includes('x-amz-security-token:TOKEN'));
  assert.ok(r.headers.Authorization.includes('x-amz-security-token'));
  assert.strictEqual(r.headers['x-amz-security-token'], 'TOKEN');
});

/* ── Properties that must hold for any input ─────────────────────────────── */

test('the same request at the same instant signs identically every time', () => {
  assert.strictEqual(signer.sign(AWS_EXAMPLE).signature, signer.sign(AWS_EXAMPLE).signature);
});

test('changing any one input changes the signature', () => {
  const base = signer.sign(AWS_EXAMPLE).signature;
  const variants = [
    { ...AWS_EXAMPLE, method: 'POST' },
    { ...AWS_EXAMPLE, path: '/other' },
    { ...AWS_EXAMPLE, region: 'eu-west-1' },
    { ...AWS_EXAMPLE, service: 'ec2' },
    { ...AWS_EXAMPLE, secretAccessKey: 'other' },
    { ...AWS_EXAMPLE, now: '2015-08-30T12:36:01Z' },
    { ...AWS_EXAMPLE, query: { Action: 'ListRoles', Version: '2010-05-08' } },
  ];
  for (const v of variants) {
    assert.notStrictEqual(signer.sign(v).signature, base);
  }
});

test('the access key ID identifies but does not authenticate', () => {
  /*
   * Deliberately NOT in the list above, and worth stating rather than leaving
   * as a surprise: the key ID never enters the string to sign or the signing
   * key. It appears only in `Credential=`, telling AWS *which* secret to check
   * the signature against. The secret is what actually signs.
   *
   * So two requests from different key IDs with the same secret sign
   * identically — which is correct, and is the kind of thing someone would
   * otherwise "fix".
   */
  const a = signer.sign({ ...AWS_EXAMPLE, accessKeyId: 'AKIDEXAMPLE' });
  const b = signer.sign({ ...AWS_EXAMPLE, accessKeyId: 'AKIDOTHER' });

  assert.strictEqual(a.signature, b.signature, 'the key ID must not affect the signature');
  assert.notStrictEqual(a.headers.Authorization, b.headers.Authorization);
  assert.ok(b.headers.Authorization.includes('Credential=AKIDOTHER/'));
});

test('the date is formatted the two ways AWS wants', () => {
  const { full, short } = signer.amzDate('2015-08-30T12:36:00Z');
  assert.strictEqual(full, '20150830T123600Z');
  assert.strictEqual(short, '20150830');
});

test('the signing key is derived in four rounds, scope component by scope component', () => {
  // Checked by value rather than by reimplementing the rounds, so this test
  // would catch a round being dropped or reordered.
  const key = signer.signingKey({
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    dateStamp: '20150830',
    region: 'us-east-1',
    service: 'iam',
  });
  assert.strictEqual(key.length, 32); // HMAC-SHA256 output
  assert.strictEqual(
    key.toString('hex'),
    'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9'
  );
});
