import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, Space, Tag, Badge } from 'antd';
import {
  ApiOutlined, ThunderboltOutlined, DollarOutlined, DisconnectOutlined, GlobalOutlined,
} from '@ant-design/icons';
import { useSearchParams, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import AwsConnectionTab from './AwsConnectionTab';
import CloudProvisioningTab from './CloudProvisioningTab';
import CloudPricingTab from './CloudPricingTab';
import CloudOrphansPanel from './CloudOrphansPanel';
import CloudRegionBuilds from './CloudRegionBuilds';
import settingsApi from '../../api/settingsApi';
import CloudSetupSteps from './CloudSetupSteps';
import deploymentsApi from '../../api/deploymentsApi';

/**
 * Everything about AWS, in one place.
 *
 * Deliberately the same page as the Google Cloud one — same tabs, same order,
 * same words for the same ideas — because the point of the Cloud section is
 * that knowing your way around one provider means knowing your way around the
 * other. Two of the three tabs are literally the same component with a
 * different `cloud` prop; only the connection form differs, because that is
 * where the vocabularies genuinely diverge (account not project, security
 * group not firewall rule, instance profile not service account).
 *
 * ── The orphans tab ──
 *
 * Backed by a real sweep (`jobs/awsReconciler.js`), which is the only reason
 * it exists: a screen that always says "all clear" whether or not anything is
 * actually being checked is worse than no screen. That sweep asks every region
 * this platform is set up in, because `DescribeInstances` is regional and a
 * single-region sweep would report all-clear while a machine in another region
 * billed by the hour.
 *
 * AWS status polling and the billing clock are still to come; they are a
 * separate job on their own schedule and do not gate this.
 */

/**
 * AWS instance types are `family.size` — `m6i.xlarge`, `g4dn.12xlarge`.
 * Google's are `e2-medium`. A field that accepted either would let a Google
 * name be typed into the AWS cost table, where it can never match anything and
 * would silently leave the real instance type unpriced.
 */
const AWS_TYPE_PATTERN = /^[a-z0-9]+\.[a-z0-9]+$/;

const AwsPage = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [aws, setAws] = useState({});
  const [orphans, setOrphans] = useState(0);
  const [regionCosts, setRegionCosts] = useState([]);
  const [regionsWaiting, setRegionsWaiting] = useState(0);

  const loadSummary = useCallback(async () => {
    const [data, orph, costs, builds] = await Promise.all([
      settingsApi.getSettings().catch(() => null),
      // This cloud's own, so the badge counts AWS machines rather than every
      // cloud's — a count that moves when Google has a problem would be read
      // as an AWS problem.
      deploymentsApi.getOrphans({ cloud: 'aws', limit: 1 }).catch(() => null),
      // For the setup steps: whether this cloud's regions have been costed.
      settingsApi.getRegionCosts().catch(() => null),
      // Orders held because their region has no network yet.
      settingsApi.getRegionBuilds().catch(() => null),
    ]);
    setAws(data?.settings?.awsSettings || {});
    setOrphans(orph?.unresolved || 0);
    setRegionCosts((costs?.regions || []).filter((r) => r.cloud === 'aws'));
    setRegionsWaiting(
      (builds?.waiting || []).reduce((sum, w) => sum + (w.waitingDeployments || 0), 0),
    );
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  /** The one-word state, visible from every tab. */
  const state = (() => {
    if (!aws.accountId || !aws.hasSecretAccessKey) return { text: 'Not connected', color: 'default' };
    if (!aws.enabled) return { text: 'Off', color: 'default' };
    if (aws.dryRun !== false) return { text: 'Dry run', color: 'blue' };
    return { text: 'Live', color: 'orange' };
  })();

  const items = [
    {
      key: 'connection',
      label: <Space><ApiOutlined />Connection</Space>,
      children: <AwsConnectionTab onSaved={loadSummary} />,
    },
    {
      key: 'provisioning',
      label: <Space><ThunderboltOutlined />Provisioning</Space>,
      children: <CloudProvisioningTab cloud="aws" label="AWS" onSaved={loadSummary} />,
    },
    {
      key: 'pricing',
      label: <Space><DollarOutlined />Pricing</Space>,
      children: (
        <CloudPricingTab
          cloud="aws"
          label="AWS"
          typePattern={AWS_TYPE_PATTERN}
          typePlaceholder="m6i.xlarge"
          costPlaceholder="0.19200"
        />
      ),
    },
    {
      key: 'regions',
      label: (
        <Space>
          <GlobalOutlined />
          Regions
          {/*
            * Badged for the same reason orphans are: a held order earns
            * nothing and appears nowhere else. On AWS a network belongs to one
            * region, so an order in a region nobody has built waits until
            * somebody does — and a tab nobody opens is the wrong place to keep
            * that number.
            */}
          {regionsWaiting > 0 && <Badge count={regionsWaiting} />}
        </Space>
      ),
      children: <CloudRegionBuilds />,
    },
    {
      key: 'orphans',
      label: (
        <Space>
          <DisconnectOutlined />
          Orphaned machines
          {/*
            * Badged, because an orphan bills by the hour and appears nowhere
            * else. A tab nobody opens is the wrong place to hide that.
            */}
          {orphans > 0 && <Badge count={orphans} />}
        </Space>
      ),
      children: <CloudOrphansPanel cloud="aws" label="AWS" onChanged={loadSummary} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Amazon Web Services"
        subtitle="Credentials, automatic provisioning, what it costs, and machines nobody owns"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Cloud', path: '/cloud' }, { label: 'AWS' }]}
        extra={<Tag color={state.color}>{state.text}</Tag>}
      />
      {/*
        * What state this cloud is in and what to do next, above the tabs that
        * hold the detail. On AWS this matters more than on Google: a region
        * with no network in it looks exactly like a working one until a
        * customer's machine fails to build there.
        */}
      <CloudSetupSteps
        cloud="aws"
        label="AWS"
        settings={aws}
        regionCosts={regionCosts}
        onGoToTab={(tab) => (tab === 'overview' ? navigate('/cloud') : setParams({ tab }))}
      />

      <Tabs
        activeKey={params.get('tab') || 'connection'}
        // Kept in the URL so an admin can link a colleague straight to the tab
        // they mean, and so a refresh does not throw them back to the start.
        onChange={(key) => setParams({ tab: key })}
        items={items}
        destroyInactiveTabPane
      />
    </div>
  );
};

export default AwsPage;
