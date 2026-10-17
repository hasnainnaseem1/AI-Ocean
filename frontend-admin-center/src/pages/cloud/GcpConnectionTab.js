import React, { useState, useEffect, useCallback } from 'react';
import {
  Form, Input, Button, Space, Alert, Row, Col, Typography, message, Spin, Descriptions, Tag,
} from 'antd';
import {
  SaveOutlined, KeyOutlined, SettingOutlined, SafetyOutlined, LinkOutlined,
  ApiOutlined, CloudServerOutlined,
} from '@ant-design/icons';
import settingsApi from '../../api/settingsApi';

const { Text, Paragraph } = Typography;

/**
 * How this platform reaches Google Cloud.
 *
 * Credentials and the names of things — nothing here switches anything on or
 * spends anything. That separation is the point of splitting the old
 * one-long-form into tabs: an operator pasting a key should not be scrolling
 * past the switch that starts creating machines.
 *
 * The service-account key is write-only. The server never returns it, not even
 * to a super admin, so the field renders blank every time and a blank field
 * means "keep the stored one".
 */
const GcpConnectionTab = ({ onSaved }) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [current, setCurrent] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await settingsApi.getSettings();
      const gcp = data.settings?.gcpSettings || {};
      setCurrent(gcp);
      form.setFieldsValue({
        projectId: gcp.projectId || '',
        serviceAccountKey: '',
        customerServiceAccount: gcp.customerServiceAccount || '',
        network: gcp.network || '',
        environment: gcp.environment || '',
        billingAccountId: gcp.billingAccountId || '',
      });
    } catch {
      message.error('Could not load the Google Cloud connection');
    } finally {
      setLoading(false);
    }
  }, [form]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const v = form.getFieldsValue();
      const payload = { ...v };
      // An untouched field must never wipe a stored key.
      if (!v.serviceAccountKey || !String(v.serviceAccountKey).trim()) delete payload.serviceAccountKey;
      const data = await settingsApi.updateGcp(payload);
      if (data.success) {
        message.success(data.message || 'Saved');
        form.setFieldsValue({ serviceAccountKey: '' });
        setTestResult(null);
        load();
        if (onSaved) onSaved();
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult({ ok: true, ...(await settingsApi.testGcp()) });
    } catch (err) {
      setTestResult({ ok: false, message: err.response?.data?.message || 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Spin spinning={loading}>
      <div style={{ maxWidth: 760 }}>
        <Alert
          type="info"
          showIcon
          icon={<CloudServerOutlined />}
          message="The account this platform builds machines in"
          description={(
            <>
              The network, firewall and NAT these machines depend on are not configured here —
              they are built once from <Text code>infra/</Text> with Terragrunt. See{' '}
              <Text code>infra/gcp/SETUP.md</Text> for the one-time account setup.
            </>
          )}
          style={{ marginBottom: 20, borderRadius: 12 }}
        />

        {current?.hasServiceAccountKey && (
          <Descriptions size="small" bordered column={1} style={{ marginBottom: 20 }}>
            <Descriptions.Item label="Key stored for">
              <Space>
                <Text code>{current.serviceAccountEmail || 'an unrecorded account'}</Text>
                <Tag color="green">encrypted</Tag>
              </Space>
            </Descriptions.Item>
          </Descriptions>
        )}

        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item
            name="projectId"
            label={<Space><SettingOutlined /> Project ID</Space>}
            extra="The GCP project customer VMs are created in. It is stored on every instance record, so changing it later never orphans an existing machine."
          >
            <Input placeholder="e.g. aiocean-prod-vms" size="large" />
          </Form.Item>

          <Form.Item
            name="serviceAccountKey"
            label={<Space><KeyOutlined /> Service account key (JSON)</Space>}
            extra={current?.hasServiceAccountKey
              ? 'Leave blank to keep the stored key. Pasting a new one replaces it.'
              : 'Paste the whole key file for the platform-runtime account, braces included. It is encrypted before it is stored and never shown again.'}
          >
            <Input.TextArea
              rows={4}
              autoComplete="off"
              placeholder={current?.hasServiceAccountKey
                ? '••••••••  (leave blank to keep existing)'
                : '{ "type": "service_account", "project_id": "…", … }'}
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
          </Form.Item>

          {current?.hasServiceAccountKey && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 20, borderRadius: 10 }}
              message="Delete the downloaded key file"
              description="Now that a key is stored here, the .json file on your own machine is a second copy of a credential that can create and destroy machines by the hour. Delete it, and never send it to anyone — including support."
            />
          )}

          <Form.Item
            name="billingAccountId"
            label={<Space><ApiOutlined /> Billing account ID</Space>}
            extra="Optional, and worth adding. Without it, prices come from Google's public list — which nobody with sustained-use or committed-use discounts actually pays. With it, the platform reads YOUR contract price."
          >
            <Input placeholder="012345-6789AB-CDEF01" size="large" />
          </Form.Item>

          <Form.Item
            name="customerServiceAccount"
            label={<Space><SafetyOutlined /> Customer VM service account</Space>}
            extra="The role-less account every customer VM runs as. The firewall rules target this account — that is what stops one customer's VM reaching another's — so it must match what infra/ created."
          >
            <Input placeholder="customer-vm@PROJECT.iam.gserviceaccount.com" size="large" />
          </Form.Item>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="network"
                label={<Space><LinkOutlined /> VPC network</Space>}
                extra="Never the default VPC — it ships with an allow-internal rule."
              >
                <Input placeholder="aiocean-customer" size="large" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="environment"
                label="Environment"
                extra="Matches the infra/gcp/live/<env> that built the network."
              >
                <Input placeholder="staging" size="large" />
              </Form.Item>
            </Col>
          </Row>

          <Space style={{ marginBottom: 8 }}>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save} size="large">
              Save connection
            </Button>
            <Button icon={<ApiOutlined />} loading={testing} onClick={test} size="large">
              Test connection
            </Button>
          </Space>
          <Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 0' }}>
            The test reads the project with the stored key. It creates nothing.
          </Paragraph>

          {testResult && (
            <Alert
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              style={{ marginTop: 12, borderRadius: 10 }}
              message={testResult.message || (testResult.ok ? 'Connection OK' : 'Connection failed')}
              description={testResult.dryRun
                ? 'Dry run is on, so nothing was sent to Google. Turn it off under Provisioning to check the stored credentials for real.'
                : undefined}
            />
          )}
        </Form>
      </div>
    </Spin>
  );
};

export default GcpConnectionTab;
