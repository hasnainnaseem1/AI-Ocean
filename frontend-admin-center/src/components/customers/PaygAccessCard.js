import React, { useEffect, useState } from 'react';
import {
  Card, Space, Select, Button, Tag, Typography, Input, Modal, Alert, message,
} from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import customersApi from '../../api/customersApi';

const { Text } = Typography;

const OPTIONS = [
  { value: 'default', label: 'Platform default' },
  { value: 'allowed', label: 'Allowed' },
  { value: 'blocked', label: 'Blocked' },
];

/** Why the account ends up with or without PAYG, in one line. */
const explain = (access, platformOn, label) => {
  const platform = `the platform switch is ${platformOn ? 'on' : 'off'}`;
  if (access === 'allowed') return `Allowed for this ${label} (${platform} for everyone else).`;
  if (access === 'blocked') return `Blocked for this ${label} (${platform} for everyone else).`;
  return `Follows the platform switch — ${platform}.`;
};

/**
 * Pay-as-you-go access for one customer — the per-customer override on top of
 * the platform switch in Settings → Billing.
 *
 * It only opens or closes the door. Eligibility, the card gate, the debt
 * limits and dispute holds still apply to an allowed customer, which is why
 * the card says so rather than letting "Allowed" read as "no limits".
 *
 * Taking PAYG away moves the customer's existing PAYG deployments to prepaid
 * on the spot (usage so far is billed as PAYG first). That is a real change to
 * what happens to their machines, so it asks for confirmation first, and
 * reports how many deployments were moved. The optional reason goes in the
 * activity log.
 */
const PaygAccessCard = ({
  customer, canManage, onChanged, style, save: saveOverride, label = 'customer',
}) => {
  const current = customer?.paygAccess || 'default';
  const [value, setValue] = useState(current);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { setValue(current); }, [current]);

  const effective = customer?.paygEffective;

  const save = async () => {
    setSaving(true);
    try {
      // Organizations own the same setting on their own account, so the same
      // card serves both rather than a second copy drifting out of step.
      const res = saveOverride
        ? await saveOverride(value, reason.trim() || undefined)
        : await customersApi.setPaygAccess(customer.id, value, reason.trim() || undefined);
      const moved = res.enforcement?.switched || 0;
      message.success(moved
        ? `Saved — ${moved} pay-as-you-go deployment${moved === 1 ? '' : 's'} moved to prepaid`
        : 'Pay-as-you-go access saved');
      setReason('');
      onChanged?.();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save pay-as-you-go access');
    } finally {
      setSaving(false);
    }
  };

  // Would saving this take PAYG away from someone who has it now?
  const platformOn = !!customer?.paygPlatformEnabled;
  const willHave = value === 'allowed' || (value === 'default' && platformOn);
  const removesAccess = !!effective?.available && !willHave;

  const confirmAndSave = () => {
    if (!removesAccess) { save(); return; }
    Modal.confirm({
      title: `Take pay-as-you-go away from this ${label}?`,
      content: 'Their pay-as-you-go deployments will be billed up to now and moved to prepaid straight away. '
        + 'From then on they run on wallet credit and pause when it runs out. What they already owe stays owed.',
      okText: 'Yes, save',
      okButtonProps: { danger: true },
      onOk: save,
    });
  };

  return (
    <Card
      title={<Space><ThunderboltOutlined />Pay-as-you-go access</Space>}
      style={{ marginBottom: 16, ...style }}
      extra={effective && (
        <Tag color={effective.available ? 'success' : 'default'}>
          {effective.available ? 'Can use pay-as-you-go' : 'No pay-as-you-go'}
        </Tag>
      )}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Text type="secondary" style={{ fontSize: 12.5 }}>{explain(current, !!customer?.paygPlatformEnabled, label)}</Text>

        {canManage ? (
          <>
            <Space wrap>
              <Select value={value} onChange={setValue} options={OPTIONS} style={{ width: 200 }} />
              <Input
                placeholder="Reason (optional, goes in the activity log)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                style={{ width: 320 }}
              />
              <Button type="primary" loading={saving} disabled={value === current} onClick={confirmAndSave}>
                Save
              </Button>
            </Space>
            {value === 'allowed' && (
              <Alert
                type="info"
                showIcon
                message="Allowed only opens the door"
                description={`Eligibility (minimum spend and account age), the verified-card requirement, the debt limits and dispute holds still apply to this ${label}.`}
              />
            )}
          </>
        ) : (
          <Tag>{OPTIONS.find((o) => o.value === current)?.label}</Tag>
        )}
      </Space>
    </Card>
  );
};

export default PaygAccessCard;
