import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Row, Col, Table, Tag, Typography, Space, Button, Alert, Input, Modal,
  Descriptions, Spin, Empty, Select, Popconfirm, message,
} from 'antd';
import {
  TeamOutlined, WarningOutlined, GlobalOutlined, LinkOutlined, HistoryOutlined,
  CreditCardOutlined, UserAddOutlined, DeleteOutlined,
} from '@ant-design/icons';
import PageHeader from '../../components/common/PageHeader';
import { StatRow, StatCard } from '../../components/StatRow';
import PaygAccessCard from '../../components/customers/PaygAccessCard';
import teamsApi from '../../api/teamsApi';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';
import { formatDateTime } from '../../utils/helpers';

const { Text, Paragraph } = Typography;

const money = (value, currency) => `${currency || 'USD'} ${Number(value || 0).toFixed(2)}`;

/**
 * What each recorded action says in plain English.
 *
 * The server stores a key rather than a sentence so the customer center can
 * render it in the reader's own language; the admin center speaks English, so
 * it keeps its own short phrasing here. An action with no phrase falls back to
 * its key, which is ugly but never wrong — and is the signal that a new one
 * needs a line adding.
 */
const ACTION_TEXT = {
  'team.created': 'created the organization',
  'team.deleted': 'closed the organization',
  'team.discoverabilityChanged': 'changed whether colleagues can find it',
  'member.invited': 'invited',
  'member.inviteRevoked': 'withdrew the invitation to',
  'member.inviteDeclined': 'declined an invitation',
  'member.joined': 'joined',
  'member.joinedByLink': 'joined through the link',
  'member.joinedByDomain': 'joined through the company domain',
  'member.joinRequested': 'asked to join',
  'member.joinApproved': 'let in',
  'member.joinDeclined': 'declined the request from',
  'member.roleChanged': 'changed the role of',
  'member.removed': 'removed',
  'member.left': 'left the organization',
  'member.limitSet': 'set a monthly limit for',
  'member.limitCleared': 'removed the monthly limit for',
  'ownership.offered': 'offered ownership to',
  'ownership.cancelled': 'withdrew the ownership offer to',
  'ownership.accepted': 'took over ownership from',
  'ownership.declined': 'declined ownership',
  'joinLink.issued': 'created a join link',
  'joinLink.revoked': 'revoked the join link',
  'domain.claimed': 'claimed the domain',
  'domain.verified': 'verified the domain',
  'domain.joinRuleChanged': 'changed the domain join rule',
  'domain.removed': 'removed the domain',
};

const ROLE_COLORS = {
  owner: 'gold', admin: 'blue', billing: 'purple', developer: 'cyan', viewer: 'default',
};

/** Everything except owner: ownership moves only by an accepted handover. */
const ASSIGNABLE = ['admin', 'billing', 'developer', 'viewer'];

/**
 * One organization, for the person running the platform.
 *
 * Three questions, in the order an operator asks them: who is in it, what does
 * it owe, and what is currently stopping it from spending. Everything else —
 * its domain, its join link, its history — is here to explain those three,
 * which is why the read-only parts stay small and the two levers (pay-as-you-go
 * and the dispute hold) are the only controls on the page.
 */
const TeamDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canManage = hasPermission(PERMISSIONS.BILLING_MANAGE);
  const canEdit = hasPermission(PERMISSIONS.CUSTOMERS_EDIT);

  const [data, setData] = useState(null);
  const [charges, setCharges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [holdReason, setHoldReason] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('developer');
  const [memberBusy, setMemberBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, seat] = await Promise.all([
        teamsApi.getTeam(id),
        teamsApi.getSeatCharges(id, { limit: 14 }).catch(() => ({ charges: [] })),
      ]);
      setData(detail);
      setCharges(seat.charges || []);
    } catch (err) {
      message.error(err.response?.data?.message || 'Failed to load the organization');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  }
  if (!data?.team) {
    return <Empty description="Organization not found" style={{ marginTop: 80 }} />;
  }

  const {
    team, members, wallet, deployments, seatFee, domain, joinLink, activity,
  } = data;

  const running = deployments.find((d) => d.status === 'running')?.count || 0;
  const open = deployments
    .filter((d) => !['terminated', 'rejected'].includes(d.status))
    .reduce((sum, d) => sum + d.count, 0);

  const toggleHold = () => {
    const turningOn = !team.disputeHold;
    Modal.confirm({
      title: turningOn ? 'Put this organization on dispute hold?' : 'Lift the dispute hold?',
      content: turningOn
        ? 'Nothing new can be started while a hold is on. Its ledger is untouched — this stops spending, it does not forgive anything.'
        : 'The organization will be able to start deployments again.',
      okText: turningOn ? 'Place hold' : 'Lift hold',
      okButtonProps: { danger: turningOn },
      onOk: async () => {
        try {
          await teamsApi.setDisputeHold(id, { disputeHold: turningOn, reason: holdReason.trim() });
          message.success(turningOn ? 'Dispute hold placed' : 'Dispute hold lifted');
          setHoldReason('');
          load();
        } catch (err) {
          message.error(err.response?.data?.message || 'Could not change the hold');
        }
      },
    });
  };

  /**
   * Support acting inside a customer's organization. Every one of these is
   * written into the organization's own activity log as well as the platform's
   * audit trail — the customer is entitled to see that somebody from the
   * platform did this.
   */
  const runMember = async (fn, okText) => {
    setMemberBusy(true);
    try {
      await fn();
      message.success(okText);
      load();
    } catch (err) {
      message.error(err.response?.data?.message || 'That did not work');
    } finally {
      setMemberBusy(false);
    }
  };

  const addMember = () => {
    const email = newMemberEmail.trim();
    if (!email) return;
    runMember(
      () => teamsApi.addMember(id, { email, role: newMemberRole }).then(() => setNewMemberEmail('')),
      `${email} added`,
    );
  };

  const memberColumns = [
    {
      title: 'Member',
      key: 'member',
      render: (_, m) => (
        <div>
          <Text strong>{m.name}</Text>
          <div><Text type="secondary" style={{ fontSize: 12 }}>{m.email}</Text></div>
        </div>
      ),
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      width: 170,
      render: (r, m) => (canEdit && r !== 'owner' ? (
        <Select
          value={r}
          size="small"
          style={{ width: 140 }}
          disabled={memberBusy}
          options={ASSIGNABLE.map((role) => ({ value: role, label: role }))}
          onChange={(role) => runMember(
            () => teamsApi.setMemberRole(id, m.userId, role),
            `${m.name} is now ${role}`,
          )}
        />
      ) : <Tag color={ROLE_COLORS[r]}>{r}</Tag>),
    },
    {
      title: 'Monthly limit',
      key: 'limit',
      width: 180,
      render: (_, m) => {
        if (m.role !== 'developer') return <Text type="secondary">—</Text>;
        if (m.spendLimitMonthly === null || m.spendLimitMonthly === undefined) {
          return (
            <Text type="secondary">
              No limit · {money(m.monthSpend, wallet.currency)} this month
            </Text>
          );
        }
        return (
          <Text>
            {money(m.monthSpend, wallet.currency)} / {Number(m.spendLimitMonthly).toFixed(2)}
          </Text>
        );
      },
    },
    {
      title: 'Joined',
      dataIndex: 'joinedAt',
      key: 'joinedAt',
      width: 170,
      render: (d) => formatDateTime(d),
    },
    {
      key: 'actions',
      width: 60,
      align: 'right',
      render: (_, m) => (canEdit && m.role !== 'owner' ? (
        <Popconfirm
          title={`Remove ${m.name}?`}
          description="They lose access at once. Deployments they created stay with the organization, which pays for them."
          okText="Remove"
          okButtonProps={{ danger: true }}
          onConfirm={() => runMember(() => teamsApi.removeMember(id, m.userId), `${m.name} removed`)}
        >
          <Button type="text" danger size="small" icon={<DeleteOutlined />} disabled={memberBusy} />
        </Popconfirm>
      ) : null),
    },
  ];

  const chargeColumns = [
    {
      title: 'Day', dataIndex: 'day', key: 'day', render: (d) => String(d).slice(0, 10),
    },
    { title: 'Paid seats', dataIndex: 'seats', key: 'seats', align: 'right' },
    {
      title: 'Charged', dataIndex: 'amount', key: 'amount', align: 'right', render: (v, r) => money(v, r.currency),
    },
    {
      title: 'To debt',
      dataIndex: 'toDebt',
      key: 'toDebt',
      align: 'right',
      render: (v, r) => (v > 0 ? <Text type="danger">{money(v, r.currency)}</Text> : <Text type="secondary">—</Text>),
    },
  ];

  return (
    <div>
      <PageHeader
        title={team.name}
        subtitle={`Owned by ${team.owner?.name || '—'} (${team.owner?.email || '—'})`}
        breadcrumbs={[
          { label: 'Home', path: '/' },
          { label: 'Organizations', path: '/teams' },
          { label: team.name },
        ]}
        onBack={() => navigate('/teams')}
      />

      {team.closedAt && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="This organization is closed"
          description={`Closed ${formatDateTime(team.closedAt)}. Nobody can use it; its ledger is kept.`}
        />
      )}

      {team.disputeHold && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="On dispute hold"
          description={team.disputeReason || 'Nothing new can start until the hold is lifted.'}
        />
      )}

      <StatRow>
        <StatCard count={4} tone="blue" icon={<TeamOutlined />} label="Members" value={members.length} />
        <StatCard count={4} tone="green" icon={<CreditCardOutlined />} label="Balance" value={money(wallet.balance, wallet.currency)} />
        <StatCard count={4} tone="red" icon={<WarningOutlined />} label="Outstanding" value={money(wallet.outstanding, wallet.currency)} />
        <StatCard count={4} tone="purple" icon={<HistoryOutlined />} label="Deployments" value={`${running} running · ${open} open`} />
      </StatRow>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card title={<Space><TeamOutlined />Members</Space>} style={{ marginBottom: 16 }}>
            <Table
              rowKey="userId"
              columns={memberColumns}
              dataSource={members}
              pagination={false}
              size="small"
              scroll={{ x: 720 }}
            />
            {canEdit && !team.closedAt && (
              <Space wrap style={{ marginTop: 16 }}>
                <Input
                  prefix={<UserAddOutlined />}
                  placeholder="Existing customer's email"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  onPressEnter={addMember}
                  style={{ width: 280 }}
                  disabled={memberBusy}
                />
                <Select
                  value={newMemberRole}
                  onChange={setNewMemberRole}
                  style={{ width: 140 }}
                  options={ASSIGNABLE.map((role) => ({ value: role, label: role }))}
                  disabled={memberBusy}
                />
                <Button type="primary" onClick={addMember} loading={memberBusy}>Add member</Button>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  They must already have an account, and they are told they were added.
                </Text>
              </Space>
            )}
          </Card>

          <Card title={<Space><CreditCardOutlined />Seat fee</Space>} style={{ marginBottom: 16 }}>
            {seatFee.enabled ? (
              <>
                <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
                  <Descriptions.Item label="Monthly fee">{money(seatFee.monthlyFee, wallet.currency)} per seat</Descriptions.Item>
                  <Descriptions.Item label="Free seats">{seatFee.freeSeats}</Descriptions.Item>
                  <Descriptions.Item label="Paid seats">{seatFee.paidSeats} of {seatFee.members}</Descriptions.Item>
                  <Descriptions.Item label="This costs">
                    {money(seatFee.perMonth, wallet.currency)}/month · {money(seatFee.perDay, wallet.currency)}/day
                  </Descriptions.Item>
                </Descriptions>
                <Table
                  rowKey={(r) => String(r.day)}
                  columns={chargeColumns}
                  dataSource={charges}
                  pagination={false}
                  size="small"
                  style={{ marginTop: 12 }}
                  locale={{ emptyText: 'Nothing charged yet' }}
                />
              </>
            ) : (
              <Text type="secondary">
                Seat fees are off. Turn them on in Settings → Teams to charge for members above the free seats.
              </Text>
            )}
          </Card>

          <Card title={<Space><HistoryOutlined />Recent activity</Space>}>
            {activity?.length ? (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {activity.map((a) => (
                  <div key={a.id}>
                    <Text style={{ fontSize: 13 }}>
                      <Text strong>{a.actor?.name}</Text>
                      {' '}
                      {ACTION_TEXT[a.action] || a.action}
                      {a.targetName ? ` ${a.targetName}` : ''}
                    </Text>
                    <div><Text type="secondary" style={{ fontSize: 11.5 }}>{formatDateTime(a.createdAt)}</Text></div>
                  </div>
                ))}
              </Space>
            ) : <Text type="secondary">Nothing recorded yet</Text>}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <PaygAccessCard
            customer={{ ...team, id }}
            canManage={canManage}
            label="organization"
            save={(access, reason) => teamsApi.setPaygAccess(id, { access, reason })}
            onChanged={load}
            style={{ marginBottom: 16 }}
          />

          <Card title={<Space><WarningOutlined />Dispute hold</Space>} style={{ marginBottom: 16 }}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                A hold stops anything new from starting. It changes no money —
                what is owed stays owed.
              </Text>
              {!team.disputeHold && (
                <Input
                  placeholder="Reason (kept in the activity log)"
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  disabled={!canManage}
                />
              )}
              <Button danger={!team.disputeHold} disabled={!canManage} onClick={toggleHold}>
                {team.disputeHold ? 'Lift hold' : 'Place hold'}
              </Button>
            </Space>
          </Card>

          <Card title={<Space><GlobalOutlined />Company domain</Space>} style={{ marginBottom: 16 }}>
            {domain?.enabled === false ? (
              <Text type="secondary">
                Company domains are off for this platform. Customers join by invitation or join link.
              </Text>
            ) : (
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="Domain">{domain?.domain || '—'}</Descriptions.Item>
                <Descriptions.Item label="Verified">
                  {domain?.verified ? <Tag color="success">Yes</Tag> : <Tag>No</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label="Joining">{domain?.joinMode || 'off'}</Descriptions.Item>
              </Descriptions>
            )}
            <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              Findable by colleagues: {team.discoverableByDomain ? 'yes' : 'no'}
            </Paragraph>
          </Card>

          <Card title={<Space><LinkOutlined />Join link</Space>}>
            {joinLink?.enabled === false ? (
              <Text type="secondary">Join links are off for this platform.</Text>
            ) : joinLink?.link ? (
              <Descriptions size="small" column={1}>
                <Descriptions.Item label="Joins as">{joinLink.link.role}</Descriptions.Item>
                <Descriptions.Item label="Expires">{formatDateTime(joinLink.link.expiresAt)}</Descriptions.Item>
                <Descriptions.Item label="Used">{joinLink.link.usedCount}</Descriptions.Item>
              </Descriptions>
            ) : <Text type="secondary">No live link</Text>}
            <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              The link itself is never shown here — only its hash is stored.
            </Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default TeamDetailPage;
