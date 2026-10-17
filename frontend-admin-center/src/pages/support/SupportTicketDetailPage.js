import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Row, Col, Avatar, Typography, Button, Input, Select, Tag,
  Checkbox, Spin, Result, Divider, message,
} from 'antd';
import {
  CustomerServiceOutlined, UserOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import supportApi from '../../api/supportApi';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import { muted } from '../../theme/colors';
import { formatDateTime } from '../../utils/helpers';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const STATUS_COLOR = { open: 'blue', pending: 'orange', solved: 'green' };
const STATUS_LABEL = { open: 'Open', pending: 'Pending', solved: 'Solved' };
const CATEGORY_LABEL = {
  general: 'General', billing: 'Billing', technical: 'Technical', deployment: 'Deployment',
};
/* Colour only. The tiers themselves, their order and their wording come from
   the server, so a tier added to the policy still renders — just in grey. */
const PRIORITY_COLOR = {
  urgent: 'red', high: 'orange', normal: 'blue', low: 'default',
};

/** Minutes → the roughest unit that still reads honestly. */
const formatMinutes = (m) => {
  if (m === null || m === undefined) return '—';
  const v = Number(m);
  if (v < 1) return 'under a minute';
  if (v < 90) return `${Math.round(v)} min`;
  if (v < 2880) return `${Math.round(v / 60)} hours`;
  return `${Math.round(v / 1440)} days`;
};

const minutesSince = (from, to) =>
  Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));

/**
 * One ticket, for the admin answering it — the thread on the left, who it's
 * from and who owns it on the right. No existing admin-center page shares
 * this shape (a message thread), so this is built from scratch rather than
 * copied, but keeps the same card/sidebar rhythm as TeamDetailPage.
 */
const SupportTicketDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { hasPermission } = usePermission();
  const canManage = hasPermission(PERMISSIONS.SUPPORT_MANAGE);
  const mutedColor = muted(isDark);

  const [ticket, setTicket] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState('');
  const [resolveOnReply, setResolveOnReply] = useState(false);
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [priorities, setPriorities] = useState([]);
  const [priorityBusy, setPriorityBusy] = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setNotFound(false);
    const calls = [supportApi.getTicket(id)];
    if (canManage) calls.push(supportApi.getAdmins());
    Promise.all(calls)
      .then(([ticketData, adminsData]) => {
        setTicket(ticketData.ticket);
        if (adminsData) setAdmins(adminsData.admins || []);
      })
      .catch((err) => { if (!silent) setNotFound(err.response?.status === 404); })
      .finally(() => { if (!silent) setLoading(false); });
  }, [id, canManage]);

  useEffect(() => load(), [load]);

  // The priority list and its SLA targets come from the analytics policy, so
  // they are fetched once rather than hardcoded in this file. Fetched only for
  // somebody who can act on them.
  useEffect(() => {
    if (!canManage) return;
    supportApi.getPriorities()
      .then((d) => setPriorities(d.priorities || []))
      .catch(() => setPriorities([]));
  }, [canManage]);

  // A customer's reply, or a colleague's, should appear here without anyone
  // hitting refresh — same 30s cadence the notification bell already polls
  // at. Skipped while this admin has an action of their own in flight, so a
  // stale response landing mid-click can't clobber what they just did.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!sending && !statusBusy && !assignBusy && !priorityBusy) load(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [load, sending, statusBusy, assignBusy, priorityBusy]);

  if (loading) {
    return <Spin style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (!ticket) {
    return notFound ? (
      <Result
        status="404"
        title="Ticket not found"
        extra={<Button type="primary" onClick={() => navigate('/support-tickets')}>Back to tickets</Button>}
      />
    ) : (
      <Result
        status="error"
        title="Could not load this ticket"
        extra={<Button type="primary" onClick={load}>Retry</Button>}
      />
    );
  }

  const submitReply = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { ticket: updated } = await supportApi.reply(ticket.id, text, resolveOnReply);
      setTicket(updated);
      setDraft('');
      setResolveOnReply(false);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not send the reply');
    } finally {
      setSending(false);
    }
  };

  const changePriority = async (priority) => {
    setPriorityBusy(true);
    try {
      const { ticket: updated } = await supportApi.setPriority(ticket.id, priority);
      setTicket(updated);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not change the priority');
    } finally {
      setPriorityBusy(false);
    }
  };

  const changeStatus = async (status) => {
    setStatusBusy(true);
    try {
      const { ticket: updated } = await supportApi.setStatus(ticket.id, status);
      setTicket(updated);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not update the status');
    } finally {
      setStatusBusy(false);
    }
  };

  const changeAssignee = async (adminId) => {
    setAssignBusy(true);
    try {
      const { ticket: updated } = await supportApi.assign(ticket.id, adminId || null);
      setTicket(updated);
    } catch (err) {
      message.error(err.response?.data?.message || 'Could not assign the ticket');
    } finally {
      setAssignBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={`#${ticket.number} — ${ticket.subject}`}
        backTo="/support-tickets"
        breadcrumbs={[{ label: 'Home', path: '/' }, { label: 'Support Tickets', path: '/support-tickets' }, { label: `#${ticket.number}` }]}
      />

      <Row gutter={24}>
        <Col xs={24} lg={16}>
          <Card style={{ marginBottom: 20 }} styles={{ body: { padding: 0 } }}>
            <div style={{ padding: 20 }}>
              {ticket.messages.map((m) => (
                <div key={m.id} style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                  <Avatar
                    size={36}
                    icon={m.authorType === 'admin' ? <CustomerServiceOutlined /> : <UserOutlined />}
                    style={{
                      flexShrink: 0,
                      background: m.authorType === 'admin' ? '#4f46e5' : (isDark ? '#232838' : '#F1F3F9'),
                      color: m.authorType === 'admin' ? '#fff' : mutedColor,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                      <Text strong style={{ fontSize: 13.5 }}>{m.authorName}</Text>
                      <Text type="secondary" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                        {formatDateTime(m.createdAt)}
                      </Text>
                    </div>
                    <Paragraph style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', marginBottom: 0 }}>{m.body}</Paragraph>
                  </div>
                </div>
              ))}
            </div>

            {canManage && (
              <>
                <Divider style={{ margin: 0 }} />
                <div style={{ padding: 16 }}>
                <TextArea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type your reply…"
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  style={{ marginBottom: 12 }}
                  disabled={sending}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Checkbox
                    checked={resolveOnReply}
                    onChange={(e) => setResolveOnReply(e.target.checked)}
                    disabled={sending}
                  >
                    Mark resolved with this reply
                  </Checkbox>
                  <Button type="primary" onClick={submitReply} disabled={!draft.trim()} loading={sending}>
                    Send reply
                  </Button>
                </div>
                </div>
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="Ticket details">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer</Text>
                <div>
                  <Button
                    type="link"
                    style={{ padding: 0, height: 'auto' }}
                    onClick={() => navigate(`/customers/${ticket.customer.id}`)}
                  >
                    {ticket.customer?.name || ticket.customer?.email}
                  </Button>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>{ticket.customer?.email}</Text>
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Category</Text>
                <div><Tag>{CATEGORY_LABEL[ticket.category] || ticket.category}</Tag></div>
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Created</Text>
                <div><Text style={{ fontSize: 13 }}>{formatDateTime(ticket.createdAt)}</Text></div>
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Priority</Text>
                <div style={{ marginTop: 4 }}>
                  {canManage && priorities.length ? (
                    <Select
                      value={ticket.priority}
                      onChange={changePriority}
                      loading={priorityBusy}
                      disabled={priorityBusy}
                      style={{ width: '100%' }}
                      options={priorities.map((p) => ({
                        value: p.key,
                        label: `${p.label} — reply within ${formatMinutes(p.slaFirstResponseMinutes)}`,
                      }))}
                    />
                  ) : (
                    <Tag color={PRIORITY_COLOR[ticket.priority] || 'default'}>{ticket.priority}</Tag>
                  )}
                </div>
                {/* Changing the priority re-stamps the targets this ticket is
                    graded against, which is not obvious from a dropdown. */}
                {canManage && priorities.length > 0 && (
                  <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 3 }}>
                    Changing this also changes the SLA this ticket is measured against.
                  </Text>
                )}
              </div>

              {/* What the queue actually promised, and what happened. Shown on
                  the ticket itself so an agent sees the same figures the
                  Support Analytics page aggregates. */}
              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timing</Text>
                <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <Text style={{ fontSize: 12.5 }}>
                    First reply:{' '}
                    {ticket.timing?.firstResponseAt
                      ? `${formatMinutes(minutesSince(ticket.createdAt, ticket.timing.firstResponseAt))} after it arrived`
                      : <Text type="warning" style={{ fontSize: 12.5 }}>nobody has replied yet</Text>}
                    {ticket.timing?.slaFirstResponseMinutes != null && (
                      <Text type="secondary" style={{ fontSize: 11, marginInlineStart: 5 }}>
                        (target {formatMinutes(ticket.timing.slaFirstResponseMinutes)})
                      </Text>
                    )}
                  </Text>
                  {ticket.timing?.resolutionMinutes != null && (
                    <Text style={{ fontSize: 12.5 }}>
                      Resolved in {formatMinutes(ticket.timing.resolutionMinutes)}
                      {/* The honesty flag, on the ticket as well as in the
                          charts: this one was reconstructed, not observed. */}
                      {ticket.timing.resolvedAtEstimated && (
                        <Text type="warning" style={{ fontSize: 11, marginInlineStart: 5 }}>
                          (estimated — the real time was never recorded)
                        </Text>
                      )}
                    </Text>
                  )}
                  {ticket.timing?.reopenedCount > 0 && (
                    <Text type="warning" style={{ fontSize: 12.5 }}>
                      Reopened {ticket.timing.reopenedCount} time{ticket.timing.reopenedCount === 1 ? '' : 's'}
                    </Text>
                  )}
                </div>
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</Text>
                <div style={{ marginTop: 4 }}>
                  {canManage ? (
                    <Select
                      value={ticket.status}
                      onChange={changeStatus}
                      loading={statusBusy}
                      disabled={statusBusy}
                      style={{ width: '100%' }}
                      options={Object.keys(STATUS_LABEL).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                    />
                  ) : (
                    <Tag color={STATUS_COLOR[ticket.status] || 'default'}>{STATUS_LABEL[ticket.status] || ticket.status}</Tag>
                  )}
                </div>
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Assigned to</Text>
                <div style={{ marginTop: 4 }}>
                  {canManage ? (
                    <Select
                      value={ticket.assignedAdmin?.id || null}
                      onChange={changeAssignee}
                      loading={assignBusy}
                      disabled={assignBusy}
                      allowClear
                      placeholder="Unassigned"
                      style={{ width: '100%' }}
                      options={admins.map((a) => ({ value: a.id, label: a.name || a.email }))}
                    />
                  ) : (
                    <Text style={{ fontSize: 13 }}>
                      {ticket.assignedAdmin ? ticket.assignedAdmin.name : <Text type="secondary">Unassigned</Text>}
                    </Text>
                  )}
                </div>
              </div>

              {ticket.status === 'solved' && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 6 }} />
                  Resolved — the customer was notified.
                </Text>
              )}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default SupportTicketDetailPage;
