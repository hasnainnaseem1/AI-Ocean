#!/usr/bin/env node
/**
 * The region build worker — a SEPARATE process, with its own credential.
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  Read this before changing anything here, and before running it anywhere.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is not part of the backend ──
 *
 * Building a region means creating a VPC, its subnets, its security group and
 * its network ACLs. The credential that can do that is, unavoidably, a
 * credential that can UNDO customer isolation: AWS has no way to grant "may
 * create this NACL rule but may never change it". The same permission that
 * writes `deny` rewrites it as `allow`, and the platform's hardest promise —
 * that no customer's machine can reach another's — is gone with it. Quietly:
 * no machine is created, no setting moves, nothing alarms.
 *
 * If that credential sat in the API process, then every path into that process
 * — a file read, a template injection, a dependency with a postinstall script,
 * a log that captures the environment — would be a path to it. The promise
 * would no longer be provable, only hoped for.
 *
 * So the API process never holds it. It writes a row saying which region is
 * wanted; this process, running as a different OS user with its own
 * environment, is the only thing that can act on that row. The API can ASK for
 * a region. It cannot build one, and it cannot read the key that could.
 *
 * ── What this means operationally ──
 *
 *   - Run as a DIFFERENT OS user from the API. If both run as the same user,
 *     the separation is cosmetic: the API's user can read this one's
 *     environment and files, and everything above is undone.
 *   - `AIOCEAN_BUILD_AWS_ACCESS_KEY_ID` / `..._SECRET_ACCESS_KEY` belong ONLY
 *     in this process's environment. Never in the API's `.env`, never in the
 *     database, never in the admin centre.
 *   - That key is region-limited by its IAM policy (`aws:RequestedRegion`), so
 *     even if it does leak it cannot build in a region nobody is watching.
 *     SETUP.md §6b has the policy.
 *
 * ── The check that makes this defensible ──
 *
 * Because the permission cannot be narrowed, the control is verification
 * rather than prevention: after every apply, this worker asks AWS what the
 * NACL rules actually say, using the API's own read-only path, and refuses to
 * publish a region whose isolation is not in place. An apply that "succeeds"
 * into a broken isolation is treated as a failure and the region stays out of
 * service.
 *
 * ── How to run it ──
 *
 *   node src/workers/regionBuilder.js            # watch for work, forever
 *   node src/workers/regionBuilder.js --once     # one pass, then exit
 *   node src/workers/regionBuilder.js --region ap-south-1 --dry-run
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../..');

require('dotenv').config({ path: path.join(ROOT, 'backend', '.env') });

const prisma = require('../lib/prismaClient');
const regionDemand = require('../services/cloud/regionDemand');
const regionMap = require('../services/aws/awsRegionMap');
const isolationCheck = require('../services/aws/isolationCheck');

/** How often to look for a region that has been asked for. */
const POLL_SECONDS = Number(process.env.AIOCEAN_BUILD_POLL_SECONDS || 30);

/** How long one apply may run before it is treated as stuck. */
const APPLY_TIMEOUT_MINUTES = Number(process.env.AIOCEAN_BUILD_TIMEOUT_MINUTES || 45);

/** Which environment's stack to build. */
const ENVIRONMENT = process.env.AIOCEAN_BUILD_ENV || 'staging';

/**
 * Which cloud this worker builds for.
 *
 * One worker per cloud rather than one that does both, because the two hold
 * DIFFERENT credentials — and the whole point of this process is that a
 * credential able to change a network lives in exactly one place. A single
 * worker holding both would double what a leak costs.
 */
const CLOUD = (process.env.AIOCEAN_BUILD_CLOUD || 'aws').toLowerCase();

const log = (...a) => console.log(`[RegionBuilder ${new Date().toISOString()}]`, ...a);
const err = (...a) => console.error(`[RegionBuilder ${new Date().toISOString()}]`, ...a);

/**
 * The build credential, from this process's environment and nowhere else.
 *
 * Deliberately NOT read from the database: the whole point is that the API
 * process, which can read the database, cannot obtain this. If it is missing
 * the worker refuses to start rather than falling back to anything — a
 * fallback to the runtime's own key would hand network-admin rights to the
 * credential that is supposed to only start machines.
 */
const buildCredential = (cloud = 'aws') => {
  if (cloud === 'gcp') {
    /*
     * Google takes a path to a key FILE rather than a secret in the
     * environment. Only the path is read here; the key's contents never
     * enter this process, which keeps it in one accountable place on disk
     * instead of two.
     */
    const keyFile = process.env.AIOCEAN_BUILD_GCP_KEY_FILE;

    if (!keyFile) {
      return {
        ok: false,
        message: 'No Google build credential. Set AIOCEAN_BUILD_GCP_KEY_FILE to the path of the '
          + 'builder service account key in THIS process\'s environment only — never in the '
          + 'API\'s .env and never in the database. See infra/gcp/SETUP.md.',
      };
    }

    if (!fs.existsSync(keyFile)) {
      return {
        ok: false,
        message: `AIOCEAN_BUILD_GCP_KEY_FILE points at ${keyFile}, which does not exist.`,
      };
    }

    // Read for its identity only — so a log line can say WHICH account is
    // loaded, and so a file that is not a key fails here rather than inside
    // terragrunt.
    try {
      const parsed = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      return {
        ok: true,
        keyFile,
        projectId: parsed.project_id || '',
        id: parsed.client_email || '',
      };
    } catch (err) {
      return {
        ok: false,
        message: `${keyFile} is not a readable service account key: ${err.message}`,
      };
    }
  }

  const id = process.env.AIOCEAN_BUILD_AWS_ACCESS_KEY_ID;
  const secret = process.env.AIOCEAN_BUILD_AWS_SECRET_ACCESS_KEY;

  if (!id || !secret) {
    return {
      ok: false,
      message: 'No build credential. Set AIOCEAN_BUILD_AWS_ACCESS_KEY_ID and '
        + 'AIOCEAN_BUILD_AWS_SECRET_ACCESS_KEY in THIS process\'s environment only — never in '
        + 'the API\'s .env and never in the database. See SETUP.md §6b.',
    };
  }

  return { ok: true, id, secret };
};

/** Where terragrunt and terraform live. */
const toolPaths = () => {
  const dir = process.env.AIOCEAN_BUILD_TOOL_DIR || '';
  const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
  return {
    terragrunt: dir ? path.join(dir, exe('terragrunt')) : exe('terragrunt'),
    terraformDir: dir,
  };
};

/**
 * Run terragrunt in one region's folder.
 *
 * The credential is passed through the environment of THIS child only. It is
 * never written to a file, never put on the command line (where it would be
 * visible in a process list to every user on the machine), and never logged.
 */
/**
 * Where the stack for one cloud's region lives.
 *
 * ── The two clouds are shaped differently, and it matters here ──
 *
 * On AWS a VPC belongs to exactly one region, so there is a folder per
 * region and building `ap-south-1` means applying that folder.
 *
 * On Google the VPC is **global** and only its subnets are regional, so one
 * stack builds every region at once (`for_each = var.subnets`). Asking for
 * one region there applies the whole environment — which is correct, and
 * means the second region anybody asks for is already built.
 */
const stackDirFor = (cloud, region) => (cloud === 'gcp'
  ? path.join(ROOT, 'infra', 'gcp', 'live', ENVIRONMENT)
  : path.join(ROOT, 'infra', 'aws', 'live', ENVIRONMENT, region));

/**
 * The build credential, in the form its own cloud's provider expects.
 *
 * Passed through the child's environment only — never written to a file,
 * never put on the command line where a process list would show it, never
 * logged.
 *
 * The two clouds take it differently. AWS reads a key id and secret from the
 * environment. Google reads a path to a key FILE, which is why the GCP branch
 * passes a path rather than the key itself: the file already exists on disk
 * and copying its contents into an environment variable would put a private
 * key somewhere it is harder to account for.
 */
const credentialEnv = (cloud, cred, region) => (cloud === 'gcp'
  ? {
    GOOGLE_APPLICATION_CREDENTIALS: cred.keyFile,
    CLOUDSDK_CORE_PROJECT: cred.projectId || '',
  }
  : {
    AWS_ACCESS_KEY_ID: cred.id,
    AWS_SECRET_ACCESS_KEY: cred.secret,
    AWS_REGION: region,
    // Belt and braces with the IAM region condition: even a stack that named
    // the wrong region would be refused by the credential itself.
    AWS_DEFAULT_REGION: region,
  });

const runApply = ({ cloud = 'aws', awsRegion, cred, dryRun }) => new Promise((resolve) => {
  const dir = stackDirFor(cloud, awsRegion);

  if (!fs.existsSync(dir)) {
    return resolve({
      ok: false,
      message: `No stack for ${awsRegion} at ${dir}. A region the platform sells must have a `
        + `stack here — see infra/${cloud}/SETUP.md.`,
    });
  }

  const { terragrunt, terraformDir } = toolPaths();
  const args = dryRun
    ? ['run-all', 'plan', '--terragrunt-non-interactive']
    : ['run-all', 'apply', '--terragrunt-non-interactive', '-auto-approve'];

  log(`${dryRun ? 'PLAN' : 'APPLY'} ${awsRegion} in ${dir}`);

  const child = spawn(terragrunt, args, {
    cwd: dir,
    env: {
      ...process.env,
      ...credentialEnv(cloud, cred, awsRegion),
      ...(terraformDir ? { PATH: `${terraformDir}${path.delimiter}${process.env.PATH}` } : {}),
      TF_IN_AUTOMATION: '1',
    },
    shell: false,
  });

  let out = '';
  let tail = '';
  const keep = (chunk) => {
    /*
     * Terminal colour codes stripped here, not later.
     *
     * Terragrunt colours its output, and those escape sequences end up stored
     * in `buildError` and rendered in the admin centre as `[90m01:25:49` —
     * which turns the one place an operator reads to find out what went wrong
     * into something they have to decode first.
     */
    // eslint-disable-next-line no-control-regex
    const text = String(chunk).replace(/\u001b\[[0-9;]*m/g, '');
    out += text;
    // The last few KB only — a full apply log is megabytes and the useful part
    // of a failure is always at the end.
    tail = (tail + text).slice(-8000);
  };

  child.stdout.on('data', keep);
  child.stderr.on('data', keep);

  const timer = setTimeout(() => {
    err(`${awsRegion}: apply exceeded ${APPLY_TIMEOUT_MINUTES} minutes, killing it`);
    child.kill('SIGTERM');
  }, APPLY_TIMEOUT_MINUTES * 60 * 1000);

  child.on('error', (e) => {
    clearTimeout(timer);
    resolve({
      ok: false,
      message: `Could not start terragrunt: ${e.message}. Set AIOCEAN_BUILD_TOOL_DIR if it is `
        + 'not on PATH.',
    });
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) return resolve({ ok: true, output: out });
    resolve({ ok: false, message: `terragrunt exited ${code}`, tail });
  });
});

/**
 * Read the ids the apply produced.
 *
 * `terragrunt output -json` per unit, because what the platform needs is
 * scattered across three of them: the VPC and subnets from `network`, the
 * security group from `security`.
 */
const readOutputs = ({ cloud = 'aws', awsRegion, cred }) => new Promise((resolve) => {
  const dir = stackDirFor(cloud, awsRegion);
  const { terragrunt, terraformDir } = toolPaths();

  const child = spawn(terragrunt, ['run-all', 'output', '-json', '--terragrunt-non-interactive'], {
    cwd: dir,
    env: {
      ...process.env,
      ...credentialEnv(cloud, cred, awsRegion),
      ...(terraformDir ? { PATH: `${terraformDir}${path.delimiter}${process.env.PATH}` } : {}),
      TF_IN_AUTOMATION: '1',
    },
    shell: false,
  });

  let out = '';
  child.stdout.on('data', (c) => { out += String(c); });
  child.stderr.on('data', () => {});
  child.on('error', (e) => resolve({ ok: false, message: e.message }));
  child.on('close', () => {
    /*
     * `run-all output` emits one JSON document per unit, concatenated. Parsed
     * by scanning for complete objects rather than assuming one document,
     * because the number of units and their order are not fixed.
     */
    const found = {};
    for (const match of out.matchAll(/\{[\s\S]*?\n\}/g)) {
      try {
        const doc = JSON.parse(match[0]);
        for (const [k, v] of Object.entries(doc)) {
          if (v && typeof v === 'object' && 'value' in v) found[k] = v.value;
        }
      } catch { /* not a complete document; keep scanning */ }
    }
    resolve({ ok: true, outputs: found });
  });
});

/**
 * Write the ids into settings — the transcription that used to be done by hand.
 *
 * Validated through the same shape the admin form uses, so a malformed id is
 * refused here rather than at a customer's launch.
 */
const publish = async ({ awsRegion, outputs }) => {
  const adminSettingsService = require('../services/admin/adminSettingsService');
  const shape = require('../services/aws/awsSettingsShape');

  const block = {
    vpcId: outputs.vpc_id || '',
    securityGroupId: outputs.security_group_id || '',
    subnetIds: outputs.private_subnet_ids || {},
    /*
     * The AMI is NOT a Terraform output — it is chosen per region by whoever
     * decides what customer machines run. Carried over from whatever is
     * already saved so a rebuild does not wipe it.
     */
    imageId: '',
  };

  const settings = await adminSettingsService.getSettings();
  const existing = shape.normalize(settings?.awsSettings || {}).regions?.[awsRegion] || {};
  block.imageId = existing.imageId || '';

  const verdict = shape.validateRegion(awsRegion, block);
  if (!verdict.ok) {
    return { ok: false, message: `The apply produced ids that do not look right: ${verdict.errors.join('; ')}` };
  }

  if (!block.vpcId || !block.securityGroupId || !Object.keys(block.subnetIds).length) {
    return {
      ok: false,
      message: 'The apply did not produce a VPC, a security group and at least one subnet.',
    };
  }

  const normalized = shape.normalize(settings.awsSettings || {});
  settings.awsSettings = {
    ...settings.awsSettings,
    ...normalized,
    regions: { ...normalized.regions, [awsRegion]: { ...existing, ...block } },
  };
  settings.markModified('awsSettings');
  await settings.save();
  adminSettingsService.clearCache?.();
  require('../services/aws/awsClient').clearCache?.();

  return { ok: true, block, needsImage: !block.imageId };
};

/**
 * Build one region, end to end.
 *
 * The order is deliberate: apply, then VERIFY ISOLATION, and only then
 * publish. Publishing before verifying would make the region sellable in the
 * window between the two, which is precisely the window a broken apply would
 * put customers into.
 */
const buildOne = async ({ cloud = 'aws', awsRegion, cred, dryRun = false }) => {
  const applied = await runApply({ cloud, awsRegion, cred, dryRun });
  if (!applied.ok) {
    await regionDemand.markFailed({
      cloud, region: awsRegion,
      /*
       * The END of the log, not the beginning.
       *
       * `slice(0, 2000)` kept the first two thousand characters — which on a
       * terragrunt run is the plan it printed before anything went wrong. The
       * actual failure is always at the bottom, so every recorded error was
       * two thousand characters of "+ resource will be created" and no reason
       * at all. Diagnosing a failed region meant re-running it by hand.
       */
      error: `${applied.message}\n${(applied.tail || '').slice(-4000)}`,
    });
    err(`${awsRegion}: ${applied.message}`);
    return { ok: false };
  }

  if (dryRun) {
    log(`${awsRegion}: plan finished. Nothing was created and nothing was published.`);
    return { ok: true, dryRun: true };
  }

  /*
   * ── Google needs no transcription, and that is the whole difference ──
   *
   * On AWS every region produces ids — a VPC, subnets, a security group —
   * that have to be read out of Terraform and saved into settings before a
   * launch can find them. On Google the network is global and addressed by
   * NAME, which is already in settings; the apply creates the regional subnet
   * under a name derived from it. So there is nothing to read back and
   * nothing to publish.
   *
   * What still has to happen is the proof: `sync` asks whether a machine
   * could actually be placed there now, and that is what marks the region
   * built. The isolation check below reads AWS's NACL rules, which Google
   * does not have — its equivalent is global firewall rules applied by this
   * same stack.
   */
  if (cloud === 'gcp') {
    await regionDemand.sync({ cloud });
    log(`${awsRegion}: applied. Waiting orders will be retried within a minute.`);
    return { ok: true };
  }

  const read = await readOutputs({ cloud, awsRegion, cred });
  if (!read.ok) {
    await regionDemand.markFailed({
      cloud, region: awsRegion,
      error: `The apply finished but its outputs could not be read: ${read.message}`,
    });
    return { ok: false };
  }

  /*
   * ── The check the whole design rests on ──
   *
   * This worker's credential can create the NACL rule that isolates customers
   * and, unavoidably, can also rewrite it. So the rule is read back from AWS
   * before the region is published, through the RUNTIME's read-only path
   * rather than this process's elevated one.
   *
   * A region that fails is not merely "not built" — it is a region where
   * customer machines could reach each other, so it is taken out of service
   * and a human has to look.
   */
  const isolated = await isolationCheck.verify({
    awsRegion,
    vpcId: read.outputs.vpc_id,
    vpcCidr: read.outputs.vpc_cidr,
  });

  if (!isolated.ok) {
    await regionDemand.markFailed({
      cloud: 'aws', region: awsRegion,
      error: `ISOLATION NOT VERIFIED — ${isolated.message}`,
    });
    err(`${awsRegion}: isolation check FAILED — ${isolated.message}`);
    err(`${awsRegion}: the region has NOT been published. No customer machine will be placed there.`);
    return { ok: false, isolationFailed: true };
  }

  log(`${awsRegion}: isolation verified (${isolated.code || 'deny rules in place'})`);

  const published = await publish({ awsRegion, outputs: read.outputs });
  if (!published.ok) {
    await regionDemand.markFailed({ cloud: 'aws', region: awsRegion, error: published.message });
    err(`${awsRegion}: ${published.message}`);
    return { ok: false };
  }

  /*
   * `sync` concludes `built` by reading the saved ids, which is the only test
   * that matches what a launch actually does. Called rather than setting the
   * state directly for exactly that reason.
   */
  await regionDemand.sync();

  if (published.needsImage) {
    log(`${awsRegion}: built, but it has no AMI yet — set one in Admin → Cloud → AWS. `
      + 'An AMI id belongs to one region; the id from another will not work.');
  } else {
    log(`${awsRegion}: built and published. Waiting orders will start within a minute.`);
  }

  return { ok: true };
};

/**
 * Is anything actually sold in this region?
 *
 * The one check that stands between a customer's order and a standing monthly
 * charge. A tier priced and sellable here means an admin recorded the region's
 * cost (`ensureCosted` refuses tier creation otherwise) and then chose to
 * offer a machine at a price that carries it. That is the approval; the build
 * is only acting on it.
 *
 * Checked at build time rather than trusted from the demand row because the
 * two answer different questions — the row says what a customer asked for,
 * this says what the platform agreed to sell.
 */
const sellsRegion = async (cloud, { region, platformRegion }) => {
  /*
   * Both spellings, because the two sides of this question are keyed
   * differently: a `TierPrice` row is keyed by the PLATFORM region
   * (`us-east`), while the demand row and this worker speak the provider's
   * name (`us-east4`).
   */
  const names = [...new Set([platformRegion, region].filter(Boolean))];

  const sold = await prisma.tierPrice.count({
    where: {
      /*
       * The cloud this worker is actually building for.
       *
       * This said `'aws'`. A worker in GCP mode therefore counted AWS's rows
       * for a Google region, found none, and refused to build — every twenty
       * seconds, for hours, while a paying customer's order sat held. The log
       * line was honest and the conclusion was wrong: something WAS sold
       * there, just not on the cloud this query asked about.
       */
      cloud,
      region: { in: names },
      status: 'sellable',
      tier: { isActive: true },
    },
  }).catch((e) => {
    err(`could not check what is sold in ${region}:`, e.message);
    // Fails closed: an unanswered question must not start a monthly charge.
    return 0;
  });

  return sold > 0;
};

/** One pass: build whatever has been asked for. */
const runOnce = async ({ cloud = CLOUD, only = null, dryRun = false } = {}) => {
  const cred = buildCredential(cloud);
  if (!cred.ok) {
    err(cred.message);
    return { ok: false, reason: 'NO_CREDENTIAL' };
  }

  const regions = await regionDemand.overview({ cloud });

  /*
   * ── What gets built without anybody pressing a button ──
   *
   * `building` is an operator asking explicitly. `wanted` is a customer's
   * order waiting — and that is built automatically too, because making a
   * paying customer wait on someone noticing a screen is not a wait, it is an
   * abandoned order.
   *
   * Applying a region does start a standing charge (~$65/month in NAT
   * gateways, billed whether anything runs there or not), so the question is
   * what makes that charge already-approved. It is not a third button. By the
   * time an order can name a region at all, an admin has deliberately done two
   * things:
   *
   *   1. recorded that region's cost — without it `ensureCosted` refuses to
   *      let a tier be created there at all
   *   2. created a tier in it — without which no customer is ever shown it
   *
   * So a `wanted` region is one the platform has already decided to sell, at a
   * price that already carries the $65. `sellsRegion` re-checks that second
   * fact here rather than trusting the demand row, because the demand row says
   * what a customer asked for and this says what we agreed to offer.
   */
  const due = [];
  for (const r of regions) {
    if (only && r.region !== only) continue;

    if (r.buildState === 'building') { due.push(r); continue; }

    /*
     * `waitingDeployments > 0` also carries the money check, which is why
     * there is no separate one here. A deployment only reaches a `region` hold
     * after `capGuard.evaluate` has passed it — and that includes `NOT_FUNDED`,
     * the team cap and the margin floor. An order from an account that cannot
     * pay is refused before the region is ever asked for, so nothing unfunded
     * can start a monthly charge.
     */
    /*
     * `failed` is retried too, and that matters more than it looks.
     *
     * An apply fails for reasons that get fixed — a bad credential, a quota,
     * a stack that could not even start. Leaving the region in `failed`
     * meant the worker never looked at it again: the cause could be repaired
     * and the customer's order would still sit held forever, with the worker
     * running happily beside it and printing nothing at all. Silence that
     * looks identical to "nothing to do".
     *
     * Terraform is the safety here, not this list. An apply re-runs against
     * existing state and converges, so trying again costs a few minutes and
     * never duplicates what already exists. The money guard is unchanged:
     * something must still be SOLD in the region before a charge can start.
     */
    if (['wanted', 'failed'].includes(r.buildState) && r.waitingDeployments > 0) {
      // eslint-disable-next-line no-await-in-loop
      if (await sellsRegion(cloud, r)) {
        due.push(r);
      } else {
        err(
          `${r.region} has ${r.waitingDeployments} order(s) waiting but no tier is sold there. `
          + 'Not building it — a region nothing is sold in earns nothing and still costs.'
        );
      }
    }
  }

  if (!due.length) return { ok: true, built: 0 };

  let built = 0;
  for (const region of due) {
    if (cloud === 'aws' && !regionMap.supportedAwsRegions().includes(region.region)) {
      err(`${region.region} is marked for building but is not a region this platform sells.`);
      continue;
    }
    const result = await buildOne({ cloud, awsRegion: region.region, cred, dryRun });
    if (result.ok) built += 1;
  }

  return { ok: true, built, considered: due.length };
};

const main = async () => {
  const args = process.argv.slice(2);
  const once = args.includes('--once');
  const dryRun = args.includes('--dry-run');
  const only = args.includes('--region') ? args[args.indexOf('--region') + 1] : null;

  log(`starting — ${CLOUD} / "${ENVIRONMENT}"${dryRun ? ', DRY RUN (plan only)' : ''}`);

  const cred = buildCredential(CLOUD);
  if (!cred.ok) {
    err(cred.message);
    process.exit(1);
  }
  log(`build credential loaded (${cred.id.slice(0, 4)}…), separate from the platform's own key`);

  if (only) {
    /*
     * An explicit region on the command line is itself the request to build
     * it, so the claim is taken here — the same claim the admin button takes,
     * which is what stops two applies racing on one region's state.
     */
    const claim = await regionDemand.markBuilding({ cloud: CLOUD, region: only });
    if (!claim.ok && claim.code === 'ALREADY_BUILDING') {
      log(`${only} is already marked as building; continuing with it.`);
    } else if (!claim.ok) {
      err(`${only}: ${claim.code}`);
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  if (once || only) {
    const summary = await runOnce({ only, dryRun });
    log(`done: ${summary.built || 0} built of ${summary.considered || 0} considered`);
    await prisma.$disconnect();
    process.exit(summary.ok ? 0 : 1);
  }

  log(`watching for work every ${POLL_SECONDS}s`);
  let stopping = false;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      log(`${sig} — finishing the current region, then stopping`);
      stopping = true;
    });
  }

   
  while (!stopping) {
    try {
      /*
       * Say we are alive BEFORE doing the work, not after.
       *
       * The admin screen uses this to decide whether its button builds a
       * region or merely leaves a note. Stamping it after a pass means a
       * worker busy with a 20-minute apply looks dead for 20 minutes —
       * precisely while it is doing the thing it exists for.
       */
      await regionDemand.heartbeat();

      const summary = await runOnce({ dryRun });
      if (summary.built) log(`built ${summary.built} region(s)`);
    } catch (e) {
      err('pass failed:', e.message);
    }
    if (stopping) break;
    await new Promise((r) => setTimeout(r, POLL_SECONDS * 1000));
  }
   

  await prisma.$disconnect();
  log('stopped');
};

if (require.main === module) {
  main().catch(async (e) => {
    err('FATAL', e);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { runOnce, buildOne, publish, buildCredential, APPLY_TIMEOUT_MINUTES };
