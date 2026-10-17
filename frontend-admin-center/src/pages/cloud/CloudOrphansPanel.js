import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Button, Space, Modal, message, Typography, Alert,
  Segmented, Tooltip, Descriptions,
} from 'antd';
import {
  CloudServerOutlined, ReloadOutlined, DeleteOutlined, CheckOutlined,
  DisconnectOutlined, WarningOutlined, SyncOutlined,
} from '@ant-design/icons';
import { usePermission } from '../../hooks/usePermission';
import deploymentsApi from '../../api/deploymentsApi';
import { PERMISSIONS } from '../../utils/permissions';

const { Text, Paragraph } = Typography;

/**
 * Machines on one cloud that this platform created and can no longer account
 * for.
 *
 * ── Why this page is not a cleanup button ──
 *
 * The reconciler finds these and writes them down. It never deletes them, and
 * that is the single most important decision in the whole sweep: a bug in it
 * would otherwise destroy live customer workloads, and "our bookkeeping lost
 * track of it" is not evidence that a machine is idle. So the sweep raises, a
 * person decides, and the decision is one machine at a time with that machine's
 * labels and status in front of them.
 *
 * Three answers, and only one touches the cloud:
 *
 *   Destroy    — delete it. Irreversible, and the customer's disk goes with it.
 *   Keep       — it is ours and should keep running. Recorded, nothing deleted.
 *   Not ours   — the label matched but it is not this platform's. Left alone.
 *
 * ── Why an orphan is urgent ──
 *
 * It bills by the hour, no customer is paying for it, and it appears nowhere
 * else in this console. That is the one failure mode on the platform that costs
 * money indefinitely while being invisible, which is why the empty state here
 * is good news and says so.
 *
 * ── Why this takes a `cloud` ──
 *
 * The same component serves both clouds, the way the provisioning and pricing
 * tabs already do. The list is filtered server-side by provider so each cloud's
 * page shows its own, and the destroy call dispatches on the provider recorded
 * on the row — never on which page the button was pressed from.
 */

const when = (d) =>
  (d ? new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const CLOUD_STATUS_TONE = {
  RUNNING: 'error', // the expensive one
  STAGING: 'warning',
  PROVISIONING: 'warning',
  STOPPING: 'warning',
  TERMINATED: 'default',
  SUSPENDED: 'default',
};

const RESOLUTION_META = {
  destroyed: { color: 'red', label: 'Destroyed' },
  kept: { color: 'green', label: 'Kept' },
  not_ours: { color: 'default', label: 'Not ours' },
};

const CloudOrphansPanel = ({ onChanged, cloud = 'gcp', label = 'Google Cloud' }) => {
  const { hasPermission } = usePermission();
  const canManage = hasPermission(PERMISSIONS.DEPLOYMENTS_MANAGE);

  const [rows, setRows] = useState([]);
  const [unresolved, setUnresolved] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [view, setView] = useState('open');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await deploymentsApi.getOrphans({
        resolved: view === 'resolved' ? 'true' : undefined,
        // Filtered server-side, so this page shows only its own cloud's.
        cloud,
        limit: 100,
      });
      setRows(data.orphans || []);
      setUnresolved(data.unresolved || 0);
      // The tab badge lives on the parent; keep it in step.
      if (onChanged) onChanged();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not load orphaned machines');
    } finally {
      setLoading(false);
    }
  }, [view, cloud, onChanged]);

  useEffect(() => { load(); }, [load]);

  const sweep = async () => {
    setSweeping(true);
    try {
      const data = await deploymentsApi.sweepCloud(cloud);
      const s = data.summary || {};

      if (s.skipped) {
        message.success(s.skipped);
      } else if (s.ran === false) {
        // Switched off, or in dry run — where nothing was ever built, so
        // nothing can be orphaned. Saying "0 found" would imply we looked.
        message.info(`${label} is not building machines right now, so there was nothing to check.`);
      } else if (s.partial) {
        /*
         * A region that could not be read. Said as a warning, because "found
         * 0" after an incomplete sweep is the one message that could talk an
         * admin out of looking further.
         */
        message.warning(
          `Found ${s.orphans ?? 0} with no owner, but could not read `
          + `${(s.regionFailures || []).map((f) => f.region).join(', ')} — there may be more.`
        );
      } else {
        message.success(
          `Checked ${label}; found ${s.orphans ?? 0} machine(s) with no owner.`
        );
      }
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not run the sweep');
    } finally {
      setSweeping(false);
    }
  };

  const resolve = async (row, resolution) => {
    setBusyId(row.id);
    try {
      const data = await deploymentsApi.resolveOrphan(row.id, resolution);
      message.success(data.message || 'Done');
      await load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not resolve this machine');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDestroy = (row) => {
    Modal.confirm({
      title: 'Destroy this machine?',
      icon: <WarningOutlined style={{ color: '#DC3D42' }} />,
      okText: 'Destroy it',
      okButtonProps: { danger: true },
      width: 560,
      content: (
        <div>
          <Paragraph style={{ marginBottom: 10 }}>
            This deletes a real machine on {label}. If it turns out to belong to a
            customer, their work and their disk are gone and cannot be recovered.
          </Paragraph>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Name"><Text code>{row.instanceName}</Text></Descriptions.Item>
            <Descriptions.Item label={cloud === 'aws' ? 'Availability zone' : 'Zone'}>
              <Text code>{row.zone}</Text>
            </Descriptions.Item>
            {/*
              * On AWS the id is the handle — the name is only a tag, and a tag
              * can be edited. Shown so an admin can match it against the EC2
              * console before destroying anything.
              */}
            {cloud === 'aws' && (
              <Descriptions.Item label="Instance id">
                <Text code>{row.instanceId || 'not recorded'}</Text>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Machine type">{row.machineType || '—'}</Descriptions.Item>
            <Descriptions.Item label={`${label} says`}>{row.cloudStatus || '—'}</Descriptions.Item>
            {/* AWS calls them tags; Google calls them labels. Same idea, and
                the word has to match the console the admin is cross-checking. */}
            <Descriptions.Item label={cloud === 'aws' ? 'Tags' : 'Labels'}>
              <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
                {row.labels ? JSON.stringify(row.labels) : '—'}
              </Text>
            </Descriptions.Item>
          </Descriptions>
          <Paragraph type="secondary" style={{ fontSize: 13, marginTop: 10, marginBottom: 0 }}>
            Check the {cloud === 'aws' ? 'tags' : 'labels'} first — <Text code>deployment-id</Text>{' '}
            tells you which deployment it was built for, even when no record of it is left.
          </Paragraph>
        </div>
      ),
      onOk: () => resolve(row, 'destroyed'),
    });
  };

  const columns = [
    {
      title: 'Machine',
      dataIndex: 'instanceName',
      render: (name, row) => (
        <div>
          <Text code style={{ fontSize: 12 }}>{name}</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.zone} · {row.machineType || 'unknown type'}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: `${label} says`,
      dataIndex: 'cloudStatus',
      width: 130,
      render: (status) => (
        <Tag color={CLOUD_STATUS_TONE[status] || 'default'}>{status || 'unknown'}</Tag>
      ),
    },
    {
      title: 'Why it has no owner',
      dataIndex: 'reason',
      render: (reason, row) => (
        <div>
          <Text style={{ fontSize: 13 }}>{reason || '—'}</Text>
          {row.suspectedDeploymentId && (
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                Built for deployment {row.suspectedDeploymentId}
              </Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'First seen',
      dataIndex: 'firstSeenAt',
      width: 170,
      render: (d) => <Text style={{ fontSize: 12 }}>{when(d)}</Text>,
    },
  ];

  if (view === 'resolved') {
    columns.push({
      title: 'Resolution',
      dataIndex: 'resolution',
      width: 200,
      render: (resolution, row) => {
        const meta = RESOLUTION_META[resolution] || { color: 'default', label: resolution };
        return (
          <div>
            <Tag color={meta.color}>{meta.label}</Tag>
            <div>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {row.resolvedBy?.name || 'Unknown'} · {when(row.resolvedAt)}
              </Text>
            </div>
          </div>
        );
      },
    });
  } else if (canManage) {
    columns.push({
      title: 'Decide',
      width: 230,
      render: (_, row) => (
        <Space size={4}>
          <Tooltip title="It is ours and should keep running">
            <Button
              size="small"
              icon={<CheckOutlined />}
              loading={busyId === row.id}
              onClick={() => resolve(row, 'kept')}
            >
              Keep
            </Button>
          </Tooltip>
          <Tooltip title="The label matched but this is not our machine">
            <Button
              size="small"
              icon={<DisconnectOutlined />}
              loading={busyId === row.id}
              onClick={() => resolve(row, 'not_ours')}
            >
              Not ours
            </Button>
          </Tooltip>
          <Tooltip title={`Delete it on ${label}`}>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={busyId === row.id}
              onClick={() => confirmDestroy(row)}
            >
              Destroy
            </Button>
          </Tooltip>
        </Space>
      ),
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 12, flexWrap: 'wrap', marginBottom: 14 }}
      >
        <Text type="secondary" style={{ fontSize: 13 }}>
          Machines on {label} this platform created and can no longer account for. They are
          recorded, never deleted automatically — destroying a machine because our own bookkeeping
          lost track of it is exactly the thing that must not happen on its own.
          {cloud === 'aws'
            ? ' The check runs every 15 minutes and asks every region you have set up.'
            : ' The check runs every minute.'}
        </Text>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Refresh</Button>
          {canManage && (
            <Tooltip title={`Ask ${label} what exists right now instead of waiting for the next run`}>
              <Button type="primary" icon={<SyncOutlined />} onClick={sweep} loading={sweeping}>
                Sweep now
              </Button>
            </Tooltip>
          )}
        </Space>
      </div>

      {unresolved > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 14, borderRadius: 10 }}
          message={unresolved === 1
            ? '1 machine is billing with nobody paying for it'
            : `${unresolved} machines are billing with nobody paying for them`}
          description="Each one costs money by the hour and appears nowhere else in this console. Check the labels, then decide."
        />
      )}

      <Card>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { label: `Needs a decision${unresolved ? ` (${unresolved})` : ''}`, value: 'open' },
            { label: 'Already decided', value: 'resolved' },
          ]}
          style={{ marginBottom: 14 }}
        />

        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{
            emptyText: view === 'open' ? (
              <div style={{ padding: '28px 0' }}>
                <CloudServerOutlined style={{ fontSize: 28, opacity: 0.35 }} />
                <Paragraph style={{ marginTop: 10, marginBottom: 2 }}>
                  <Text strong>Every machine on {label} is accounted for.</Text>
                </Paragraph>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  This is the state you want. A machine shows up here only when it exists on{' '}
                  {label} and nothing on this platform owns it.
                </Text>
              </div>
            ) : (
              <div style={{ padding: '28px 0' }}>
                <Text type="secondary">Nothing has needed a decision yet.</Text>
              </div>
            ),
          }}
        />
      </Card>
    </div>
  );
};

export default CloudOrphansPanel;
