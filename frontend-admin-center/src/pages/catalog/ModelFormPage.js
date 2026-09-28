import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Form, Input, InputNumber, Select, Switch, Button, Space, Row, Col,
  message, Table, Spin, Alert, Divider, Typography,
} from 'antd';
import { SaveOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import { modelsApi, tiersApi } from '../../api/catalogApi';

const { Text } = Typography;

const FAMILIES = ['kimi', 'deepseek', 'llama', 'qwen', 'mistral', 'gemma', 'phi', 'falcon', 'custom'];
const MODALITIES = ['chat', 'completion', 'vision', 'image_generation', 'embedding', 'audio', 'code'];
const STATUSES = ['available', 'beta', 'coming_soon', 'deprecated'];

const ModelFormPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const isEdit = !!id;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [tiers, setTiers] = useState([]);

  /**
   * Which tiers this model runs on, keyed by tier id. Kept outside the Form
   * because it's edited through a table rather than form fields.
   */
  const [tierLinks, setTierLinks] = useState({});

  const load = useCallback(async () => {
    try {
      if (isEdit) {
        const data = await modelsApi.getModel(id);
        const model = data.model;

        form.setFieldsValue({
          ...model,
          tags: model.tags || [],
          modalities: model.modalities || [],
        });

        const links = {};
        (model.supportedTiers || []).forEach((link) => {
          links[link.tierId] = {
            enabled: true,
            recommended: !!link.recommended,
            priceMultiplier: link.priceMultiplier ?? 1,
            notes: link.notes || '',
          };
        });
        setTierLinks(links);
        setTiers(data.availableTiers || []);
      } else {
        form.setFieldsValue({
          family: 'custom',
          modalities: ['chat'],
          status: 'available',
          category: 'General Purpose',
          isActive: true,
          isFeatured: false,
          displayOrder: 0,
          contextLength: 0,
          minVramGb: 0,
        });
        const data = await tiersApi.getTiers({ isActive: true });
        setTiers(data.tiers || []);
      }
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not load the model');
    } finally {
      setLoading(false);
    }
  }, [id, isEdit, form]);

  useEffect(() => { load(); }, [load]);

  const setLink = (tierId, patch) => {
    setTierLinks((prev) => ({
      ...prev,
      [tierId]: { enabled: false, recommended: false, priceMultiplier: 1, notes: '', ...prev[tierId], ...patch },
    }));
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const supportedTiers = Object.entries(tierLinks)
        .filter(([, link]) => link.enabled)
        .map(([tierId, link]) => ({
          tierId,
          recommended: !!link.recommended,
          priceMultiplier: link.priceMultiplier ?? 1,
          notes: link.notes || '',
        }));

      if (supportedTiers.length === 0) {
        message.warning('Select at least one tier, or customers will have nothing to deploy on.');
      }

      const payload = { ...values, supportedTiers };

      if (isEdit) {
        await modelsApi.updateModel(id, payload);
        message.success('Model updated');
      } else {
        await modelsApi.createModel(payload);
        message.success('Model created');
      }
      navigate('/models');
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.message || 'Could not save the model');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;
  }

  const tierColumns = [
    {
      title: 'Offer',
      key: 'enabled',
      width: 64,
      render: (_, row) => (
        <Switch
          size="small"
          checked={!!tierLinks[row.id]?.enabled}
          onChange={(enabled) => setLink(row.id, { enabled })}
        />
      ),
    },
    {
      title: 'Tier',
      dataIndex: 'name',
      render: (name, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.gpuCount}× {row.gpuModel} · {row.vramGb}GB VRAM · {row.currency} {row.pricePerHour.toFixed(2)}/hr
          </Text>
        </Space>
      ),
    },
    {
      title: 'Recommended',
      key: 'recommended',
      width: 100,
      align: 'center',
      render: (_, row) => (
        <Switch
          size="small"
          disabled={!tierLinks[row.id]?.enabled}
          checked={!!tierLinks[row.id]?.recommended}
          onChange={(recommended) => setLink(row.id, { recommended })}
        />
      ),
    },
    {
      title: 'Price ×',
      key: 'multiplier',
      width: 90,
      render: (_, row) => (
        <InputNumber
          size="small"
          min={0}
          step={0.05}
          style={{ width: '100%' }}
          disabled={!tierLinks[row.id]?.enabled}
          value={tierLinks[row.id]?.priceMultiplier ?? 1}
          onChange={(priceMultiplier) => setLink(row.id, { priceMultiplier })}
        />
      ),
    },
    {
      title: 'Customer pays',
      key: 'effective',
      width: 105,
      align: 'right',
      render: (_, row) => {
        const link = tierLinks[row.id];
        if (!link?.enabled) return <Text type="secondary">—</Text>;
        const rate = row.pricePerHour * (link.priceMultiplier ?? 1);
        return <Text strong>{row.currency} {rate.toFixed(2)}/hr</Text>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title={isEdit ? 'Edit model' : 'New model'}
        breadcrumbs={[
          { label: 'Home', path: '/' },
          { label: 'AI Infrastructure' },
          { label: 'Models', path: '/models' },
          { label: isEdit ? 'Edit' : 'New' },
        ]}
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/models')}>Cancel</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              {isEdit ? 'Save changes' : 'Create model'}
            </Button>
          </Space>
        }
      />

      <Form form={form} layout="vertical">
        <Row gutter={[20, 20]}>
          <Col xs={24} lg={14}>
            <Card title="Details">
              <Row gutter={16}>
                <Col span={14}>
                  <Form.Item name="name" label="Model name" rules={[{ required: true, message: 'A name is required' }]}>
                    <Input placeholder="Kimi K2" />
                  </Form.Item>
                </Col>
                <Col span={10}>
                  <Form.Item name="version" label="Version">
                    <Input placeholder="K2-Instruct" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="shortDescription" label="Short description" help="Shown on the catalog card">
                <Input placeholder="One line that sells the model" maxLength={160} />
              </Form.Item>

              <Form.Item name="description" label="Full description">
                <Input.TextArea rows={5} placeholder="What this model is good at, and who should pick it" />
              </Form.Item>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="family" label="Family" rules={[{ required: true }]}>
                    <Select options={FAMILIES.map((f) => ({ value: f, label: f }))} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="modalities" label="Capabilities" rules={[{ required: true, message: 'Pick at least one' }]}>
                    <Select mode="multiple" options={MODALITIES.map((m) => ({ value: m, label: m.replace('_', ' ') }))} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="parameterSize" label="Parameters">
                    <Input placeholder="671B (37B active)" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="contextLength" label="Context length (tokens)">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="minVramGb" label="Minimum VRAM (GB)" help="Warns on undersized tiers">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>

              <Divider />

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="huggingFaceId" label="Model ID">
                    <Input placeholder="moonshotai/Kimi-K2-Instruct" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="license" label="License">
                    <Input placeholder="Apache 2.0" />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="docsUrl" label="Documentation URL">
                    <Input placeholder="https://…" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="logoUrl" label="Logo URL">
                    <Input placeholder="https://…" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          <Col xs={24} lg={10}>
            <Card title="Catalog placement">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="status" label="Status" rules={[{ required: true }]}>
                    <Select options={STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="category" label="Category">
                    <Input placeholder="General Purpose" />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="tags" label="Tags" help="Type to add">
                <Select mode="tags" placeholder="reasoning, coding, long-context" />
              </Form.Item>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="displayOrder" label="Order">
                    <InputNumber min={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="isFeatured" label="Featured" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="isActive" label="Active" valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>

          <Col xs={24}>
            <Card title="Hardware this model can run on">
              <Alert
                type="info"
                showIcon
                message="The price multiplier scales the tier's base rate for this model — use it when a model is heavier to serve than the tier's default workload."
                style={{ marginBottom: 16 }}
              />
              {tiers.length === 0 ? (
                <Alert
                  type="warning"
                  showIcon
                  message="No tiers exist yet"
                  description="Create tiers first — a model with no machine can't be deployed."
                  action={<Button size="small" onClick={() => navigate('/tiers')}>Manage tiers</Button>}
                />
              ) : (
                <Table
                  columns={tierColumns}
                  dataSource={tiers}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  scroll={{ x: 660 }}
                />
              )}
            </Card>
          </Col>
        </Row>
      </Form>
    </div>
  );
};

export default ModelFormPage;
