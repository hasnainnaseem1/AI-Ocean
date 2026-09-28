import { formatAmount } from '../utils/money';
import React, { useEffect, useState } from "react";
import {
  Row, Col, Card, Button, Typography, Alert, Space, Empty,
} from "antd";
import {
  ThunderboltOutlined, RocketOutlined, WalletOutlined,
  CreditCardOutlined, ClockCircleOutlined,
  ArrowRightOutlined, PlusOutlined, ApiOutlined,
  CloudServerOutlined, HistoryOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import StatusBadge from "../components/StatusBadge";
import Sparkline from "../components/Sparkline";
import { StatRow, StatCard, IconTile } from "../components/StatRow";
import { StatCardsSkeleton, TableRowsSkeleton } from "../components/Skeletons";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useSite, useBilling } from "../context/SiteContext";
import { cardStyle, monoNumeric, SURFACE, ltrTechnical } from "../theme/colors";
import DomainJoinBanner from '../components/DomainJoinBanner';
import walletApi from "../api/walletApi";
import deploymentsApi from "../api/deploymentsApi";
import { STATUS_META, STATUS_TONE } from "./deployments/DeploymentsListPage";
import EmptyBalanceAlert from "../components/EmptyBalanceAlert";
import { useTeam } from "../context/TeamContext";
import { formatRate } from "../utils/money";
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

const DashboardPage = () => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { user } = useAuth();
  const { isDark } = useTheme();
  const { siteConfig } = useSite();
  // `creditsEnabled` is false for a team member who may not see money
  // (Developer / Viewer) — every money tile below keys on it.
  const { creditsEnabled, currency } = useBilling();
  const { can } = useTeam();
  const navigate = useNavigate();

  const deploymentsEnabled = siteConfig?.enableDeployments !== false;
  const catalogEnabled = siteConfig?.enableModelCatalog !== false;

  const [wallet, setWallet] = useState(null);
  const [balanceTrend, setBalanceTrend] = useState([]);
  const [deployments, setDeployments] = useState([]);
  const [burnRate, setBurnRate] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    /**
     * Swallowing these rejections left every tile on its initial zero, so an
     * outage rendered as "CREDIT BALANCE 0.00 · 0 deployments · No deployments
     * yet" — indistinguishable from a genuinely empty account, and alarming to
     * a customer who has neither. Record the failure instead and say so.
     */
    let failed = 0;
    const note = () => { failed += 1; };

    const jobs = [];
    if (creditsEnabled) {
      jobs.push(walletApi.get().then((d) => !cancelled && setWallet(d.wallet)).catch(note));
      jobs.push(
        walletApi.getTransactions({ limit: 12 })
          .then((d) => {
            if (cancelled) return;
            // Oldest → newest, real balanceAfter values only — no fabricated trend
            const series = (d.transactions || []).slice().reverse().map((t) => t.balanceAfter);
            setBalanceTrend(series);
          })
          .catch(note)
      );
    }
    if (deploymentsEnabled) {
      jobs.push(
        deploymentsApi.list({ limit: 6 })
          .then((d) => {
            if (cancelled) return;
            setDeployments(d.deployments || []);
            setBurnRate(d.burnRatePerHour || 0);
          })
          .catch(note)
      );
    }

    Promise.all(jobs).finally(() => {
      if (cancelled) return;
      setLoadError(failed ? t('dashboard:loadFailedBody') : null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [t, creditsEnabled, deploymentsEnabled]);

  const running = deployments.filter((d) => d.status === 'running').length;
  const paused  = deployments.filter((d) => d.status === 'paused').length;
  const card = cardStyle(isDark);
  const textMuted = isDark ? '#9BA1BC' : '#8A90AB';
  const borderColor = isDark ? SURFACE.borderDark : SURFACE.borderLight;

  const quickActions = [
    ...(catalogEnabled && can('deployments.create') ? [{
      key: 'deploy', label: t('dashboard:deployNewModel'), icon: <RocketOutlined />,
      tone: 'pink', primary: true, onClick: () => navigate('/models'),
    }] : []),
    ...(deploymentsEnabled ? [{
      key: 'manage', label: t('dashboard:manageDeployments'), icon: <CloudServerOutlined />,
      tone: 'blue', onClick: () => navigate('/deployments'),
    }] : []),
    ...(creditsEnabled ? [{
      key: 'topup', label: t('common:action.addCredit'), icon: <WalletOutlined />,
      // Straight to the Credit balance tab, where the top-up form actually is.
      // This used to go to /wallet, which redirects to Billing's Overview tab
      // — a page about what you've spent, with no way to add credit on it.
      tone: 'purple', onClick: () => navigate('/billing?tab=credits'),
    }] : []),
    ...(creditsEnabled ? [{
      key: 'invoices', label: t('dashboard:viewInvoices'), icon: <HistoryOutlined />,
      // This used to go to /settings?tab=billing, which lands on the profile
      // page — it has no "billing" tab, so the query param did nothing and the
      // customer landed on Edit Profile instead of any invoice.
      tone: 'cyan', onClick: () => navigate('/billing?tab=invoices'),
    }] : []),
  ];

  return (
    <>
      {/* An organization at this customer's own email domain, if there is one. */}
      <DomainJoinBanner />

      {/* ── Alerts ── */}
      {loadError && (
        <Alert
          type="error" showIcon
          style={{ marginBottom: 16 }}
          message={t('dashboard:loadFailed')}
          description={loadError}
          action={<Button size="small" onClick={() => window.location.reload()}>{t('common:action.retry')}</Button>}
        />
      )}

      {/*
        * This used to say "Running deployments have been paused" to anyone
        * whose balance hit zero — directly above a stat card reading
        * "0 paused", and flatly untrue for a pay-as-you-go account, whose
        * machines keep running and keep charging. Shared with the billing page
        * so the two can never disagree about what an empty wallet means.
        */}
      <EmptyBalanceAlert
        wallet={wallet}
        deployments={deployments}
        currency={currency}
        creditsEnabled={creditsEnabled}
        danger
        style={{ borderRadius: 14 }}
        onAddCredit={() => navigate('/billing?tab=credits')}
        onAddCard={() => navigate('/billing?tab=cards')}
      />
      {creditsEnabled && wallet && wallet.isLow && wallet.balance > 0 && (
        <Alert
          type="warning" showIcon icon={<ClockCircleOutlined />}
          message={
            wallet.runwayDays !== null
              ? t('dashboard:runwayDaysLeft', { count: wallet.runwayDays })
              : t('dashboard:lowBalance')
          }
          description={t('dashboard:lowBalanceBody')}
          action={<Button type="primary" size="small" onClick={() => navigate('/billing?tab=credits')}>{t('common:action.addCredit')}</Button>}
          style={{ marginBottom: 20, borderRadius: 14 }}
        />
      )}
      {/* ── Header ── */}
      <Row justify="space-between" align="middle" wrap gutter={[16, 16]} style={{ marginBottom: 26 }}>
        <Col>
          <Title level={2} style={{ margin: 0, fontSize: 30 }}>
            {t('dashboard:welcomeBack', { name: user?.name?.split(' ')[0] || t('dashboard:there') })}
          </Title>
        </Col>
        <Col>
          {deploymentsEnabled && (
            <Button
              type="primary"
              size="large"
              className="btn-gradient"
              icon={<RocketOutlined />}
              onClick={() => navigate("/models")}
              style={{ height: 44, borderRadius: 12, fontWeight: 700 }}
            >
              {t('dashboard:deployModel')}
            </Button>
          )}
        </Col>
      </Row>

      {/* ── Stats ── */}
      {loading ? (
        <StatCardsSkeleton count={4} />
      ) : (
      <StatRow>
        {creditsEnabled && (
          <StatCard
            className="card-hover"
            // Straight to the tab with the top-up form, matching "Add a card"
            // above rather than the general (and less useful) Overview tab.
            onClick={() => navigate('/billing?tab=credits')}
            icon={<WalletOutlined />}
            tone="blue"
            label={t('dashboard:creditBalance')}
            value={formatAmount((wallet?.balance ?? 0))}
            suffix={currency}
            caption={
              wallet?.runwayDays !== null && wallet?.runwayDays !== undefined
                ? t('dashboard:runwayAtCurrentUsage', { count: wallet.runwayDays })
                : t('dashboard:noActiveUsage')
            }
            chart={balanceTrend.length >= 2 ? <Sparkline values={balanceTrend} width={72} height={34} /> : null}
          />
        )}
        {deploymentsEnabled && (
          <StatCard
            className="card-hover"
            onClick={() => navigate("/deployments")}
            icon={<RocketOutlined />}
            tone="green"
            label={t('dashboard:runningDeployments')}
            value={running}
            caption={t('dashboard:totalAndPaused', { total: deployments.length, paused })}
          />
        )}
        {deploymentsEnabled && creditsEnabled && (
          <StatCard
            icon={<ThunderboltOutlined />}
            tone="pink"
            label={t('dashboard:currentBurnRate')}
            value={formatAmount(burnRate)}
            suffix={`${currency}${t('common:units.perHour')}`}
            caption={t('dashboard:perDayAtThisRate', { amount: `${currency} ${formatAmount(burnRate * 24)}` })}
          />
        )}
        {creditsEnabled && (
        <StatCard
          className="card-hover"
          // Same dead link as the Quick Actions above — the caption promises
          // "open invoice history", so it has to actually open the Invoices tab.
          onClick={() => navigate('/billing?tab=invoices')}
          icon={<CreditCardOutlined />}
          tone="purple"
          label={t('dashboard:billingAndInvoices')}
          value={wallet ? formatAmount((wallet.lifetimeSpend ?? 0)) : t('dashboard:view')}
          suffix={wallet ? currency : null}
          caption={t('dashboard:lifetimeCaption')}
        />
        )}
      </StatRow>
      )}

      <Row gutter={[18, 18]}>
        {/* ── Recent deployments ── */}
        {deploymentsEnabled && (
          <Col xs={24} lg={16}>
            <Card
              title={t('dashboard:recentDeployments')}
              extra={<Button type="link" style={{ fontWeight: 600 }} onClick={() => navigate("/deployments")}>{t('dashboard:viewAll')} <ArrowRightOutlined /></Button>}
              style={{ ...card, height: '100%' }}
              styles={{ body: { padding: (!loading && deployments.length) ? 0 : 24 } }}
            >
              {loading ? (
                <TableRowsSkeleton rows={4} />
              ) : deployments.length === 0 ? (
                <Empty
                  image={<ApiOutlined style={{ fontSize: 44, color: isDark ? '#242942' : '#DDE2F0' }} />}
                  description={
                    <Space direction="vertical" size={4}>
                      <Text strong>{t('dashboard:noDeployments')}</Text>
                      <Text style={{ color: textMuted }}>{t('dashboard:noDeploymentsBody')}</Text>
                    </Space>
                  }
                  style={{ padding: '24px 0' }}
                >
                  <Button type="primary" className="btn-gradient" icon={<PlusOutlined />} onClick={() => navigate("/models")}>
                    {t('common:action.browseModels')}
                  </Button>
                </Empty>
              ) : (
                <div>
                  {/* Column header — matches the ledger tables elsewhere */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '12px 24px', borderBottom: `1px solid ${borderColor}`,
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: textMuted,
                  }}>
                    <span style={{ flex: 1 }}>{t('dashboard:columnDeployment')}</span>
                    {creditsEnabled && <span className="dep-rate">{t('common:label.rate')}</span>}
                    <span className="dep-status">{t('common:label.status')}</span>
                  </div>

                  {deployments.map((d, i) => {
                    const meta = STATUS_META[d.status] || {};
                    const tone = STATUS_TONE[d.status] || 'neutral';
                    const tileTone = tone === 'success' ? 'green' : tone === 'error' ? 'pink' : tone === 'warning' ? 'amber' : 'blue';
                    return (
                      <div
                        key={d.id}
                        className="row-hover"
                        onClick={() => navigate(`/deployments/${d.id}`)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 16,
                          padding: '14px 24px', cursor: 'pointer',
                          borderBottom: i < deployments.length - 1 ? `1px solid ${borderColor}` : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                          <IconTile icon={<CloudServerOutlined />} tone={tileTone} size={36} />
                          <div style={{ minWidth: 0 }}>
                            <Text strong ellipsis style={{ display: 'block', fontSize: 14, ...ltrTechnical }}>{d.deploymentName}</Text>
                            {/* Model and machine names are identifiers, not prose: pinned
                                ltr so an RTL page truncates them at the end rather
                                than the beginning ("…Seek R1" instead of "DeepSeek…"). */}
                            <Text ellipsis style={{ display: 'block', fontSize: 12, color: textMuted, ...ltrTechnical }}>
                              {d.model?.name} · {d.tier?.name}
                            </Text>
                          </div>
                        </div>
                        {creditsEnabled && (
                        <Text strong className="dep-rate" style={{ fontSize: 13.5, ...monoNumeric }}>
                          {/* Three decimals, like every other hourly rate on
                              the platform — this is the price the customer is
                              charged at, not a rounded headline. */}
                          {currency} {formatRate(d.effectiveRate)}
                          <Text style={{ fontSize: 11, color: textMuted }}>{t('common:units.perHour')}</Text>
                        </Text>
                        )}
                        <div className="dep-status">
                          <StatusBadge tone={tone} label={meta.labelKey ? t(meta.labelKey) : d.status} pulse={d.status === 'running'} size="small" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </Col>
        )}

        {/* ── Quick actions ── */}
        <Col xs={24} lg={deploymentsEnabled ? 8 : 24}>
          <Card title={t('dashboard:quickActions')} style={{ ...card, height: '100%' }} styles={{ body: { padding: 16 } }}>
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {quickActions.map((a) => (
                <div
                  key={a.key}
                  onClick={a.onClick}
                  className={a.primary ? 'btn-gradient' : 'card-hover'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                    fontWeight: 600, fontSize: 14,
                    ...(a.primary ? {} : {
                      background: isDark ? 'rgba(255,255,255,0.03)' : '#F7F9FF',
                      border: `1px solid ${borderColor}`,
                      color: isDark ? '#E8EAF4' : '#1B1F35',
                    }),
                  }}
                >
                  {a.primary ? (
                    <span style={{
                      width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                      background: 'rgba(255,255,255,0.22)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                    }}>
                      {a.icon}
                    </span>
                  ) : (
                    <IconTile icon={a.icon} tone={a.tone} size={30} />
                  )}
                  <span style={{ flex: 1 }}>{a.label}</span>
                  <ArrowRightOutlined style={{ fontSize: 12, opacity: 0.55 }} />
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
    </>
  );
};

export default DashboardPage;
