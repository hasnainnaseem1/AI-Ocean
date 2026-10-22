import React, { useState, useEffect, useCallback } from 'react';
import { Tabs, Space, Tag, Badge } from 'antd';
import {
  ApiOutlined, ThunderboltOutlined, DollarOutlined, DisconnectOutlined,
} from '@ant-design/icons';
import { useSearchParams, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import GcpConnectionTab from './GcpConnectionTab';
import CloudProvisioningTab from './CloudProvisioningTab';
import CloudPricingTab from './CloudPricingTab';
import CloudOrphansPanel from './CloudOrphansPanel';
import settingsApi from '../../api/settingsApi';
import CloudSetupSteps from './CloudSetupSteps';
import deploymentsApi from '../../api/deploymentsApi';

/**
 * Everything about Google Cloud, in one place.
 *
 * ── Why this is a page and not a tab on Integrations ──
 *
 * Integrations is about services the platform *talks to* — a payment gateway,
 * an SMTP server. Those are one form each. A cloud provider is not that: it has
 * credentials, a kill switch, spending limits, a pricing source, and machines
 * that outlive any of it. Squeezed into one long form it was genuinely hard to
 * manage, which is the complaint that produced this page.
 *
 * So the four things an operator actually does are four tabs, in the order they
 * happen: connect it, decide whether it builds, decide what it costs, then deal
 * with what it left behind.
 */
const GoogleCloudPage = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);

  const loadSummary = useCallback(async () => {
    const [settings, orphans, costs] = await Promise.all([
      settingsApi.getSettings().catch(() => null),
      // This cloud's own, so the badge is not moved by an AWS problem.
      deploymentsApi.getOrphans({ cloud: 'gcp', limit: 1 }).catch(() => null),
      // For the setup steps: whether this cloud's regions have been costed.
      settingsApi.getRegionCosts().catch(() => null),
    ]);
    setSummary({
      gcp: settings?.settings?.gcpSettings || {},
      unresolvedOrphans: orphans?.unresolved || 0,
      regionCosts: (costs?.regions || []).filter((r) => r.cloud === 'gcp'),
    });
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const gcp = summary?.gcp || {};

  /** The one-word state, so it is visible from every tab. */
  const state = (() => {
    if (!gcp.projectId) return { text: 'Not connected', color: 'default' };
    if (!gcp.enabled) return { text: 'Off', color: 'default' };
    if (gcp.dryRun !== false) return { text: 'Dry run', color: 'blue' };
    return { text: 'Live', color: 'orange' };
  })();

  const items = [
    {
      key: 'connection',
      label: <Space><ApiOutlined />Connection</Space>,
      children: <GcpConnectionTab onSaved={loadSummary} />,
    },
    {
      key: 'provisioning',
      label: <Space><ThunderboltOutlined />Provisioning</Space>,
      children: <CloudProvisioningTab cloud="gcp" label="Google Cloud" onSaved={loadSummary} />,
    },
    {
      key: 'pricing',
      label: <Space><DollarOutlined />Pricing</Space>,
      children: <CloudPricingTab cloud="gcp" label="Google Cloud" />,
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
          {summary?.unresolvedOrphans > 0 && <Badge count={summary.unresolvedOrphans} />}
        </Space>
      ),
      children: <CloudOrphansPanel cloud="gcp" label="Google Cloud" onChanged={loadSummary} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Google Cloud"
        subtitle="Credentials, automatic provisioning, what it costs, and machines nobody owns"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Cloud', path: '/cloud' }, { label: 'Google Cloud' }]}
        extra={<Tag color={state.color}>{state.text}</Tag>}
      />
      {/*
        * What state this cloud is in and what to do next, above the tabs that
        * hold the detail. Without it an operator could fill in every field and
        * still have nothing happen, with no way to find out why.
        */}
      <CloudSetupSteps
        cloud="gcp"
        label="Google Cloud"
        settings={gcp}
        regionCosts={summary?.regionCosts || []}
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

export default GoogleCloudPage;
