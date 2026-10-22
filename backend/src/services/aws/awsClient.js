/**
 * The EC2 client.
 *
 * Shaped like `gcpClient.js` — a singleton holding decrypted credentials, a
 * `dryRun` mode that is on by default, and the four verbs the driver needs.
 * The differences are AWS's, not this platform's:
 *
 *   - Authentication is SigV4 over the request itself (see `awsSigner.js`),
 *     not a bearer token.
 *   - EC2's API is a **query API**: a form-encoded POST to one endpoint with
 *     `Action=RunInstances`, and an XML response. Not JSON, and not REST.
 *   - Idempotency is asked for, not given. GCP's per-zone unique instance name
 *     makes a duplicate create impossible; AWS will happily run two instances
 *     unless a `ClientToken` says otherwise.
 *
 * ── The security posture, which is the point of `buildRunInstancesParams` ──
 *
 * Every instance this platform creates is built the same way, and each choice
 * below closes something:
 *
 *   - **No public IP.** There is no inbound path at all, so there is nothing
 *     to attack and no inbound rule to get wrong.
 *   - **IMDSv2 required.** IMDSv1 is the classic credential-theft path: any
 *     SSRF bug in a customer's model reads the instance credentials over plain
 *     HTTP. Requiring a token makes that a non-event.
 *   - **Hop limit 1.** Even with IMDSv2, a container on the instance could
 *     reach the metadata service through an extra network hop. One hop means
 *     the instance itself and nothing running behind it.
 *   - **The role-less instance profile** from `infra/aws/modules/iam` — it can
 *     open an SSM session to the machine the attacker is already on, and
 *     nothing else.
 *   - **Encrypted EBS, deleted on termination.** A volume that outlives its
 *     instance is a bill nobody is watching and a disk nobody is guarding.
 *
 * ── Every call carries its own region ──
 *
 * There is deliberately no "the" region on this client. AWS has a separate
 * endpoint per region, the signature covers that region, and a VPC, security
 * group, subnet and AMI all belong to one region only. A client with a single
 * configured region can serve exactly one region, and a tier sold in a second
 * one fails at launch with `InvalidSubnetID.NotFound`.
 *
 * So `call()` takes the region as a required argument, and each verb takes the
 * availability zone the instance actually lives in. Nothing here falls back to
 * a default: a destroy sent to the wrong region answers "no such instance",
 * which reads exactly like success, while the real machine keeps billing.
 */
const crypto = require('crypto');

const signer = require('./awsSigner');
const naming = require('./awsInstanceNaming');
const regionMap = require('./awsRegionMap');
const shape = require('./awsSettingsShape');

/** EC2's query API version this client is written against. */
const EC2_API_VERSION = '2016-11-15';

class AwsClient {
  constructor() {
    this._initialized = false;
    this._settings = null;
    this._secret = null;
  }

  async initialize() {
    if (this._initialized) return this;

    const adminSettingsService = require('../admin/adminSettingsService');
    const cryptoHelper = require('../../utils/helpers/cryptoHelper');

    const settings = await adminSettingsService.getSettings();
    const aws = settings?.awsSettings || {};

    if (!aws.enabled) {
      throw new Error('AWS is switched off. Turn it on in Admin → Cloud → AWS.');
    }

    /*
     * In dry-run nothing is ever sent, so credentials are not required — and
     * that is the point, not a convenience. Dry run exists so the whole chain
     * can be exercised before an AWS account exists. (The GCP client learned
     * this the hard way: it demanded a project id even in dry run, which made
     * dry run useless.)
     */
    const dryRun = aws.dryRun !== false;

    if (!dryRun) {
      if (!aws.accessKeyId) {
        throw new Error('No AWS access key id is stored. Add it in Admin → Cloud → AWS.');
      }
      if (!aws.secretAccessKeyEncrypted) {
        throw new Error(
          'No AWS secret access key is stored. Re-add it in Admin → Cloud → AWS '
          + '(an existing key becomes unreadable if CREDENTIAL_ENCRYPTION_KEY or JWT_SECRET was rotated).'
        );
      }
      this._secret = cryptoHelper.decrypt(aws.secretAccessKeyEncrypted);
      if (!this._secret) {
        throw new Error('The stored AWS secret key could not be decrypted. Re-add it.');
      }
      /*
       * At least one region must be fully built. Which region a given launch
       * needs is not knowable here — it comes from the deployment — so this
       * only refuses the case where no region works at all. The per-region
       * check happens at launch, where the region is known and the error can
       * name it.
       */
      if (!shape.configuredRegions(aws).length) {
        throw new Error(
          'No AWS region is set up. Each region needs its own VPC, security group, subnets and '
          + 'AMI — they are regional on AWS — so apply infra/aws for at least one region and '
          + 'paste the ids into Admin → Cloud → AWS.'
        );
      }
    }

    // Stored normalized, so nothing downstream has to know that an older
    // single-region settings object used flat fields.
    this._settings = { ...aws, ...shape.normalize(aws) };
    this._initialized = true;
    return this;
  }

  clearCache() {
    this._initialized = false;
    this._settings = null;
    this._secret = null;
    return this;
  }

  /** The loaded settings, without ever exposing the secret. */
  async config() {
    await this.initialize();
    const { secretAccessKeyEncrypted, ...safe } = this._settings;
    return { ...safe, hasSecret: !!secretAccessKeyEncrypted };
  }

  get dryRun() {
    return this._settings?.dryRun !== false;
  }

  /** The AWS regions this platform is actually set up to build in. */
  async regions() {
    await this.initialize();
    return shape.configuredRegions(this._settings);
  }

  /**
   * The infrastructure ids for one AWS region.
   *
   * Throws rather than returning a partial set: launching with a blank subnet
   * id puts the instance in the default VPC, outside every firewall rule this
   * platform relies on for isolation. A refusal is the only safe answer.
   *
   * ── Except in dry run ──
   *
   * Dry run exists so the whole chain can be exercised before an AWS account
   * exists, so it cannot require infrastructure that has not been built. The
   * ids it returns are obviously fake on sight — the GCP client learned this
   * the hard way by demanding a project id in dry run, which made dry run
   * useless. Nothing is sent, so nothing can be launched into the wrong place.
   */
  async infraFor(awsRegion) {
    await this.initialize();

    if (this.dryRun) {
      const real = shape.infraFor(this._settings, awsRegion);
      if (real.ok) return real;

      const azs = Object.values(regionMap.REGIONS)
        .find((r) => r.awsRegion === awsRegion)?.azs || [];
      return {
        ok: true,
        dryRun: true,
        awsRegion,
        vpcId: 'vpc-dryrun',
        securityGroupId: 'sg-dryrun',
        imageId: 'ami-dryrun',
        instanceProfile: this._settings?.instanceProfile || 'dry-run-no-profile',
        subnetIds: Object.fromEntries(azs.map((az) => [az, `subnet-dryrun-${az}`])),
      };
    }

    const infra = shape.infraFor(this._settings, awsRegion);
    if (!infra.ok) {
      const err = new Error(infra.message);
      err.code = infra.code;
      /*
       * NOT permanent, and that distinction is the whole of the region flow.
       *
       * "AWS is not built in this region" is the expected state of every
       * region on the day its first customer arrives: the platform costs and
       * sells a region before building it, deliberately, so the region's
       * standing cost is inside the price from the start. Calling it permanent
       * moved the order to `failed` — a dead end for one that only needed to
       * wait — and put this very message, with an `infra/aws/live/...` path in
       * it, in front of the customer.
       */
      err.permanent = false;
      err.needsRegion = true;
      err.missing = infra.missing || [];
      throw err;
    }
    return infra;
  }

  /**
   * One call to the EC2 query API, in one region.
   *
   * @param {string} action  e.g. "RunInstances"
   * @param {object} params  flat, already in EC2's dotted-parameter form
   * @param {string} opts.region  REQUIRED for regional services. The endpoint
   *   and the signature both depend on it, and there is no safe default — see
   *   the file header.
   */
  async call(action, params = {}, { service = 'ec2', host = null, region = null } = {}) {
    await this.initialize();

    if (!region) {
      throw new Error(
        `EC2 ${action} was called without a region. Every AWS call needs one — the endpoint and `
        + 'the signature both depend on it. Pass the region from the deployment, or from the '
        + "instance's availability zone for an existing machine."
      );
    }

    const endpointHost = host || `${service}.${region}.amazonaws.com`;

    const body = new URLSearchParams({
      Action: action,
      Version: EC2_API_VERSION,
      ...Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
      ),
    }).toString();

    const signed = signer.sign({
      method: 'POST',
      path: '/',
      headers: {
        host: endpointHost,
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body,
      region,
      service,
      accessKeyId: this._settings.accessKeyId,
      secretAccessKey: this._secret,
      now: new Date(),
    });

    const timeoutMs = Math.max(5, Number(this._settings.requestTimeoutSeconds) || 30) * 1000;

    const res = await fetch(`https://${endpointHost}/`, {
      method: 'POST',
      headers: signed.headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const text = await res.text();

    if (!res.ok) {
      /*
       * EC2 reports errors as XML. The code is what the classifier reads, so
       * it is pulled out and attached rather than left for every caller to
       * parse the same string again.
       */
      const err = new Error(`EC2 ${action} failed (${res.status})`);
      err.status = res.status;
      err.awsCode = (text.match(/<Code>([^<]+)<\/Code>/) || [])[1] || '';
      err.awsMessage = (text.match(/<Message>([^<]+)<\/Message>/) || [])[1] || text.slice(0, 300);
      err.body = text;
      throw err;
    }

    return text;
  }

  /**
   * The launch parameters, carrying the whole security posture.
   *
   * Pure and exported through the instance so a test can assert the posture
   * without any network — which is how the GCP side proved the same thing.
   */
  buildRunInstancesParams({ plan, az, infra, deploymentId, teamId, imageId, attempt = 0 }) {
    const s = this._settings || {};
    const subnetId = (infra?.subnetIds || {})[az];

    if (!subnetId) {
      /*
       * Refused rather than sent with a blank subnet. EC2 reads an empty
       * SubnetId as "put it in the default VPC", which is the one place with
       * no firewall policy and no isolation — a customer machine there can
       * reach every other machine in that VPC.
       */
      const err = new Error(
        `No subnet is configured for availability zone ${az}. A machine cannot be launched there `
        + 'without one, because an instance with no subnet lands in the default VPC, outside '
        + 'every isolation rule this platform depends on.'
      );
      err.code = 'SUBNET_NOT_CONFIGURED';
      err.permanent = true;
      throw err;
    }

    const tags = naming.instanceTags({
      deploymentId,
      teamId,
      environment: s.environment || 'staging',
    });

    const params = {
      // The AMI is regional, so it comes from this region's block — never from
      // a single top-level image id, which would only exist in one region.
      ImageId: imageId || infra.imageId || '',
      InstanceType: plan.instanceType || plan.machineType,
      MinCount: '1',
      MaxCount: '1',

      /*
       * The idempotency token. Without it a retry after a timeout — where the
       * first call actually succeeded — silently creates a second instance and
       * doubles a customer's bill. AWS honours it for 24 hours.
       */
      ClientToken: naming.clientToken(deploymentId, attempt),

      // No public IP, and the subnet fixes the availability zone.
      'NetworkInterface.1.DeviceIndex': '0',
      'NetworkInterface.1.SubnetId': subnetId,
      'NetworkInterface.1.AssociatePublicIpAddress': 'false',
      'NetworkInterface.1.DeleteOnTermination': 'true',
      // Also regional — a security group belongs to one VPC, which belongs to
      // one region.
      'NetworkInterface.1.SecurityGroupId.1': infra.securityGroupId || '',

      // The role-less profile. SSM only. IAM is global on AWS, so this one is
      // shared across every region rather than copied per region.
      'IamInstanceProfile.Name': infra.instanceProfile || s.instanceProfile || '',

      // IMDSv2 required, one hop. See the file header.
      'MetadataOptions.HttpTokens': 'required',
      'MetadataOptions.HttpEndpoint': 'enabled',
      'MetadataOptions.HttpPutResponseHopLimit': '1',

      // Encrypted root volume that dies with the instance.
      'BlockDeviceMapping.1.DeviceName': '/dev/xvda',
      'BlockDeviceMapping.1.Ebs.VolumeSize': String(plan.bootDisk?.sizeGb || 8),
      'BlockDeviceMapping.1.Ebs.VolumeType': plan.bootDisk?.type || 'gp3',
      'BlockDeviceMapping.1.Ebs.Encrypted': 'true',
      'BlockDeviceMapping.1.Ebs.DeleteOnTermination': 'true',

      /*
       * Not spot. A customer paid for a machine that stays up, and a spot
       * instance can be reclaimed with two minutes' notice — cheaper, and not
       * the thing that was sold.
       */
      'InstanceMarketOptions.MarketType': '',
    };

    // EC2 wants tags as indexed parameters on the launch call, so they exist
    // from the first instant rather than being added afterwards — an instance
    // that is untagged for even a moment is invisible to the orphan sweep.
    params['TagSpecification.1.ResourceType'] = 'instance';
    tags.forEach((t, i) => {
      params[`TagSpecification.1.Tag.${i + 1}.Key`] = t.Key;
      params[`TagSpecification.1.Tag.${i + 1}.Value`] = t.Value;
    });
    params['TagSpecification.2.ResourceType'] = 'volume';
    tags.forEach((t, i) => {
      params[`TagSpecification.2.Tag.${i + 1}.Key`] = t.Key;
      params[`TagSpecification.2.Tag.${i + 1}.Value`] = t.Value;
    });

    // An empty market-options value would be sent as a literal; drop it.
    delete params['InstanceMarketOptions.MarketType'];

    return params;
  }

  /* ── The four verbs ───────────────────────────────────────────────────── */

  /**
   * Which region an existing machine's calls must go to.
   *
   * Derived from the availability zone **recorded on the instance row**, not
   * from the deployment's region. The two can disagree: a tier's regions are
   * editable, so a deployment created in Ireland can later point at Mumbai
   * while its machine is still running in Ireland. Trusting the deployment
   * would send the destroy to Mumbai, get "no such instance", and leave the
   * Irish machine billing forever with the platform believing it was gone.
   *
   * Same reasoning as the frozen `cloudProvider` on the deployment: where a
   * machine *is* is a recorded fact, never a re-derived one.
   */
  regionForAz(az) {
    const resolved = regionMap.regionOfAz(az);
    if (!resolved.ok) {
      const err = new Error(resolved.message);
      err.code = resolved.code;
      err.permanent = true;
      throw err;
    }
    return resolved.awsRegion;
  }

  async runInstance({ plan, az, deploymentId, teamId, imageId, attempt = 0 }) {
    await this.initialize();

    const region = this.regionForAz(az);
    const infra = await this.infraFor(region);
    const params = this.buildRunInstancesParams({
      plan, az, infra, deploymentId, teamId, imageId, attempt,
    });

    if (this.dryRun) {
      console.log(`[AWS] dry-run: would launch ${params.InstanceType} in ${az} (${region}) for ${deploymentId}`);
      return {
        dryRun: true,
        region,
        // A synthetic id in AWS's own shape, so anything downstream that
        // pattern-matches on it behaves as it would for real.
        instanceId: `i-dryrun${crypto.createHash('sha256').update(String(deploymentId)).digest('hex').slice(0, 10)}`,
        params,
      };
    }

    const xml = await this.call('RunInstances', params, { region });
    return {
      dryRun: false,
      region,
      instanceId: (xml.match(/<instanceId>([^<]+)<\/instanceId>/) || [])[1] || null,
      xml,
    };
  }

  /**
   * What AWS says about one instance right now.
   *
   * This is the AWS answer to Google's "poll the operation". `RunInstances`
   * returns immediately with an id and no operation to follow, so the instance
   * itself is the only source of truth — its `instanceState` moves
   * `pending → running` on its own, or `pending → terminated` when the launch
   * fails after being accepted.
   *
   * `stateReason` matters as much as the state: an instance that terminates
   * itself seconds after launch (`Server.InsufficientInstanceCapacity`,
   * `Client.VolumeLimitExceeded`) is a *failure*, and without the reason it
   * looks exactly like a machine somebody stopped on purpose.
   */
  async describeInstance(instanceId, az) {
    await this.initialize();
    if (this.dryRun) {
      return {
        dryRun: true,
        state: 'running',
        privateIp: '10.30.0.10',
        publicIp: null,
        launchTime: new Date().toISOString(),
      };
    }

    const region = this.regionForAz(az);
    const xml = await this.call('DescribeInstances', { 'InstanceId.1': instanceId }, { region });

    /*
     * `<stateReason>` carries the machine-readable code and is the one we
     * want. EC2 also returns `<reason>` as prose; it is kept only for the
     * admin screen, never for a decision.
     */
    const stateReason = xml.match(/<stateReason>[\s\S]*?<code>([^<]+)<\/code>[\s\S]*?<message>([^<]*)<\/message>/);

    return {
      stateReasonCode: stateReason?.[1] || null,
      stateReasonMessage: stateReason?.[2] || null,
      instanceType: (xml.match(/<instanceType>([^<]+)<\/instanceType>/) || [])[1] || null,
      found: /<instanceId>/.test(xml),
      dryRun: false,
      state: (xml.match(/<instanceState>[\s\S]*?<name>([^<]+)<\/name>/) || [])[1] || null,
      privateIp: (xml.match(/<privateIpAddress>([^<]+)<\/privateIpAddress>/) || [])[1] || null,
      publicIp: (xml.match(/<ipAddress>([^<]+)<\/ipAddress>/) || [])[1] || null,
      launchTime: (xml.match(/<launchTime>([^<]+)<\/launchTime>/) || [])[1] || null,
      xml,
    };
  }

  /**
   * Find an instance by the Name tag this platform gave it.
   *
   * For the adopt case: the launch call timed out or came back ambiguous, so
   * the instance id was never recorded, but AWS may well have built the
   * machine. Without this the row sits with no handle while a real instance
   * runs and bills — the exact shape of an orphan, created by us.
   *
   * Terminated instances are excluded. EC2 keeps them visible for about an
   * hour, and adopting a tombstone would record a machine that is already gone
   * and start a meter for it.
   */
  async findInstanceByName(name, region) {
    await this.initialize();
    if (this.dryRun) return null;

    const xml = await this.call('DescribeInstances', {
      'Filter.1.Name': 'tag:Name',
      'Filter.1.Value.1': name,
      'Filter.2.Name': 'instance-state-name',
      'Filter.2.Value.1': 'pending',
      'Filter.2.Value.2': 'running',
      'Filter.2.Value.3': 'stopping',
      'Filter.2.Value.4': 'stopped',
    }, { region });

    const id = (xml.match(/<instanceId>([^<]+)<\/instanceId>/) || [])[1];
    if (!id) return null;

    return {
      instanceId: id,
      state: (xml.match(/<instanceState>[\s\S]*?<name>([^<]+)<\/name>/) || [])[1] || null,
      az: (xml.match(/<availabilityZone>([^<]+)<\/availabilityZone>/) || [])[1] || null,
      privateIp: (xml.match(/<privateIpAddress>([^<]+)<\/privateIpAddress>/) || [])[1] || null,
      publicIp: (xml.match(/<ipAddress>([^<]+)<\/ipAddress>/) || [])[1] || null,
      launchTime: (xml.match(/<launchTime>([^<]+)<\/launchTime>/) || [])[1] || null,
      instanceType: (xml.match(/<instanceType>([^<]+)<\/instanceType>/) || [])[1] || null,
    };
  }

  async stopInstance(instanceId, az) {
    await this.initialize();
    if (this.dryRun) return { dryRun: true };
    const region = this.regionForAz(az);
    await this.call('StopInstances', { 'InstanceId.1': instanceId }, { region });
    return { dryRun: false, region };
  }

  async startInstance(instanceId, az) {
    await this.initialize();
    if (this.dryRun) return { dryRun: true };
    const region = this.regionForAz(az);
    await this.call('StartInstances', { 'InstanceId.1': instanceId }, { region });
    return { dryRun: false, region };
  }

  async terminateInstance(instanceId, az) {
    await this.initialize();
    if (this.dryRun) return { dryRun: true };
    const region = this.regionForAz(az);
    await this.call('TerminateInstances', { 'InstanceId.1': instanceId }, { region });
    return { dryRun: false, region };
  }

  /** Every managed instance in ONE region. */
  async listManagedInstancesIn(region) {
    const xml = await this.call('DescribeInstances', {
      'Filter.1.Name': 'tag:managed-by',
      'Filter.1.Value.1': naming.MANAGED_BY,
    }, { region });

    const out = [];
    const blocks = xml.split('<instancesSet>').slice(1);
    for (const block of blocks) {
      const id = (block.match(/<instanceId>([^<]+)<\/instanceId>/) || [])[1];
      if (!id) continue;
      out.push({
        instanceId: id,
        region,
        instanceType: (block.match(/<instanceType>([^<]+)<\/instanceType>/) || [])[1] || '',
        state: (block.match(/<instanceState>[\s\S]*?<name>([^<]+)<\/name>/) || [])[1] || '',
        az: (block.match(/<availabilityZone>([^<]+)<\/availabilityZone>/) || [])[1] || '',
        name: (block.match(/<key>Name<\/key>\s*<value>([^<]+)<\/value>/) || [])[1] || '',
      });
    }
    return out;
  }

  /**
   * Every instance this platform believes it created, in every region.
   *
   * The orphan sweep's half of the comparison. Filtered by tag rather than by
   * name so an instance somebody renamed is still recognised as ours.
   *
   * ── Why this sweeps every region, and why a partial answer is an error ──
   *
   * `DescribeInstances` is regional: it answers for the region it was sent to
   * and says nothing about any other. A sweep of one region would return a
   * clean list while an orphan in another region bills by the hour, invisible
   * — and the sweep would report "all clear", which is worse than not running
   * at all.
   *
   * So a region that fails to answer makes the whole result `partial`. The
   * caller must not delete anything on a partial sweep: "this instance has no
   * live deployment" and "we could not ask the region it is in" produce the
   * same empty list, and acting on the second destroys a running customer
   * machine.
   */
  async listManagedInstances() {
    await this.initialize();
    if (this.dryRun) return { instances: [], partial: false, regions: [], failures: [] };

    const regions = shape.configuredRegions(this._settings);
    const instances = [];
    const failures = [];

    for (const region of regions) {
      try {
        instances.push(...await this.listManagedInstancesIn(region));
      } catch (err) {
        failures.push({ region, message: err.awsMessage || err.message });
      }
    }

    return {
      instances,
      regions,
      failures,
      // Load-bearing: see the header. Never reconcile deletions on a partial.
      partial: failures.length > 0,
    };
  }

  /**
   * Prove the credentials work, without creating anything.
   *
   * `DescribeRegions` is the narrowest call that still fails for every reason
   * worth knowing about — wrong key, wrong secret, clock skew, no permission.
   * Run against every configured region, because a key can be valid while a
   * region is disabled on the account, and that only shows up per region.
   */
  async testConnection() {
    await this.initialize();
    if (this.dryRun) {
      return {
        ok: true,
        dryRun: true,
        message: 'Dry run is on, so nothing was sent to AWS. Turn it off to test the real credentials.',
      };
    }

    const regions = shape.configuredRegions(this._settings);
    if (!regions.length) {
      return {
        ok: false,
        dryRun: false,
        message: 'No AWS region is fully set up yet, so there is nothing to test against.',
      };
    }

    const results = [];
    for (const region of regions) {
      try {
        const xml = await this.call('DescribeRegions', { 'RegionName.1': region }, { region });
        const found = (xml.match(/<regionName>([^<]+)<\/regionName>/) || [])[1];
        results.push({ region, ok: true, confirmed: found || region });
      } catch (err) {
        results.push({ region, ok: false, message: err.awsMessage || err.message });
      }
    }

    const good = results.filter((r) => r.ok).map((r) => r.region);
    const bad = results.filter((r) => !r.ok);

    return {
      ok: bad.length === 0,
      dryRun: false,
      regions: results,
      message: bad.length === 0
        ? `Connected to AWS in ${good.join(', ')}.`
        : `Connected in ${good.length ? good.join(', ') : 'no region'}. Failed in `
          + `${bad.map((b) => `${b.region} (${b.message})`).join('; ')}.`,
    };
  }
}

module.exports = new AwsClient();
module.exports.EC2_API_VERSION = EC2_API_VERSION;
