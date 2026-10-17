import React, { useState } from 'react';
import {
  Card, Descriptions, Tag, Space, Button, Modal, message, Typography, Alert, Tooltip,
} from 'antd';
import {
  CloudServerOutlined, ReloadOutlined, PauseCircleOutlined,
  PlayCircleOutlined, DeleteOutlined, WarningOutlined,
} from '@ant-design/icons';
import deploymentsApi from '../../api/deploymentsApi';

const { Text, Paragraph } = Typography;

/**
 * The machine behind a deployment.
 *
 * Renders nothing at all when there is no machine, which is every deployment on
 * a platform that has not been switched over to automatic provisioning. An
 * empty "no cloud machine" card on hundreds of hand-fulfilled deployments would
 * be noise, not information.
 *
 * ── What this panel is for ──
 *
 * The owner asked for no review step: a customer deploys and a VM appears. That
 * takes the admin out of the decision; it must not take them out of the facts.
 * Three questions this answers that nothing else on the page can:
 *
 *   1. **Is it what the customer paid for?** Google has no shape matching some
 *      tiers exactly. The mapper's rule is never to give less than was sold, so
 *      where it had to give more — or could not match a figure at all — "sold"
 *      and "built" differ, and both are shown rather than only the one that
 *      flatters us.
 *   2. **Is the meter running?** A machine reports RUNNING while the deployment
 *      is still `provisioning`, and the customer is charged from that instant.
 *      That gap is deliberate and surprising, so it is stated.
 *   3. **Has the isolation held?** No machine this platform builds asks for an
 *      external IP. One appearing here is a security finding, and it is
 *      rendered as an alarm rather than as another row.
 */

const PHASE_META = {
  planned: { color: 'default', label: 'Queued', hint: 'Waiting to be built.' },
  creating: { color: 'processing', label: 'Building', hint: 'Google is building it; this usually takes under two minutes.' },
  running: { color: 'success', label: 'Running', hint: 'The machine is up, and the customer is being charged for it.' },
  stopping: { color: 'warning', label: 'Stopping', hint: 'Shutting down. Compute is still billable until Google confirms it is down.' },
  stopped: { color: 'default', label: 'Stopped', hint: 'Off, but the disk still exists and is billed as storage.' },
  terminated: { color: 'default', label: 'Destroyed', hint: 'The machine and its disk are gone.' },
  failed: { color: 'error', label: 'Failed', hint: 'The build did not work. The reason is below.' },
};

const when = (d) =>
  (d ? new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/** "16 vCPU · 32 GB · 1x NVIDIA L4" from whichever parts are present. */
const describeShape = (parts) => {
  const out = [];
  if (parts.vcpu) out.push(`${parts.vcpu} vCPU`);
  if (parts.ramGb) out.push(`${parts.ramGb} GB RAM`);
  if (parts.accelerator && parts.acceleratorCount) {
    out.push(`${parts.acceleratorCount}× ${parts.accelerator}`);
  } else if (parts.gpu) {
    out.push(parts.gpu);
  }
  if (parts.storageGb) out.push(`${parts.storageGb} GB ${parts.storageType || ''}`.trim());
  return out.length ? out.join(' · ') : '—';
};

const CloudMachinePanel = ({ deploymentId, instance, canManage, onChanged }) => {
  const [busy, setBusy] = useState(null);
  const [current, setCurrent] = useState(instance);

  // The parent owns the first load; keep in step when it reloads.
  React.useEffect(() => { setCurrent(instance); }, [instance]);

  if (!current) return null;

  const phase = PHASE_META[current.phase] || { color: 'default', label: current.phase, hint: '' };

  const act = async (action) => {
    setBusy(action);
    try {
      const data = await deploymentsApi.instanceAction(deploymentId, action);
      message.success(data.message || 'Done');
      setCurrent(data.instance);
      if (onChanged) onChanged();
    } catch (err) {
      message.error(err.response?.data?.message || `Could not ${action} the machine`);
    } finally {
      setBusy(null);
    }
  };

  const confirmDestroy = () => {
    Modal.confirm({
      title: 'Destroy this machine?',
      icon: <WarningOutlined style={{ color: '#DC3D42' }} />,
      okText: 'Destroy it',
      okButtonProps: { danger: true },
      content: (
        <div>
          <Paragraph style={{ marginBottom: 8 }}>
            <Text code>{current.instanceName}</Text> in <Text code>{current.zone}</Text> will be deleted
            along with its boot disk. The customer&apos;s data on that disk is not recoverable.
          </Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
            This does not change the deployment&apos;s status or refund anything already billed.
          </Paragraph>
        </div>
      ),
      onOk: () => act('destroy'),
    });
  };

  const gone = ['terminated', 'failed'].includes(current.phase);

  /*
   * The difference between what was sold and what was built, as a sentence
   * rather than two tables to compare by eye. Only shown when they differ.
   */
  const soldText = current.sold ? describeShape(current.sold) : null;
  const builtText = describeShape(current.built);
  const differs = soldText && builtText !== '—' && soldText !== builtText;

  return (
    <Card
      title={(
        <Space>
          <CloudServerOutlined />
          Cloud machine
          <Tag color={phase.color}>{phase.label}</Tag>
        </Space>
      )}
      style={{ marginTop: 20 }}
      extra={canManage && (
        <Space size={6}>
          {['failed', 'planned'].includes(current.phase) && (
            <Tooltip title="Build it again on the next reconciler pass">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={busy === 'retry'}
                onClick={() => act('retry')}
              >
                Retry
              </Button>
            </Tooltip>
          )}
          {current.phase === 'running' && (
            <Tooltip title="Stop the machine but keep its disk">
              <Button
                size="small"
                icon={<PauseCircleOutlined />}
                loading={busy === 'stop'}
                onClick={() => act('stop')}
              >
                Stop
              </Button>
            </Tooltip>
          )}
          {current.phase === 'stopped' && (
            <Tooltip title="Start it back up">
              <Button
                size="small"
                icon={<PlayCircleOutlined />}
                loading={busy === 'start'}
                onClick={() => act('start')}
              >
                Start
              </Button>
            </Tooltip>
          )}
          {!gone && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              loading={busy === 'destroy'}
              onClick={confirmDestroy}
            >
              Destroy
            </Button>
          )}
        </Space>
      )}
    >
      {phase.hint && (
        <Paragraph type="secondary" style={{ fontSize: 13, marginTop: -4, marginBottom: 14 }}>
          {phase.hint}
        </Paragraph>
      )}

      {/*
        * An external IP is not a detail. Every machine this platform creates is
        * built with no accessConfigs at all, so a value here means either the
        * posture regressed or something else created the machine — and it is
        * the one thing on this panel that is a security finding rather than a
        * status.
        */}
      {current.externalIp && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 14, borderRadius: 10 }}
          message="This machine has a public IP address"
          description={(
            <>
              No machine this platform builds requests one — customer VMs reach the internet
              through Cloud NAT and are administered over IAP. <Text code>{current.externalIp}</Text> should
              not exist. Check the firewall rules and how this machine was created.
            </>
          )}
        />
      )}

      {current.phase === 'failed' && current.lastError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 14, borderRadius: 10 }}
          message={current.lastErrorCode || 'The build failed'}
          description={current.lastError}
        />
      )}

      {current.phase !== 'failed' && current.lastError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14, borderRadius: 10 }}
          message={`Last problem: ${current.lastErrorCode || 'error'}`}
          description={(
            <>
              {current.lastError}
              {current.nextAttemptAt && <> Next attempt {when(current.nextAttemptAt)}.</>}
            </>
          )}
        />
      )}

      {differs && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14, borderRadius: 10 }}
          message="What was built is not identical to what was sold"
          description={(
            <>
              Sold: <Text strong>{soldText}</Text><br />
              Built: <Text strong>{builtText}</Text><br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Google has no shape matching this tier exactly. The machine is never smaller than
                what the customer paid for — see the notes below for what could not be matched.
              </Text>
            </>
          )}
        />
      )}

      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="Machine type">
          <Text code>{current.machineType || '—'}</Text>
          {current.acceleratorCount > 0 && (
            <Text type="secondary"> · {current.acceleratorCount}× {current.acceleratorType}</Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Zone"><Text code>{current.zone}</Text></Descriptions.Item>
        <Descriptions.Item label="Name"><Text code>{current.instanceName}</Text></Descriptions.Item>
        <Descriptions.Item label="Project"><Text code>{current.projectId}</Text></Descriptions.Item>
        <Descriptions.Item label="Boot disk">
          {current.bootDiskSizeGb ? `${current.bootDiskSizeGb} GB ${current.bootDiskType}` : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Internal IP">
          {current.internalIp ? <Text code>{current.internalIp}</Text> : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Asked for">{when(current.requestedAt)}</Descriptions.Item>
        <Descriptions.Item label="Running since">
          {current.runningAt ? (
            <Space>
              {when(current.runningAt)}
              {/* The surprising part, said out loud. */}
              <Tag color="green">billing from here</Tag>
            </Space>
          ) : '—'}
        </Descriptions.Item>
        {current.stoppedAt && (
          <Descriptions.Item label="Stopped">{when(current.stoppedAt)}</Descriptions.Item>
        )}
        {current.deletedAt && (
          <Descriptions.Item label="Destroyed">{when(current.deletedAt)}</Descriptions.Item>
        )}
        {current.attempt > 1 && (
          <Descriptions.Item label="Attempts">{current.attempt}</Descriptions.Item>
        )}
        {current.operationName && (
          <Descriptions.Item label="Open operation">
            <Text code style={{ fontSize: 11 }}>{current.operationName}</Text>
          </Descriptions.Item>
        )}
      </Descriptions>

      {current.notes?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
            How this shape was chosen
          </Text>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {current.notes.map((note) => (
              <li key={note}>
                <Text type="secondary" style={{ fontSize: 12 }}>{note}</Text>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};

export default CloudMachinePanel;
