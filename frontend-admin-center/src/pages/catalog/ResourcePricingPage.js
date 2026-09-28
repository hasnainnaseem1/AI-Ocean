import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Space, Card, message, Tooltip, Tag, Modal, Form,
  Input, InputNumber, Switch, Select, Alert, Typography, Tabs, Row, Col, Empty,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
  CheckCircleOutlined, StopOutlined, PauseCircleOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import { rowActions } from '../../components/common/DataTable';
import { usePermission } from '../../hooks/usePermission';
import { resourceComponentsApi } from '../../api/catalogApi';
import { PERMISSIONS } from '../../utils/permissions';

const { Text, Paragraph } = Typography;

/**
 * The kinds a component can be. Only a grouping label for this page — nothing
 * in billing or sizing branches on it. What actually decides whether a part
 * keeps charging after a customer pauses is `billedWhileStopped`, which is set
 * per component.
 */
const KINDS = [
  { value: 'storage', label: 'Storage', unit: 'GB', hint: 'Disks. Normally billed while stopped — this is the charge a paused customer keeps paying.' },
  { value: 'cpu', label: 'CPU', unit: 'vCPU', hint: 'Compute cores, released back to the pool when a deployment stops.' },
  { value: 'memory', label: 'Memory', unit: 'GB', hint: 'System RAM, released back to the pool when a deployment stops.' },
  { value: 'gpu', label: 'Accelerator', unit: 'GPU', hint: 'GPUs and other accelerators. Give each one its VRAM under specs so tiers can be sized.' },
  { value: 'network', label: 'Network', unit: 'Gbps', hint: 'Guaranteed bandwidth.' },
  { value: 'other', label: 'Other', unit: 'unit', hint: 'Anything else you want to charge for — a reserved IP, a licence.' },
];

const kindMeta = (kind) => KINDS.find((k) => k.value === kind) || KINDS[KINDS.length - 1];

const money = (n, currency = 'USD') => `${currency} ${Number(n || 0).toFixed(6)}`;
const money2 = (n, currency = 'USD') => `${currency} ${Number(n || 0).toFixed(2)}`;

/**
 * Resource pricing — where the per-unit money lives.
 *
 * A tier's hourly rate is the sum of its parts, so these are the numbers that
 * actually set what customers pay. Two consequences worth keeping in mind while
 * editing: changing a price here reprices every component-built tier that uses
 * it immediately, and marking a part "billed while stopped" is what makes a
 * paused customer keep paying for it.
 */
const ResourcePricingPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();

  const [loading, setLoading] = useState(false);
  const [components, setComponents] = useState([]);
  const [categories, setCategories] = useState([]);
  const [hoursPerMonth, setHoursPerMonth] = useState(730);
  const [storageBillingOn, setStorageBillingOn] = useState(true);

  const [componentModal, setComponentModal] = useState(false);
  const [editingComponent, setEditingComponent] = useState(null);
  const [categoryModal, setCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [saving, setSaving] = useState(false);

  const [componentForm] = Form.useForm();
  const [categoryForm] = Form.useForm();

  const canEdit = hasPermission(PERMISSIONS.MODELS_EDIT);
  const canCreate = hasPermission(PERMISSIONS.MODELS_CREATE);
  const canDelete = hasPermission(PERMISSIONS.MODELS_DELETE);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [componentData, categoryData] = await Promise.all([
        resourceComponentsApi.getComponents(),
        resourceComponentsApi.getCategories(),
      ]);
      setComponents(componentData.components || []);
      setCategories(categoryData.categories || []);
      if (componentData.hoursPerMonth) setHoursPerMonth(componentData.hoursPerMonth);
      setStorageBillingOn(componentData.billStorageWhileStopped !== false);
    } catch {
      message.error('Failed to load resource pricing');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /* ── Components ── */

  const openComponentCreate = (kind) => {
    setEditingComponent(null);
    componentForm.resetFields();
    const meta = kindMeta(kind);
    componentForm.setFieldsValue({
      kind,
      unitLabel: meta.unit,
      currency: 'USD',
      pricingPeriod: kind === 'storage' ? 'month' : 'hour',
      // Disks stay ours to hold while a deployment sleeps; compute does not
      billedWhileStopped: kind === 'storage',
      isActive: true,
      availableForCustomBuilds: true,
      minQuantity: 1,
      stepQuantity: 1,
      maxQuantity: 0,
      displayOrder: components.filter((c) => c.kind === kind).length + 1,
      vramGb: 0,
    });
    setComponentModal(true);
  };

  const openComponentEdit = (component) => {
    setEditingComponent(component);
    componentForm.setFieldsValue({
      ...component,
      model: component.specs?.model || '',
      vramGb: component.specs?.vramGb || 0,
      mediaType: component.specs?.mediaType || '',
    });
    setComponentModal(true);
  };

  const saveComponent = async () => {
    try {
      const values = await componentForm.validateFields();
      setSaving(true);

      const { model, vramGb, mediaType, ...rest } = values;
      const specs = {};
      if (values.kind === 'gpu') {
        if (model) specs.model = model;
        if (vramGb) specs.vramGb = vramGb;
      }
      if (values.kind === 'storage' && mediaType) specs.mediaType = mediaType;

      const payload = { ...rest, specs };

      const result = editingComponent
        ? await resourceComponentsApi.updateComponent(editingComponent.id, payload)
        : await resourceComponentsApi.createComponent(payload);

      message.success(result.message || 'Saved');

      // Say plainly what a price change did to the catalog, rather than
      // letting the admin discover it on the Tiers page
      if (result.repricedTiers?.length) {
        Modal.info({
          title: `${result.repricedTiers.length} tier price(s) changed`,
          content: (
            <ul style={{ paddingInlineStart: 18, marginBottom: 0 }}>
              {result.repricedTiers.map((t) => (
                <li key={t.tierId}>
                  <b>{t.name}</b>: {t.before} → {t.after} /hr
                </li>
              ))}
            </ul>
          ),
          okText: 'Got it',
        });
      }

      setComponentModal(false);
      fetchAll();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.message || 'Could not save the component');
    } finally {
      setSaving(false);
    }
  };

  const toggleComponent = async (component) => {
    try {
      await resourceComponentsApi.toggleComponent(component.id);
      message.success(`${component.name} ${component.isActive ? 'disabled' : 'enabled'}`);
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not toggle the component');
    }
  };

  const removeComponent = async (component) => {
    try {
      await resourceComponentsApi.deleteComponent(component.id);
      message.success('Component deleted');
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not delete the component');
    }
  };

  /* ── Categories ── */

  const openCategoryCreate = () => {
    setEditingCategory(null);
    categoryForm.resetFields();
    categoryForm.setFieldsValue({ isActive: true, displayOrder: categories.length + 1 });
    setCategoryModal(true);
  };

  const openCategoryEdit = (category) => {
    setEditingCategory(category);
    categoryForm.setFieldsValue(category);
    setCategoryModal(true);
  };

  const saveCategory = async () => {
    try {
      const values = await categoryForm.validateFields();
      setSaving(true);

      if (editingCategory) {
        await resourceComponentsApi.updateCategory(editingCategory.id, values);
        message.success('Category updated');
      } else {
        await resourceComponentsApi.createCategory(values);
        message.success('Category created');
      }

      setCategoryModal(false);
      fetchAll();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.message || 'Could not save the category');
    } finally {
      setSaving(false);
    }
  };

  const removeCategory = async (category) => {
    try {
      const result = await resourceComponentsApi.deleteCategory(category.id);
      message.success(result.message || 'Category deleted');
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not delete the category');
    }
  };

  const componentColumns = [
    {
      title: 'Component',
      dataIndex: 'name',
      render: (name, row) => (
        <Space direction="vertical" size={2}>
          <Space size={6} wrap>
            <Text strong>{name}</Text>
            {!row.isActive && <Tag>Disabled</Tag>}
            {row.billedWhileStopped && (
              <Tooltip title="Keeps charging while a customer's deployment is paused or stopped">
                <Tag color="gold" icon={<PauseCircleOutlined />} style={{ marginInlineEnd: 0 }}>
                  Billed while stopped
                </Tag>
              </Tooltip>
            )}
          </Space>
          {row.description && (
            <Text type="secondary" style={{ fontSize: 12 }}>{row.description}</Text>
          )}
          {row.kind === 'gpu' && row.specs?.vramGb > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {row.specs.vramGb}GB VRAM{row.specs.model ? ` · ${row.specs.model}` : ''}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Price',
      key: 'price',
      width: 170,
      align: 'right',
      render: (_, row) => (
        <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
          <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            {money(row.pricePerUnitPerHour, row.currency)}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            per {row.unitLabel} / hour
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            = {money2(row.pricePerUnitPerMonth, row.currency)} per {row.unitLabel} / month
          </Text>
        </Space>
      ),
    },
    {
      title: 'Used by',
      key: 'usage',
      width: 140,
      render: (_, row) => (row.tierCount ? (
        <Tooltip title={row.tierNames.join(', ')}>
          <Text>{row.tierCount} tier{row.tierCount === 1 ? '' : 's'}</Text>
        </Tooltip>
      ) : <Text type="secondary">Not used yet</Text>),
    },
    rowActions([
      {
        key: 'edit', icon: <EditOutlined />, label: 'Edit',
        visible: () => canEdit, onClick: openComponentEdit,
      },
      {
        key: 'disable', icon: <StopOutlined />, label: 'Disable',
        visible: (r) => canEdit && r.isActive, onClick: toggleComponent,
      },
      {
        key: 'enable', icon: <CheckCircleOutlined />, label: 'Enable',
        visible: (r) => canEdit && !r.isActive, onClick: toggleComponent,
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        visible: () => canDelete,
        confirm: { title: 'Delete this component?', description: 'Refused if any tier is built from it.' },
        onClick: removeComponent,
      },
    ], { maxVisible: 3, width: 130 }),
  ];

  const kindTabs = KINDS.map((kind) => {
    const rows = components.filter((c) => c.kind === kind.value);
    return {
      key: kind.value,
      label: (
        <span>
          {kind.label}
          {rows.length > 0 && <Tag style={{ marginInlineStart: 8 }}>{rows.length}</Tag>}
        </span>
      ),
      children: (
        <>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>{kind.hint}</Paragraph>
          {canCreate && (
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              onClick={() => openComponentCreate(kind.value)}
              style={{ marginBottom: 12 }}
            >
              New {kind.label.toLowerCase()} component
            </Button>
          )}
          <Table
            scroll={{ x: 'max-content' }}
            columns={componentColumns}
            dataSource={rows}
            rowKey="id"
            loading={loading}
            pagination={false}
            size="small"
            locale={{ emptyText: <Empty description={`No ${kind.label.toLowerCase()} components yet`} /> }}
          />
        </>
      ),
    };
  });

  const categoryColumns = [
    {
      title: 'Category',
      dataIndex: 'name',
      render: (name, row) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            <Tag color={row.color || 'default'}>{name}</Tag>
            {!row.isActive && <Tag>Disabled</Tag>}
          </Space>
          {row.description && (
            <Text type="secondary" style={{ fontSize: 12 }}>{row.description}</Text>
          )}
        </Space>
      ),
    },
    { title: 'Tiers', dataIndex: 'tierCount', width: 100, render: (n) => <Text type="secondary">{n || 0}</Text> },
    rowActions([
      {
        key: 'edit', icon: <EditOutlined />, label: 'Edit',
        visible: () => canEdit, onClick: openCategoryEdit,
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        visible: () => canDelete,
        confirm: { title: 'Delete this category?', description: 'Tiers filed under it are kept and simply become uncategorised.' },
        onClick: removeCategory,
      },
    ], { width: 100 }),
  ];

  const componentKind = Form.useWatch('kind', componentForm);
  const pricingPeriod = Form.useWatch('pricingPeriod', componentForm);
  const pricePerUnit = Form.useWatch('pricePerUnit', componentForm);
  const unitLabel = Form.useWatch('unitLabel', componentForm) || 'unit';

  const perHour = pricingPeriod === 'month'
    ? (pricePerUnit || 0) / hoursPerMonth
    : (pricePerUnit || 0);

  return (
    <div>
      <PageHeader
        title="Resource Pricing"
        subtitle="The per-unit prices your machines are built from, and the categories they are filed under."
        breadcrumbs={[
          { label: 'Home', path: '/' },
          { label: 'AI Infrastructure' },
          { label: 'Resource Pricing' },
        ]}
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/tiers')}>Back to tiers</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchAll}>Refresh</Button>
          </Space>
        }
      />

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 20 }}
        message="Editing a price here reprices tiers immediately"
        description={
          <>
            Every tier built from a component is recalculated the moment you save, and you will be
            told which ones changed. Deployments already running are untouched — their rates were
            frozen when the customer ordered.
            {!storageBillingOn && (
              <>
                {' '}
                <b>Note:</b> idle-storage charging is currently switched off in Settings → Billing,
                so nothing is billed while a deployment is stopped regardless of what is marked
                below.
              </>
            )}
          </>
        }
      />

      <Card>
        <Tabs
          items={[
            ...kindTabs,
            {
              key: 'categories',
              label: <span>Categories <Tag style={{ marginInlineStart: 8 }}>{categories.length}</Tag></span>,
              children: (
                <>
                  <Paragraph type="secondary" style={{ fontSize: 13 }}>
                    The shelf a machine sits on — GPU Optimized, CPU Optimized, Memory Optimized,
                    or anything else you sell. Purely a label: nothing about pricing or sizing
                    depends on it.
                  </Paragraph>
                  {canCreate && (
                    <Button
                      type="dashed"
                      icon={<PlusOutlined />}
                      onClick={openCategoryCreate}
                      style={{ marginBottom: 12 }}
                    >
                      New category
                    </Button>
                  )}
                  <Table
                    scroll={{ x: 'max-content' }}
                    columns={categoryColumns}
                    dataSource={categories}
                    rowKey="id"
                    loading={loading}
                    pagination={false}
                    size="small"
                  />
                </>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Component form ── */}
      <Modal
        title={editingComponent ? `Edit ${editingComponent.name}` : 'New component'}
        open={componentModal}
        onOk={saveComponent}
        onCancel={() => setComponentModal(false)}
        confirmLoading={saving}
        width={720}
        okText={editingComponent ? 'Save changes' : 'Create component'}
      >
        <Form form={componentForm} layout="vertical" style={{ marginTop: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="Name" rules={[{ required: true, message: 'A name is required' }]}>
                <Input placeholder="NVMe SSD" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="kind" label="Kind" rules={[{ required: true }]}>
                <Select options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="unitLabel"
                label="Unit"
                help="What one of these is"
                rules={[{ required: true }]}
              >
                <Input placeholder="GB" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="What this part is, in the admin's own words" />
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="pricePerUnit"
                label="Price per unit"
                rules={[{ required: true, message: 'A price is required' }]}
              >
                <InputNumber min={0} step={0.001} precision={6} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="pricingPeriod" label="Per">
                <Select
                  options={[
                    { value: 'hour', label: 'Hour' },
                    { value: 'month', label: `Month (${hoursPerMonth} hrs)` },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="currency" label="Currency">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Alert
            type="info"
            style={{ marginBottom: 16 }}
            message={
              <Text style={{ fontSize: 13 }}>
                Billed as <b>{money(perHour)} per {unitLabel} per hour</b>
                {' — '}
                {money2(perHour * hoursPerMonth)} per {unitLabel} per month.
                {' '}A tier with 500 {unitLabel} of this pays {money2(perHour * 500)}/hr for it.
              </Text>
            }
          />

          <Form.Item
            name="billedWhileStopped"
            label="Keep charging while the deployment is paused or stopped"
            valuePropName="checked"
            help={
              'Turn this on for anything the customer still occupies when they are not running — '
              + 'disks, above all. Compute you can hand back to the pool should stay off.'
            }
          >
            <Switch />
          </Form.Item>

          {componentKind === 'gpu' && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="model" label="Accelerator model" help="Shown on the tier's spec line">
                  <Input placeholder="NVIDIA A100" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="vramGb"
                  label="VRAM per unit (GB)"
                  help="Used to size models against this tier — get it right or recommendations will be wrong"
                >
                  <InputNumber min={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          )}

          {componentKind === 'storage' && (
            <Form.Item name="mediaType" label="Media type" help="Free text, e.g. nvme, ssd, hdd">
              <Input placeholder="nvme" />
            </Form.Item>
          )}

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="minQuantity" label="Min quantity">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="maxQuantity" label="Max quantity" help="0 = no limit">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="stepQuantity" label="Step">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="displayOrder" label="Display order">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="availableForCustomBuilds"
                label="Offer in customer-built machines"
                valuePropName="checked"
                help="For the coming flow where a customer assembles their own machine instead of picking a tier"
              >
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="isActive" label="Active" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* ── Category form ── */}
      <Modal
        title={editingCategory ? `Edit ${editingCategory.name}` : 'New category'}
        open={categoryModal}
        onOk={saveCategory}
        onCancel={() => setCategoryModal(false)}
        confirmLoading={saving}
        okText={editingCategory ? 'Save changes' : 'Create category'}
      >
        <Form form={categoryForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: 'A name is required' }]}>
            <Input placeholder="Memory Optimized" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="What kind of workload this shelf is for" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="color" label="Tag colour" help="Hex, e.g. #722ed1">
                <Input placeholder="#722ed1" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="displayOrder" label="Order">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="isActive" label="Active" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

export default ResourcePricingPage;
