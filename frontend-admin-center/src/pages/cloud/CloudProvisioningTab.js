import React, { useState, useEffect, useCallback } from 'react';
import {
  Form, Switch, InputNumber, Button, Space, Alert, Row, Col, Typography,
  message, Spin, Card, Modal,
} from 'antd';
import {
  SaveOutlined, WarningOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, hairline } from '../../theme/colors';

const { Text, Paragraph } = Typography;

/**
 * Whether this platform builds machines, and the limits on how many.
 *
 * ── The two switches, and what is deliberately NOT here ──
 *
 * There is no allowlist. **Every customer gets automatic provisioning**; an
 * admin takes it away from one account on that account's own page. An opt-in
 * list here would make the normal case the one that needs work, and would
 * quietly leave every new customer on the manual queue forever.
 *
 * So platform-wide there are two switches, and the banner states the
 * conclusion rather than leaving an operator to work it out from two toggles —
 * recomputed as they move, *before* anything is saved.
 */
const spendState = ({ enabled, dryRun, label = 'this cloud' }) => {
  if (!enabled) {
    return {
      tone: 'neutral',
      title: 'Off',
      text: `Deployments routed here keep going to the manual fulfilment queue. Nothing is created on ${label}.`,
    };
  }
  if (dryRun !== false) {
    return {
      tone: 'info',
      title: 'Dry run',
      text: `The full provisioning flow runs and is recorded, but no call reaches ${label} and no machine `
        + 'is created. Turn this off only when you are ready for real machines.',
    };
  }
  return {
    tone: 'warning',
    title: 'Live — real machines, real money',
    text: `Every customer deployment routed to ${label} now creates a real machine there, and that `
      + 'customer is billed from the moment it reports RUNNING. Accounts you have set to manual '
      + 'review are the only exception.',
  };
};

/**
 * One implementation, both clouds.
 *
 * The provisioning settings are genuinely the same fields on Google and AWS —
 * a kill switch, a dry run, two caps and two timeouts — so this takes the cloud
 * as a prop rather than existing twice. Two copies would drift, and the half
 * that drifted would be the one nobody is looking at.
 *
 * @param {string} cloud  'gcp' | 'aws' — picks the settings block and the API
 * @param {string} label  what to call it in a sentence
 */
const CloudProvisioningTab = ({ cloud = 'gcp', label = 'Google Cloud', onSaved }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [current, setCurrent] = useState(null);
  const [live, setLive] = useState({ enabled: false, dryRun: true });
  const { isDark } = useTheme();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      const gcp = data.settings?.[`${cloud}Settings`] || {};
      setCurrent(gcp);
      setLive({ enabled: !!gcp.enabled, dryRun: gcp.dryRun !== false });
      form.setFieldsValue({
        enabled: !!gcp.enabled,
        dryRun: gcp.dryRun !== false,
        maxConcurrentInstancesPerTeam: Number(gcp.maxConcurrentInstancesPerTeam) || 0,
        maxConcurrentInstancesPlatform: Number(gcp.maxConcurrentInstancesPlatform) || 0,
        requestTimeoutSeconds: Number(gcp.requestTimeoutSeconds) || 30,
        dryRunRunningAfterSeconds: Number(gcp.dryRunRunningAfterSeconds) || 45,
      });
    } catch {
      message.error('Could not load the provisioning settings');
    } finally {
      setLoading(false);
    }
  }, [form, cloud]);

  useEffect(() => { load(); }, [load]);

  const sync = () => {
    const v = form.getFieldsValue();
    setLive({ enabled: !!v.enabled, dryRun: v.dryRun !== false });
  };

  const submit = async (values) => {
    setSaving(true);
    try {
      // One API method per cloud; the shape of the body is identical.
      const data = cloud === 'aws'
        ? await settingsApi.updateAws(values)
        : await settingsApi.updateGcp(values);
      if (data.success) {
        message.success(data.message || 'Saved');
        load();
        if (onSaved) onSaved();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    const v = form.getFieldsValue();
    const after = spendState({ enabled: !!v.enabled, dryRun: v.dryRun !== false, label });
    const before = spendState({
      label,
      enabled: !!current?.enabled,
      dryRun: current?.dryRun !== false,
    });

    // Going live is the one action here that can cost money, so it gets a
    // confirm that names what is about to happen rather than a generic one.
    if (after.tone === 'warning' && before.tone !== 'warning') {
      Modal.confirm({
        title: 'Start creating real machines?',
        okText: 'Yes, go live',
        okButtonProps: { danger: true },
        content: (
          <div>
            <Paragraph style={{ marginBottom: 8 }}>{after.text}</Paragraph>
            <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
              Switching dry run back on stops any new machine being created — it does not destroy
              machines that already exist. To exempt one customer, turn off automatic provisioning
              on that account instead.
            </Paragraph>
          </div>
        ),
        onOk: () => submit(v),
      });
      return;
    }
    submit(v);
  };

  const state = spendState({ ...live, label });
  const c = STATUS_COLORS[state.tone] || STATUS_COLORS.neutral;
  const ink = isDark ? c.dark : c.light;

  return (
    <Spin spinning={loading}>
      <div style={{ maxWidth: 760 }}>
        <Card
          size="small"
          style={{
            marginBottom: 20,
            borderRadius: 12,
            background: c.bg(isDark),
            border: `1px solid ${hairline(isDark)}`,
          }}
        >
          <Space align="start">
            {state.tone === 'warning'
              ? <WarningOutlined style={{ color: ink, fontSize: 18, marginTop: 2 }} />
              : <CheckCircleOutlined style={{ color: ink, fontSize: 18, marginTop: 2 }} />}
            <div>
              <Text strong style={{ color: ink, display: 'block' }}>{state.title}</Text>
              <Text type="secondary" style={{ fontSize: 13 }}>{state.text}</Text>
            </div>
          </Space>
        </Card>

        <Form form={form} layout="vertical" onValuesChange={sync} requiredMark={false}>
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="enabled"
                label="Automatic provisioning"
                valuePropName="checked"
                extra="Off means every deployment keeps going to the manual fulfilment queue."
              >
                <Switch checkedChildren="On" unCheckedChildren="Off" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="dryRun"
                label="Dry run"
                valuePropName="checked"
                extra="On: the full flow runs and is recorded, but nothing reaches Google."
              >
                <Switch checkedChildren="Dry run" unCheckedChildren="Real" />
              </Form.Item>
            </Col>
          </Row>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16, borderRadius: 10 }}
            message="Every customer gets automatic provisioning"
            description={(
              <>
                There is no allowlist here, deliberately. To make ONE customer&apos;s deployments
                wait for your approval, open that account and turn off automatic provisioning
                there — their requests then sit in the deployments queue, and approving one builds
                the machine exactly as the automatic path would.
              </>
            )}
          />

          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16, borderRadius: 10 }}
            message="These caps are what stop one bug becoming a thousand machines"
            description="There is no admin review in this flow — a deployment creates a VM directly. These limits are the only thing standing between a retry loop and a bill."
          />

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="maxConcurrentInstancesPerTeam"
                label="Max machines per customer"
                extra="0 blocks everything."
              >
                <InputNumber min={0} max={1000} style={{ width: '100%' }} size="large" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="maxConcurrentInstancesPlatform"
                label="Max machines platform-wide"
                extra="The hard ceiling across every customer."
              >
                <InputNumber min={0} max={10000} style={{ width: '100%' }} size="large" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="requestTimeoutSeconds"
                label="API timeout (seconds)"
                extra="A hung call must not jam the reconciler. 5–300."
              >
                <InputNumber min={5} max={300} style={{ width: '100%' }} size="large" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="dryRunRunningAfterSeconds"
                label="Dry run: seconds to RUNNING"
                extra="How long a pretend machine takes to come up, so the billing clock can be exercised without GCP."
              >
                <InputNumber min={0} max={3600} style={{ width: '100%' }} size="large" />
              </Form.Item>
            </Col>
          </Row>

          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} size="large">
            Save provisioning settings
          </Button>
        </Form>
      </div>
    </Spin>
  );
};

export default CloudProvisioningTab;
export { spendState };
