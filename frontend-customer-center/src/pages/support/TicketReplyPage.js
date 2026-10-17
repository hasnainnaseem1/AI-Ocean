import React, { useCallback, useEffect, useState } from 'react';
import { Row, Col, Card, Typography, Button, Input, Avatar, Result, Tooltip, message } from 'antd';
import {
  ArrowLeftOutlined, LeftOutlined, RightOutlined, PaperClipOutlined,
  CheckCircleOutlined, UndoOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import StatusBadge from '../../components/StatusBadge';
import { DetailSkeleton } from '../../components/Skeletons';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { cardStyle as surfaceStyle, GRADIENT, SURFACE } from '../../theme/colors';
import supportApi from '../../api/supportApi';
import { TICKET_STATUS_META, CATEGORY_LABEL_KEYS } from './ticketMeta';
import { formatDate } from '../../utils/format';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;
const { TextArea } = Input;

const TicketReplyPage = () => {
  const { t } = useTranslation(['support', 'common']);
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const card = surfaceStyle(isDark);
  const borderColor = isDark ? SURFACE.borderDark : SURFACE.borderLight;

  const [ticket, setTicket] = useState(null);
  const [allTickets, setAllTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setNotFound(false);
    Promise.all([supportApi.get(id), supportApi.list()])
      .then(([ticketData, listData]) => {
        setTicket(ticketData.ticket);
        setAllTickets(listData.tickets || []);
      })
      .catch((err) => {
        // 404 shows its own page below; any other failure falls through to
        // the generic error Result, which already carries a retry button —
        // no need for a toast on top of it. A silent background poll simply
        // leaves whatever is already on screen alone rather than bumping the
        // customer to an error page because one poll happened to fail.
        if (!silent) setNotFound(err.response?.status === 404);
      })
      .finally(() => { if (!silent) setLoading(false); });
  }, [id]);

  useEffect(() => load(), [load]);

  // Support's reply, or a status change, should show up here without the
  // customer needing to reload — same 30s cadence the notification bell
  // already polls at. Skipped while a reply or status change of their own
  // is in flight, so a stale response can't overwrite what they just did.
  useEffect(() => {
    const interval = setInterval(() => {
      if (!sending && !statusBusy) load(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [load, sending, statusBusy]);

  if (loading) {
    return <DetailSkeleton />;
  }

  if (!ticket) {
    return notFound ? (
      <Result
        status="404"
        title={t('support:reply.notFound')}
        subTitle={t('support:reply.removed')}
        extra={<Button type="primary" onClick={() => navigate('/support')}>{t('support:reply.back')}</Button>}
      />
    ) : (
      <Result
        status="error"
        title={t('support:reply.loadFailed')}
        extra={<Button type="primary" onClick={load}>{t('common:action.retry')}</Button>}
      />
    );
  }

  const trimmedName = user?.name?.trim();
  const hasDistinctName = !!trimmedName && trimmedName.toLowerCase() !== user?.email?.toLowerCase();
  const displayName = hasDistinctName ? trimmedName : (user?.email?.split('@')[0] || 'You');

  const meta = TICKET_STATUS_META[ticket.status] || TICKET_STATUS_META.open;
  const index = allTickets.findIndex((t) => t.id === ticket.id);
  const goTo = (delta) => {
    const next = allTickets[index + delta];
    if (next) navigate(`/support/${next.id}`);
  };

  const submitReply = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { ticket: updated } = await supportApi.reply(ticket.id, text);
      setTicket(updated);
      setDraft('');
    } catch (err) {
      message.error(err.response?.data?.message || t('support:reply.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  const toggleResolved = async () => {
    if (statusBusy) return;
    setStatusBusy(true);
    try {
      const { ticket: updated } = await supportApi.setStatus(ticket.id, ticket.status === 'solved' ? 'open' : 'solved');
      setTicket(updated);
      setAllTickets((prev) => prev.map((t2) => (t2.id === updated.id ? { ...t2, status: updated.status } : t2)));
    } catch (err) {
      message.error(err.response?.data?.message || t('support:reply.statusFailed'));
    } finally {
      setStatusBusy(false);
    }
  };

  return (
    <>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/support')} style={{ marginBottom: 16, paddingInlineStart: 0 }}>
        {t('support:reply.back')}
      </Button>

      <Row gutter={24}>
        <Col xs={24} lg={16}>
          <Card style={{ ...card, marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
              <div>
                <Title level={4} style={{ marginBottom: 4 }}>
                  Ticket #{ticket.number} — {ticket.subject}
                </Title>
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {formatDate(ticket.createdAt, 'weekdayTime')}
                </Text>
              </div>
              {allTickets.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <Text type="secondary" style={{ fontSize: 12.5 }}>{index + 1} of {allTickets.length}</Text>
                  <Button size="small" shape="circle" icon={<LeftOutlined />} disabled={index <= 0} onClick={() => goTo(-1)} />
                  <Button size="small" shape="circle" icon={<RightOutlined />} disabled={index >= allTickets.length - 1} onClick={() => goTo(1)} />
                </div>
              )}
            </div>
          </Card>

          <Card style={{ ...card, marginBottom: 24 }} styles={{ body: { padding: 0 } }}>
            <div style={{ padding: 20 }}>
              {ticket.messages.map((m) => (
                <div key={m.id} style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
                  <Avatar
                    size={38}
                    style={{
                      flexShrink: 0, fontWeight: 700, fontSize: 13,
                      background: m.authorType === 'admin' ? (isDark ? '#232B45' : '#F1F3F9') : GRADIENT,
                      color: m.authorType === 'admin' ? (isDark ? '#9BA1BC' : '#6B7290') : '#fff',
                    }}
                  >
                    {m.authorType === 'admin' ? 'S' : displayName.slice(0, 2).toUpperCase()}
                  </Avatar>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                      <Text strong style={{ fontSize: 13.5 }}>
                        {m.authorType === 'admin' ? t('support:reply.supportTeam') : displayName}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>
                        {formatDate(m.createdAt, 'dateTime')}
                      </Text>
                    </div>
                    <Text style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{m.body}</Text>
                  </div>
                </div>
              ))}

              {!ticket.messages.some((m) => m.authorType === 'admin') && (
                <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: 4 }}>
                  {t('support:reply.noReplyYet')}
                </Text>
              )}
            </div>

            <div style={{ padding: 16, borderTop: `1px solid ${borderColor}` }}>
              <TextArea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t('support:reply.placeholder')}
                autoSize={{ minRows: 3, maxRows: 6 }}
                style={{ borderRadius: 10, marginBottom: 12 }}
                disabled={sending}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Tooltip title={t('support:reply.attachSoon')}>
                  <Button type="text" icon={<PaperClipOutlined />} disabled>{t('support:reply.attach')}</Button>
                </Tooltip>
                <Button type="primary" onClick={submitReply} disabled={!draft.trim()} loading={sending}>{t('support:reply.send')}</Button>
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card style={card} title={t('support:reply.details')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('support:reply.customer')}</Text>
                <div><Text strong>{displayName}</Text></div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('support:reply.email')}</Text>
                <div><Text>{user?.email}</Text></div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('support:list.ticketId')}</Text>
                <div><Text>#{ticket.number}</Text></div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('support:form.category')}</Text>
                <div><Text>{t(CATEGORY_LABEL_KEYS[ticket.category] || 'support:category.general')}</Text></div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('support:list.created')}</Text>
                <div><Text>{formatDate(ticket.createdAt, 'short')}</Text></div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('common:label.status')}</Text>
                <div style={{ marginTop: 4 }}><StatusBadge tone={meta.tone} label={t(meta.labelKey)} /></div>
              </div>

              <Button
                icon={ticket.status === 'solved' ? <UndoOutlined /> : <CheckCircleOutlined />}
                onClick={toggleResolved}
                loading={statusBusy}
                style={{ marginTop: 6 }}
              >
                {ticket.status === 'solved' ? t('support:reply.reopen') : t('support:reply.markResolved')}
              </Button>
            </div>
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default TicketReplyPage;
