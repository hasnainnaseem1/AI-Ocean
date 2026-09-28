import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button, Space, Card, message, Tooltip, Row, Col,
  Tag, Modal, Form, Input, InputNumber, Switch, Select, Alert, Typography, Radio,
  Divider, Empty,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  CheckCircleOutlined, StopOutlined, DatabaseOutlined, DollarOutlined,
  MinusCircleOutlined, PauseCircleOutlined, SettingOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import DataTable, { rowActions } from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import { usePermission } from '../../hooks/usePermission';
import { tiersApi, resourceComponentsApi } from '../../api/catalogApi';
import { PERMISSIONS } from '../../utils/permissions';

const { Text } = Typography;

const STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'limited', label: 'Limited' },
  { value: 'out_of_stock', label: 'Out of stock' },
];

/**
 * Four decimals is enough for a machine's hourly rate but not for a part's.
 * A per-GB-hour disk price is genuinely tiny — NVMe at 0.000123 and SSD at
 * 0.000068 both round to "0.0001", which makes two differently priced disks
 * look identical in the part picker. Fall back to six decimals below a cent.
 */
const money = (n, currency = 'USD') => {
  const v = Number(n || 0);
  return `${currency} ${v > 0 && v < 0.01 ? v.toFixed(6) : v.toFixed(4)}`;
};
const money2 = (n, currency = 'USD') => `${currency} ${Number(n || 0).toFixed(2)}`;

/**
 * The spec line under a tier's name. Only mentions parts the machine actually
 * has, so a CPU-optimised tier does not advertise "0× GPU".
 */
const specLine = (row) => {
  const parts = [];
  if (row.gpuCount > 0) {
    parts.push(`${row.gpuCount}× ${row.gpuModel || 'accelerator'}${row.vramGb ? ` (${row.vramGb}GB)` : ''}`);
  }
  if (row.vcpu) parts.push(`${row.vcpu} vCPU`);
  if (row.ramGb) parts.push(`${row.ramGb}GB RAM`);
  if (row.storageGb) parts.push(`${row.storageGb}GB ${row.storageType || 'storage'}`);
  if (row.networkGbps) parts.push(`${row.networkGbps} Gbps`);
  return parts.join(' · ') || 'No specification set';
};

/**
 * Machine tiers — our own cloud, of whatever shape the platform sells.
 *
 * A tier is priced one of two ways, chosen per tier: assembled from resource
 * components (a disk, some vCPUs, RAM, maybe accelerators) at their per-unit
 * prices, or a flat hourly rate typed by hand. Both produce the same two
 * numbers everything downstream reads — what it costs running, and what it
 * costs while paused or stopped and only the disk is still ours to hold.
 */
const TiersPage = () => {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const [loading, setLoading] = useState(false);
  const [tiers, setTiers] = useState([]);
  const [components, setComponents] = useState([]);
  const [categories, setCategories] = useState([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  // Live price of whatever is currently in the builder, priced by the server
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const quoteTicket = useRef(0);

  const canEdit = hasPermission(PERMISSIONS.MODELS_EDIT);
  const canCreate = hasPermission(PERMISSIONS.MODELS_CREATE);
  const canDelete = hasPermission(PERMISSIONS.MODELS_DELETE);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [tierData, componentData, categoryData] = await Promise.all([
        tiersApi.getTiers(),
        resourceComponentsApi.getComponents({ isActive: true }),
        resourceComponentsApi.getCategories(),
      ]);
      setTiers(tierData.tiers || []);
      setComponents(componentData.components || []);
      setCategories(categoryData.categories || []);
    } catch {
      message.error('Failed to load tiers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  /**
   * Ask the server what the current builder contents cost.
   *
   * Deliberately a round trip rather than multiplying in the browser: this is
   * the number we will actually bill, and a second implementation here would
   * be free to drift from it.
   */
  const refreshQuote = useCallback(async () => {
    const values = form.getFieldsValue();
    if (values.pricingMode !== 'components') { setQuote(null); return; }

    const picks = (values.components || [])
      .filter((c) => c && c.componentId && c.quantity > 0)
      .map((c) => ({ componentId: c.componentId, quantity: c.quantity }));

    if (!picks.length) { setQuote(null); return; }

    const ticket = ++quoteTicket.current;
    setQuoting(true);
    try {
      const result = await tiersApi.pricePreview(picks, values.markupPercent || 0);
      if (ticket === quoteTicket.current) setQuote(result);
    } catch {
      if (ticket === quoteTicket.current) setQuote(null);
    } finally {
      if (ticket === quoteTicket.current) setQuoting(false);
    }
  }, [form]);

  // Debounced so dragging a quantity spinner doesn't fire a request per step
  const quoteTimer = useRef(null);
  const scheduleQuote = useCallback(() => {
    clearTimeout(quoteTimer.current);
    quoteTimer.current = setTimeout(refreshQuote, 300);
  }, [refreshQuote]);

  useEffect(() => () => clearTimeout(quoteTimer.current), []);

  const openCreate = () => {
    setEditing(null);
    setQuote(null);
    form.resetFields();
    form.setFieldsValue({
      currency: 'USD',
      status: 'available',
      isActive: true,
      displayOrder: tiers.length + 1,
      regions: ['default'],
      capacityTotal: 0,
      pricingMode: 'components',
      markupPercent: 0,
      components: [],
      gpuCount: 0,
      vramGb: 0,
      vcpu: 0,
      ramGb: 0,
      storageGb: 0,
      networkGbps: 0,
      flatPricePerHour: 0,
      flatStoppedPricePerHour: 0,
    });
    setModalOpen(true);
  };

  const openEdit = (tier) => {
    setEditing(tier);
    setQuote(null);
    form.setFieldsValue({
      ...tier,
      categoryId: tier.categoryId || undefined,
      regions: tier.regions || [],
      capacityTotal: tier.capacity?.total || 0,
      pricingMode: tier.pricing?.mode || 'flat',
      markupPercent: tier.pricing?.markupPercent || 0,
      flatPricePerHour: tier.pricing?.flatPricePerHour ?? tier.pricePerHour ?? 0,
      flatStoppedPricePerHour: tier.pricing?.flatStoppedPricePerHour ?? 0,
      components: (tier.components || []).map((c) => ({
        componentId: c.componentId,
        quantity: c.quantity,
      })),
    });
    setModalOpen(true);
    scheduleQuote();
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const {
        capacityTotal, pricingMode, markupPercent,
        flatPricePerHour, flatStoppedPricePerHour,
        components: picks, ...rest
      } = values;

      const payload = {
        ...rest,
        categoryId: values.categoryId || null,
        // Preserve what's already allocated; only the total is admin-editable
        capacity: { total: capacityTotal || 0, allocated: editing?.capacity?.allocated || 0 },
        components: (picks || [])
          .filter((c) => c && c.componentId && c.quantity > 0)
          .map((c) => ({ componentId: c.componentId, quantity: c.quantity })),
        pricing: {
          mode: pricingMode,
          markupPercent: markupPercent || 0,
          flatPricePerHour: flatPricePerHour || 0,
          flatStoppedPricePerHour: flatStoppedPricePerHour || 0,
        },
      };

      const result = editing
        ? await tiersApi.updateTier(editing.id, payload)
        : await tiersApi.createTier(payload);

      message.success(editing ? 'Tier updated' : 'Tier created');
      if (result.warning) message.warning(result.warning);

      /**
       * A tier with no running price, or with storage held for nothing while
       * stopped, is a real way to give away compute or disk for free — the
       * server never blocks the save (this platform warns rather than
       * rejects), so this is where it's actually seen and has to be
       * consciously dismissed rather than missed in a toast.
       */
      if (result.freeComputeWarnings?.length) {
        Modal.warning({
          title: 'This tier gives something away for free',
          content: (
            <Space direction="vertical" size={8} style={{ marginTop: 8 }}>
              {result.freeComputeWarnings.map((w) => <Text key={w.code}>{w.message}</Text>)}
            </Space>
          ),
          okText: 'I understand',
          width: 425,
        });
      }

      setModalOpen(false);
      fetchAll();
    } catch (err) {
      if (err?.errorFields) return; // form validation, already highlighted
      message.error(err.response?.data?.message || 'Could not save the tier');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (tier) => {
    try {
      await tiersApi.toggleTier(tier.id);
      message.success(`${tier.name} ${tier.isActive ? 'disabled' : 'enabled'}`);
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not toggle the tier');
    }
  };

  const remove = async (tier) => {
    try {
      await tiersApi.deleteTier(tier.id);
      message.success('Tier deleted');
      fetchAll();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not delete the tier');
    }
  };

  const activeCount = tiers.filter((t) => t.isActive).length;
  const totalCapacity = tiers.reduce((sum, t) => sum + (t.capacity?.total || 0), 0);
  const allocated = tiers.reduce((sum, t) => sum + (t.capacity?.allocated || 0), 0);

  const componentOptions = components.map((c) => {
    // Disks are priced per GB per hour, which is an unreadable number to choose
    // on. Quote the month for anything that cheap — it is how the admin set it
    // and how they think about it.
    const price = c.pricePerUnitPerHour < 0.01 && c.pricePerUnitPerMonth
      ? `${money2(c.pricePerUnitPerMonth, c.currency)}/${c.unitLabel}/mo`
      : `${money(c.pricePerUnitPerHour, c.currency)}/${c.unitLabel}/hr`;

    // Only `value` and `label` — antd spreads anything else straight onto the
    // option's DOM node, which is how a stray `kind="cpu"` attribute ends up in
    // the markup.
    return {
      value: c.id,
      label: `${c.name} — ${price}${c.billedWhileStopped ? ' · held while stopped' : ''}`,
    };
  });

  const columns = [
    {
      title: 'Tier',
      width: 250,
      dataIndex: 'name',
      render: (name, row) => (
        <Space direction="vertical" size={2}>
          <Space size={6} wrap>
            <Text strong>{name}</Text>
            {row.category && (
              <Tag color={row.category.color || 'default'} style={{ marginInlineEnd: 0 }}>
                {row.category.name}
              </Tag>
            )}
            {!row.isActive && <Tag>Disabled</Tag>}
            {row.status === 'limited' && <Tag color="orange">Limited</Tag>}
            {row.status === 'out_of_stock' && <Tag color="red">Out of stock</Tag>}
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>{specLine(row)}</Text>
        </Space>
      ),
    },
    {
      title: 'Priced from',
      key: 'pricingMode',
      width: 135,
      render: (_, row) => (row.pricing?.mode === 'components'
        ? (
          <Tooltip title={`${row.components?.length || 0} component(s)${row.pricing.markupPercent ? ` + ${row.pricing.markupPercent}% markup` : ''}`}>
            <Tag color="blue">Components</Tag>
          </Tooltip>
        )
        : <Tag>Flat rate</Tag>),
    },
    {
      title: 'Running',
      dataIndex: 'pricePerHour',
      width: 134,
      align: 'right',
      sorter: (a, b) => a.pricePerHour - b.pricePerHour,
      render: (p, row) => (
        <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
          <Text strong>{money2(p, row.currency)}/hr</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {money2(p * 730, row.currency)}/mo
          </Text>
        </Space>
      ),
    },
    {
      title: 'Stopped',
      dataIndex: 'stoppedPricePerHour',
      width: 115,
      align: 'right',
      sorter: (a, b) => (a.stoppedPricePerHour || 0) - (b.stoppedPricePerHour || 0),
      render: (p, row) => (p > 0 ? (
        <Tooltip title="Charged while the customer's deployment is paused or stopped — they still hold the disk">
          <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
            <Text>{money2(p, row.currency)}/hr</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {money2(p * 730, row.currency)}/mo
            </Text>
          </Space>
        </Tooltip>
      ) : (
        <Tooltip title="A stopped deployment on this tier costs the customer nothing. Add a storage component, or set a stopped rate, to charge for held disk.">
          <Text type="secondary">Free</Text>
        </Tooltip>
      )),
    },
    {
      title: 'Capacity',
      key: 'capacity',
      width: 105,
      render: (_, row) => {
        if (!row.capacity?.total) return <Text type="secondary">Untracked</Text>;
        const used = row.capacity.allocated || 0;
        const total = row.capacity.total;
        return (
          <Text type={used >= total ? 'danger' : undefined}>
            {used} / {total} in use
          </Text>
        );
      },
    },
    {
      title: 'Deployments',
      dataIndex: 'activeDeployments',
      width: 90,
      align: 'right',
      render: (n) => <Text type="secondary">{n || 0}</Text>,
    },
    rowActions([
      {
        key: 'edit', icon: <EditOutlined />, label: 'Edit',
        visible: () => canEdit, onClick: openEdit,
      },
      {
        key: 'disable', icon: <StopOutlined />, label: 'Disable',
        visible: (r) => canEdit && r.isActive, onClick: toggle,
      },
      {
        key: 'enable', icon: <CheckCircleOutlined />, label: 'Enable',
        visible: (r) => canEdit && !r.isActive, onClick: toggle,
      },
      {
        key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true,
        visible: () => canDelete,
        confirm: { title: 'Delete this tier?', description: "Models offering it lose the option. Tiers with active deployments can't be deleted." },
        onClick: remove,
      },
    ], { maxVisible: 3 }),
  ];

  const pricingMode = Form.useWatch('pricingMode', form);
  const currency = Form.useWatch('currency', form) || 'USD';

  return (
    <div>
      <PageHeader
        title="Tiers"
        subtitle="The machines on our own cloud that customers deploy models onto — accelerated, CPU-optimised, memory-optimised, whatever you assemble."
        count={tiers.length}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'AI Infrastructure' }, { label: 'Tiers' }]}
        extra={
          <Space>
            <Button icon={<SettingOutlined />} onClick={() => navigate('/resource-pricing')}>
              Resource pricing
            </Button>
            {canCreate && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New tier</Button>
            )}
          </Space>
        }
      />

      <Alert
        type="info"
        showIcon
        message="Every tier has two prices"
        description={
          <>
            <b>Running</b> is charged for as long as the deployment is live. <b>Stopped</b> is
            charged while it is paused or stopped — the customer released the compute but their
            data still sits on your disk, so the storage keeps billing until they terminate.
            Build a tier from resource components and both numbers are worked out for you.
            Changing a price never affects a deployment already running: rates are frozen at
            order time.
          </>
        }
        style={{ marginBottom: 20 }}
      />

      <StatRow>
        <StatCard count={4} tone="blue" icon={<DatabaseOutlined />} label="Active Tiers" value={activeCount} suffix={`/ ${tiers.length}`} />
        <StatCard count={4} tone="purple" icon={<DatabaseOutlined />} label="Units Allocated" value={allocated} suffix={`/ ${totalCapacity}`} />
        <StatCard count={4} tone="green" icon={<DollarOutlined />} label="Cheapest Running Rate" value={(tiers.length ? Math.min(...tiers.map((t) => t.pricePerHour)) : 0).toFixed(2)} suffix="/hr" />
        <StatCard count={4} tone="amber" icon={<PauseCircleOutlined />} label="Charge While Stopped" value={tiers.filter((t) => (t.stoppedPricePerHour || 0) > 0).length} suffix={`/ ${tiers.length}`} />
      </StatRow>

      <DataTable
        title="Tiers"
        count={tiers.length}
        onRefresh={fetchAll}
        refreshLoading={loading}
        empty={{ title: 'No tiers yet' }}
        columns={columns}
        dataSource={tiers}
        rowKey="id"
        loading={loading}
        pagination={false}
        scroll={{ x: 900 }}
      />

      <Modal
        title={editing ? `Edit ${editing.name}` : 'New tier'}
        open={modalOpen}
        onOk={save}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={880}
        okText={editing ? 'Save changes' : 'Create tier'}
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 16 }}
          onValuesChange={scheduleQuote}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="Tier name" rules={[{ required: true, message: 'A name is required' }]}>
                <Input placeholder="A100 80GB ×1" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="categoryId"
                label="Category"
                help="What kind of machine this is. Manage the list under Resource pricing."
              >
                <Select
                  allowClear
                  placeholder="Uncategorised"
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} placeholder="What this machine is good for" />
          </Form.Item>

          <Divider orientation="left" style={{ marginTop: 8 }}>Pricing</Divider>

          <Form.Item name="pricingMode" label="How is this tier priced?">
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value="components">Build from components</Radio.Button>
              <Radio.Button value="flat">Flat hourly price</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {pricingMode === 'components' ? (
            <ComponentBuilder
              form={form}
              options={componentOptions}
              components={components}
              quote={quote}
              quoting={quoting}
              currency={currency}
            />
          ) : (
            <FlatPricing currency={currency} />
          )}

          <Divider orientation="left">Availability</Divider>

          <Row gutter={16}>
            <Col span={10}>
              <Form.Item name="regions" label="Regions" help="Type to add">
                <Select mode="tags" placeholder="eu-central, us-east…" />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="capacityTotal" label="Total units" help="0 = untracked">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="status" label="Stock status">
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="isActive" label="Active" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="currency" label="Currency">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="displayOrder" label="Display order">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
};

/**
 * The bill of materials, plus the running total the server just quoted.
 *
 * Specs are not typed here — they are read off the parts. Picking two H100s
 * makes it a 2-accelerator machine; picking 500 GB of NVMe makes that its disk.
 */
const ComponentBuilder = ({ form, options, components, quote, quoting, currency }) => {
  const byId = new Map(components.map((c) => [c.id, c]));
  const picks = Form.useWatch('components', form) || [];

  if (!components.length) {
    return (
      <Alert
        type="warning"
        showIcon
        message="No resource components exist yet"
        description="A tier can't be assembled without parts to assemble it from. Create some disks, vCPUs and memory under Resource pricing first — or switch this tier to a flat hourly price."
        style={{ marginBottom: 16 }}
      />
    );
  }

  return (
    <>
      <Form.List name="components">
        {(fields, { add, remove }) => (
          <>
            {fields.length === 0 && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No parts yet — add a disk, some vCPUs and memory"
                style={{ marginBottom: 12 }}
              />
            )}

            {fields.map((field) => {
              const pick = picks[field.name] || {};
              const component = byId.get(pick.componentId);
              const lineTotal = component
                ? (pick.quantity || 0) * (component.pricePerUnitPerHour || 0)
                : 0;

              return (
                <Row gutter={8} key={field.key} align="middle" style={{ marginBottom: 8 }}>
                  <Col span={11}>
                    <Form.Item {...field} name={[field.name, 'componentId']} noStyle>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Choose a part"
                        options={options}
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={6}>
                    <Form.Item {...field} name={[field.name, 'quantity']} noStyle>
                      <InputNumber
                        min={0}
                        step={component?.stepQuantity || 1}
                        style={{ width: '100%' }}
                        addonAfter={component?.unitLabel || 'units'}
                        placeholder="Quantity"
                      />
                    </Form.Item>
                  </Col>
                  <Col span={5} style={{ textAlign: 'right' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {component ? `${money(lineTotal, currency)}/hr` : '—'}
                      {component?.billedWhileStopped && (
                        <Tag color="gold" style={{ marginLeft: 6, marginInlineEnd: 0 }}>held</Tag>
                      )}
                    </Text>
                  </Col>
                  <Col span={2} style={{ textAlign: 'right' }}>
                    <Button
                      type="text"
                      danger
                      icon={<MinusCircleOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </Col>
                </Row>
              );
            })}

            <Button
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={() => add({ quantity: 1 })}
              style={{ marginBottom: 16 }}
            >
              Add a part
            </Button>
          </>
        )}
      </Form.List>

      <Row gutter={16}>
        <Col span={8}>
          <Form.Item
            name="markupPercent"
            label="Markup"
            help="Added on top of the parts, for margin"
          >
            <InputNumber min={0} max={500} step={5} addonAfter="%" style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col span={16}>
          <QuoteSummary quote={quote} quoting={quoting} currency={currency} />
        </Col>
      </Row>
    </>
  );
};

/** What the server says these parts add up to — the same sum it will bill. */
const QuoteSummary = ({ quote, quoting, currency }) => {
  if (!quote) {
    return (
      <Card size="small" style={{ background: 'rgba(128,128,128,0.06)' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {quoting ? 'Pricing…' : 'Add parts above and the price appears here.'}
        </Text>
      </Card>
    );
  }

  const line = (label, value, strong = false, hint = null) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <Text type={strong ? undefined : 'secondary'} strong={strong} style={{ fontSize: strong ? 14 : 12 }}>
        {label}
      </Text>
      <div style={{ textAlign: 'right' }}>
        <Text strong={strong} style={{ fontSize: strong ? 15 : 12, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Text>
        {hint && (
          <div><Text type="secondary" style={{ fontSize: 11 }}>{hint}</Text></div>
        )}
      </div>
    </div>
  );

  return (
    <Card size="small" loading={quoting} style={{ background: 'rgba(22,119,255,0.05)' }}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        {line('Parts subtotal', `${money(quote.subtotalPerHour, currency)}/hr`)}
        {quote.markupPercent > 0 && line(`Markup (${quote.markupPercent}%)`,
          `${money(quote.pricePerHour - quote.subtotalPerHour, currency)}/hr`)}
        <Divider style={{ margin: '6px 0' }} />
        {line('Running', `${money2(quote.pricePerHour, currency)}/hr`, true,
          `${money2(quote.pricePerHour * 730, currency)} / month`)}
        {line('Paused or stopped', `${money2(quote.stoppedPricePerHour, currency)}/hr`, true,
          `${money2(quote.stoppedPricePerHour * 730, currency)} / month`)}
        <Text type="secondary" style={{ fontSize: 11 }}>
          {quote.stoppedPricePerHour > 0
            ? 'The stopped rate is the parts marked “held” — the disk the customer keeps.'
            : 'Nothing here is billed while stopped. Add a storage part to charge for held disk.'}
        </Text>

        {(quote.freeComputeWarnings || []).map((w) => (
          <Alert
            key={w.code}
            type="warning"
            showIcon
            message={w.message}
            style={{ marginTop: 4, fontSize: 12 }}
          />
        ))}
      </Space>
    </Card>
  );
};

/**
 * Flat pricing: both rates and every spec typed by hand.
 *
 * Kept because a platform owner who negotiated a package price should not have
 * to reverse-engineer it into parts to enter it.
 */
const FlatPricing = ({ currency }) => (
  <>
    <Row gutter={16}>
      <Col span={12}>
        <Form.Item
          name="flatPricePerHour"
          label="Running price per hour"
          rules={[{ required: true, message: 'An hourly price is required' }]}
        >
          <InputNumber min={0} step={0.01} precision={4} addonBefore={currency} style={{ width: '100%' }} />
        </Form.Item>
      </Col>
      <Col span={12}>
        <Form.Item
          name="flatStoppedPricePerHour"
          label="Stopped price per hour"
          help="What the customer pays to hold the disk while paused or stopped. 0 = free."
        >
          <InputNumber min={0} step={0.001} precision={4} addonBefore={currency} style={{ width: '100%' }} />
        </Form.Item>
      </Col>
    </Row>

    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="Specs are typed by hand in this mode"
      description="Build the tier from components instead and these are read off the parts, so they can never disagree with what the machine is actually made of."
    />

    <Row gutter={16}>
      <Col span={8}>
        <Form.Item name="gpuModel" label="Accelerator model" help="Leave blank for a machine with none">
          <Input placeholder="NVIDIA A100" />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item name="gpuCount" label="Accelerator count">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Col>
      <Col span={8}>
        <Form.Item name="vramGb" label="VRAM per accelerator (GB)">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Col>
    </Row>

    <Row gutter={16}>
      <Col span={6}>
        <Form.Item name="vcpu" label="vCPU">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Col>
      <Col span={6}>
        <Form.Item name="ramGb" label="RAM (GB)">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Col>
      <Col span={6}>
        <Form.Item name="storageGb" label="Storage (GB)">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Col>
      <Col span={6}>
        <Form.Item name="storageType" label="Storage type">
          <Input placeholder="NVMe SSD" />
        </Form.Item>
      </Col>
    </Row>

    <Row gutter={16}>
      <Col span={8}>
        <Form.Item name="networkGbps" label="Network (Gbps)">
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
      </Col>
    </Row>
  </>
);

export default TiersPage;
