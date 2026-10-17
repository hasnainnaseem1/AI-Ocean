import React, { useState } from 'react';
import {
  Card, Space, Switch, Input, Typography, Tag, message, Modal, Alert,
} from 'antd';
import { ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';
import deploymentsApi from '../api/deploymentsApi';

const { Text, Paragraph } = Typography;

/**
 * Automatic cloud provisioning, for one account.
 *
 * ── The product rule this card exists to express ──
 *
 * **Every customer deploys automatically.** This card is how an admin takes
 * that away from one account, and nothing else on the platform does. There is
 * deliberately no allowlist in settings: an opt-in list would have made the
 * normal case the one that needed work, and would have left every new customer
 * sitting on the manual queue until somebody remembered them.
 *
 * ── Off is a deferral, not a punishment ──
 *
 * Turning it off does not stop this customer deploying and does not touch
 * anything already running. Their next deployment waits in the queue, an admin
 * approves it, and approving builds the machine exactly as the automatic path
 * would have. The wording throughout says that, because "blocked" would send an
 * admin looking for a problem — and would be the wrong thing to tell support.
 *
 * Works on both kinds of account. A personal account is a Team of
 * `kind: personal`, and the endpoint behind this does not filter on kind — the
 * pay-as-you-go control next to it does, which is why that one silently cannot
 * be applied to an individual customer.
 */
const AutoDeployCard = ({ account, canManage, onChanged, style }) => {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  if (!account?.id) return null;

  const on = account.autoDeploy !== false;

  const apply = async (next) => {
    setSaving(true);
    try {
      const data = await deploymentsApi.setAccountAutoDeploy(account.id, {
        autoDeploy: next,
        reason: next ? '' : reason.trim(),
      });
      message.success(data.message || 'Saved');
      setReason('');
      if (onChanged) onChanged(data);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not change automatic provisioning');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (next) => {
    if (next) return apply(true);
    // Turning it off is the one direction worth a confirm — not because it is
    // dangerous, but because it quietly creates work for whoever is on the
    // deployments queue, and that should be a decision, not a slip.
    return Modal.confirm({
      title: 'Send this account to manual review?',
      icon: <WarningOutlined />,
      okText: 'Yes, review their deployments',
      content: (
        <div>
          <Paragraph style={{ marginBottom: 8 }}>
            Nothing already running is affected. From now on, every deployment{' '}
            <Text strong>{account.name}</Text> creates will wait in the deployments queue
            until an admin approves it.
          </Paragraph>
          <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
            Approving one builds the machine automatically, exactly as it would have been
            built without this.
          </Paragraph>
        </div>
      ),
      onOk: () => apply(false),
    });
  };

  return (
    <Card
      title={<Space><ThunderboltOutlined />Automatic cloud provisioning</Space>}
      extra={on ? <Tag color="green">On</Tag> : <Tag color="orange">Manual review</Tag>}
      style={style}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 12.5 }}>
          {on
            ? 'This account’s deployments build a machine straight away, with no admin step. '
              + 'That is the default for every customer.'
            : 'This account’s deployments wait in the queue. Approving one builds its machine '
              + 'automatically — the only difference is that a person says yes first.'}
        </Text>

        {!on && account.autoDeployOffReason && (
          <Alert
            type="info"
            showIcon
            style={{ borderRadius: 8 }}
            message="Why this was turned off"
            description={account.autoDeployOffReason}
          />
        )}

        {on && (
          <Input
            placeholder="Reason (kept in the activity log)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canManage || saving}
          />
        )}

        <Space>
          <Switch
            checked={on}
            loading={saving}
            disabled={!canManage}
            onChange={toggle}
            checkedChildren="Automatic"
            unCheckedChildren="Review"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {on ? 'Deployments build immediately' : 'Deployments need approval'}
          </Text>
        </Space>
      </Space>
    </Card>
  );
};

export default AutoDeployCard;
