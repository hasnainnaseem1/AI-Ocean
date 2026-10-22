/**
 * The only thing in this platform that talks to Google Cloud.
 *
 * Shaped like `services/polar/polarService.js` — a singleton class with a lazy,
 * idempotent `initialize()` that reads credentials from AdminSettings, a
 * `clearCache()` the settings controller calls after a save, and one `request()`
 * helper every call goes through. Following that shape rather than inventing
 * one means the next person to read this file has already read it.
 *
 * ── Why REST and not @google-cloud/compute ──
 *
 * `google-auth-library` is already a dependency (Google SSO uses it) and is all
 * that is needed to mint an access token from a service-account key. The
 * Compute REST API is then plain HTTP, which this codebase already does with
 * `fetch`. Pulling in the Compute SDK would add a large dependency to get a
 * different idiom for the same five calls, and would hide the request bodies
 * that `dryRun` exists to show.
 *
 * ── Timeouts ──
 *
 * This is the one place in the codebase with a request timeout, and it is not
 * an inconsistency. Every other HTTP call here is made while a user waits, so a
 * hung one fails their request and nothing else. These are made by a cron
 * reconciler holding work: a GCP call that never returns would wedge it, and
 * machines nobody is watching would keep running.
 */
const { JWT } = require('google-auth-library');

const adminSettingsService = require('../admin/adminSettingsService');
const cryptoHelper = require('../../utils/helpers/cryptoHelper');
const naming = require('./gcpInstanceNaming');

const COMPUTE_BASE = 'https://compute.googleapis.com/compute/v1';
const SCOPES = ['https://www.googleapis.com/auth/compute'];

class GcpClient {
  constructor() {
    this._initialized = false;
    this._settings = null;
    this._jwt = null;
  }

  /**
   * Load credentials. Idempotent, and throws a message naming the admin screen
   * rather than a stack trace about a missing field.
   */
  async initialize() {
    if (this._initialized) return this;

    const settings = await adminSettingsService.getSettings();
    const gcp = settings?.gcpSettings || {};

    if (!gcp.enabled) {
      throw new Error('Google Cloud is switched off. Turn it on in Admin → Settings → Integrations.');
    }
    /*
     * In dry-run nothing is ever sent, so neither a project nor a key is
     * required — and that is not a convenience, it is the point. Dry run exists
     * so the entire chain (driver, reconciler, the compute clock, billing, the
     * admin screens) can be exercised *before* a Google Cloud account exists.
     * Demanding a project id here made that impossible: the guard correctly
     * waives it in dry run, then this threw anyway and every build failed with
     * a message about a screen the operator cannot usefully fill in yet.
     *
     * A placeholder project is used for the synthetic resource paths, so a
     * dry-run row is obviously synthetic if it is ever read back.
     */
    const dryRun = gcp.dryRun !== false;

    if (!dryRun && !gcp.projectId) {
      throw new Error('Google Cloud has no project id. Add it in Admin → Settings → Integrations.');
    }

    if (!dryRun) {
      const raw = gcp.serviceAccountKeyEncrypted
        ? cryptoHelper.decrypt(gcp.serviceAccountKeyEncrypted)
        : '';
      if (!raw) {
        throw new Error(
          'Google Cloud has no usable service-account key. Re-add it in Admin → Settings → Integrations '
          + '(an existing key becomes unreadable if CREDENTIAL_ENCRYPTION_KEY or JWT_SECRET was rotated).',
        );
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('The stored Google Cloud key is not valid JSON. Re-add the service-account key file.');
      }
      if (!parsed.client_email || !parsed.private_key) {
        throw new Error('The stored Google Cloud key is missing client_email or private_key.');
      }

      this._jwt = new JWT({
        email: parsed.client_email,
        key: parsed.private_key,
        scopes: SCOPES,
      });
      // Kept so another Google API can be reached with the same credential
      // without a second place in this codebase decrypting the key.
      this._key = { clientEmail: parsed.client_email, privateKey: parsed.private_key };
    }

    this._settings = dryRun && !gcp.projectId
      ? { ...gcp, projectId: 'dry-run-no-project' }
      : gcp;
    this._initialized = true;
    return this;
  }

  /**
   * An access token for a *different* Google API, from the same stored key.
   *
   * The Compute client is scoped to compute alone, deliberately — a token that
   * can do everything is a token that can do everything if it leaks. Pricing
   * lives behind the Cloud Billing API and needs its own scope, so it asks for
   * one here rather than widening the compute token or decrypting the key in a
   * second place.
   *
   * Returns null when there is no usable key, which is every install before
   * Google Cloud is set up and every dry run. Callers treat that as "pricing is
   * unavailable", not as an error.
   */
  async accessTokenFor(scopes) {
    await this.initialize();
    if (!this._key) return null;
    const jwt = new JWT({
      email: this._key.clientEmail,
      key: this._key.privateKey,
      scopes: Array.isArray(scopes) ? scopes : [scopes],
    });
    const { token } = await jwt.getAccessToken();
    return token || null;
  }

  /** Called by the settings controller after a save, so the next call re-reads. */
  clearCache() {
    this._initialized = false;
    this._settings = null;
    this._jwt = null;
    this._key = null;
    return this;
  }

  /** The loaded settings, without ever exposing the key. */
  async config() {
    await this.initialize();
    const { serviceAccountKeyEncrypted, ...safe } = this._settings;
    return { ...safe, hasKey: !!serviceAccountKeyEncrypted };
  }

  get dryRun() {
    return !!this._settings?.dryRun;
  }

  /**
   * One HTTP call to the Compute API.
   *
   * Errors are thrown with `status` and the parsed GCP body attached, which is
   * what `gcpErrorClassifier` reads to decide between retrying, moving zone,
   * adopting an existing instance, or stopping and telling a human.
   */
  async request(method, path, body = null) {
    await this.initialize();

    const timeoutMs = Math.max(5, Number(this._settings.requestTimeoutSeconds) || 30) * 1000;
    const token = await this._jwt.getAccessToken();

    let response;
    try {
      response = await fetch(`${COMPUTE_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token.token || token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // A timeout or a dropped connection. Marked retryable explicitly rather
      // than left to be guessed from an opaque message.
      const wrapped = new Error(`GCP request failed: ${err.message}`);
      wrapped.code = err.name === 'TimeoutError' ? 'DEADLINE_EXCEEDED' : 'ECONNRESET';
      throw wrapped;
    }

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!response.ok) {
      const detail = data?.error || {};
      console.error('[GCP] API error:', {
        status: response.status,
        path,
        reason: detail.errors?.[0]?.reason,
        message: String(detail.message || '').slice(0, 300),
      });
      const err = new Error(detail.message || `GCP returned ${response.status}`);
      err.status = response.status;
      err.code = detail.errors?.[0]?.reason || detail.status || '';
      err.gcpBody = data;
      throw err;
    }

    return data;
  }

  /* ── Reads ───────────────────────────────────────────────────────────── */

  async getInstance({ zone, name }) {
    const { projectId } = this._settings;
    return this.request('GET', `/projects/${projectId}/zones/${zone}/instances/${encodeURIComponent(name)}`);
  }

  async getZoneOperation({ zone, operationName }) {
    const { projectId } = this._settings;
    return this.request('GET', `/projects/${projectId}/zones/${zone}/operations/${encodeURIComponent(operationName)}`);
  }

  /**
   * Every machine this platform believes it created, across all zones.
   *
   * The orphan sweep's half of the comparison. Filtered by label rather than by
   * name so that an instance someone renamed is still recognised as ours.
   */
  async listManagedInstances() {
    await this.initialize();
    const { projectId, environment } = this._settings;
    const filter = encodeURIComponent(naming.managedInstanceFilter(environment));

    const found = [];
    let pageToken = '';
    do {
      const page = await this.request(
        'GET',
        `/projects/${projectId}/aggregated/instances?filter=${filter}&maxResults=500`
          + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''),
      );
      for (const [scope, bucket] of Object.entries(page?.items || {})) {
        for (const instance of bucket.instances || []) {
          found.push({
            name: instance.name,
            id: instance.id,
            zone: scope.replace(/^zones\//, ''),
            status: instance.status,
            machineType: String(instance.machineType || '').split('/').pop(),
            labels: instance.labels || {},
          });
        }
      }
      pageToken = page?.nextPageToken || '';
    } while (pageToken);

    return found;
  }

  /* ── Writes ──────────────────────────────────────────────────────────── */

  /**
   * Build the exact `instances.insert` body.
   *
   * Kept separate from sending it so that dry-run can store and show precisely
   * what would have gone to Google — a plan nobody can read is not a plan — and
   * so the security posture below is one reviewable block rather than something
   * spread through a request method.
   */
  buildInstanceBody({ plan, zone, deploymentId, teamId, image }) {
    const gcp = this._settings;
    const name = naming.instanceName(deploymentId);

    const body = {
      name,
      machineType: `zones/${zone}/machineTypes/${plan.machineType}`,
      labels: naming.instanceLabels({ deploymentId, teamId, environment: gcp.environment }),

      disks: [{
        boot: true,
        autoDelete: true,
        deviceName: naming.bootDiskName(deploymentId),
        initializeParams: {
          diskSizeGb: String(plan.bootDisk.sizeGb),
          diskType: `zones/${zone}/diskTypes/${plan.bootDisk.type}`,
          sourceImage: image || 'projects/debian-cloud/global/images/family/debian-12',
        },
      }],

      networkInterfaces: [{
        subnetwork: `regions/${zone.replace(/-[a-z]$/, '')}/subnetworks/${gcp.network}-${zone.replace(/-[a-z]$/, '')}`,
        // No accessConfigs: no external IP. There is no address on the internet
        // that resolves to a customer's machine. Outbound goes through Cloud NAT.
      }],

      serviceAccounts: [{
        email: gcp.customerServiceAccount,
        // No scopes at all. The account holds no IAM roles either, so a token
        // taken off the metadata server by a compromised workload is worthless.
        scopes: [],
      }],

      // A VM that can forward IP packets can route around firewall rules, which
      // is the one thing the isolation design cannot allow.
      canIpForward: false,

      shieldedInstanceConfig: {
        enableSecureBoot: true,
        enableVtpm: true,
        enableIntegrityMonitoring: true,
      },

      metadata: {
        items: [
          // OS Login makes SSH an IAM decision; blocking project keys stops a
          // key added project-wide from opening every customer's machine.
          { key: 'enable-oslogin', value: 'TRUE' },
          { key: 'block-project-ssh-keys', value: 'TRUE' },
          { key: 'aiocean-deployment-id', value: String(deploymentId) },
        ],
      },

      scheduling: {
        // Not preemptible: the customer is paying for a machine that stays up.
        preemptible: false,
        automaticRestart: true,
        onHostMaintenance: plan.acceleratorCount > 0 ? 'TERMINATE' : 'MIGRATE',
      },
    };

    // Only for GPUs that attach to an ordinary machine (T4, V100). An a2/a3/g2
    // shape already includes its accelerators and GCP rejects the field.
    if (plan.accelerator) {
      body.guestAccelerators = [{
        acceleratorType: `zones/${zone}/acceleratorTypes/${plan.accelerator.type}`,
        acceleratorCount: plan.accelerator.count,
      }];
    }

    return body;
  }

  /**
   * Create the machine.
   *
   * In dry-run this returns a synthetic operation and sends nothing — which is
   * the default on a fresh install, so a half-configured platform cannot spend.
   */
  async createInstance({ plan, zone, deploymentId, teamId, image }) {
    await this.initialize();
    const body = this.buildInstanceBody({ plan, zone, deploymentId, teamId, image });

    if (this.dryRun) {
      console.log(`[GCP] dry-run: would create ${body.name} (${plan.machineType}) in ${zone}`);
      return {
        dryRun: true,
        operationName: `dryrun-${body.name}`,
        body,
      };
    }

    const { projectId } = this._settings;
    const op = await this.request('POST', `/projects/${projectId}/zones/${zone}/instances`, body);
    return { dryRun: false, operationName: op?.name, operation: op, body };
  }

  async deleteInstance({ zone, name }) {
    await this.initialize();
    if (this.dryRun) {
      console.log(`[GCP] dry-run: would delete ${name} in ${zone}`);
      return { dryRun: true, operationName: `dryrun-delete-${name}` };
    }
    const { projectId } = this._settings;
    const op = await this.request('DELETE', `/projects/${projectId}/zones/${zone}/instances/${encodeURIComponent(name)}`);
    return { dryRun: false, operationName: op?.name, operation: op };
  }

  async stopInstance({ zone, name }) {
    await this.initialize();
    if (this.dryRun) return { dryRun: true, operationName: `dryrun-stop-${name}` };
    const { projectId } = this._settings;
    const op = await this.request('POST', `/projects/${projectId}/zones/${zone}/instances/${encodeURIComponent(name)}/stop`);
    return { dryRun: false, operationName: op?.name, operation: op };
  }

  async startInstance({ zone, name }) {
    await this.initialize();
    if (this.dryRun) return { dryRun: true, operationName: `dryrun-start-${name}` };
    const { projectId } = this._settings;
    const op = await this.request('POST', `/projects/${projectId}/zones/${zone}/instances/${encodeURIComponent(name)}/start`);
    return { dryRun: false, operationName: op?.name, operation: op };
  }

  /* ── Checks ──────────────────────────────────────────────────────────── */

  /**
   * Is this region's network actually built?
   *
   * ── Why this is its own check ──
   *
   * Google's VPC is global, so there is one network for every region — but
   * its **subnets are regional**, and a machine cannot be placed in a region
   * whose subnet does not exist. "We sell this region" and "we have built
   * this region" are therefore two different facts on Google exactly as they
   * are on AWS, even though the thing that is missing is smaller.
   *
   * Without this, the first order into a region nobody has built reached
   * `insert instance` and came back as a raw Google error about a subnetwork
   * resource — which reads as a platform fault, leaves a failed row behind,
   * and tells the customer nothing they can act on.
   *
   * Shaped to match `awsSettingsShape.infraFor`: `{ ok: false, code, message }`
   * rather than a throw, with `REGION_NOT_CONFIGURED` so the provisioning
   * path holds the order and asks for the region instead of failing it.
   */
  async regionReady(gcpRegion) {
    await this.initialize();

    if (this.dryRun) {
      // Dry run exists so the whole chain can be exercised before a network
      // does — see `infraFor` on the AWS client for the same reasoning.
      return { ok: true, dryRun: true, gcpRegion };
    }

    const { projectId, network } = this._settings;
    const subnet = `${network}-${gcpRegion}`;

    try {
      await this.request('GET', `/projects/${projectId}/regions/${gcpRegion}/subnetworks/${subnet}`);
    } catch (err) {
      return {
        ok: false,
        code: 'REGION_NOT_CONFIGURED',
        message: `Google Cloud is not set up in ${gcpRegion} — there is no "${subnet}" subnet. `
          + 'Apply infra/gcp/live/<env> so the network exists there.',
        missing: ['subnet'],
        gcpRegion,
      };
    }

    /*
     * ── A subnet alone is not a usable region ──
     *
     * The deny rules ARE the isolation: without them a customer's machine can
     * reach every other machine on the network. A half-applied region has
     * exactly that shape — the network, subnet and NAT succeed, and the
     * firewall unit fails on its own (a missing `compute.securityAdmin` does
     * precisely this, and it is not hypothetical: it happened on the first
     * real apply of this project).
     *
     * Checking only the subnet would then report the region ready and place
     * customer machines into a network with no isolation at all. So the deny
     * rules are required too, and a region missing them is `not configured` —
     * the same answer as a region with no network, because from a customer's
     * point of view it is the same: nothing may be placed there.
     */
    try {
      const xml = await this.request('GET', `/projects/${projectId}/global/firewalls`);
      const names = JSON.stringify(xml || {});
      const required = [`${network}-deny-ingress-all`, `${network}-deny-egress-private`];
      const absent = required.filter((rule) => !names.includes(rule));

      if (absent.length) {
        return {
          ok: false,
          code: 'REGION_NOT_CONFIGURED',
          message: `Google Cloud is not fully set up for "${network}" — the isolation rules `
            + `${absent.join(' and ')} do not exist. The network is there but customer machines `
            + 'would not be isolated from each other, so nothing may be placed in it. '
            + 'Re-apply infra/gcp/live/<env>; a missing compute.securityAdmin role on the build '
            + 'account is the usual cause.',
          missing: ['firewall'],
          gcpRegion,
        };
      }
    } catch (err) {
      // Could not ask. NOT read as "isolation is fine" — an unanswered
      // question and a failed check are different, and only one is safe to
      // ignore.
      return {
        ok: false,
        code: 'REGION_NOT_CONFIGURED',
        message: `Could not confirm the isolation rules for "${network}": ${err.message}`,
        missing: ['firewall'],
        gcpRegion,
      };
    }

    // Both halves are there: a subnet to place the machine in, and the deny
    // rules that keep it away from every other customer's.
    return { ok: true, gcpRegion, subnet };
  }

  /**
   * Does this shape actually exist in this zone?
   *
   * The spec mapper knows GCP's *rules* — how many vCPUs a shape has, which GPU
   * it is welded to. It cannot know GCP's live inventory, and a machine type
   * that exists in the API may be unavailable in a given zone. This asks,
   * without creating anything, and is what the admin's "Test connection"
   * button runs.
   */
  async validateShape({ zone, machineType, acceleratorType }) {
    await this.initialize();
    const { projectId } = this._settings;
    const problems = [];

    try {
      await this.request('GET', `/projects/${projectId}/zones/${zone}/machineTypes/${machineType}`);
    } catch (err) {
      problems.push(`machine type ${machineType} is not available in ${zone}: ${err.message}`);
    }

    if (acceleratorType) {
      try {
        await this.request('GET', `/projects/${projectId}/zones/${zone}/acceleratorTypes/${acceleratorType}`);
      } catch (err) {
        problems.push(`accelerator ${acceleratorType} is not available in ${zone}: ${err.message}`);
      }
    }

    const region = zone.replace(/-[a-z]$/, '');
    const subnet = `${this._settings.network}-${region}`;
    try {
      await this.request('GET', `/projects/${projectId}/regions/${region}/subnetworks/${subnet}`);
    } catch (err) {
      problems.push(`subnet ${subnet} does not exist in ${region} — has the Terragrunt baseline been applied? (${err.message})`);
    }

    return { ok: problems.length === 0, problems };
  }

  /**
   * Prove the credentials work, without creating anything.
   *
   * Reads the project itself: the narrowest call that still fails for every
   * reason worth knowing about — wrong project, revoked key, Compute API not
   * enabled, missing IAM role.
   */
  async testConnection() {
    await this.initialize();
    if (this.dryRun) {
      return {
        ok: true,
        dryRun: true,
        message: 'Dry-run is on, so nothing was sent to Google. Turn it off to test the real credentials.',
      };
    }
    const { projectId } = this._settings;
    const project = await this.request('GET', `/projects/${projectId}`);
    return {
      ok: true,
      dryRun: false,
      message: `Connected to ${project?.name || projectId}.`,
      project: project?.name || projectId,
    };
  }
}

module.exports = new GcpClient();
