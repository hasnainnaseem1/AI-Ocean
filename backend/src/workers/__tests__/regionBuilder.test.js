/**
 * The separation between the platform's key and the build key.
 *
 * ── What is actually being protected ──
 *
 * The build credential can create a VPC's network ACLs, and on AWS that
 * unavoidably means it can rewrite them. One word changed in one rule and
 * every customer machine in a region can reach every other, with nothing else
 * about the account changing.
 *
 * That risk is acceptable ONLY because the key lives in a different process,
 * under a different OS user, and the API process has no way to obtain it. The
 * moment that stops being true — a convenient fallback to the runtime's key, a
 * read from the database, the key echoed into a log — the platform's hardest
 * promise goes from "provable" to "hoped for", and nothing visible changes.
 *
 * These are tripwires on exactly that. They fail when somebody makes the
 * separation convenient.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');

const worker = require('../regionBuilder');

/** The worker's source, comments stripped — its header argues for the very
 *  things the tripwires search for, so raw text would match the argument. */
const code = () => require('fs')
  .readFileSync(require.resolve('../regionBuilder.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('where the build credential may come from', () => {
  const ENV = ['AIOCEAN_BUILD_AWS_ACCESS_KEY_ID', 'AIOCEAN_BUILD_AWS_SECRET_ACCESS_KEY'];

  test('its own environment, and nowhere else', () => {
    const saved = ENV.map((k) => process.env[k]);
    try {
      for (const k of ENV) delete process.env[k];
      const verdict = worker.buildCredential();

      assert.equal(verdict.ok, false, 'with no env set there must be no credential');
      assert.match(verdict.message, /environment/i);
    } finally {
      ENV.forEach((k, i) => { if (saved[i] !== undefined) process.env[k] = saved[i]; });
    }
  });

  test('a missing key is refused, never substituted', () => {
    /*
     * The dangerous convenience: falling back to the platform's own AWS key
     * when the build key is absent. It would make the worker "just work" and
     * would hand network-admin rights to the credential that is supposed to
     * only start and stop machines.
     */
    const src = code();
    assert.ok(
      !/AWS_ACCESS_KEY_ID\s*\|\|/.test(src),
      'no fallback from the build credential to anything else',
    );
    assert.ok(
      !/awsSettings\.(accessKeyId|secretAccessKey)/.test(src),
      'the build worker must never read the platform\'s stored AWS credential',
    );
    assert.ok(
      !/secretAccessKeyEncrypted/.test(src),
      'the build worker must not decrypt the platform\'s key',
    );
  });

  test('half a credential is no credential', () => {
    const saved = ENV.map((k) => process.env[k]);
    try {
      process.env[ENV[0]] = 'AKIAEXAMPLE';
      delete process.env[ENV[1]];
      assert.equal(worker.buildCredential().ok, false, 'an id with no secret must be refused');
    } finally {
      ENV.forEach((k, i) => {
        if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i];
      });
    }
  });
});

describe('how the credential is handed to terragrunt', () => {
  test('through the child process environment, not the command line', () => {
    /*
     * An argument is visible in the process list to every user on the machine,
     * which would undo the separation on a shared host.
     */
    const src = code();
    assert.ok(!/--aws-access-key|-var[= ]['"]?aws_secret/.test(src));
    assert.match(src, /AWS_ACCESS_KEY_ID:\s*cred\.id/);
  });

  test('and never written to a file', () => {
    const src = code();
    assert.ok(
      !/writeFile[\s\S]{0,200}(cred|SECRET|secret)/.test(src),
      'a credential on disk outlives the process that needed it',
    );
  });

  test('shell interpolation is off', () => {
    // `shell: true` would put the environment through a command interpreter,
    // where a region name becomes an injection point.
    assert.ok(!/shell:\s*true/.test(code()));
    assert.match(code(), /shell:\s*false/);
  });

  test('the secret is never logged', () => {
    const src = code();
    assert.ok(!/log\([^)]*cred\.secret/.test(src));
    assert.ok(!/console\.\w+\([^)]*SECRET_ACCESS_KEY/.test(src));
    // The id is logged truncated, so an operator can tell WHICH key is loaded
    // without the log becoming a place the key can be read from.
    assert.match(src, /cred\.id\.slice\(0,\s*4\)/);
  });
});

describe('what a build is allowed to conclude', () => {
  test('isolation is verified BEFORE a region is published', () => {
    /*
     * Order matters more than presence here. Publishing first and verifying
     * second leaves a window in which the region is sellable and unverified —
     * which is exactly the state a broken apply produces.
     */
    const src = code();
    const verifyAt = src.indexOf('isolationCheck.verify');
    const publishAt = src.indexOf('await publish(');

    assert.ok(verifyAt > 0, 'the build must verify isolation');
    assert.ok(publishAt > 0, 'the build must publish');
    assert.ok(verifyAt < publishAt, 'verification must come before publication');
  });

  test('a failed check takes the region out of service', () => {
    const src = code();
    const idx = src.indexOf('isolationCheck.verify');
    const after = src.slice(idx, idx + 900);

    assert.match(after, /markFailed/, 'a region that failed the check must not stay buildable');
    assert.ok(!/sync\(\)/.test(after.split('markFailed')[0]), 'and must not be concluded built');
  });

  test('"built" is concluded from the saved ids, not from the apply', () => {
    /*
     * An apply can exit 0 while the transcription into settings is missing or
     * malformed. The only test that matches what a launch does is reading the
     * ids back, which is what `sync` does.
     */
    assert.match(code(), /regionDemand\.sync\(\)/);
    assert.ok(!/buildState:\s*['"]built['"]/.test(code()), 'nothing may assert built directly');
  });

  test('a customer order builds a region without anyone pressing a button', () => {
    /*
     * Making a paying customer wait on somebody noticing a screen is not a
     * wait, it is an abandoned order. So `wanted` — a held order — builds.
     */
    const src = code();
    assert.match(src, /buildState === 'building'/);
    // Written against the behaviour rather than one spelling: `wanted` was a
    // bare comparison until `failed` joined it in a list, and a test pinned to
    // the old shape fails on a change that is entirely correct.
    assert.match(src, /'wanted'/);
    assert.match(src, /waitingDeployments > 0/);
  });

  test('a region whose apply failed is tried again', () => {
    /*
     * ── The bug this is about ──
     *
     * The due-list matched `building` and `wanted` only. One failed apply put
     * a region into `failed` and the worker never looked at it again — so
     * after the cause was fixed (a colliding versions.tf, in the case that
     * found this), the customer's order stayed held forever while the worker
     * ran beside it printing nothing. Silence that reads exactly like
     * "nothing to do".
     *
     * Terraform converges on a re-run, so retrying is cheap and cannot
     * duplicate what exists. The money guard is untouched: `sellsRegion`
     * still has to pass.
     */
    const src = code();
    assert.match(src, /\['wanted', 'failed'\]\.includes\(r\.buildState\)/);
  });

  test('but only into a region the platform actually sells', () => {
    /*
     * The one check between a customer's order and a standing monthly charge.
     *
     * A sellable tier in a region means an admin recorded that region's cost
     * (without which `ensureCosted` refuses to create a tier there at all) and
     * then chose to offer a machine at a price carrying it. That is the
     * approval. A region with orders but nothing sold in it earns nothing and
     * still costs ~$65/month.
     */
    const src = code();
    assert.match(src, /sellsRegion/);
    assert.match(src, /status:\s*'sellable'/);
    assert.match(src, /isActive:\s*true/);
  });

  test('the sold check asks about the cloud being built, not a fixed one', () => {
    /*
     * ── The bug this is about ──
     *
     * This query had `cloud: 'aws'` written into it. A worker running in GCP
     * mode therefore counted AWS's price rows for a Google region, found
     * none, and refused to build — every twenty seconds, for over two hours,
     * while a paying customer's order sat held and nothing appeared in GCP.
     *
     * The log line it printed was true and useless: "no tier is sold there".
     * Something WAS sold there; the query just asked about the wrong cloud.
     * A worker that can build either cloud must never name one.
     */
    const src = code();
    const at = src.indexOf('const sellsRegion');
    const body = src.slice(at, src.indexOf('};', at));

    assert.ok(
      !/cloud:\s*'(aws|gcp)'/.test(body),
      'sellsRegion must not hardcode a cloud — it is called for both',
    );
    assert.match(body, /cloud,/, 'it takes the cloud it is building for');
  });

  test('and it matches a region under either of its two names', () => {
    /*
     * A `TierPrice` row is keyed by the PLATFORM region (`us-east`); the
     * worker and the demand row speak the provider's name (`us-east4`).
     * Checking one spelling finds nothing and refuses the build.
     */
    const src = code();
    const at = src.indexOf('const sellsRegion');
    const body = src.slice(at, src.indexOf('};', at));

    assert.match(body, /platformRegion/);
    assert.match(body, /region: \{ in: names \}/);
  });

  test('and the sold check fails closed', () => {
    /*
     * If the question cannot be answered — the database is unreachable mid
     * pass — the answer must be "do not build". An error swallowed into a
     * truthy default starts a monthly charge nobody approved.
     */
    const src = code();
    const at = src.indexOf('const sellsRegion');
    const body = src.slice(at, src.indexOf('};', at));

    assert.match(body, /catch/);
    assert.match(body, /return 0/, 'a failed check must count as nothing sold');
  });
});

describe('the worker cannot quietly become part of the API', () => {
  test('it is not required by anything the API loads', () => {
    /*
     * The separation is a process boundary. A `require` from inside the API
     * would pull this code — and anything it is given — back into the process
     * the whole design keeps it out of.
     */
    const { execSync } = require('child_process');
    const root = require('path').resolve(__dirname, '../..');

    let hits = '';
    try {
      hits = execSync(
        'git grep -n "workers/regionBuilder" -- "src/**/*.js" ":!src/workers/**"',
        { cwd: require('path').resolve(root, '..'), encoding: 'utf8' },
      );
    } catch {
      // git grep exits non-zero when nothing matches, which is the pass case.
    }

    assert.equal(hits.trim(), '', `the API must not require the build worker:\n${hits}`);
  });
});
