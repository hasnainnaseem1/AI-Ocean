import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Row, Col, Card, Table, Typography, Button, Input, Modal, Form, Select, Empty, Alert, message,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, CustomerServiceOutlined,
  ClockCircleOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import { StatRow, StatCard } from '../../components/StatRow';
import { TableRowsSkeleton } from '../../components/Skeletons';
import { useTheme } from '../../context/ThemeContext';
import { cardStyle as surfaceStyle } from '../../theme/colors';
import supportApi from '../../api/supportApi';
import { TICKET_STATUS_META, CATEGORY_OPTIONS } from './ticketMeta';
import { formatDate } from '../../utils/format';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;
const { TextArea } = Input;

const SupportTicketsPage = () => {
  const { t } = useTranslation(['support', 'common']);
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const card = surfaceStyle(isDark);

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [prefillMessage, setPrefillMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  const refresh = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    supportApi.list()
      .then((data) => { setTickets(data.tickets || []); if (!silent) setError(null); })
      .catch((err) => { if (!silent) setError(err.response?.data?.message || t('support:list.loadFailed')); })
      .finally(() => { if (!silent) setLoading(false); });
  }, [t]);
  useEffect(() => refresh(), [refresh]);

  // A reply landing on any of these tickets should move it in the list
  // (and its stats) without the customer needing to reload the page.
  useEffect(() => {
    const interval = setInterval(() => refresh(true), 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const openNewTicketModal = () => {
    setPrefillMessage('');
    setModalOpen(true);
  };

  // Arriving from the support chat widget's "Turn this into a ticket" —
  // open the composer pre-filled with whatever the user had typed there.
  // AppLayout now stays mounted across navigation, so this page doesn't
  // remount on a second visit — the handoff has to react to the query
  // param changing, not just fire once on the page's first-ever mount.
  // The prefill goes in via the Form's `initialValues` (read once the
  // modal — and its `destroyOnHidden` Form — actually mounts) rather than
  // an imperative `form.setFieldsValue` call, which would fire before the
  // Form exists and log antd's "not connected to any Form element" warning.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setPrefillMessage(searchParams.get('draft') || '');
      setModalOpen(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((t) => t.subject.toLowerCase().includes(q) || t.number.toLowerCase().includes(q));
  }, [tickets, search]);

  const openCount = tickets.filter((t) => t.status !== 'solved').length;
  const solvedCount = tickets.filter((t) => t.status === 'solved').length;

  const submitTicket = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const { ticket } = await supportApi.create(values);
      form.resetFields();
      setModalOpen(false);
      navigate(`/support/${ticket.id}`);
    } catch (err) {
      message.error(err.response?.data?.message || t('support:form.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      title: t('support:list.ticketId'),
      dataIndex: 'number',
      width: 120,
      render: (number, record) => (
        <Button type="link" style={{ padding: 0, height: 'auto', fontWeight: 600 }} onClick={() => navigate(`/support/${record.id}`)}>
          #{number}
        </Button>
      ),
    },
    { title: t('support:form.subject'), dataIndex: 'subject', ellipsis: true },
    {
      title: t('support:list.created'),
      dataIndex: 'createdAt',
      width: 140,
      render: (d) => <Text type="secondary">{formatDate(d, 'short')}</Text>,
    },
    {
      title: t('common:label.status'),
      dataIndex: 'status',
      width: 130,
      render: (status) => {
        const meta = TICKET_STATUS_META[status] || TICKET_STATUS_META.open;
        return <StatusBadge tone={meta.tone} label={t(meta.labelKey)} />;
      },
    },
  ];

  return (
    <>
      <Row justify="space-between" align="middle" style={{ marginBottom: 24 }}>
        <Col>
          <Title level={2} style={{ marginBottom: 4 }}>{t('support:list.title')}</Title>
          <Text type="secondary">{t('support:list.subtitle')}</Text>
        </Col>
        <Col>
          <Button type="primary" icon={<PlusOutlined />} onClick={openNewTicketModal}>
            {t('support:list.newTicket')}
          </Button>
        </Col>
      </Row>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 20, borderRadius: 12 }} />}

      <StatRow>
        <StatCard
          count={3} sm={8}
          icon={<CustomerServiceOutlined />}
          tone="blue"
          label={t('support:list.totalTickets')}
          value={tickets.length}
          caption={t('support:list.totalCaption')}
        />
        <StatCard
          count={3} sm={8}
          icon={<ClockCircleOutlined />}
          tone="amber"
          label={t('support:list.awaitingReply')}
          value={openCount}
          caption={t('support:list.awaitingCaption')}
        />
        <StatCard
          count={3} sm={8}
          icon={<CheckCircleOutlined />}
          tone="green"
          label={t('support:list.solvedTickets')}
          value={solvedCount}
          caption={t('support:list.solvedCaption')}
        />
      </StatRow>

      {loading ? (
        <TableRowsSkeleton rows={5} />
      ) : (
      <Card style={card} styles={{ body: { padding: 0 } }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${isDark ? '#242942' : '#ECEFF8'}` }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('support:list.searchPlaceholder')}
            prefix={<SearchOutlined style={{ color: isDark ? '#9BA1BC' : '#AEB4CC' }} />}
            style={{ maxWidth: 320, borderRadius: 10 }}
          />
        </div>
        <Table
          className="ledger-table"
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          rowClassName="row-hover"
          onRow={(row) => ({ style: { cursor: 'pointer' }, onClick: () => navigate(`/support/${row.id}`) })}
          pagination={filtered.length > 20 ? { pageSize: 20 } : false}
          scroll={{ x: 600 }}
          locale={{
            emptyText: (
              <Empty description={t('support:list.empty')} style={{ padding: 40 }}>
                <Button type="primary" icon={<PlusOutlined />} onClick={openNewTicketModal}>
                  {t('support:list.newTicket')}
                </Button>
              </Empty>
            ),
          }}
        />
      </Card>
      )}

      <Modal
        title={t('support:form.title')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submitTicket}
        okText={t('support:form.submit')}
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="subject" label={t('support:form.subject')} rules={[{ required: true, message: t('support:form.subjectRequired') }]}>
            <Input placeholder={t('support:form.subjectPlaceholder')} />
          </Form.Item>
          <Form.Item name="category" label={t('support:form.category')} initialValue="general" rules={[{ required: true }]}>
            <Select options={CATEGORY_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
          </Form.Item>
          <Form.Item name="message" label={t('support:form.message')} initialValue={prefillMessage} rules={[{ required: true, message: t('support:form.messageRequired') }]}>
            <TextArea rows={5} placeholder={t('support:form.messagePlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default SupportTicketsPage;
