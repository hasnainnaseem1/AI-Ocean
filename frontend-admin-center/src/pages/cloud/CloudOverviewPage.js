import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Space, Tag, Typography, Button, Divider, Spin, Statistic, Alert,
  Select, Switch, message,
} from 'antd';
import {
  CloudServerOutlined, ArrowRightOutlined, CheckCircleOutlined,
  CloseCircleOutlined, DisconnectOutlined, ApartmentOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import CloudPricingSettings from '../../components/settings/CloudPricingSettings';
import CloudRegionCosts from './CloudRegionCosts';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';
import settingsApi from '../../api/settingsApi';
import deploymentsApi from '../../api/deploymentsApi';
import { IconTile } from '../../components/StatRow';
import { useTheme } from '../../contexts/ThemeContext';
import { adminCardStyle, hairline } from '../../theme/colors';

const { Text, Paragraph } = Typography;

/**
 * Every cloud this platform can use, and the one policy they share.
 *
 * ── Why the cost policy lives here and not inside a provider ──
 *
 * Overhead, tax and margin are not facts about Google — they are facts about
 * this business. They apply identically to a machine on any provider, and a
 * copy of them per provider would be two numbers that drift apart and then
 * disagree about whether the same tier is profitable.
 *
 * What IS per-provider — credentials, switches, price source — lives on that
 * provider's own page.
 */
const CloudOverviewPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const { isDark } = useTheme();
  const canEdit = hasPermission(PERMISSIONS.SETTINGS_EDIT);

  const [loading, setLoading] = useState(true);
  const [gcp, setGcp] = useState({});
  const [aws, setAws] = useState({});
  const [routing, setRouting] = useState({});
  const [status, setStatus] = useState(null);
  const [awsStatus, setAwsStatus] = useState(null);
  const [orphans, setOrphans] = useState(0);
  // Per cloud, so the alert can send an admin to the page that can act on it.
  const [orphansByCloud, setOrphansByCloud] = useState({});
  const [savingDefault, setSavingDefault] = useState(false);
  const [togglingCloud, setTogglingCloud] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [settings, pricing, awsPricing, orph] = await Promise.all([
      settingsApi.getSettings().catch(() => null),
      deploymentsApi.getPricingStatus({ cloud: 'gcp' }).catch(() => null),
      deploymentsApi.getPricingStatus({ cloud: 'aws' }).catch(() => null),
      deploymentsApi.getOrphans({ limit: 1 }).catch(() => null),
    ]);
    setGcp(settings?.settings?.gcpSettings || {});
    setAws(settings?.settings?.awsSettings || {});
    setRouting(settings?.settings?.cloudRoutingSettings || {});
    setStatus(pricing);
    setAwsStatus(awsPricing);
    setOrphans(orph?.unresolved || 0);
    setOrphansByCloud(orph?.unresolvedByCloud || {});
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const awsState = (() => {
    if (!aws.accountId || !aws.hasSecretAccessKey) {
      return { text: 'Not connected', color: 'default', tone: 'neutral' };
    }
    if (!aws.enabled) return { text: 'Off', color: 'default', tone: 'neutral' };
    if (aws.dryRun !== false) return { text: 'Dry run', color: 'blue', tone: 'info' };
    return { text: 'Live — building real machines', color: 'orange', tone: 'warning' };
  })();

  const gcpState = (() => {
    if (!gcp.projectId) return { text: 'Not connected', color: 'default', tone: 'neutral' };
    if (!gcp.enabled) return { text: 'Off', color: 'default', tone: 'neutral' };
    if (gcp.dryRun !== false) return { text: 'Dry run', color: 'blue', tone: 'info' };
    return { text: 'Live — building real machines', color: 'orange', tone: 'warning' };
  })();

  const providers = [
    {
      key: 'gcp',
      label: 'Google Cloud',
      tone: 'blue',
      to: '/cloud/gcp',
      state: gcpState,
      ready: true,
      enabled: !!gcp.enabled,
      connected: !!(gcp.projectId && gcp.hasServiceAccountKey),
      rows: [
        ['Project', gcp.projectId || 'Not set'],
        ['Credentials', gcp.hasServiceAccountKey ? 'Stored (encrypted)' : 'Not stored'],
        ['Builds machines', gcp.enabled && gcp.dryRun === false ? 'Yes' : 'No'],
        ['Live prices', status?.live?.ok
          ? (status.live.source === 'gcp:account' ? 'Yes — your account rates' : 'Yes — public list rates')
          : 'No'],
      ],
    },
    {
      key: 'aws',
      label: 'Amazon Web Services',
      tone: 'amber',
      to: '/cloud/aws',
      state: awsState,
      ready: true,
      enabled: !!aws.enabled,
      connected: !!(aws.accountId && aws.hasSecretAccessKey),
      rows: [
        ['Account', aws.accountId || 'Not set'],
        ['Credentials', aws.hasSecretAccessKey ? 'Stored (encrypted)' : 'Not stored'],
        ['Builds machines', aws.enabled && aws.dryRun === false ? 'Yes' : 'No'],
        ['Live prices', awsStatus?.live?.ok ? 'Yes' : 'No'],
      ],
    },
  ];

  /*
   * Which clouds are actually on. The default-cloud choice only means anything
   * when more than one is — with a single cloud on, the router uses it without
   * consulting a default at all.
   */
  const enabled = [
    ...(gcp.enabled ? [{ value: 'gcp', label: 'Google Cloud' }] : []),
    ...(aws.enabled ? [{ value: 'aws', label: 'Amazon Web Services' }] : []),
  ];

  /**
   * Turn a cloud on or off from here.
   *
   * Only `enabled` is sent: the rest of that cloud's settings are its own
   * screen's business, and a partial save from here that carried stale form
   * values would quietly overwrite them.
   */
  const toggleCloud = async (cloud, on) => {
    setTogglingCloud(cloud);
    try {
      const update = cloud === 'aws' ? settingsApi.updateAws : settingsApi.updateGcp;
      await update({ enabled: on });
      message.success(on
        ? `${cloud === 'aws' ? 'AWS' : 'Google Cloud'} is on. It still needs dry run turned off before it builds anything for real.`
        : `${cloud === 'aws' ? 'AWS' : 'Google Cloud'} is off. Machines already running there are not affected.`);
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not change that');
    } finally {
      setTogglingCloud(null);
    }
  };

  const setDefaultCloud = async (value) => {
    setSavingDefault(true);
    try {
      const data = await settingsApi.updateCloudRouting({ defaultCloud: value || '' });
      message.success(data.message || 'Saved');
      setRouting({ defaultCloud: value || '' });
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
    } finally {
      setSavingDefault(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Cloud"
        subtitle="The providers this platform builds customer machines on, and what a machine-hour really costs"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Cloud' }]}
      />

      <Spin spinning={loading}>
        {orphans > 0 && (
          <Alert
            type="error"
            showIcon
            icon={<DisconnectOutlined />}
            style={{ marginBottom: 14, borderRadius: 10 }}
            message={orphans === 1
              ? '1 machine is billing with nobody paying for it'
              : `${orphans} machines are billing with nobody paying for them`}
            /*
             * Broken down per cloud, because each cloud's orphans are resolved
             * on that cloud's page — a single "Review" button that always went
             * to Google would be a dead end for an AWS machine, which is the
             * one that is still costing money.
             */
            description={Object.keys(orphansByCloud).length > 1
              ? Object.entries(orphansByCloud)
                .map(([c, n]) => `${n} on ${c === 'aws' ? 'AWS' : 'Google Cloud'}`)
                .join(', ')
              : undefined}
            action={(
              <Space direction="vertical" size={4}>
                {Object.entries(orphansByCloud)
                  .filter(([, n]) => n > 0)
                  .map(([c]) => (
                    <Button key={c} size="small" onClick={() => navigate(`/cloud/${c}?tab=orphans`)}>
                      Review {c === 'aws' ? 'AWS' : 'Google'}
                    </Button>
                  ))}
              </Space>
            )}
          />
        )}

        <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
          {providers.map((p) => (
            <Col xs={24} md={12} key={p.key}>
              <div
                className="card-hover"
                style={{
                  ...adminCardStyle(isDark),
                  padding: 18,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  opacity: p.ready ? 1 : 0.75,
                }}
              >
                <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Space>
                    <IconTile icon={<CloudServerOutlined />} tone={p.tone} size={40} />
                    <div>
                      <Text strong style={{ fontSize: 15, display: 'block' }}>{p.label}</Text>
                      <Tag color={p.state.color} style={{ marginTop: 4 }}>{p.state.text}</Tag>
                    </div>
                  </Space>
                </Space>

                <div style={{ flex: 1 }}>
                  {p.rows.map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '5px 0',
                        borderBottom: `1px solid ${hairline(isDark)}`,
                      }}
                    >
                      <Text type="secondary" style={{ fontSize: 12.5 }}>{label}</Text>
                      <Text style={{ fontSize: 12.5, textAlign: 'right' }}>{value}</Text>
                    </div>
                  ))}
                </div>

                {/*
                  * The on/off switch, here rather than only two levels down on
                  * the cloud's Provisioning tab.
                  *
                  * It is the first thing somebody setting this up needs and the
                  * last thing they could find: both of the controls that make a
                  * two-cloud platform work — the per-model assignment and the
                  * default cloud — appear only once two clouds are ON, so the
                  * screen that would tell you two clouds are possible was itself
                  * hidden until you already had them.
                  */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '10px 0 2px',
                    borderTop: `1px solid ${hairline(isDark)}`,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13, display: 'block' }}>
                      Build machines here
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {p.connected
                        ? 'Both clouds can be on at once.'
                        : 'Connect it first — a switch with no credential does nothing.'}
                    </Text>
                  </div>
                  <Switch
                    checked={!!p.enabled}
                    disabled={!canEdit || !p.connected || togglingCloud === p.key}
                    loading={togglingCloud === p.key}
                    onChange={(on) => toggleCloud(p.key, on)}
                    checkedChildren="On"
                    unCheckedChildren="Off"
                  />
                </div>

                <Button
                  type={p.ready ? 'primary' : 'default'}
                  icon={<ArrowRightOutlined />}
                  onClick={() => navigate(p.to)}
                  block
                >
                  {p.ready ? 'Manage' : 'What it would take'}
                </Button>
              </div>
            </Col>
          ))}
        </Row>

        {/* The health of the price source, said once, where both providers meet. */}
        <Row gutter={[16, 16]} style={{ marginTop: 6, marginBottom: 6 }}>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ borderRadius: 12 }}>
              <Statistic
                title="Cost figures come from"
                value={status?.live?.ok ? 'The provider, live' : `${status?.recorded?.count ?? 0} typed by hand`}
                valueStyle={{ fontSize: 16 }}
                prefix={status?.live?.ok
                  ? <CheckCircleOutlined style={{ color: '#1A9655' }} />
                  : <CloseCircleOutlined style={{ color: '#C97E14' }} />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ borderRadius: 12 }}>
              <Statistic
                title="Margin guard"
                value={gcp.enforceMarginGuard === false ? 'Off' : 'Enforced'}
                valueStyle={{ fontSize: 16, color: gcp.enforceMarginGuard === false ? '#C97E14' : undefined }}
              />
            </Card>
          </Col>
          <Col xs={24} sm={8}>
            <Card size="small" style={{ borderRadius: 12 }}>
              <Statistic
                title="Machines with no owner"
                value={orphans}
                valueStyle={{ fontSize: 16, color: orphans > 0 ? '#DC3D42' : undefined }}
              />
            </Card>
          </Col>
        </Row>

        {/*
          * Which cloud wins when nothing else says.
          *
          * Shown only when more than one cloud is on, because that is the only
          * time it decides anything — with a single cloud the router uses it
          * without consulting a default at all. A control that does nothing is
          * worse than an absent one: somebody sets it and expects an effect.
          */}
        {/*
          * With fewer than two clouds on, the default-cloud control decides
          * nothing — but something still has to be said, because the two
          * features that make a two-cloud platform work (this, and assigning
          * each model to a cloud) BOTH appear only once two clouds are on. An
          * operator who has never had two on has no way to learn they exist.
          */}
        {enabled.length <= 1 && (
          <Card
            style={{ borderRadius: 12, marginTop: 20 }}
            title={<Space><ApartmentOutlined />Running both clouds at once</Space>}
          >
            <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0, maxWidth: 820 }}>
              {enabled.length === 0
                ? 'Neither cloud is on, so nothing is being built automatically.'
                : `Only ${enabled[0].label} is on, so every deployment goes there and nothing has to choose.`}
              {' '}Switch the other one on above and two more controls appear: each model can be
              sent to the cloud that suits it — under <Text strong>AI Models</Text>, a
              {' '}<Text strong>Cloud</Text> column — and this card becomes the fallback for models
              you have not assigned.
            </Paragraph>
          </Card>
        )}

        {enabled.length > 1 && (
          <Card
            style={{ borderRadius: 12, marginTop: 20 }}
            title={<Space><ApartmentOutlined />Where deployments go by default</Space>}
          >
            <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 14 }}>
              Both clouds are on, so each model can be sent to whichever one suits it — set that on
              the model itself under <Text strong>AI Models</Text>. This is the fallback for models
              you have not assigned.
            </Paragraph>
            <Space wrap align="center">
              <Select
                value={routing.defaultCloud || ''}
                onChange={setDefaultCloud}
                loading={savingDefault}
                disabled={!canEdit || savingDefault}
                style={{ minWidth: 260 }}
                size="large"
                options={[
                  { value: '', label: 'No default — unassigned models wait for an admin' },
                  ...enabled,
                ]}
              />
              {!routing.defaultCloud && (
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  With two clouds on and no default, a model nobody has assigned goes to the
                  fulfilment queue rather than being sent somewhere arbitrary.
                </Text>
              )}
            </Space>
            <Paragraph type="secondary" style={{ fontSize: 12, margin: '12px 0 0' }}>
              Changing this only affects deployments created from now on. Every machine already
              running stays on the cloud it was built on — that is frozen onto the deployment, so
              a destroy order can never go to the wrong provider.
            </Paragraph>
          </Card>
        )}

        {/* `titlePlacement`: antd now reads `orientation` as horizontal/vertical. */}
        <Divider titlePlacement="left" plain style={{ marginTop: 24 }}>
          What a machine-hour really costs
        </Divider>

        <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16, maxWidth: 820 }}>
          These apply to every cloud. They are facts about this business, not about any provider —
          so there is one copy of them, and a tier&apos;s price floor is the same whichever cloud
          its machine ends up on.
        </Paragraph>

        <Card style={{ borderRadius: 12 }}>
          <CloudPricingSettings canUpdate={canEdit} />
        </Card>

        {/*
          * Below the shared policy, because it is the same kind of thing —
          * what a machine-hour truly costs — but the one part of it that
          * differs per region rather than applying everywhere.
          */}
        <div style={{ marginTop: 16 }}>
          <CloudRegionCosts />
        </div>
      </Spin>
    </div>
  );
};

export default CloudOverviewPage;
