import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Button, Space, Spin, message, Tag, Timeline, Popconfirm, Row, Col, Result, Avatar, Typography, Statistic, Tooltip,
  List, Table, Tabs, Modal, Form, InputNumber, Select, Input, Alert, Descriptions,
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, StopOutlined,
  UserOutlined, MailOutlined, IdcardOutlined, SafetyOutlined, CalendarOutlined,
  EnvironmentOutlined, CheckCircleOutlined as VerifiedIcon, ClockCircleOutlined,
  DownloadOutlined, GlobalOutlined,
  DollarOutlined, CreditCardOutlined, WalletOutlined, CloudServerOutlined,
  RiseOutlined, FileTextOutlined, PlusOutlined, EyeOutlined,
  KeyOutlined, WarningOutlined, DesktopOutlined, BellOutlined,
  FormOutlined, DeleteOutlined, PhoneOutlined,
  ApartmentOutlined,} from '@ant-design/icons';
import { useParams, useNavigate } from 'react-router-dom';
import PageHeader from '../../components/common/PageHeader';
import StatusTag from '../../components/common/StatusTag';
import PermissionGuard from '../../components/guards/PermissionGuard';
import DateTimeRangePicker from '../../components/common/DateTimeRangePicker';
import { StatRow, StatCard } from '../../components/StatRow';
import { STATUS_META } from '../deployments/DeploymentsListPage';
import customersApi from '../../api/customersApi';
import PaygAccessCard from '../../components/customers/PaygAccessCard';
import CustomerTeamsCard from '../../components/customers/CustomerTeamsCard';
import walletsApi from '../../api/walletsApi';
import { usePermission } from '../../hooks/usePermission';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, STATUS_COLORS, muted, subtle, hairline } from '../../theme/colors';
import { PERMISSIONS } from '../../utils/permissions';
import { formatDateTime, timeAgo, formatIPAddress } from '../../utils/helpers';

const { Title, Text, Paragraph } = Typography;

const WALLET_TXN_META = {
  topup: { color: 'green', label: 'Top-up' },
  signup_credit: { color: 'blue', label: 'Welcome credit' },
  bonus: { color: 'blue', label: 'Bonus' },
  charge: { color: 'red', label: 'Usage' },
  refund: { color: 'cyan', label: 'Refund' },
  adjustment: { color: 'purple', label: 'Adjustment' },
};

/** A short "Browser on OS" label from a raw user-agent string, or null if there isn't one. */
const parseUserAgent = (ua) => {
  if (!ua) return null;
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari'
    : 'Unknown browser';
  const os =
    /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown OS';
  return `${browser} on ${os}`;
};

const CustomerDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { hasPermission, isSuperAdmin } = usePermission();
  const purple = TILE.purple.fg(isDark);
  const blue = TILE.blue.fg(isDark);
  const success = STATUS_COLORS.success[isDark ? 'dark' : 'light'];
  const error = STATUS_COLORS.error[isDark ? 'dark' : 'light'];
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [allActivity, setAllActivity] = useState([]);
  const [activity, setActivity] = useState([]);
  const [activityDateRange, setActivityDateRange] = useState(null);
  const [loginHistory, setLoginHistory] = useState([]);
  const [loginHistoryLoading, setLoginHistoryLoading] = useState(false);
  const [exportingActivity, setExportingActivity] = useState(false);
  const [error_, setError] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  // Payment data
  const [paymentData, setPaymentData] = useState(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentPage, setPaymentPage] = useState(1);

  // Deployments
  const [deployments, setDeployments] = useState([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [deploymentsPage, setDeploymentsPage] = useState(1);
  const [deploymentsPagination, setDeploymentsPagination] = useState({});

  // Wallet
  const [wallet, setWallet] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [adjustForm] = Form.useForm();
  const [collecting, setCollecting] = useState(false);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writingOff, setWritingOff] = useState(false);
  const [writeOffForm] = Form.useForm();
  const canManageBilling = hasPermission(PERMISSIONS.BILLING_MANAGE);

  // Payment methods
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);

  // Notifications sent
  const [sentNotifications, setSentNotifications] = useState([]);
  const [sentNotificationsLoading, setSentNotificationsLoading] = useState(false);
  const [sentNotificationsPage, setSentNotificationsPage] = useState(1);
  const [sentNotificationsPagination, setSentNotificationsPagination] = useState({});

  // Internal admin notes
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Delete customer
  const [deleting, setDeleting] = useState(false);

  const fetchCustomer = useCallback(async () => {
    setLoading(true);
    try {
      const data = await customersApi.getCustomer(id);
      setCustomer(data.customer);
      setAnalytics(data.analytics);
      setAllActivity(data.recentActivity || []);
      setActivity(data.recentActivity || []);
      setError(false);
    } catch {
      setError(true);
      message.error('Failed to load customer');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchLoginHistory = useCallback(async () => {
    setLoginHistoryLoading(true);
    try {
      const data = await customersApi.getLoginHistory(id, 10);
      if (data.success) {
        setLoginHistory(data.loginHistory || []);
      }
    } catch (err) {
      console.error('Failed to fetch login history:', err);
    } finally {
      setLoginHistoryLoading(false);
    }
  }, [id]);

  const fetchPayments = useCallback(async (page = 1) => {
    setPaymentLoading(true);
    try {
      const data = await customersApi.getCustomerPayments(id, { page, limit: 10 });
      if (data.success) {
        setPaymentData(data);
      }
    } catch (err) {
      console.error('Failed to fetch payments:', err);
    } finally {
      setPaymentLoading(false);
    }
  }, [id]);

  const fetchDeployments = useCallback(async (page = 1) => {
    setDeploymentsLoading(true);
    try {
      const data = await customersApi.getCustomerDeployments(id, { page, limit: 10 });
      if (data.success) {
        setDeployments(data.deployments || []);
        setDeploymentsPagination(data.pagination || {});
      }
    } catch (err) {
      console.error('Failed to fetch deployments:', err);
    } finally {
      setDeploymentsLoading(false);
    }
  }, [id]);

  const fetchWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const data = await walletsApi.getWallet(id);
      setWallet(data);
    } catch (err) {
      console.error('Failed to fetch wallet:', err);
      setWallet(null);
    } finally {
      setWalletLoading(false);
    }
  }, [id]);

  const fetchPaymentMethods = useCallback(async () => {
    setPaymentMethodsLoading(true);
    try {
      const data = await customersApi.getCustomerPaymentMethods(id);
      if (data.success) {
        setPaymentMethods(data.paymentMethods || []);
      }
    } catch (err) {
      console.error('Failed to fetch payment methods:', err);
    } finally {
      setPaymentMethodsLoading(false);
    }
  }, [id]);

  const fetchSentNotifications = useCallback(async (page = 1) => {
    setSentNotificationsLoading(true);
    try {
      const data = await customersApi.getCustomerNotifications(id, { page, limit: 15 });
      if (data.success) {
        setSentNotifications(data.notifications || []);
        setSentNotificationsPagination(data.pagination || {});
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setSentNotificationsLoading(false);
    }
  }, [id]);

  const fetchNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      const data = await customersApi.getCustomerNotes(id);
      if (data.success) {
        setNotes(data.notes || []);
      }
    } catch (err) {
      console.error('Failed to fetch notes:', err);
    } finally {
      setNotesLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCustomer();
    fetchLoginHistory();
    fetchPayments();
    fetchDeployments();
    fetchWallet();
    fetchPaymentMethods();
    fetchSentNotifications();
    fetchNotes();
  }, [fetchCustomer, fetchLoginHistory, fetchPayments, fetchDeployments, fetchWallet, fetchPaymentMethods, fetchSentNotifications, fetchNotes]);

  // Filter activity based on date range
  useEffect(() => {
    if (!activityDateRange || activityDateRange.length !== 2) {
      setActivity(allActivity);
      return;
    }

    const [start, end] = activityDateRange;
    const filtered = allActivity.filter((log) => {
      const logDate = new Date(log.createdAt);
      return logDate >= start.toDate() && logDate <= end.toDate();
    });
    setActivity(filtered);
  }, [activityDateRange, allActivity]);

  const handleVerifyEmail = async () => {
    try {
      await customersApi.verifyEmail(id);
      message.success('Email verified successfully');
      fetchCustomer();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to verify email');
    }
  };

  const handleSuspend = async () => {
    try {
      await customersApi.updateStatus(id, 'suspended');
      message.success('Customer suspended');
      fetchCustomer();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to suspend customer');
    }
  };

  const handleActivate = async () => {
    try {
      await customersApi.updateStatus(id, 'active');
      message.success('Customer activated');
      fetchCustomer();
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to activate customer');
    }
  };

  const handleExportActivity = async () => {
    setExportingActivity(true);
    try {
      const params = { customerId: id };
      if (activityDateRange && activityDateRange.length === 2) {
        params.startDate = activityDateRange[0].toISOString();
        params.endDate = activityDateRange[1].toISOString();
      }
      await customersApi.exportCustomerActivity(params);
      message.success('Activity logs exported successfully');
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to export activity');
    } finally {
      setExportingActivity(false);
    }
  };

  const openAdjust = () => {
    adjustForm.resetFields();
    adjustForm.setFieldsValue({ type: 'adjustment', amount: null, description: '' });
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    try {
      const values = await adjustForm.validateFields();
      setAdjustSaving(true);
      const result = await walletsApi.adjust(id, values);
      message.success(result.message);
      setAdjustOpen(false);
      fetchWallet();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.message || 'Could not adjust the balance');
    } finally {
      setAdjustSaving(false);
    }
  };

  const attemptCollection = async () => {
    setCollecting(true);
    try {
      const result = await walletsApi.collect(id);
      message.success(result.message);
      fetchWallet();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not attempt collection');
    } finally {
      setCollecting(false);
    }
  };

  const openWriteOff = () => {
    writeOffForm.resetFields();
    setWriteOffOpen(true);
  };

  const submitWriteOff = async () => {
    try {
      const values = await writeOffForm.validateFields();
      setWritingOff(true);
      const result = await walletsApi.writeOff(id, values.reason);
      message.success(result.message);
      setWriteOffOpen(false);
      fetchWallet();
    } catch (err) {
      if (err?.errorFields) return;
      message.error(err.response?.data?.message || 'Could not write off the debt');
    } finally {
      setWritingOff(false);
    }
  };

  const submitNote = async () => {
    if (!noteText.trim()) return;
    setAddingNote(true);
    try {
      await customersApi.addCustomerNote(id, noteText.trim());
      setNoteText('');
      fetchNotes();
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not save the note');
    } finally {
      setAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await customersApi.deleteCustomerNote(id, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not delete the note');
    }
  };

  const handleDeleteCustomer = async () => {
    setDeleting(true);
    try {
      await customersApi.deleteCustomer(id);
      message.success('Customer deleted successfully');
      navigate('/customers');
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to delete customer');
      setDeleting(false);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (error_ || !customer) return <Result status="error" title="Customer not found" extra={<Button onClick={() => navigate('/customers')}>Back to Customers</Button>} />;

  const getInitials = (name) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const walletCurrency = analytics?.wallet?.currency || wallet?.wallet?.currency || 'USD';

  // ── Overview tab ──────────────────────────────────────────────────────
  const overviewTab = (
    <>
      <StatRow>
        <StatCard
          count={4} icon={<WalletOutlined />} tone="green"
          label="Wallet Balance"
          value={`${walletCurrency} ${(analytics?.wallet?.balance ?? 0).toFixed(2)}`}
        />
        <StatCard
          count={4} icon={<CloudServerOutlined />} tone="blue"
          label="Total Deployments"
          value={analytics?.totalDeployments ?? 0}
        />
        <StatCard
          count={4} icon={<RiseOutlined />} tone="purple"
          label="Lifetime Spend"
          value={`${walletCurrency} ${(analytics?.wallet?.lifetimeSpend ?? 0).toFixed(2)}`}
        />
        <StatCard
          count={4} icon={<CalendarOutlined />} tone="cyan"
          label="Member Since"
          value={formatDateTime(customer.createdAt).split(',')[0]}
        />
      </StatRow>

      <Card title={<Space><SafetyOutlined />Account Details</Space>} style={{ marginBottom: 16 }}>
        <Row gutter={[24, 24]}>
          <Col xs={24} sm={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>EMAIL VERIFIED</Text>
            <div style={{ marginTop: 4 }}>
              {customer.isEmailVerified ? (
                <Tag icon={<CheckCircleOutlined />} color="success">Verified</Tag>
              ) : (
                <Tag color="error">Not Verified</Tag>
              )}
            </div>
          </Col>
          <Col xs={24} sm={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>ACCOUNT STATUS</Text>
            <div style={{ marginTop: 4 }}>
              <StatusTag status={customer.status} />
            </div>
          </Col>
          <Col xs={24} sm={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>PHONE</Text>
            <div style={{ marginTop: 4 }}>
              <Space>
                <PhoneOutlined style={{ color: muted(isDark) }} />
                <Text>{customer.phone || 'Not provided'}</Text>
              </Space>
            </div>
          </Col>
          <Col xs={24} sm={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>TIMEZONE</Text>
            <div style={{ marginTop: 4 }}>
              <Text>{customer.timezone || 'UTC'}</Text>
            </div>
          </Col>
        </Row>
      </Card>

      <Card title={<Space><ClockCircleOutlined />Activity Information</Space>}>
        <Row gutter={[24, 24]}>
          <Col xs={24} sm={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>LAST LOGIN</Text>
            <div style={{ marginTop: 4 }}>
              <Space>
                <CalendarOutlined style={{ color: blue }} />
                <Text strong>{customer.lastLogin ? formatDateTime(customer.lastLogin) : 'Never'}</Text>
              </Space>
            </div>
          </Col>
          <Col xs={24} sm={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>CREATED</Text>
            <div style={{ marginTop: 4 }}>
              <Space>
                <CalendarOutlined style={{ color: muted(isDark) }} />
                <Text>{formatDateTime(customer.createdAt)}</Text>
              </Space>
            </div>
          </Col>
          <Col xs={24} sm={12}>
            <Text type="secondary" style={{ fontSize: 12 }}>LAST UPDATED</Text>
            <div style={{ marginTop: 4 }}>
              <Space>
                <CalendarOutlined style={{ color: muted(isDark) }} />
                <Text>{formatDateTime(customer.updatedAt)}</Text>
              </Space>
            </div>
          </Col>
        </Row>
      </Card>
    </>
  );

  // ── Deployments tab ───────────────────────────────────────────────────
  const deploymentsTab = (
    <Card title={<Space><CloudServerOutlined />Deployments</Space>} loading={deploymentsLoading}>
      {deployments.length > 0 ? (
        <Table
          dataSource={deployments}
          rowKey="id"
          size="small"
          pagination={{
            current: deploymentsPage,
            pageSize: 10,
            total: deploymentsPagination.totalItems || 0,
            onChange: (pg) => { setDeploymentsPage(pg); fetchDeployments(pg); },
            showSizeChanger: false,
            showTotal: (total) => `${total} deployments`,
          }}
          columns={[
            {
              title: 'Name',
              dataIndex: 'deploymentName',
              key: 'name',
              render: (v) => <Text strong>{v}</Text>,
            },
            {
              title: 'Model / Tier',
              key: 'model',
              render: (_, r) => (
                <Space direction="vertical" size={0}>
                  <Text style={{ fontSize: 13 }}>{r.modelName || '—'}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{r.tierName || '—'}</Text>
                </Space>
              ),
            },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              width: 120,
              render: (s) => {
                const meta = STATUS_META[s] || { color: 'default', label: s };
                return <Tag color={meta.color}>{meta.label}</Tag>;
              },
            },
            {
              title: 'Price/hr',
              dataIndex: 'pricePerHour',
              key: 'pricePerHour',
              width: 90,
              align: 'right',
              render: (v) => (v != null ? `$${v.toFixed(2)}` : '—'),
            },
            {
              title: 'Total Cost',
              dataIndex: 'totalCost',
              key: 'totalCost',
              width: 100,
              align: 'right',
              render: (v) => <Text strong>{v != null ? `$${v.toFixed(2)}` : '—'}</Text>,
            },
            {
              title: 'Runtime',
              dataIndex: 'totalRuntimeHours',
              key: 'runtime',
              width: 90,
              align: 'right',
              render: (v) => (v != null ? `${v.toFixed(1)}h` : '—'),
            },
            {
              title: 'Created',
              dataIndex: 'createdAt',
              key: 'createdAt',
              width: 130,
              render: (v) => formatDateTime(v),
            },
            {
              title: '',
              key: 'actions',
              width: 50,
              render: (_, r) => (
                <Tooltip title="View deployment">
                  <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => navigate(`/deployments/${r.id}`)} />
                </Tooltip>
              ),
            },
          ]}
        />
      ) : (
        <div style={{ padding: '40px 0', textAlign: 'center', color: muted(isDark) }}>
          <CloudServerOutlined style={{ fontSize: 48, marginBottom: 16, color: subtle(isDark) }} />
          <div>No deployments yet</div>
        </div>
      )}
    </Card>
  );

  // ── Wallet & Billing tab ──────────────────────────────────────────────
  const walletBillingTab = (
    <>
      <PaygAccessCard
        customer={customer}
        canManage={canManageBilling}
        onChanged={() => { fetchCustomer(); fetchWallet(); fetchDeployments(); }}
      />
      <Card
        title={<Space><CreditCardOutlined />Payment Method</Space>}
        loading={paymentMethodsLoading}
        style={{ marginBottom: 16 }}
      >
        {paymentMethods.length > 0 ? (
          <List
            dataSource={paymentMethods}
            renderItem={(pm) => (
              <List.Item>
                <Space direction="vertical" size={2}>
                  <Space>
                    <Text strong style={{ textTransform: 'capitalize' }}>{pm.brand || 'Card'} •••• {pm.last4}</Text>
                    {pm.isDefault && <Tag color="blue">Default</Tag>}
                    {pm.isExpired ? (
                      <Tag color="error">Expired</Tag>
                    ) : pm.daysUntilExpiry != null && pm.daysUntilExpiry <= 30 && (
                      <Tag color="warning">Expires in {pm.daysUntilExpiry}d</Tag>
                    )}
                  </Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Expires {String(pm.expMonth).padStart(2, '0')}/{pm.expYear} · Verified {formatDateTime(pm.verifiedAt)}
                    {pm.lastUsedAt && <> · Last used {timeAgo(pm.lastUsedAt)}</>}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <div style={{ padding: '30px 0', textAlign: 'center', color: muted(isDark) }}>
            <CreditCardOutlined style={{ fontSize: 40, color: subtle(isDark), marginBottom: 12 }} />
            <div>No card on file</div>
          </div>
        )}
        {wallet?.wallet?.cardGate?.required && (
          <div style={{ marginTop: paymentMethods.length > 0 ? 8 : 0 }}>
            <Tag color={wallet.wallet.cardGate.verified ? 'success' : 'error'}>
              {wallet.wallet.cardGate.verified ? 'Card gate: verified' : 'Card gate: not verified — deployments blocked'}
            </Tag>
          </div>
        )}
      </Card>

      <Card
        title={<Space><WalletOutlined />Wallet</Space>}
        loading={walletLoading}
        style={{ marginBottom: 16 }}
        extra={
          canManageBilling && wallet?.wallet && (
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openAdjust}>Adjust</Button>
          )
        }
      >
        {wallet?.wallet ? (
          <>
            {!wallet.reconciliation?.matches && (
              <Alert
                type="error"
                showIcon
                message="Balance does not match the ledger"
                description={`Wallet shows ${wallet.wallet.balance.toFixed(2)} but the transactions sum to ${wallet.reconciliation.ledgerTotal.toFixed(2)}. This should not happen — please investigate before adjusting.`}
                style={{ marginBottom: 16 }}
              />
            )}
            {wallet.wallet.outstandingBalance > 0 && (
              <Alert
                type="warning"
                showIcon
                icon={<WarningOutlined />}
                message={`Outstanding debt: ${wallet.wallet.currency} ${wallet.wallet.outstandingBalance.toFixed(2)}${wallet.wallet.debtDays ? ` (${wallet.wallet.debtDays} day${wallet.wallet.debtDays === 1 ? '' : 's'})` : ''}`}
                description={wallet.wallet.debtBlocked ? `Blocked: ${wallet.wallet.debtBlockedReason || 'over the platform limit'}` : null}
                action={canManageBilling && (
                  <Space>
                    <Button size="small" icon={<CreditCardOutlined />} loading={collecting} onClick={attemptCollection}>Collect</Button>
                    <Button size="small" danger icon={<StopOutlined />} onClick={openWriteOff}>Write off</Button>
                  </Space>
                )}
                style={{ marginBottom: 16 }}
              />
            )}
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
              <Col xs={24} sm={8}>
                <Statistic title="Balance" value={wallet.wallet.balance} precision={2} prefix={wallet.wallet.currency} valueStyle={{ color: success }} />
              </Col>
              <Col xs={24} sm={8}>
                <Statistic title="Burn rate" value={wallet.wallet.burnRatePerHour} precision={2} suffix="/hr" />
              </Col>
              <Col xs={24} sm={8}>
                <Statistic
                  title="Runway"
                  value={wallet.wallet.runwayDays === null ? '∞' : wallet.wallet.runwayDays}
                  suffix={wallet.wallet.runwayDays === null ? '' : 'days'}
                />
              </Col>
            </Row>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Active deployments">{wallet.activeDeployments}</Descriptions.Item>
              <Descriptions.Item label="Lifetime top-up">{wallet.wallet.currency} {(wallet.wallet.lifetimeTopUp || 0).toFixed(2)}</Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              rowKey="id"
              dataSource={wallet.transactions}
              pagination={{ pageSize: 10 }}
              columns={[
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
                    const m = WALLET_TXN_META[t] || { color: 'default', label: t };
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
              ]}
            />
          </>
        ) : (
          <div style={{ padding: '40px 0', textAlign: 'center', color: muted(isDark) }}>
            <WalletOutlined style={{ fontSize: 48, marginBottom: 16, color: subtle(isDark) }} />
            <div>No wallet found for this customer</div>
          </div>
        )}
      </Card>

      {/* Billing Summary */}
      <Card
        title={<Space><DollarOutlined style={{ color: success }} />Billing Summary</Space>}
        style={{ marginBottom: 16 }}
        loading={paymentLoading}
      >
        {paymentData?.stats ? (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={8}>
                <Statistic
                  title="Total Spent"
                  value={paymentData.stats.totalSpent}
                  prefix="$"
                  valueStyle={{ color: success, fontWeight: 600 }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title="Payments"
                  value={paymentData.stats.totalPayments}
                  valueStyle={{ color: blue }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title="Avg Payment"
                  value={paymentData.stats.avgPaymentAmount}
                  prefix="$"
                  precision={2}
                  valueStyle={{ color: purple }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title="Net Revenue"
                  value={paymentData.stats.netRevenue}
                  prefix="$"
                  valueStyle={{ color: success }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title="Refunds"
                  value={paymentData.stats.totalRefunded}
                  prefix="$"
                  valueStyle={{ color: paymentData.stats.totalRefunded > 0 ? error : muted(isDark) }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title="Failed"
                  value={paymentData.stats.failedPayments}
                  valueStyle={{ color: paymentData.stats.failedPayments > 0 ? error : muted(isDark) }}
                />
              </Col>
            </Row>
            {paymentData.stats.lastPaymentDate && (
              <div style={{ marginTop: 16, padding: 10, background: STATUS_COLORS.success.bg(isDark), borderRadius: 6, border: `1px solid ${hairline(isDark)}` }}>
                <Space>
                  <CalendarOutlined style={{ color: success }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Last payment: {formatDateTime(paymentData.stats.lastPaymentDate)}
                  </Text>
                  {paymentData.stats.firstPaymentDate && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      &nbsp;|&nbsp; First payment: {formatDateTime(paymentData.stats.firstPaymentDate)}
                    </Text>
                  )}
                </Space>
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '30px 0', color: muted(isDark) }}>
            <DollarOutlined style={{ fontSize: 40, color: subtle(isDark), marginBottom: 12 }} />
            <div>No payment records yet</div>
          </div>
        )}
      </Card>

      {/* Payment History */}
      <Card title={<Space><DollarOutlined style={{ color: success }} />Payment History</Space>} loading={paymentLoading}>
        {paymentData && paymentData.payments && paymentData.payments.length > 0 ? (
          <>
            <Table
              dataSource={paymentData.payments}
              rowKey={(r) => r.id}
              size="small"
              pagination={{
                current: paymentPage,
                pageSize: 10,
                total: paymentData.pagination?.totalCount || 0,
                onChange: (pg) => { setPaymentPage(pg); fetchPayments(pg); },
                showSizeChanger: false,
                showTotal: (total) => `${total} payments`,
              }}
              columns={[
                {
                  title: "Date",
                  dataIndex: "paidAt",
                  key: "date",
                  width: 140,
                  render: (val, record) => (
                    <Space direction="vertical" size={0}>
                      <Text style={{ fontSize: 13 }}>{formatDateTime(val || record.createdAt)}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>{timeAgo(val || record.createdAt)}</Text>
                    </Space>
                  ),
                },
                {
                  title: "Amount",
                  dataIndex: "amount",
                  key: "amount",
                  width: 100,
                  render: (val, record) => (
                    <Text strong style={{ color: success, fontSize: 14 }}>
                      ${val?.toFixed(2)} <Text type="secondary" style={{ fontSize: 11 }}>{record.currency?.toUpperCase()}</Text>
                    </Text>
                  ),
                },
                {
                  title: "Status",
                  dataIndex: "status",
                  key: "status",
                  width: 90,
                  render: (val) => {
                    const colorMap = { succeeded: "success", pending: "processing", failed: "error", refunded: "warning", cancelled: "default" };
                    return <Tag color={colorMap[val] || "default"}>{val}</Tag>;
                  },
                },
                {
                  title: "Actions",
                  key: "actions",
                  width: 90,
                  render: (_, record) => (
                    <Space size={4}>
                      {record.receiptUrl && (
                        <Tooltip title="View Receipt">
                          <Button type="link" size="small" icon={<FileTextOutlined />} href={record.receiptUrl} target="_blank" />
                        </Tooltip>
                      )}
                      {record.invoiceUrl && (
                        <Tooltip title="View Invoice">
                          <Button type="link" size="small" icon={<DownloadOutlined />} href={record.invoiceUrl} target="_blank" />
                        </Tooltip>
                      )}
                    </Space>
                  ),
                },
              ]}
            />
            {paymentData.monthlyTrend && paymentData.monthlyTrend.length > 0 && (
              <div style={{ marginTop: 16, padding: 12, background: STATUS_COLORS.neutral.bg(isDark), borderRadius: 6 }}>
                <Text strong style={{ fontSize: 13, marginBottom: 8, display: "block" }}>
                  <RiseOutlined style={{ marginRight: 6 }} />Monthly Spending Trend
                </Text>
                <List
                  size="small"
                  dataSource={paymentData.monthlyTrend}
                  renderItem={(item) => (
                    <List.Item>
                      <List.Item.Meta title={item.month} />
                      <Space>
                        <Text strong style={{ color: success }}>${item.amount.toFixed(2)}</Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>({item.count} payment{item.count > 1 ? "s" : ""})</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: "40px 0", textAlign: "center", color: muted(isDark) }}>
            <CreditCardOutlined style={{ fontSize: 48, marginBottom: 16, color: subtle(isDark) }} />
            <div>No payment records found</div>
          </div>
        )}
      </Card>
    </>
  );

  // ── Activity tab ──────────────────────────────────────────────────────
  const activityTab = (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <Card
          title="Recent Activity"
          extra={
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExportActivity}
              loading={exportingActivity}
              size="small"
            >
              Export
            </Button>
          }
        >
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>FILTER BY DATE RANGE</Text>
            <DateTimeRangePicker
              value={activityDateRange}
              onChange={setActivityDateRange}
              placeholder={['Start Date & Time', 'End Date & Time']}
              use24HourFormat={false}
            />
          </Space>

          {activity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <ClockCircleOutlined style={{ fontSize: 48, color: subtle(isDark), marginBottom: 16 }} />
              <div style={{ color: muted(isDark) }}>No recent activity</div>
            </div>
          ) : (
            <Timeline
              items={activity.map((a) => ({
                color: a.status === 'success' ? 'green' : a.status === 'failed' ? 'red' : 'gray',
                children: (
                  <div>
                    <div style={{ fontWeight: 500 }}>{a.action}</div>
                    <div style={{ fontSize: 12, color: muted(isDark), marginTop: 4 }}>{a.description}</div>
                    {a.ipAddress && (
                      <div style={{ fontSize: 11, color: blue, marginTop: 2 }}>
                        <GlobalOutlined style={{ marginRight: 4 }} />
                        {formatIPAddress(a.ipAddress)}
                      </div>
                    )}
                    {parseUserAgent(a.userAgent) && (
                      <div style={{ fontSize: 11, color: subtle(isDark), marginTop: 2 }}>
                        <DesktopOutlined style={{ marginRight: 4 }} />
                        {parseUserAgent(a.userAgent)}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: subtle(isDark), marginTop: 2 }}>{timeAgo(a.createdAt)}</div>
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      </Col>

      <Col xs={24} lg={12}>
        <Card title={<Space><GlobalOutlined />Login History</Space>} loading={loginHistoryLoading}>
          {loginHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <GlobalOutlined style={{ fontSize: 48, color: subtle(isDark), marginBottom: 16 }} />
              <div style={{ color: muted(isDark) }}>No login history available</div>
            </div>
          ) : (
            <Timeline
              items={loginHistory.map((login) => ({
                color: login.status === 'success' ? 'green' : 'red',
                children: (
                  <div>
                    <div style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <GlobalOutlined style={{ color: blue }} />
                      {formatIPAddress(login.ipAddress)}
                    </div>
                    <div style={{ fontSize: 12, color: muted(isDark), marginTop: 4 }}>
                      {login.description || 'Customer login'}
                    </div>
                    {parseUserAgent(login.userAgent) && (
                      <div style={{ fontSize: 11, color: subtle(isDark), marginTop: 2 }}>
                        <DesktopOutlined style={{ marginRight: 4 }} />
                        {parseUserAgent(login.userAgent)}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: subtle(isDark), marginTop: 2 }}>
                      {formatDateTime(login.createdAt)}
                    </div>
                  </div>
                ),
              }))}
            />
          )}
        </Card>
      </Col>
    </Row>
  );

  // ── Notifications Sent tab ────────────────────────────────────────────
  const notificationsTab = (
    <Card title={<Space><BellOutlined />Notifications Sent</Space>} loading={sentNotificationsLoading}>
      {sentNotifications.length > 0 ? (
        <Table
          dataSource={sentNotifications}
          rowKey="id"
          size="small"
          pagination={{
            current: sentNotificationsPage,
            pageSize: 15,
            total: sentNotificationsPagination.totalItems || 0,
            onChange: (pg) => { setSentNotificationsPage(pg); fetchSentNotifications(pg); },
            showSizeChanger: false,
            showTotal: (total) => `${total} notifications`,
          }}
          columns={[
            {
              title: 'Date',
              dataIndex: 'createdAt',
              width: 150,
              render: (d) => (
                <Space direction="vertical" size={0}>
                  <Text style={{ fontSize: 13 }}>{formatDateTime(d)}</Text>
                  <Text type="secondary" style={{ fontSize: 11 }}>{timeAgo(d)}</Text>
                </Space>
              ),
            },
            {
              title: 'Type',
              dataIndex: 'type',
              width: 160,
              render: (t) => <Tag>{(t || '').replace(/_/g, ' ')}</Tag>,
            },
            {
              title: 'Title / Message',
              key: 'content',
              render: (_, r) => (
                <Space direction="vertical" size={0}>
                  <Text strong={!r.isRead} style={{ fontSize: 13 }}>{r.title}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{r.message}</Text>
                </Space>
              ),
            },
            {
              title: 'Read',
              dataIndex: 'isRead',
              width: 90,
              render: (isRead) => (isRead ? <Tag color="default">Read</Tag> : <Tag color="blue">Unread</Tag>),
            },
          ]}
        />
      ) : (
        <div style={{ padding: '40px 0', textAlign: 'center', color: muted(isDark) }}>
          <BellOutlined style={{ fontSize: 48, marginBottom: 16, color: subtle(isDark) }} />
          <div>No notifications sent yet</div>
        </div>
      )}
    </Card>
  );

  // ── Notes tab ──────────────────────────────────────────────────────────
  const notesTab = (
    <Card title={<Space><FormOutlined />Internal Notes</Space>} loading={notesLoading}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        Only visible to admins — never shown to the customer.
      </Text>
      <Space.Compact style={{ width: '100%', marginBottom: 20 }}>
        <Input.TextArea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Called customer on 3 Sep, promised a refund…"
          autoSize={{ minRows: 1, maxRows: 4 }}
          onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); submitNote(); } }}
        />
        <Button type="primary" onClick={submitNote} loading={addingNote} disabled={!noteText.trim()}>
          Add
        </Button>
      </Space.Compact>

      {notes.length > 0 ? (
        <List
          dataSource={notes}
          renderItem={(n) => (
            <List.Item
              actions={[
                <Popconfirm key="delete" title="Delete this note?" onConfirm={() => handleDeleteNote(n.id)}>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={<Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.text}</Text>}
                description={
                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                    {n.authorName} · {formatDateTime(n.createdAt)}
                  </Text>
                }
              />
            </List.Item>
          )}
        />
      ) : (
        <div style={{ padding: '30px 0', textAlign: 'center', color: muted(isDark) }}>
          <FormOutlined style={{ fontSize: 40, color: subtle(isDark), marginBottom: 12 }} />
          <div>No notes yet</div>
        </div>
      )}
    </Card>
  );

  // ── Security tab ──────────────────────────────────────────────────────
  const securityTab = (
    <Card title={<Space><SafetyOutlined />Security</Space>}>
      {customer.disputeHold && (
        <Alert
          type="error"
          showIcon
          message="Account on dispute hold"
          description="A chargeback was filed on one of this customer's payments. Deployments stay blocked until an admin reviews and clears the hold."
          style={{ marginBottom: 20 }}
        />
      )}
      <Row gutter={[24, 24]}>
        <Col xs={24} sm={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>EMAIL VERIFIED</Text>
          <div style={{ marginTop: 4 }}>
            {customer.isEmailVerified ? (
              <Tag icon={<CheckCircleOutlined />} color="success">Verified</Tag>
            ) : (
              <Tag color="error">Not Verified</Tag>
            )}
          </div>
        </Col>
        <Col xs={24} sm={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>ACCOUNT STATUS</Text>
          <div style={{ marginTop: 4 }}>
            <StatusTag status={customer.status} />
          </div>
        </Col>
        <Col xs={24} sm={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>LAST LOGIN IP</Text>
          <div style={{ marginTop: 4 }}>
            <Space>
              <EnvironmentOutlined style={{ color: blue }} />
              <Text strong>{formatIPAddress(customer.lastLoginIP)}</Text>
            </Space>
          </div>
        </Col>
        <Col xs={24} sm={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>FAILED LOGIN ATTEMPTS</Text>
          <div style={{ marginTop: 4 }}>
            <Space>
              <KeyOutlined style={{ color: customer.loginAttempts > 0 ? error : muted(isDark) }} />
              <Text strong={customer.loginAttempts > 0}>{customer.loginAttempts ?? 0}</Text>
            </Space>
          </div>
        </Col>
      </Row>

      {isSuperAdmin && (
        <div style={{ marginTop: 24, padding: 16, border: `1px solid ${error}`, borderRadius: 8 }}>
          <Text strong style={{ color: error, display: 'block', marginBottom: 4 }}>Danger Zone</Text>
          <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: 12 }}>
            Permanently deletes this customer, their deployments, wallet, cards and notifications. This cannot be undone.
          </Text>
          <Popconfirm
            title="Permanently delete this customer?"
            description="Their deployments, wallet, cards, and notifications are erased too."
            okButtonProps={{ danger: true }}
            onConfirm={handleDeleteCustomer}
          >
            <Button danger icon={<DeleteOutlined />} loading={deleting}>Delete Customer</Button>
          </Popconfirm>
        </div>
      )}
    </Card>
  );

  const organizationsTab = <CustomerTeamsCard customerId={id} />;

  const tabItems = [
    { key: 'overview', label: <Space><IdcardOutlined />Overview</Space>, children: overviewTab },
    { key: 'deployments', label: <Space><CloudServerOutlined />Deployments</Space>, children: deploymentsTab },
    { key: 'wallet', label: <Space><WalletOutlined />Wallet & Billing</Space>, children: walletBillingTab },
    { key: 'activity', label: <Space><ClockCircleOutlined />Activity</Space>, children: activityTab },
    { key: 'notifications', label: <Space><BellOutlined />Notifications</Space>, children: notificationsTab },
    { key: 'notes', label: <Space><FormOutlined />Notes</Space>, children: notesTab },
    { key: 'organizations', label: <Space><ApartmentOutlined />Organizations</Space>, children: organizationsTab },
    { key: 'security', label: <Space><SafetyOutlined />Security</Space>, children: securityTab },
  ];

  return (
    <div>
      <PageHeader
        title="Customer Details"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Customers', path: '/customers' }, { label: customer.name }]}
        extra={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/customers')}>Back</Button>
            <PermissionGuard permission={PERMISSIONS.CUSTOMERS_VERIFY}>
              {!customer.isEmailVerified && (
                <Popconfirm title="Verify email manually?" onConfirm={handleVerifyEmail}>
                  <Button icon={<CheckCircleOutlined />}>Verify Email</Button>
                </Popconfirm>
              )}
            </PermissionGuard>
            <PermissionGuard permission={PERMISSIONS.CUSTOMERS_EDIT}>
              {customer.status === 'active' && (
                <Popconfirm title="Suspend this customer?" onConfirm={handleSuspend}>
                  <Button icon={<StopOutlined />} danger>Suspend</Button>
                </Popconfirm>
              )}
            </PermissionGuard>
            <PermissionGuard permission={PERMISSIONS.CUSTOMERS_EDIT}>
              {customer.status === 'suspended' && (
                <Popconfirm title="Activate this customer?" onConfirm={handleActivate}>
                  <Button icon={<CheckCircleOutlined />} type="primary" style={{ background: success, borderColor: success }}>Activate</Button>
                </Popconfirm>
              )}
            </PermissionGuard>
          </Space>
        }
      />

      {/* Profile Header Card */}
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={24} align="middle">
          <Col>
            <Avatar
              size={80}
              src={customer.avatar || undefined}
              style={{ backgroundColor: purple, fontSize: 32 }}
              icon={<UserOutlined />}
            >
              {getInitials(customer.name)}
            </Avatar>
          </Col>
          <Col flex="auto">
            <Title level={3} style={{ marginBottom: 4 }}>{customer.name}</Title>
            <Space size={16} wrap>
              <Space>
                <MailOutlined style={{ color: muted(isDark) }} />
                <Text>{customer.email}</Text>
              </Space>
              {customer.phone && (
                <Space>
                  <PhoneOutlined style={{ color: muted(isDark) }} />
                  <Text>{customer.phone}</Text>
                </Space>
              )}
              <Space>
                <IdcardOutlined style={{ color: muted(isDark) }} />
                <Text>Customer Account</Text>
              </Space>
            </Space>
            <div style={{ marginTop: 12 }}>
              <Space size={8}>
                <StatusTag status={customer.status} />
                {customer.isEmailVerified && <Tag icon={<VerifiedIcon />} color="success">Email Verified</Tag>}
                {customer.disputeHold && <Tag icon={<WarningOutlined />} color="error">Dispute Hold</Tag>}
              </Space>
            </div>
          </Col>
          <Col>
            <Button icon={<MailOutlined />} type="primary" href={`mailto:${customer.email}`}>
              Email Customer
            </Button>
          </Col>
        </Row>
      </Card>

      <Card styles={{ body: { padding: '8px 8px 8px 0' } }}>
        <Tabs
          tabPosition="left"
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems.map((t) => ({ ...t, children: <div style={{ padding: '4px 16px 16px' }}>{t.children}</div> }))}
        />
      </Card>

      {/* Adjust wallet balance modal */}
      <Modal
        title={`Adjust balance — ${customer.email}`}
        open={adjustOpen}
        onOk={submitAdjust}
        onCancel={() => setAdjustOpen(false)}
        confirmLoading={adjustSaving}
        okText="Apply adjustment"
      >
        <Paragraph type="secondary">
          Use a positive amount to credit the customer and a negative amount to debit them.
          Adding credit also resumes any deployment that was paused for lack of funds.
        </Paragraph>
        <Form form={adjustForm} layout="vertical">
          <Form.Item
            name="amount"
            label={`Amount (${wallet?.wallet?.currency || 'USD'})`}
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

      {/* Write off debt modal */}
      <Modal
        title={`Write off — ${customer.email}`}
        open={writeOffOpen}
        onOk={submitWriteOff}
        onCancel={() => setWriteOffOpen(false)}
        confirmLoading={writingOff}
        okText="Write off debt"
        okButtonProps={{ danger: true }}
      >
        <Paragraph type="secondary">
          This erases {wallet?.wallet?.currency} {(wallet?.wallet?.outstandingBalance || 0).toFixed(2)} of
          outstanding balance without collecting it. It cannot be undone, and is recorded in the activity log.
        </Paragraph>
        <Form form={writeOffForm} layout="vertical">
          <Form.Item
            name="reason"
            label="Reason"
            rules={[{ required: true, message: 'Please give a reason' }]}
          >
            <Input placeholder="Uncollectable — customer unreachable" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CustomerDetailPage;
