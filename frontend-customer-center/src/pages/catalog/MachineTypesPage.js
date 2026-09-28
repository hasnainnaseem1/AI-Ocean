import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Row, Col, Card, Table, Typography, Input, Select, Empty,
  Button, Alert, Segmented, Tooltip,
} from 'antd';
import {
  SearchOutlined, ArrowRightOutlined, AppstoreOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CardGridSkeleton, TableRowsSkeleton } from '../../components/Skeletons';
import StatusBadge from '../../components/StatusBadge';
import catalogApi from '../../api/catalogApi';
import { useTheme } from '../../context/ThemeContext';
import { useBilling } from '../../context/SiteContext';
import { formatRate, formatAmount } from '../../utils/money';
import { tierSpecLine } from '../deploy/journeyParts';
import { cardStyle as surfaceStyle, getBrand, monoNumeric, TILE, ltrTechnical } from '../../theme/colors';
import { useTranslation } from 'react-i18next';

const { Title, Text, Paragraph } = Typography;

/**
 * The machine catalogue.
 *
 * Until this page existed a customer could only see hardware from inside the
 * deploy wizard, one model at a time — after they had already committed to a
 * model. There was no answer to "what do you actually have, and what does it
 * cost". The data was all being served already: the endpoint behind this page
 * existed, and nothing called it.
 *
 * Table first, cards second. Specs are read across a row far more easily than
 * across a grid, and comparing machines is the entire point of the page; the
 * card view is for browsing rather than choosing.
 */

// Category slugs get a consistent pastel tone so a shelf reads as a shelf.
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

// Its own key: this page defaults to the table, the model catalogue defaults to
// its grid, and one preference must not silently set the other.
const VIEW_STORAGE_KEY = 'aio_machines_view';

/** Remembered per browser — a browsing preference, not account state. */
const readStoredView = () => {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === 'cards' || stored === 'table' ? stored : 'table';
  } catch {
    return 'table';
  }
};

/** Keys, not labels — translated where the Select is built. */
const SORTS = [
  { value: 'price', labelKey: 'catalog:machines.sortPriceAsc' },
  { value: 'price_desc', labelKey: 'catalog:machines.sortPriceDesc' },
  { value: 'vram', labelKey: 'catalog:machines.sortVramDesc' },
  { value: 'name', labelKey: 'catalog:machines.sortName' },
];

const MachineTypesPage = () => {
  const { t } = useTranslation(['catalog', 'common']);
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { currency } = useBilling();
  const BRAND = getBrand(isDark);
  const [searchParams] = useSearchParams();
  const [view, setView] = useState(readStoredView);

  const changeView = useCallback((next) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* Private browsing — the toggle still works for this session. */
    }
    // `t` changes identity with the language, so a switch refreshes rather
    // than leaving a message stranded in the previous one.
  }, []);

  const [tiers, setTiers] = useState([]);
  const [hoursPerMonth, setHoursPerMonth] = useState(730);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Seeded from ?q= so a link like /machines?q=a100 lands with a term applied
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [category, setCategory] = useState();
  const [accelerator, setAccelerator] = useState();
  const [runsModel, setRunsModel] = useState();
  const [sort, setSort] = useState('price');

  useEffect(() => {
    setSearch(searchParams.get('q') || '');
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    catalogApi
      .getTiers()
      .then((data) => {
        if (cancelled) return;
        setTiers(data.tiers || []);
        if (data.hoursPerMonth) setHoursPerMonth(data.hoursPerMonth);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.message || t('catalog:machines.loadFailed'));
      })
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
  }, [t]);

  const openMachine = useCallback((tier) => {
    // `slug` is nullable on a machine, so the id is the fallback — the endpoint
    // accepts either.
    navigate(`/machines/${tier.slug || tier.id}`);
  }, [navigate]);

  // Filtering is client-side so typing feels instant on a catalogue this size
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = tiers.filter((t) => {
      if (category && t.category?.slug !== category) return false;
      if (accelerator === 'gpu' && !(t.gpuCount > 0)) return false;
      if (accelerator === 'cpu' && t.gpuCount > 0) return false;
      if (runsModel && !(t.models || []).some((m) => m.slug === runsModel)) return false;
      if (!term) return true;
      return (
        t.name.toLowerCase().includes(term) ||
        (t.description || '').toLowerCase().includes(term) ||
        (t.gpuModel || '').toLowerCase().includes(term) ||
        (t.category?.name || '').toLowerCase().includes(term)
      );
    });

    // The table sorts from its own column headers; this drives the card view,
    // and gives the table its initial order.
    const sorted = [...rows];
    if (sort === 'price') sorted.sort((a, b) => a.pricePerHour - b.pricePerHour);
    if (sort === 'price_desc') sorted.sort((a, b) => b.pricePerHour - a.pricePerHour);
    if (sort === 'vram') sorted.sort((a, b) => (b.totalVramGb || 0) - (a.totalVramGb || 0));
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [tiers, search, category, accelerator, runsModel, sort]);

  const categories = useMemo(() => {
    const seen = new Map();
    tiers.forEach((t) => t.category && seen.set(t.category.slug, t.category.name));
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [tiers]);

  const modelOptions = useMemo(() => {
    const seen = new Map();
    tiers.forEach((t) => (t.models || []).forEach((m) => seen.set(m.slug, m.name)));
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tiers]);

  const cardStyle = {
    ...surfaceStyle(isDark),
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  };

  // `tier`, not `t` — the old parameter name shadowed the translator, which
  // this function now needs.
  const stockBadge = (tier) => {
    const units = tier.availableUnits;
    const label = STOCK_LABEL_KEY[tier.status] ? t(STOCK_LABEL_KEY[tier.status]) : tier.status;
    return (
      <Tooltip title={units === null
        ? t('catalog:machines.stockNotTracked')
        : t('catalog:machines.unitsAvailable', { count: units })}
      >
        <span>
          <StatusBadge tone={STOCK_TONE[tier.status] || 'neutral'} label={label} size="small" />
        </span>
      </Tooltip>
    );
  };

  const categoryPill = (t) => (t.category ? (
    <span style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
      padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap',
      background: TILE[toneFor(t.category.slug)].bg(isDark),
      color: TILE[toneFor(t.category.slug)].fg(isDark),
    }}>
      {t.category.name}
    </span>
  ) : null);

  const numeric = (value, suffix = '') => (
    value ? <Text style={monoNumeric}>{value}{suffix}</Text> : <Text type="secondary">—</Text>
  );

  /**
   * Deliberately short.
   *
   * Every spec this platform holds fitted here once, and the table needed
   * horizontal scrolling to show it — which meant the price sat off-screen
   * until you dragged for it, on a page whose whole job is comparing prices.
   * Storage, network, the monthly figure and the paused rate all live on the
   * detail page, one click away, and the View button is there to make that
   * click obvious.
   *
   * What survives is what someone actually scans a machine list for: what the
   * accelerator is, how much memory it has, how many models run on it, what it
   * costs an hour, and whether it can be ordered at all.
   */
  const columns = [
    {
      title: t('catalog:machines.columnMachine'),
      dataIndex: 'name',
      width: 290,
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name, row) => (
        /*
         * Plain divs with explicit overflow rather than antd's <Space> +
         * <Text ellipsis>: Space does not constrain its children's width, so
         * under a fixed table layout the description simply drew over the
         * neighbouring column instead of truncating.
         */
        <div style={{ minWidth: 0 }}>
          {/* The name yields before the pill does, and the row clips either
              way — a long category name used to draw straight over the next
              column. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, overflow: 'hidden' }}>
            <Text
              strong
              ellipsis={{ tooltip: name }}
              style={{ fontSize: 14, flex: '0 1 auto', minWidth: 0 }}
            >
              {name}
            </Text>
            <span dir="auto" style={{ flexShrink: 0, display: 'inline-flex' }}>{categoryPill(row)}</span>
          </div>
          {row.description && (
            <Tooltip title={row.description}>
              <div dir="auto" style={{
                fontSize: 12, marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
              }}>
                {row.description}
              </div>
            </Tooltip>
          )}
        </div>
      ),
    },
    {
      title: t('catalog:machines.columnAccelerator'),
      key: 'gpu',
      width: 165,
      render: (_, tier) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tier.gpuCount > 0
              ? `${tier.gpuCount}× ${tier.gpuModel || 'GPU'}`
              : <Text type="secondary" style={{ fontSize: 13 }}>{t('catalog:machines.cpuOnly')}</Text>}
          </div>
          <Text type="secondary" style={{ fontSize: 11.5, whiteSpace: 'nowrap', ...monoNumeric }}>
            {tier.vcpu} vCPU · {tier.ramGb} GB RAM
          </Text>
        </div>
      ),
    },
    {
      title: t('catalog:machines.columnGpuMemory'),
      dataIndex: 'totalVramGb',
      width: 110,
      align: 'right',
      sorter: (a, b) => (a.totalVramGb || 0) - (b.totalVramGb || 0),
      render: (v) => numeric(v, ' GB'),
    },
    {
      title: t('catalog:machines.columnModels'),
      dataIndex: 'modelCount',
      width: 95,
      align: 'right',
      sorter: (a, b) => a.modelCount - b.modelCount,
      render: (count, tier) => (count === 0
        ? <Text type="secondary">—</Text>
        : (
          <Tooltip title={(tier.models || []).map((m) => m.name).join(', ')}>
            <Text style={monoNumeric}>{count}</Text>
          </Tooltip>
        )),
    },
    {
      title: t('catalog:machines.columnPerHour'),
      dataIndex: 'pricePerHour',
      width: 130,
      align: 'right',
      defaultSortOrder: 'ascend',
      sorter: (a, b) => a.pricePerHour - b.pricePerHour,
      render: (v, tier) => (
        <Tooltip title={t('catalog:machines.ifLeftRunning', {
          amount: `${currency} ${formatAmount(tier.pricePerMonth)}`,
          hours: hoursPerMonth,
        })}
        >
          <Text strong style={{ color: BRAND, ...monoNumeric }}>{currency} {formatRate(v)}</Text>
        </Tooltip>
      ),
    },
    {
      title: t('catalog:machines.columnAvailability'),
      key: 'status',
      width: 130,
      render: (_, tier) => stockBadge(tier),
    },
    {
      title: '',
      key: 'view',
      width: 90,
      align: 'right',
      render: (_, tier) => (
        <Button size="small" icon={<ArrowRightOutlined />} onClick={() => openMachine(tier)}>
          {t('catalog:machines.view')}
        </Button>
      ),
    },
  ];

  const emptyText = tiers.length === 0
    ? t('catalog:machines.emptyAll')
    : t('catalog:machines.emptyFiltered');

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ marginBottom: 4 }}>{t('catalog:machines.title')}</Title>
        <Text type="secondary">
          {t('catalog:machines.subtitle')}
        </Text>
      </div>

      {error && (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 20, borderRadius: 12 }} />
      )}

      {/* Filters */}
      <Card style={{ ...cardStyle, height: 'auto', marginBottom: 24 }} styles={{ body: { padding: 16 } }}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={7}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder={t('catalog:machines.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder={t('catalog:machines.anyCategory')}
              value={category}
              onChange={setCategory}
              options={categories}
            />
          </Col>
          <Col xs={12} md={4}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder={t('catalog:machines.anyHardware')}
              value={accelerator}
              onChange={setAccelerator}
              options={[
                { value: 'gpu', label: t('catalog:machines.gpuMachines') },
                { value: 'cpu', label: t('catalog:machines.cpuOnly') },
              ]}
            />
          </Col>
          <Col xs={12} md={5}>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: '100%' }}
              placeholder={t('catalog:machines.runsAnyModel')}
              value={runsModel}
              onChange={setRunsModel}
              options={modelOptions}
            />
          </Col>
          <Col xs={12} md={4} style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {/* The table sorts from its headers; the cards need a control. */}
            {view === 'cards' && (
              <Select
                style={{ width: 150 }}
                value={sort}
                onChange={setSort}
                options={SORTS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
              />
            )}
            <Segmented
              value={view}
              onChange={changeView}
              options={[
                { value: 'table', icon: <Tooltip title={t('catalog:machines.tableView')}><UnorderedListOutlined /></Tooltip> },
                { value: 'cards', icon: <Tooltip title={t('catalog:machines.cardView')}><AppstoreOutlined /></Tooltip> },
              ]}
            />
          </Col>
        </Row>
      </Card>

      {loading ? (
        view === 'cards' ? <CardGridSkeleton count={6} /> : <TableRowsSkeleton rows={8} />
      ) : filtered.length === 0 ? (
        <Empty description={emptyText} style={{ padding: 60 }} />
      ) : view === 'table' ? (
        <Card style={{ ...cardStyle, height: 'auto' }} styles={{ body: { padding: 0 } }}>
          <Table
            className="ledger-table"
            rowClassName="row-hover"
            /*
             * Without this antd sizes columns to their content and ignores the
             * declared widths: the description in the Machine cell stretched
             * that column to ~550px and pushed Availability off the edge, which
             * is the horizontal scrolling this layout exists to remove. Fixed
             * layout honours the widths and lets the description truncate.
             */
            tableLayout="fixed"
            columns={columns}
            dataSource={filtered}
            rowKey="id"
            onRow={(row) => ({
              style: { cursor: 'pointer' },
              onClick: () => openMachine(row),
            })}
            pagination={filtered.length > 20 ? { pageSize: 20 } : false}
            scroll={{ x: 1010 }}
          />
        </Card>
      ) : (
        <Row gutter={[20, 20]}>
          {filtered.map((tier) => (
            <Col xs={24} sm={12} lg={8} key={tier.id}>
              <Card
                hoverable
                className="card-hover spec-card"
                style={cardStyle}
                styles={{ body: { padding: 22, display: 'flex', flexDirection: 'column', flex: 1 } }}
                onClick={() => openMachine(tier)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  {categoryPill(tier)}
                  {stockBadge(tier)}
                </div>

                <Title level={4} style={{ margin: 0, marginBottom: 6 }} ellipsis={{ tooltip: tier.name }}>
                  {tier.name}
                </Title>

                <Paragraph
                  type="secondary"
                  ellipsis={{ rows: 2 }}
                  style={{ fontSize: 13, marginBottom: 14, minHeight: 40 }}
                >
                  {tier.description || <span style={ltrTechnical}>{tierSpecLine(tier, 'short')}</span>}
                </Paragraph>

                {/* The spec strip — same wording the deploy journey uses, from
                    the one function that turns a machine into words. */}
                <div style={{
                  background: isDark ? 'rgba(255,255,255,0.03)' : '#F7F9FF',
                  borderRadius: 12, padding: '12px 14px', marginBottom: 14,
                }}>
                  <Text style={{ fontSize: 12.5, ...monoNumeric }}>{tierSpecLine(tier, 'full')}</Text>
                </div>

                <Text type="secondary" style={{ fontSize: 12.5, marginBottom: 14 }}>
                  {tier.modelCount === 0
                    ? t('catalog:machines.noModelsOffered')
                    : `Runs ${tier.modelCount} model${tier.modelCount === 1 ? '' : 's'}`}
                </Text>

                <div style={{
                  marginTop: 'auto', display: 'flex', alignItems: 'flex-end',
                  justifyContent: 'space-between', gap: 12,
                }}>
                  <div>
                    <Text strong style={{
                      fontSize: 24, color: BRAND, fontWeight: 800,
                      letterSpacing: '-0.03em', ...monoNumeric,
                    }}>
                      {currency} {formatRate(tier.pricePerHour)}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{t('common:units.perHour')}</Text>
                    <Text type="secondary" style={{ fontSize: 11.5, display: 'block' }}>
                      {t('catalog:machines.ifLeftRunning', { amount: `${currency} ${formatAmount(tier.pricePerMonth)}`, hours: hoursPerMonth })}
                    </Text>
                  </div>
                  <Button type="primary" icon={<ArrowRightOutlined />}>{t('catalog:machines.view')}</Button>
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </>
  );
};

export default MachineTypesPage;
