import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Descriptions, Tag, Button, Space, Timeline, Input, Form,
  Select, Modal, message, Spin, Result, Statistic, Table, Alert, Typography,
  Switch,
} from 'antd';
import {
  ArrowLeftOutlined, SaveOutlined, CheckOutlined, CloseOutlined,
  ApiOutlined, UserOutlined, CopyOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import { usePermission } from '../../hooks/usePermission';
import deploymentsApi from '../../api/deploymentsApi';
import usersApi from '../../api/usersApi';
import { PERMISSIONS } from '../../utils/permissions';
import { STATUS_META } from './DeploymentsListPage';

const { Text, Paragraph } = Typography;

const formatDateTime = (d) =>
  d ? new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

/** Turn a stored answer into something readable for the admin. */
const renderAnswer = (answer) => {
  if (Array.isArray(answer)) return answer.map((a) => String(a).replace(/_/g, ' ')).join(', ');
  if (typeof answer === 'boolean') return answer ? 'Yes' : 'No';
  if (answer === null || answer === undefined || answer === '') return '—';
  return String(answer).replace(/_/g, ' ');
};

const DeploymentDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();

  const [deployment, setDeployment] = useState(null);
  const [usage, setUsage] = useState([]);
  const [allowedTransitions, setAllowedTransitions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [admins, setAdmins] = useState([]);

  const [endpointForm] = Form.useForm();
  const [notesForm] = Form.useForm();
  const [generateKey, setGenerateKey] = useState(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const canManage = hasPermission(PERMISSIONS.DEPLOYMENTS_MANAGE);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await deploymentsApi.getDeployment(id);
      setDeployment(data.deployment);
      setUsage(data.usage || []);
      setAllowedTransitions(data.allowedTransitions || []);
      setError(null);

      endpointForm.setFieldsValue({
        url: data.deployment.endpoint?.url || '',
        docsUrl: data.deployment.endpoint?.docsUrl || '',
        apiKey: '',
      });
      notesForm.setFieldsValue({
        adminNotes: data.deployment.adminNotes || '',
        assignedTo: data.deployment.assignedTo?.id || null,
      });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load this deployment.');
    } finally {
      setLoading(false);
    }
  }, [id, endpointForm, notesForm]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    usersApi
      .getUsers({ accountType: 'admin', limit: 100 })
      .then((d) => setAdmins(d.users || []))
      .catch(() => {});
  }, []);

  const changeStatus = async (status, note) => {
    setSaving(true);
    try {
      await deploymentsApi.setStatus(id, status, note);
      message.success(`Deployment marked as ${status.replace('_', ' ')}`);
      setRejectOpen(false);
      setRejectReason('');
      load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not change the status');
    } finally {
      setSaving(false);
    }
  };

  const saveEndpoint = async () => {
    try {
      const values = await endpointForm.validateFields();
      setSaving(true);

      const payload = { url: values.url, docsUrl: values.docsUrl };
      if (generateKey) payload.generateKey = true;
      else if (values.apiKey) payload.apiKey = values.apiKey;

      const result = await deploymentsApi.setEndpoint(id, payload);

      if (result.generatedApiKey) {
        // Shown once — after this it's encrypted and only the customer can reveal it
        Modal.success({
          title: 'API key generated',
          width: 510,
          content: (
            <div style={{ marginTop: 12 }}>
              <Paragraph type="secondary">
                This is the only time the full key is shown here. The customer can reveal it
                from their deployment page at any time.
              </Paragraph>
              <Input.TextArea readOnly value={result.generatedApiKey} rows={2} />
              <Button
                icon={<CopyOutlined />}
                style={{ marginTop: 8 }}
                onClick={() => {
                  navigator.clipboard.writeText(result.generatedApiKey);
                  message.success('Copied');
                }}
              >
                Copy
              </Button>
            </div>
          ),
        });
      } else {
        message.success('Endpoint saved');
      }

      setGenerateKey(false);
      endpointForm.setFieldValue('apiKey', '');
      load();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.message || 'Could not save the endpoint');
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    try {
      const values = await notesForm.validateFields();
      setSaving(true);
      await deploymentsApi.setNotes(id, values);
      message.success('Saved');
      load();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !deployment) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  if (error || !deployment) {
    return (
      <Result
        status="404"
        title="Deployment not found"
        subTitle={error}
        extra={<Button type="primary" onClick={() => navigate('/deployments')}>Back to queue</Button>}
      />
    );
  }

  const meta = STATUS_META[deployment.status] || { color: 'default', label: deployment.status };
  const effectiveRate = deployment.pricePerHour * (1 - (deployment.planDiscountPercent || 0) / 100);
  const canGoLive = allowedTransitions.includes('running');
  const needsEndpoint = !deployment.endpoint?.url;

  const usageColumns = [
    { title: 'Period start', dataIndex: 'periodStart', render: formatDateTime },
    { title: 'Hours', dataIndex: 'hours', align: 'right', width: 90, render: (h) => h.toFixed(2) },
    { title: 'Rate', dataIndex: 'rate', align: 'right', width: 100, render: (r) => r.toFixed(2) },
    { title: 'Charged', dataIndex: 'amount', align: 'right', width: 110, render: (a) => <Text strong>{deployment.currency} {a.toFixed(2)}</Text> },
  ];

  return (
    <div>
      <PageHeader
        title={deployment.deploymentName}
        breadcrumbs={[
          { label: 'Home', path: '/' },
          { label: 'AI Infrastructure' },
          { label: 'Deployments', path: '/deployments' },
          { label: deployment.deploymentName },
        ]}
        extra={
          <Space wrap>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/deployments')}>Back</Button>
            {canManage && allowedTransitions.includes('approved') && (
              <Button type="primary" icon={<CheckOutlined />} loading={saving}
                onClick={() => changeStatus('approved', 'Approved for provisioning')}>
                Approve
              </Button>
            )}
            {canManage && allowedTransitions.includes('rejected') && (
              <Button danger icon={<CloseOutlined />} onClick={() => setRejectOpen(true)}>Reject</Button>
            )}
            {canManage && allowedTransitions.includes('provisioning') && (
              <Button loading={saving} onClick={() => changeStatus('provisioning', 'Provisioning started')}>
                Mark provisioning
              </Button>
            )}
            {canManage && canGoLive && (
              <Button
                type="primary"
                loading={saving}
                disabled={needsEndpoint}
                title={needsEndpoint ? 'Set the endpoint URL first' : undefined}
                onClick={() => changeStatus('running', 'Deployment is live')}
              >
                Mark running
              </Button>
            )}
          </Space>
        }
      />

      <Space align="center" style={{ marginBottom: 20 }}>
        <Tag color={meta.color} style={{ fontSize: 14, padding: '4px 12px' }}>{meta.label}</Tag>
        {deployment.autoSuspendedForCredit && <Tag color="red">Auto-paused: out of credit</Tag>}
      </Space>

      {needsEndpoint && canGoLive && (
        <Alert
          type="warning"
          showIcon
          message="Set the endpoint before going live"
          description="Marking this running emails the customer their connection details, so the endpoint URL must be filled in first."
          style={{ marginBottom: 20 }}
        />
      )}

      {/* Cost summary */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} md={6}>
          <Card><Statistic title="Hourly rate" value={effectiveRate} precision={2} prefix={deployment.currency} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="Runtime" value={deployment.totalRuntimeHours || 0} precision={1} suffix="h" /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="Revenue" value={deployment.totalCost || 0} precision={2} prefix={deployment.currency} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card><Statistic title="Discount" value={deployment.planDiscountPercent || 0} suffix="%" /></Card>
        </Col>
      </Row>

      <Row gutter={[20, 20]}>
        {/* The requirements — what the admin needs to build the right thing */}
        <Col xs={24} lg={14}>
          <Card title="Customer requirements" extra={<Text type="secondary">{deployment.requirements?.length || 0} answers</Text>}>
            {(deployment.requirements || []).length === 0 ? (
              <Text type="secondary">No requirements were captured.</Text>
            ) : (
              <Descriptions column={1} bordered size="small">
                {deployment.requirements.map((r) => (
                  <Descriptions.Item key={r.questionKey} label={r.question || r.questionKey}>
                    <Text strong>{renderAnswer(r.answer)}</Text>
                  </Descriptions.Item>
                ))}
              </Descriptions>
            )}
          </Card>

          {canManage && (
            <Card title={<Space><ApiOutlined /> Endpoint delivery</Space>} style={{ marginTop: 20 }}>
              <Alert
                type="info"
                showIcon
                message="Provision the instance on your server, then record the connection details here. The API key is encrypted at rest and revealed only to the customer."
                style={{ marginBottom: 16 }}
              />
              <Form form={endpointForm} layout="vertical">
                <Form.Item
                  name="url"
                  label="Endpoint URL"
                  rules={[{ required: true, message: 'The endpoint URL is required' }]}
                >
                  <Input placeholder="https://gpu-eu-01.internal/v1" />
                </Form.Item>

                <Form.Item label="API key">
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Space>
                      <Switch checked={generateKey} onChange={setGenerateKey} />
                      <Text>Generate a key for me</Text>
                    </Space>
                    {!generateKey && (
                      <Form.Item name="apiKey" noStyle>
                        <Input.Password placeholder={
                          deployment.endpoint?.hasApiKey
                            ? `Currently ${deployment.endpoint.apiKeyMasked} — enter a new key to replace it`
                            : 'Paste the key issued by your inference server'
                        } />
                      </Form.Item>
                    )}
                  </Space>
                </Form.Item>

                <Form.Item name="docsUrl" label="Docs URL">
                  <Input placeholder="https://docs…" />
                </Form.Item>

                <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveEndpoint}>
                  Save endpoint
                </Button>
              </Form>
            </Card>
          )}
        </Col>

        {/* Customer, config, internal notes, timeline */}
        <Col xs={24} lg={10}>
          <Card title={<Space><UserOutlined /> Customer</Space>}>
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label="Name">{deployment.userId?.name}</Descriptions.Item>
              <Descriptions.Item label="Email">{deployment.userId?.email}</Descriptions.Item>
            </Descriptions>
            <Button
              size="small"
              style={{ marginTop: 8 }}
              onClick={() => navigate(`/customers/${deployment.userId?.id}`)}
            >
              View customer
            </Button>
          </Card>

          <Card title="Requested configuration" style={{ marginTop: 20 }}>
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label="Model">
                {deployment.model?.name} {deployment.model?.version}
              </Descriptions.Item>
              <Descriptions.Item label="Parameters">{deployment.model?.parameterSize || '—'}</Descriptions.Item>
              <Descriptions.Item label="Machine">
                {deployment.tier?.name || '—'}
                {/* No catalogue row to look this up in — say so, because the
                    parts list below is the only spec that exists for it. */}
                {deployment.tier?.isCustom && (
                  <Tag color="purple" style={{ marginInlineStart: 8 }}>Built by the customer</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Hardware">
                {deployment.tier?.gpuCount}× {deployment.tier?.gpuModel} ({deployment.tier?.vramGb}GB)
              </Descriptions.Item>
              <Descriptions.Item label="Resources">
                {deployment.tier?.vcpu} vCPU · {deployment.tier?.ramGb}GB RAM
                {deployment.tier?.storageGb
                  ? ` · ${deployment.tier.storageGb}GB ${deployment.tier.storageType || 'disk'}`
                  : ''}
              </Descriptions.Item>
              <Descriptions.Item label="Region">{deployment.region}</Descriptions.Item>
              <Descriptions.Item label="Requested">{formatDateTime(deployment.createdAt)}</Descriptions.Item>
            </Descriptions>

            {/*
              * A custom machine was never a tier, so there is nothing to look
              * up when it comes time to provision it. This parts list, frozen
              * at order time, is the whole specification — including what each
              * line is costing the customer per hour.
              */}
            {deployment.tier?.isCustom && deployment.tier?.customBuild?.lines?.length > 0 && (
              <Table
                size="small"
                style={{ marginTop: 12 }}
                pagination={false}
                rowKey={(r) => r.componentId}
                dataSource={deployment.tier.customBuild.lines}
                columns={[
                  { title: 'Part', dataIndex: 'name' },
                  {
                    title: 'Qty',
                    align: 'right',
                    render: (_, r) => `${r.quantity} ${r.unitLabel || ''}`.trim(),
                  },
                  {
                    title: `${deployment.currency}/hr`,
                    dataIndex: 'lineTotalPerHour',
                    align: 'right',
                    render: (v) => Number(v || 0).toFixed(4),
                  },
                ]}
              />
            )}
          </Card>

          {canManage && (
            <Card title="Internal notes" style={{ marginTop: 20 }}>
              <Form form={notesForm} layout="vertical">
                <Form.Item name="assignedTo" label="Assigned to">
                  <Select
                    allowClear
                    placeholder="Unassigned"
                    options={admins.map((a) => ({ value: a.id, label: `${a.name} (${a.email})` }))}
                  />
                </Form.Item>
                <Form.Item name="adminNotes" label="Notes" help="Never shown to the customer">
                  <Input.TextArea rows={4} placeholder="Provisioning notes, blockers, follow-ups…" />
                </Form.Item>
                <Button icon={<SaveOutlined />} loading={saving} onClick={saveNotes}>Save notes</Button>
              </Form>
            </Card>
          )}

          <Card title="Status history" style={{ marginTop: 20 }}>
            <Timeline
              items={(deployment.statusHistory || []).slice().reverse().map((h) => {
                const m = STATUS_META[h.status] || {};
                return {
                  color: m.color === 'processing' ? 'blue' : m.color === 'default' ? 'gray' : m.color,
                  children: (
                    <Space direction="vertical" size={0}>
                      <Text strong>{m.label || h.status}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDateTime(h.at)}{h.byName ? ` · ${h.byName}` : ''}
                      </Text>
                      {h.note && <Text style={{ fontSize: 12 }}>{h.note}</Text>}
                    </Space>
                  ),
                };
              })}
            />
          </Card>
        </Col>

        <Col xs={24}>
          <Card title="Billing history">
            <Table
              columns={usageColumns}
              dataSource={usage}
              rowKey="id"
              size="small"
              pagination={usage.length > 10 ? { pageSize: 10 } : false}
              locale={{ emptyText: 'No charges yet' }}
              scroll={{ x: 430 }}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        title="Reject this request"
        open={rejectOpen}
        onCancel={() => setRejectOpen(false)}
        onOk={() => changeStatus('rejected', rejectReason)}
        okText="Reject request"
        okButtonProps={{ danger: true, disabled: !rejectReason.trim() }}
        confirmLoading={saving}
      >
        <Paragraph type="secondary">
          This reason is emailed to the customer, so write it for them rather than for the team.
        </Paragraph>
        <Input.TextArea
          rows={4}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="e.g. We don't currently have H100 capacity in eu-central. We can offer A100 80GB instead — reply and we'll set it up."
        />
      </Modal>
    </div>
  );
};

export default DeploymentDetailPage;
