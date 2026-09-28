import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Space, message, Tag, Input,
  Modal, Form, Typography, Tooltip,
} from 'antd';
import {
  DollarOutlined, WarningOutlined,
  CreditCardOutlined, StopOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import DataTable from '../../components/common/DataTable';
import { StatRow, StatCard } from '../../components/StatRow';
import { usePermission } from '../../hooks/usePermission';
import walletsApi from '../../api/walletsApi';
import { PERMISSIONS } from '../../utils/permissions';

const { Text, Paragraph } = Typography;

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '—';

/**
 * Every customer currently carrying an unpaid balance — pay-as-you-go usage
 * or unpaid storage the wallet couldn't cover. debtCollection.js already
 * chases these automatically (scheduled card retries, then a storage grace
 * period), so this page exists for what that job doesn't do on its own:
 * seeing the whole receivables picture at a glance, forcing an out-of-cycle
 * collection attempt, and the one thing that must always be a deliberate
 * human decision — writing a debt off.
 */
const ReceivablesPage = () => {
  const { hasPermission } = usePermission();
  const canManage = hasPermission(PERMISSIONS.BILLING_MANAGE);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [search, setSearch] = useState('');
  const [collecting, setCollecting] = useState(null);

  const [writeOffTarget, setWriteOffTarget] = useState(null);
  const [writingOff, setWritingOff] = useState(false);
  const [form] = Form.useForm();

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await walletsApi.getDebt({ search, limit: 100 });
      setRows(data.wallets || []);
      setSummary(data.summary || {});
    } catch {
      message.error('Failed to load receivables');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetch(); }, [fetch]);

  const attemptCollection = async (row) => {
    const userId = row.userId?.id || row.userId;
    setCollecting(userId);
    try {
      const result = await walletsApi.collect(userId);
      message.success(result.message);
      fetch();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not attempt collection');
    } finally {
      setCollecting(null);
    }
  };

  const openWriteOff = (row) => {
    setWriteOffTarget(row);
    form.resetFields();
  };

  const submitWriteOff = async () => {
    try {
      const values = await form.validateFields();
      setWritingOff(true);
      const userId = writeOffTarget.userId?.id || writeOffTarget.userId;
      const result = await walletsApi.writeOff(userId, values.reason);
      message.success(result.message);
      setWriteOffTarget(null);
      fetch();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.message || 'Could not write off this debt');
    } finally {
      setWritingOff(false);
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
      title: 'Outstanding',
      dataIndex: 'outstandingBalance',
      width: 115,
      align: 'right',
      sorter: (a, b) => a.outstandingBalance - b.outstandingBalance,
      defaultSortOrder: 'descend',
      render: (v, row) => (
        <Text strong type="danger">{row.currency} {(v || 0).toFixed(2)}</Text>
      ),
    },
    {
      title: 'Debt age',
      key: 'debtDays',
      width: 90,
      align: 'right',
      sorter: (a, b) => (a.debtStatus?.debtDays || 0) - (b.debtStatus?.debtDays || 0),
      render: (_, row) => (
        <Text>{row.debtStatus?.debtDays ?? 0} day{row.debtStatus?.debtDays === 1 ? '' : 's'}</Text>
      ),
    },
    {
      title: 'Status',
      key: 'status',
      width: 155,
      render: (_, row) => {
        if (!row.debtStatus?.blocked) {
          return <Tag color="default">Within limits</Tag>;
        }
        return (
          <Tag color="red" icon={<WarningOutlined />}>
            {row.debtStatus.reason === 'CREDIT_LIMIT_EXCEEDED' ? 'Over credit limit' : 'Debt too old'}
          </Tag>
        );
      },
    },
    {
      title: 'Last charge attempt',
      key: 'lastAttempt',
      width: 165,
      render: (_, row) => (
        row.lastAutoChargeAt ? (
          <Space direction="vertical" size={0}>
            <Text style={{ fontSize: 13 }}>{formatDate(row.lastAutoChargeAt)}</Text>
            {row.autoChargeFailures > 0 && (
              <Tooltip title={row.lastAutoChargeError || 'No further detail'}>
                <Text type="danger" style={{ fontSize: 12 }}>
                  {row.autoChargeFailures} failed attempt{row.autoChargeFailures === 1 ? '' : 's'}
                </Text>
              </Tooltip>
            )}
          </Space>
        ) : <Text type="secondary">Never attempted</Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 190,
      render: (_, row) => (
        <Space size={4}>
          {canManage && (
            <>
              <Button
                size="small"
                icon={<CreditCardOutlined />}
                loading={collecting === (row.userId?.id || row.userId)}
                onClick={() => attemptCollection(row)}
              >
                Collect
              </Button>
              <Button size="small" danger icon={<StopOutlined />} onClick={() => openWriteOff(row)}>
                Write off
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Receivables"
        subtitle="Customers carrying an unpaid balance"
        count={rows.length}
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Billing' }, { label: 'Receivables' }]}
      />

      <StatRow>
        <StatCard
          count={3} tone="pink" icon={<DollarOutlined />} label="Total Outstanding"
          value={(summary.totalOutstanding || 0).toFixed(2)}
          caption="Unpaid balance across every customer"
        />
        <StatCard count={3} tone="amber" icon={<WarningOutlined />} label="Customers with Debt" value={summary.count || 0} />
        <StatCard
          count={3} tone="pink" icon={<StopOutlined />} label="Over the Platform's Limit"
          value={rows.filter((r) => r.debtStatus?.blocked).length}
          caption="Already paused by debtCollection"
        />
      </StatRow>

      <DataTable
        title="Receivables"
        count={rows.length}
        search={{ value: search, onChange: (e) => setSearch(e.target.value), placeholder: 'Search by customer name or email…' }}
        onRefresh={fetch}
        refreshLoading={loading}
        empty={{ title: 'No outstanding balances', description: 'Everyone is paid up.' }}
        columns={columns}
        dataSource={rows}
        rowKey="id"
        loading={loading}
        pagination={rows.length > 20 ? { pageSize: 20 } : false}
        scroll={{ x: 900 }}
      />

      <Modal
        title={`Write off — ${writeOffTarget?.userId?.email || ''}`}
        open={!!writeOffTarget}
        onOk={submitWriteOff}
        onCancel={() => setWriteOffTarget(null)}
        confirmLoading={writingOff}
        okText="Write off debt"
        okButtonProps={{ danger: true }}
      >
        <Paragraph type="secondary">
          This erases {writeOffTarget?.currency} {(writeOffTarget?.outstandingBalance || 0).toFixed(2)} of
          outstanding balance without collecting it. It cannot be undone, and is recorded in the activity log.
        </Paragraph>
        <Form form={form} layout="vertical">
          <Form.Item
            name="reason"
            label="Reason"
            rules={[{ required: true, message: 'A reason is required to write off a debt' }]}
          >
            <Input.TextArea rows={3} placeholder="e.g. Customer disputed the charge and support agreed to waive it" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ReceivablesPage;
