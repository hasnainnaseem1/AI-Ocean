import React, { useEffect, useState } from 'react';
import {
  Card, Row, Col, Typography, Descriptions, Button, Space, Tag, Table, Empty, Result,
} from 'antd';
import {
  ArrowLeftOutlined, RocketOutlined, ThunderboltOutlined, DatabaseOutlined,
  HddOutlined, DeploymentUnitOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { DetailSkeleton } from '../../components/Skeletons';
import { StatRow, StatCard } from '../../components/StatRow';
import StatusBadge from '../../components/StatusBadge';
import catalogApi from '../../api/catalogApi';
import { useTheme } from '../../context/ThemeContext';
import { useBilling } from '../../context/SiteContext';
import { useTeam } from '../../context/TeamContext';
import { formatRate, formatAmount } from '../../utils/money';
import { cardStyle as surfaceStyle, getBrand, monoNumeric, TILE } from '../../theme/colors';
import { useTranslation } from 'react-i18next';

const { Title, Text, Paragraph } = Typography;

const CATEGORY_TONE = {
  gpu: 'purple',
  'gpu-compute': 'purple',
  cpu: 'blue',
  'cpu-compute': 'blue',
  memory: 'cyan',
  'memory-optimized': 'cyan',
  storage: 'green',
};
const toneFor = (slug) => CATEGORY_TONE[slug] || 'blue';

const STOCK_TONE = { available: 'success', limited: 'warning', out_of_stock: 'error' };
/** Keys, not labels — see the note on MODALITY_LABEL_KEY elsewhere. */
const STOCK_LABEL_KEY = {
  available: 'catalog:machines.available',
  limited: 'catalog:machines.limited',
  out_of_stock: 'catalog:machines.outOfStock',
};

/**
 * One machine in full.
 *
 * Two things here exist nowhere else in the product: the whole price ladder in
 * one place (a customer otherwise only ever sees the hourly rate, mid-wizard),
 * and the list of models that run on this machine — the reverse of the
 * relationship every other screen reads, and a question nothing could answer
 * until now.
 */
const MachineDetailPage = () => {
  const { t } = useTranslation(['catalog', 'common']);
  // Only roles that may deploy in this account get a working Deploy button.
  const canDeploy = useTeam().can('deployments.create');
  const { slug } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { currency } = useBilling();
  const BRAND = getBrand(isDark);
  const card = surfaceStyle(isDark);

  const [tier, setTier] = useState(null);
  const [hoursPerMonth, setHoursPerMonth] = useState(730);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    catalogApi
      .getTier(slug)
      .then((data) => {
        if (cancelled) return;
        setTier(data.tier);
        if (data.hoursPerMonth) setHoursPerMonth(data.hoursPerMonth);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.message || t('catalog:machine.loadFailed'));
      })
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
  }, [slug, t]);

  if (loading) return <DetailSkeleton />;

  if (error || !tier) {
    return (
      <Result
        status="404"
        title={t('catalog:machine.notFound')}
        subTitle={error || t('catalog:machine.removed')}
        extra={(
          <Button type="primary" onClick={() => navigate('/machines')}>
            {t('catalog:machine.back')}
          </Button>
        )}
      />
    );
  }

  const tone = toneFor(tier.category?.slug);
  const money = (v) => `${currency} ${formatAmount(v)}`;
  const rate = (v) => `${currency} ${formatRate(v)}`;

  const modelColumns = [
    {
      title: t('common:label.model'),
      dataIndex: 'name',
      render: (name, m) => (
        <Space direction="vertical" size={2}>
          <Space size={8} align="center" wrap>
            <Button
              type="link"
              style={{ padding: 0, height: 'auto', fontWeight: 600 }}
              onClick={() => navigate(`/models/${m.slug}`)}
            >
              {name}
            </Button>
            {/* Same tag vocabulary the deploy journey uses, so a customer who
                has seen one recognises the other. */}
            {m.recommended && <Tag color="green">{t('catalog:model.adminPick')}</Tag>}
            {m.underpowered && <Tag color="orange">{t('catalog:model.undersized')}</Tag>}
          </Space>
          {(m.notes || m.shortDescription) && (
            <Text dir="auto" type="secondary" style={{ fontSize: 12 }}>
              {m.notes || m.shortDescription}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: t('catalog:machine.family'),
      dataIndex: 'family',
      width: 130,
      render: (f) => <Text type="secondary" style={{ fontSize: 12.5 }}>{f}</Text>,
    },
    {
      // A model's price multiplier applies to the whole machine, so the same
      // model can cost differently on different hardware. This is that price.
      title: t('catalog:machine.onThisMachine'),
      dataIndex: 'pricePerHour',
      width: 160,
      align: 'right',
      render: (v, m) => (
        <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
          <Text strong style={{ color: BRAND, ...monoNumeric }}>{rate(v)}<Text type="secondary" style={{ fontSize: 11 }}>{t('common:units.perHour')}</Text></Text>
          <Text type="secondary" style={{ fontSize: 11.5, ...monoNumeric }}>{money(m.pricePerMonth)}{t('common:units.perMonth')}</Text>
        </Space>
      ),
    },
    {
      title: '',
      key: 'deploy',
      width: 130,
      align: 'right',
      render: (_, m) => (
        <Button
          type="primary"
          size="small"
          icon={<RocketOutlined />}
          disabled={!canDeploy}
          /*
           * Carry the machine through. The customer has chosen both halves
           * here, so the journey drops its hardware-recommendation step —
           * suggesting a machine to someone standing on that machine's page is
           * a screen with nothing left to decide.
           *
           * `tier.id`, not `tierId`: this page's tier comes from the catalogue
           * serializer, which names it `id`.
           */
          onClick={() => navigate(
            `/deploy/${m.slug}?machine=${encodeURIComponent(tier.slug || tier.id)}`
          )}
        >
          {t('catalog:models.deploy')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/machines')}
        style={{ paddingInlineStart: 0, marginBottom: 16 }}
      >
        {t('catalog:machine.back')}
      </Button>

      {/* ── Header ── */}
      <Card style={{ ...card, marginBottom: 20 }} styles={{ body: { padding: 24 } }}>
        <Row gutter={[24, 16]} align="middle" justify="space-between">
          <Col xs={24} md={15}>
            <Space size={10} align="center" wrap style={{ marginBottom: 8 }}>
              {tier.category && (
                <span style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                  padding: '2px 8px', borderRadius: 6,
                  background: TILE[tone].bg(isDark),
                  color: TILE[tone].fg(isDark),
                }}>
                  {tier.category.name}
                </span>
              )}
              <StatusBadge
                tone={STOCK_TONE[tier.status] || 'neutral'}
                label={t(STOCK_LABEL_KEY[tier.status]) || tier.status}
                size="small"
              />
              {tier.availableUnits !== null && tier.availableUnits !== undefined && (
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  {t('catalog:machines.unitsAvailable', { count: tier.availableUnits })}
                </Text>
              )}
            </Space>
            <Title level={2} style={{ margin: 0, marginBottom: 6 }}>{tier.name}</Title>
            {tier.description && (
              <Paragraph dir="auto" type="secondary" style={{ marginBottom: 0, fontSize: 13.5 }}>
                {tier.description}
              </Paragraph>
            )}
          </Col>
          <Col xs={24} md={9} style={{ textAlign: 'end' }}>
            <Text strong style={{
              fontSize: 32, color: BRAND, fontWeight: 800,
              letterSpacing: '-0.03em', ...monoNumeric,
            }}>
              {rate(tier.pricePerHour)}
            </Text>
            <Text type="secondary" style={{ fontSize: 14 }}>{t('common:units.perHour')}</Text>
            <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginTop: 2 }}>
              billed by the hour, only while it runs
            </Text>
          </Col>
        </Row>
      </Card>

      {/* ── The four numbers people compare machines on ── */}
      <StatRow>
        <StatCard
          icon={<ThunderboltOutlined />} tone="purple"
          label={t('catalog:machine.gpuMemory')}
          value={tier.totalVramGb || 0}
          suffix="GB"
          caption={tier.gpuCount > 0
            ? `${tier.gpuCount}× ${tier.gpuModel || t('catalog:machine.accelerator')}`
            : t('catalog:machine.noAccelerator')}
        />
        <StatCard
          icon={<DeploymentUnitOutlined />} tone="blue"
          label={<>{t('catalog:machine.virtual')}<br />{t('catalog:machine.cpus')}</>}
          value={tier.vcpu || 0}
          suffix={t('catalog:machine.vcpuSuffix')}
          caption={t('catalog:machine.coresCaption')}
        />
        <StatCard
          icon={<DatabaseOutlined />} tone="cyan"
          label={t('catalog:machine.systemMemory')}
          value={tier.ramGb || 0}
          suffix="GB"
          caption={t('catalog:machine.ramCaption')}
        />
        <StatCard
          icon={<HddOutlined />} tone="green"
          label={<>{t('catalog:machine.disk')}</>}
          value={tier.storageGb || 0}
          suffix="GB"
          caption={tier.storageType ? `${tier.storageType} — kept while paused` : 'Kept while paused'}
        />
      </StatRow>

      <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
        {/* ── Pricing ── */}
        <Col xs={24} lg={12}>
          <Card title={t('catalog:machine.pricing')} style={{ ...card, height: '100%' }} styles={{ body: { padding: 20 } }}>
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label={t('catalog:machines.columnPerHour')}>
                <Text strong style={monoNumeric}>{rate(tier.pricePerHour)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('catalog:machine.perDay')}>
                <Text style={monoNumeric}>{money(tier.pricePerDay)}</Text>
              </Descriptions.Item>
              {/* Labelled with the hours it is quoted over rather than implying
                  a calendar month — the platform bills by the hour and nothing
                  else. */}
              <Descriptions.Item label={t('catalog:machine.perMonthHours', { hours: hoursPerMonth })}>
                <Text style={monoNumeric}>{money(tier.pricePerMonth)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('catalog:machine.whilePausedPerHour')}>
                <Text style={monoNumeric}>{rate(tier.stoppedPricePerHour)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('catalog:machine.whilePausedPerMonthHours', { hours: hoursPerMonth })}>
                <Text style={monoNumeric}>{money(tier.stoppedPricePerMonth)}</Text>
              </Descriptions.Item>
            </Descriptions>

            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12, lineHeight: 1.6 }}>
              Pausing a deployment releases the compute but keeps its disk, so the paused
              rate keeps running until you terminate it. Daily and monthly figures are the
              hourly rate multiplied out — nothing is billed in advance.
            </Text>
          </Card>
        </Col>

        {/* ── Specification ── */}
        <Col xs={24} lg={12}>
          <Card title={t('catalog:machine.specification')} style={{ ...card, height: '100%' }} styles={{ body: { padding: 20 } }}>
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label={t('catalog:machines.columnAccelerator')}>
                {tier.gpuCount > 0
                  ? `${tier.gpuCount}× ${tier.gpuModel || 'accelerator'}`
                  : 'None — CPU machine'}
              </Descriptions.Item>
              {tier.gpuCount > 0 && (
                <Descriptions.Item label={t('catalog:machines.columnGpuMemory')}>
                  <Space direction="vertical" size={0}>
                    <Text style={monoNumeric}>{t('catalog:machine.gbTotal', { size: tier.totalVramGb })}</Text>
                    <Text type="secondary" style={{ fontSize: 12, ...monoNumeric }}>
                      {t('catalog:machine.gbPerAccelerator', { size: tier.vramGb })}
                    </Text>
                  </Space>
                </Descriptions.Item>
              )}
              <Descriptions.Item label={t('catalog:machine.vcpuSuffix')}>
                <Text style={monoNumeric}>{tier.vcpu || '—'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="RAM">
                <Text style={monoNumeric}>{tier.ramGb ? `${tier.ramGb} GB` : '—'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('catalog:machine.storage')}>
                <Text style={monoNumeric}>
                  {tier.storageGb ? `${tier.storageGb} GB ${tier.storageType || ''}`.trim() : '—'}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('catalog:machine.network')}>
                <Text style={monoNumeric}>{tier.networkGbps ? `${tier.networkGbps} Gbps` : '—'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('catalog:machine.regions')}>
                {(tier.regions || []).length
                  ? <Space size={4} wrap>{tier.regions.map((r) => <Tag key={r}>{r}</Tag>)}</Space>
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label={t('catalog:machines.columnAvailability')}>
                <Space size={8}>
                  <StatusBadge
                    tone={STOCK_TONE[tier.status] || 'neutral'}
                    label={t(STOCK_LABEL_KEY[tier.status]) || tier.status}
                    size="small"
                  />
                  <Text type="secondary" style={{ fontSize: 12.5 }}>
                    {tier.availableUnits === null || tier.availableUnits === undefined
                      ? t('catalog:machines.stockNotTracked')
                      : t('catalog:machines.unitsAvailable', { count: tier.availableUnits })}
                  </Text>
                </Space>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {/* ── Which models run here ── */}
      <Card
        title={t('catalog:machine.modelsThatRun')}
        extra={tier.modelCount > 0 && (
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {t('catalog:machine.modelCount', { count: tier.modelCount })}
          </Text>
        )}
        style={card}
        styles={{ body: { padding: 0 } }}
      >
        <Table
          className="ledger-table"
          rowClassName="row-hover"
          columns={modelColumns}
          dataSource={tier.models || []}
          rowKey="id"
          pagination={false}
          scroll={{ x: 700 }}
          locale={{
            emptyText: (
              <Empty
                description={t('catalog:machine.noModels')}
                style={{ padding: 40 }}
              />
            ),
          }}
        />
      </Card>
    </>
  );
};

export default MachineDetailPage;
