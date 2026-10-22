import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Typography, Space, Button, Tag, Alert, Modal, message, Steps, Empty,
} from 'antd';
import {
  SyncOutlined, CheckCircleOutlined, ClockCircleOutlined, ToolOutlined,
  WarningOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';

const { Text, Paragraph } = Typography;

/**
 * Which regions have a network, and which customers are waiting for one.
 *
 * ── Why this screen exists at all ──
 *
 * The platform sells a region before it builds one, and that is deliberate: it
 * is what puts the region's standing cost — on AWS, its NAT gateways, charged
 * per zone whether anything uses them or not — inside every price from the day
 * the region is costed. So the customer who happens to be the first one in a
 * region pays the same rate as the hundredth and subsidises nobody.
 *
 * The consequence is that "we sell this region" and "we have built this
 * region" are two different facts, and somebody has to be able to see the
 * second one. Before this screen, the first order into an unbuilt region was
 * marked failed, and the only trace was a notification.
 *
 * ── What this screen will not do ──
 *
 * It does not run the apply. The platform's own AWS key can start and stop
 * machines and nothing else — it cannot create or change a network. That is
 * not an oversight to be fixed by adding a button: a key able to change a
 * network, held anywhere the running platform can read it, would make the
 * promise that one customer's machine can never reach another's unprovable.
 *
 * So the button records the request and shows the two commands to run. The
 * customer's order waits either way, and starts on its own once the ids are
 * saved.
 */

/**
 * Each state as a sentence, not a label.
 *
 * These are read by whoever is on call, which may not be the person who built
 * the platform. "unbuilt" tells them nothing; "nothing here yet — no orders
 * waiting" tells them whether to act.
 */
const STATE_VIEW = {
  built: {
    color: 'success',
    icon: <CheckCircleOutlined />,
    label: 'Ready',
    says: 'Machines can start here now.',
  },
  wanted: {
    color: 'warning',
    icon: <ClockCircleOutlined />,
    label: 'Customers waiting',
    says: 'Orders are held here, waiting for this region to be built.',
  },
  building: {
    color: 'processing',
    icon: <SyncOutlined spin />,
    label: 'Being built',
    says: 'Someone is running the apply. Orders will start when the ids are saved.',
  },
  failed: {
    color: 'error',
    icon: <WarningOutlined />,
    label: 'Build failed',
    says: 'The last attempt did not finish. Orders are still waiting, not lost.',
  },
  unbuilt: {
    color: 'default',
    icon: null,
    label: 'Not built yet',
    says: 'Nothing has been built here. No orders are waiting.',
  },
};

const CloudRegionBuilds = () => {
  const { hasPermission } = usePermission();
  const canEdit = hasPermission(PERMISSIONS.SETTINGS_EDIT);

  const [rows, setRows] = useState([]);
  const [waiting, setWaiting] = useState([]);
  const [worker, setWorker] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [steps, setSteps] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await settingsApi.getRegionBuilds();
      setRows(data.regions || []);
      setWaiting(data.waiting || []);
      setWorker(data.worker || null);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not load region build states');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const build = async (region) => {
    setBusy(region);
    try {
      const data = await settingsApi.buildRegion(region);
      // The commands, kept on screen — this is the moment they are needed.
      setSteps({ region, ...data });
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || `Could not mark ${region} as building`);
    } finally {
      setBusy(null);
    }
  };

  const markFailed = (region) => Modal.confirm({
    title: `Record the build of ${region} as failed?`,
    icon: <ExclamationCircleOutlined />,
    content: (
      <Paragraph style={{ marginBottom: 0 }}>
        Use this when an apply did not finish. The region stops showing as being built so it
        can be tried again. <Text strong>Customer orders keep waiting rather than failing</Text>,
        so nothing is lost.
      </Paragraph>
    ),
    okText: 'Record as failed',
    onOk: async () => {
      try {
        await settingsApi.failRegionBuild(region, 'Recorded as failed from the admin centre.');
        message.success(`${region} can be built again.`);
        await load();
      } catch (err) {
        message.error(err.response?.data?.message || 'Could not record the failure');
      }
    },
  });

  const columns = [
    {
      title: 'Region',
      dataIndex: 'region',
      render: (region, row) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ fontFamily: 'monospace' }}>{region}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            sold as {row.platformRegion}
          </Text>
        </Space>
      ),
    },
    {
      title: 'State',
      dataIndex: 'buildState',
      render: (state) => {
        const view = STATE_VIEW[state] || STATE_VIEW.unbuilt;
        return (
          <Space direction="vertical" size={0}>
            <Tag color={view.color} icon={view.icon}>{view.label}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>{view.says}</Text>
          </Space>
        );
      },
    },
    {
      title: 'Orders waiting',
      dataIndex: 'waitingDeployments',
      align: 'right',
      render: (n, row) => {
        if (!n) return <Text type="secondary">—</Text>;
        // The only number on this screen that is costing money right now.
        return (
          <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
            <Text strong type={row.buildState === 'built' ? undefined : 'danger'}>{n}</Text>
            {row.buildWantedAt && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                since {new Date(row.buildWantedAt).toLocaleString()}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Priced',
      dataIndex: 'costed',
      align: 'center',
      render: (costed) => (costed
        ? <Tag color="success">Yes</Tag>
        : (
          <Tag color="warning">
            {/* A region with no standing cost recorded cannot be sold: a tier
                priced on the machine alone is short by the region's whole
                standing cost, and tier creation refuses it. */}
            Not costed
          </Tag>
        )),
    },
    {
      title: '',
      align: 'right',
      render: (_, row) => {
        if (!canEdit) return null;
        if (row.buildState === 'built') return null;

        return (
          <Space>
            {row.canBuild && (
              <Button
                type={row.waitingDeployments > 0 ? 'primary' : 'default'}
                size="small"
                icon={<ToolOutlined />}
                loading={busy === row.region}
                onClick={() => build(row.region)}
              >
                Build this region
              </Button>
            )}
            {row.buildState === 'building' && (
              <Button size="small" danger onClick={() => markFailed(row.region)}>
                It failed
              </Button>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <>
      <Card
        size="small"
        title={<Space><ToolOutlined />Regions and their networks</Space>}
        extra={(
          <Button size="small" icon={<SyncOutlined />} onClick={load} loading={loading}>
            Refresh
          </Button>
        )}
      >
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          On AWS a network belongs to one region, so each region needs its own before a machine
          can start there. Prices already include what a region costs to keep open, so a region
          can be sold before it is built — the first order there simply waits.
        </Paragraph>

        {/*
          * What this screen's button MEANS, which is not fixed.
          *
          * With a build worker running, asking for a region builds it. Without
          * one, the request is a note and somebody has to run the commands.
          * Same button, two outcomes — and an admin who assumes the first
          * while the second is true watches a region that never gets built,
          * with customer orders waiting behind it.
          */}
        {worker && (
          <Alert
            type={worker.running ? 'success' : 'info'}
            showIcon
            style={{ marginBottom: 12 }}
            message={worker.running
              ? 'Regions are built automatically'
              : 'Regions are built by hand'}
            description={worker.running
              ? 'A build worker is running, so a region builds itself the moment a customer '
                + 'orders in it — no button needed — as long as a tier is actually sold there. '
                + 'It uses its own separate credentials; the platform itself still cannot '
                + 'create or change a network.'
              : 'No build worker is running, so a customer ordering in a new region waits until '
                + 'somebody runs the commands. Use the button below to get them. Nothing is '
                + 'charged while an order waits, and it starts on its own once the ids are saved.'}
          />
        )}

        {waiting.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${waiting.reduce((sum, w) => sum + w.waitingDeployments, 0)} order(s) are waiting for a region`}
            description={(
              <Space direction="vertical" size={2}>
                {waiting.map((w) => (
                  <Text key={w.region}>
                    <Text strong style={{ fontFamily: 'monospace' }}>{w.region}</Text>
                    {' — '}
                    {w.waitingDeployments} order(s)
                    {w.wantedAt && ` since ${new Date(w.wantedAt).toLocaleString()}`}
                  </Text>
                ))}
                <Text type="secondary">
                  Nothing is charged while an order waits, and each one starts on its own once
                  its region&apos;s ids are saved.
                </Text>
              </Space>
            )}
          />
        )}

        <Table
          rowKey="region"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={false}
          locale={{ emptyText: <Empty description="No regions are configured to sell yet" /> }}
        />
      </Card>

      <Modal
        open={!!steps}
        onCancel={() => setSteps(null)}
        onOk={() => setSteps(null)}
        okText="Done"
        cancelButtonProps={{ style: { display: 'none' } }}
        width={680}
        title={`Build ${steps?.region || ''}`}
      >
        {steps && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert
              type="info"
              showIcon
              message="Run these yourself, with your own credentials"
              description={steps.howToRun?.note}
            />

            <Steps
              direction="vertical"
              size="small"
              current={-1}
              items={(steps.howToRun?.steps || []).map((s, i) => ({
                title: i < 2
                  ? <Text code copyable={{ text: s }} style={{ fontSize: 13 }}>{s}</Text>
                  : <Text style={{ fontSize: 13 }}>{s}</Text>,
              }))}
            />

            <Alert
              type="warning"
              showIcon
              message="This starts a standing charge"
              description={steps.howToRun?.costWarning}
            />

            {steps.waitingDeployments > 0 && (
              <Alert
                type="success"
                showIcon
                message={`${steps.waitingDeployments} order(s) will start on their own`}
                description="Once the ids are saved, the waiting orders are retried within a minute. Nobody needs to touch them."
              />
            )}
          </Space>
        )}
      </Modal>
    </>
  );
};

export default CloudRegionBuilds;
