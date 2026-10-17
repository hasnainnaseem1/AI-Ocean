import React, { useState, useEffect, useCallback } from 'react';
import {
  Form, Switch, InputNumber, Input, Button, Space, Alert, Typography, Tag,
  message, Spin, Card, Collapse, Descriptions, Tooltip, Empty,
} from 'antd';
import {
  SaveOutlined, PlusOutlined, MinusCircleOutlined, ReloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';
import deploymentsApi from '../../api/deploymentsApi';

const { Text, Paragraph } = Typography;

/**
 * Where this platform's cost figures come from.
 *
 * ── The question this screen must answer first ──
 *
 * There are two possible sources — Google's own API, and a table an operator
 * types by hand — and the old version of this screen showed only the table.
 * That was actively misleading: it read as a thing you must fill in, next to a
 * platform that claims to read prices live, with no way to tell which one was
 * actually in use.
 *
 * So the status comes first, from a real lookup rather than from configuration:
 * "credentials are stored" and "prices actually come back" are different
 * things, and the difference only shows up on a call.
 *
 * The hand-filled table is then framed by that answer. When live prices work it
 * is collapsed and labelled as what it is — a fallback nobody needs to touch.
 * When they do not, it is open, and it says plainly that it is the only thing
 * standing between the margin guard and "unknown".
 */
/**
 * One implementation, both clouds.
 *
 * @param {string} cloud  'gcp' | 'aws'
 * @param {string} label  what to call it in a sentence
 * @param {RegExp} typePattern  what a valid machine type looks like on this
 *   cloud — `e2-medium` and `m6i.xlarge` are spelled differently, and a field
 *   that accepts either would let a GCP name be typed into the AWS table where
 *   it can never match anything.
 */
const CloudPricingTab = ({
  cloud = 'gcp',
  label = 'Google Cloud',
  typePattern = /^[a-z0-9-]{1,64}$/,
  typePlaceholder = 'e2-medium',
  costPlaceholder = '0.03350',
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);

  const loadStatus = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await deploymentsApi.getPricingStatus({ cloud }));
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }, [cloud]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      const gcp = data.settings?.[`${cloud}Settings`] || {};
      form.setFieldsValue({
        enforceMarginGuard: gcp.enforceMarginGuard !== false,
        machineCosts: Object.entries(gcp.machineCostPerHour || {})
          .map(([machineType, costPerHour]) => ({ machineType, costPerHour })),
      });
    } catch {
      message.error('Could not load the pricing settings');
    } finally {
      setLoading(false);
    }
  }, [form, cloud]);

  useEffect(() => { load(); loadStatus(); }, [load, loadStatus]);

  const save = async () => {
    setSaving(true);
    try {
      const v = form.getFieldsValue();
      const machineCostPerHour = (v.machineCosts || []).reduce((acc, row) => {
        const type = String(row?.machineType || '').trim();
        if (type && row?.costPerHour !== null && row?.costPerHour !== undefined && row.costPerHour !== '') {
          acc[type] = Number(row.costPerHour);
        }
        return acc;
      }, {});
      const update = cloud === 'aws' ? settingsApi.updateAws : settingsApi.updateGcp;
      const data = await update({
        enforceMarginGuard: v.enforceMarginGuard,
        machineCostPerHour,
      });
      if (data.success) {
        message.success(data.message || 'Saved');
        loadStatus();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const liveOk = !!status?.live?.ok;
  const configured = !!status?.providers?.find((p) => p.name === cloud)?.configured;
  const recordedCount = status?.recorded?.count ?? 0;

  /*
   * One sentence about where cost figures are coming from right now. The whole
   * point of this tab: nothing below it makes sense until this is clear.
   */
  const banner = (() => {
    if (!configured) {
      return {
        type: 'warning',
        message: 'Prices cannot be read automatically yet',
        description: `${label} is not connected, so the only cost figures this platform has are `
          + 'the ones you type below. Connect it under the Connection tab and prices are read for you.',
      };
    }
    if (!liveOk) {
      return {
        type: 'error',
        message: `${label} is connected, but prices are not coming back`,
        description: status?.live?.reason
          || 'The credential may lack permission to read billing. Until this works, the table below is '
            + 'the only cost source.',
      };
    }
    return {
      type: 'success',
      message: status?.live?.source === 'gcp:account'
        ? `Prices are read live from ${label} — at YOUR account’s rates`
        : `Prices are read live from ${label} — at public list rates`,
      description: status?.live?.source === 'gcp:account'
        ? 'Costs reflect your sustained-use and committed-use discounts. Nothing below needs filling in.'
        : 'These are list prices, which nobody with discounts actually pays. Add your billing account ID '
          + 'under Connection and the platform will read your real contract price instead.',
    };
  })();

  return (
    <Spin spinning={loading}>
      <div style={{ maxWidth: 820 }}>
        <Alert
          type={banner.type}
          showIcon
          message={banner.message}
          description={banner.description}
          style={{ marginBottom: 16, borderRadius: 12 }}
          action={(
            <Tooltip title={`Ask ${label} for prices again`}>
              <Button size="small" icon={<ReloadOutlined />} loading={checking} onClick={loadStatus}>
                Re-check
              </Button>
            </Tooltip>
          )}
        />

        {liveOk && status?.live?.found && (
          <Card size="small" title={`What came back from ${label}`} style={{ marginBottom: 20, borderRadius: 12 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="vCPU and RAM">
                {status.live.found.vcpu && status.live.found.ram
                  ? <Tag icon={<CheckCircleOutlined />} color="success">priced</Tag>
                  : <Tag icon={<CloseCircleOutlined />} color="error">missing</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Accelerators priced">
                {status.live.found.gpuModels.length
                  ? status.live.found.gpuModels.map((g) => <Tag key={g}>{g}</Tag>)
                  : <Text type="secondary">none</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Disk types priced">
                {status.live.found.diskTypes.length
                  ? status.live.found.diskTypes.map((d) => <Tag key={d}>{d}</Tag>)
                  : <Text type="secondary">none</Text>}
              </Descriptions.Item>
            </Descriptions>
            <Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 0 0' }}>
              Anything not in this list has no automatic price, so the margin guard would refuse to
              build it. That is what the table below is for.
            </Paragraph>
          </Card>
        )}

        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="enforceMarginGuard"
            label="Margin guard"
            valuePropName="checked"
            extra="Refuse to build a machine that costs more than the tier sells for. Leave it on — it is what keeps a mispriced tier from losing money on every deployment instead of once."
          >
            <Switch checkedChildren="Enforced" unCheckedChildren="Off" />
          </Form.Item>

          {/*
            * Framed by the status above. When live prices work this is a
            * fallback nobody should be filling in "just in case" — stale
            * figures here are worse than none, because they are what somebody
            * would price a product against.
            */}
          <Collapse
            style={{ marginBottom: 20 }}
            defaultActiveKey={liveOk ? [] : ['table']}
            items={[{
              key: 'table',
              label: (
                <Space>
                  <Text strong>Costs recorded by hand</Text>
                  {recordedCount > 0 && <Tag>{recordedCount} recorded</Tag>}
                  {liveOk
                    ? <Tag color="default">fallback only — not in use</Tag>
                    : <Tag color="orange">in use</Tag>}
                </Space>
              ),
              children: (
                <>
                  <Alert
                    type={liveOk ? 'info' : 'warning'}
                    showIcon
                    style={{ marginBottom: 14, borderRadius: 8 }}
                    message={liveOk
                      ? 'You do not need to fill this in'
                      : 'Right now this is the only cost source'}
                    description={liveOk
                      ? `Live prices are working, so these are only used for a machine type ${label} does `
                        + 'not publish a price for. An entry here always wins over nothing — but never '
                        + 'over a live price. Leaving it empty is correct.'
                      : 'A machine type with no entry here has an unknown cost, and the margin guard '
                        + 'treats unknown as a refusal. Copy each figure from the GCP pricing calculator '
                        + 'for your own region.'}
                  />

                  <Form.List name="machineCosts">
                    {(fields, { add, remove }) => (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {fields.length === 0 && (
                          <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={liveOk
                              ? 'Nothing recorded, which is what you want while live prices work'
                              : 'Nothing recorded — no machine can be costed'}
                            style={{ margin: '8px 0' }}
                          />
                        )}
                        {fields.map(({ key, name, ...rest }) => (
                          <Space key={key} align="baseline" style={{ display: 'flex' }}>
                            <Form.Item
                              {...rest}
                              name={[name, 'machineType']}
                              style={{ marginBottom: 0 }}
                              rules={[{
                                pattern: typePattern,
                                message: `That is not a ${label} machine type`,
                              }]}
                            >
                              <Input placeholder={typePlaceholder} style={{ width: 240, fontFamily: 'monospace' }} />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'costPerHour']} style={{ marginBottom: 0 }}>
                              <InputNumber
                                min={0}
                                // GCP quotes small shapes to four or five
                                // decimals; rounding to cents would move the
                                // margin on a $0.0335 machine by 10%.
                                step={0.0001}
                                precision={5}
                                prefix="$"
                                placeholder={costPlaceholder}
                                style={{ width: 150 }}
                              />
                            </Form.Item>
                            <Tooltip title="Remove">
                              <Button
                                type="text"
                                icon={<MinusCircleOutlined />}
                                onClick={() => remove(name)}
                                aria-label="Remove this machine type"
                              />
                            </Tooltip>
                          </Space>
                        ))}
                        <Button type="dashed" onClick={() => add()} icon={<PlusOutlined />} style={{ width: 240 }}>
                          Add a machine type
                        </Button>
                      </div>
                    )}
                  </Form.List>
                </>
              ),
            }]}
          />

          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} size="large">
            Save pricing settings
          </Button>
        </Form>

        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 16 }}>
          What the platform adds on top of {label}&apos;s charge — overhead, tax and the margin you
          need — is set once for every cloud under <Text strong>Cloud → Overview</Text>.
        </Paragraph>
      </div>
    </Spin>
  );
};

export default CloudPricingTab;
