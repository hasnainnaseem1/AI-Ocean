import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Space, Card, message, Row, Col, Statistic, Tag, Input,
  Modal, Form, InputNumber, Select, Typography, Alert, Drawer, Descriptions,
} from 'antd';
import {
  WalletOutlined, DollarOutlined,
  PlusOutlined, EyeOutlined, WarningOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import { usePermission } from '../../hooks/usePermission';
import walletsApi from '../../api/walletsApi';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS } from '../../theme/colors';

const { Text, Paragraph } = Typography;

const TYPE_META = {
  topup: { color: 'green', label: 'Top-up' },
  signup_credit: { color: 'blue', label: 'Welcome credit' },
  bonus: { color: 'blue', label: 'Bonus' },
  charge: { color: 'red', label: 'Usage' },
  refund: { color: 'cyan', label: 'Refund' },
  adjustment: { color: 'purple', label: 'Adjustment' },
};

const WalletsPage = () => {
  const { hasPermission } = usePermission();
  const { isDark } = useTheme();
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const error = STATUS_COLORS.error[isDark ? 'dark' : 'light'];

  const [loading, setLoading] = useState(false);
  const [wallets, setWallets] = useState([]);
  const [summary, setSummary] = useState({});
  const [search, setSearch] = useState('');

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const canManage = hasPermission(PERMISSIONS.BILLING_MANAGE);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await walletsApi.getWallets({ search, limit: 100 });
      setWallets(data.wallets || []);
      setSummary(data.summary || {});
    } catch {
      message.error('Failed to load wallets');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetch(); }, [fetch]);

  const openDetail = async (wallet) => {
    setDetailLoading(true);
    setDetail({ loading: true });
    try {
      const data = await walletsApi.getWallet(wallet.userId.id || wallet.userId);
      setDetail(data);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not load the wallet');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const openAdjust = (wallet) => {
    setAdjustTarget(wallet);
    form.resetFields();
    form.setFieldsValue({ type: 'adjustment', amount: null, description: '' });
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const userId = adjustTarget.userId.id || adjustTarget.userId;
      const result = await walletsApi.adjust(userId, values);
      message.success(result.message);
      setAdjustOpen(false);
      fetch();
      if (detail?.customer?.id === userId) openDetail(adjustTarget);
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.message || 'Could not adjust the balance');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: 'Customer',
      key: 'customer',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text strong>{row.userId?.name || '—'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{row.userId?.email}</Text>
        </Space>
      ),
    },
    {
      title: 'Balance',
      dataIndex: 'balance',
      width: 115,
      align: 'right',
      sorter: (a, b) => a.balance - b.balance,
      defaultSortOrder: 'ascend',
      render: (b, row) => (
        <Space size={4}>
          {b <= 0 && <WarningOutlined style={{ color: error }} />}
          <Text strong type={b <= 0 ? 'danger' : undefined}>
            {row.currency} {b.toFixed(2)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Lifetime top-up',
      dataIndex: 'lifetimeTopUp',
      width: 115,
      align: 'right',
      render: (v, row) => <Text type="secondary">{row.currency} {(v || 0).toFixed(2)}</Text>,
    },
    {
      title: 'Lifetime spend',
      dataIndex: 'lifetimeSpend',
      width: 115,
      align: 'right',
      sorter: (a, b) => (a.lifetimeSpend || 0) - (b.lifetimeSpend || 0),
      render: (v, row) => <Text>{row.currency} {(v || 0).toFixed(2)}</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 125,
      render: (_, row) => (
        <Space size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>Ledger</Button>
          {canManage && (
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => openAdjust(row)}>Adjust</Button>
          )}
        </Space>
      ),
    },
  ];

  const ledgerColumns = [
    {
      title: 'Date',
      dataIndex: 'createdAt',
      width: 140,
      render: (d) => new Date(d).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      width: 115,
      render: (t) => {
        const m = TYPE_META[t] || { color: 'default', label: t };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    { title: 'Description', dataIndex: 'description', ellipsis: true },
    {
      title: 'Amount',
      dataIndex: 'amount',
      width: 100,
      align: 'right',
      render: (a) => (
        <Text strong style={{ color: a >= 0 ? success : error }}>
          {a >= 0 ? '+' : ''}{a.toFixed(2)}
        </Text>
      ),
    },
    {
      title: 'Balance',
      dataIndex: 'balanceAfter',
      width: 90,
      align: 'right',
      render: (b) => <Text type="secondary">{b.toFixed(2)}</Text>,
    },
  ];

  const emptyWallets = wallets.filter((w) => w.balance <= 0).length;

  return (
    <div>
      <PageHeader
        title="Customer Wallets"
        subtitle="Prepaid balances across every customer"
        count={wallets.length}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Billing' }, { label: 'Wallets' }]}
      />

      <StatRow>
        <StatCard
          count={3} tone="blue" icon={<WalletOutlined />} label="Outstanding Balance"
          value={(summary.outstandingBalance || 0).toFixed(2)}
          caption="Paid for but not yet consumed"
        />
        <StatCard count={3} tone="green" icon={<DollarOutlined />} label="Lifetime Revenue Collected" value={(summary.lifetimeTopUp || 0).toFixed(2)} />
        <StatCard count={3} tone="amber" icon={<WarningOutlined />} label="Wallets at Zero" value={emptyWallets} suffix={`/ ${wallets.length}`} />
      </StatRow>

      <DataTable
        title="Wallets"
        count={wallets.length}
        search={{ value: search, onChange: (e) => setSearch(e.target.value), placeholder: 'Search by customer name or email…' }}
        onRefresh={fetch}
        refreshLoading={loading}
        empty={{ title: 'No wallets yet', description: 'They are created when customers sign up.' }}
        columns={columns}
        dataSource={wallets}
        rowKey="id"
        loading={loading}
        pagination={wallets.length > 20 ? { pageSize: 20 } : false}
        scroll={{ x: 820 }}
      />

      {/* Ledger drawer */}
      <Drawer
        title={detail?.customer ? `${detail.customer.name} — wallet` : 'Wallet'}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={840}
        loading={detailLoading}
      >
        {detail?.wallet && (
          <>
            {!detail.reconciliation?.matches && (
              <Alert
                type="error"
                showIcon
                message="Balance does not match the ledger"
                description={`Wallet shows ${detail.wallet.balance.toFixed(2)} but the transactions sum to ${detail.reconciliation.ledgerTotal.toFixed(2)}. This should not happen — please investigate before adjusting.`}
                style={{ marginBottom: 16 }}
              />
            )}

            <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Balance" value={detail.wallet.balance} precision={2} prefix={detail.wallet.currency} />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic title="Burn rate" value={detail.wallet.burnRatePerHour} precision={2} suffix="/hr" />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="Runway"
                    value={detail.wallet.runwayDays === null ? '∞' : detail.wallet.runwayDays}
                    suffix={detail.wallet.runwayDays === null ? '' : 'days'}
                  />
                </Card>
              </Col>
            </Row>

            <Descriptions column={2} size="small" bordered style={{ marginBottom: 20 }}>
              <Descriptions.Item label="Email">{detail.customer.email}</Descriptions.Item>
              <Descriptions.Item label="Active deployments">{detail.activeDeployments}</Descriptions.Item>
              <Descriptions.Item label="Lifetime spend">
                {detail.wallet.currency} {detail.wallet.lifetimeSpend.toFixed(2)}
              </Descriptions.Item>
            </Descriptions>

            <Table
              columns={ledgerColumns}
              dataSource={detail.transactions}
              rowKey="id"
              size="small"
              pagination={{ pageSize: 15 }}
              scroll={{ x: 570 }}
            />
          </>
        )}
      </Drawer>

      {/* Adjust modal */}
      <Modal
        title={`Adjust balance — ${adjustTarget?.userId?.email || ''}`}
        open={adjustOpen}
        onOk={submitAdjust}
        onCancel={() => setAdjustOpen(false)}
        confirmLoading={saving}
        okText="Apply adjustment"
      >
        <Paragraph type="secondary">
          Use a positive amount to credit the customer and a negative amount to debit them.
          Adding credit also resumes any deployment that was paused for lack of funds.
        </Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item
            name="amount"
            label={`Amount (${adjustTarget?.currency || 'USD'})`}
            rules={[{ required: true, message: 'Enter a non-zero amount' }]}
          >
            <InputNumber style={{ width: '100%' }} step={1} precision={2} placeholder="50 or -25" />
          </Form.Item>
          <Form.Item name="type" label="Record as">
            <Select
              options={[
                { value: 'adjustment', label: 'Adjustment (correction)' },
                { value: 'bonus', label: 'Bonus (goodwill credit)' },
                { value: 'refund', label: 'Refund' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="description"
            label="Reason"
            help="Shown to the customer in their transaction history"
            rules={[{ required: true, message: 'Please give a reason' }]}
          >
            <Input placeholder="Goodwill credit for the outage on 12 March" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default WalletsPage;
