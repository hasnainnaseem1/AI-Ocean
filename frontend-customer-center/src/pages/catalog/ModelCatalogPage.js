import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Row, Col, Card, Typography, Tag, Input, Select, Empty,
  Button, Space, Alert, Segmented, Tooltip,
} from 'antd';
import {
  SearchOutlined, ArrowRightOutlined, StarFilled, DatabaseOutlined,
  AppstoreOutlined, UnorderedListOutlined, RocketOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CardGridSkeleton } from '../../components/Skeletons';
import catalogApi from '../../api/catalogApi';
import { useTheme } from '../../context/ThemeContext';
import { useBilling } from '../../context/SiteContext';
import { useTeam } from '../../context/TeamContext';
import { formatRate } from '../../utils/money';
import { cardStyle as surfaceStyle, getBrand, monoNumeric, TILE } from '../../theme/colors';
import { useTranslation } from 'react-i18next';

const { Title, Text, Paragraph } = Typography;

/**
 * Keys, not labels — a module-level constant has no `t` and could never follow
 * a language change. Call sites translate: `t(MODALITY_LABEL_KEY[m])`.
 */
const MODALITY_LABEL_KEY = {
  chat: 'catalog:modality.chat',
  completion: 'catalog:modality.completion',
  code: 'catalog:modality.code',
  vision: 'catalog:modality.vision',
  image_generation: 'catalog:modality.imageGeneration',
  embedding: 'catalog:modality.embeddings',
  audio: 'catalog:modality.audio',
};

// Each model family gets a consistent pastel tone so the catalog reads as a
// set of distinct products rather than a uniform grid.
const FAMILY_TONE = {
  kimi: 'pink',
  deepseek: 'blue',
  llama: 'purple',
  qwen: 'cyan',
  mistral: 'amber',
  gemma: 'green',
};

const VIEW_STORAGE_KEY = 'aio_catalog_view';

/** Remembered per browser — a browsing preference, not account state. */
const readStoredView = () => {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === 'list' || stored === 'grid' ? stored : 'grid';
  } catch {
    return 'grid';
  }
};

const ModelCatalogPage = () => {
  const { t } = useTranslation(['catalog', 'common']);
  // Only roles that may deploy in this account get a working Deploy button.
  const canDeploy = useTeam().can('deployments.create');
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

  /** Straight into the guided journey, skipping the detail page. */
  const startDeploy = useCallback((event, model) => {
    event.stopPropagation();
    navigate(`/deploy/${model.slug}`);
  }, [navigate]);

  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Seeded from ?q= so the header search box can land here with a term
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [family, setFamily] = useState();
  const [modality, setModality] = useState();

  useEffect(() => {
    setSearch(searchParams.get('q') || '');
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    catalogApi
      .getModels()
      .then((data) => {
        if (cancelled) return;
        setModels(data.models || []);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.message || t('catalog:models.loadFailed'));
      })
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
  }, [t]);

  // Filtering is client-side so typing feels instant on a catalog this size
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return models.filter((m) => {
      if (family && m.family !== family) return false;
      if (modality && !(m.modalities || []).includes(modality)) return false;
      if (!term) return true;
      return (
        m.name.toLowerCase().includes(term) ||
        (m.shortDescription || '').toLowerCase().includes(term) ||
        (m.tags || []).some((t) => t.toLowerCase().includes(term))
      );
    });
  }, [models, search, family, modality]);

  const families = useMemo(
    () => [...new Set(models.map((m) => m.family))].sort(),
    [models]
  );
  const modalities = useMemo(
    () => [...new Set(models.flatMap((m) => m.modalities || []))].sort(),
    [models]
  );

  const cardStyle = {
    ...surfaceStyle(isDark),
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  };

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ marginBottom: 4 }}>{t('catalog:models.title')}</Title>
        <Text type="secondary">
          {t('catalog:models.subtitle')}
        </Text>
      </div>

      {error && (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 20, borderRadius: 12 }} />
      )}

      {/* Filters */}
      <Card style={{ ...cardStyle, height: 'auto', marginBottom: 24 }} styles={{ body: { padding: 16 } }}>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={9}>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder={t('catalog:models.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Col>
          <Col xs={12} md={6}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder={t('catalog:models.anyFamily')}
              value={family}
              onChange={setFamily}
              options={families.map((f) => ({ value: f, label: f.charAt(0).toUpperCase() + f.slice(1) }))}
            />
          </Col>
          <Col xs={12} md={6}>
            <Select
              allowClear
              style={{ width: '100%' }}
              placeholder={t('catalog:models.anyCapability')}
              value={modality}
              onChange={setModality}
              options={modalities.map((m) => ({ value: m, label: t(MODALITY_LABEL_KEY[m]) || m }))}
            />
          </Col>
          <Col xs={24} md={3} style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Segmented
              value={view}
              onChange={changeView}
              options={[
                { value: 'grid', icon: <Tooltip title={t('catalog:models.gridView')}><AppstoreOutlined /></Tooltip> },
                { value: 'list', icon: <Tooltip title={t('catalog:models.listView')}><UnorderedListOutlined /></Tooltip> },
              ]}
            />
          </Col>
        </Row>
      </Card>

      {loading ? (
        <CardGridSkeleton count={6} />
      ) : filtered.length === 0 ? (
        <Empty
          description={models.length === 0 ? t('catalog:models.emptyAll') : t('catalog:models.emptyFiltered')}
          style={{ padding: 60 }}
        />
      ) : view === 'list' ? (
        /* List view — denser rows, better for comparing many models at once */
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {filtered.map((model) => {
            const familyTile = TILE[FAMILY_TONE[model.family]] || TILE.blue;
            const unavailable = model.status === 'coming_soon';

            return (
              <Card
                key={model.id}
                hoverable
                className="card-hover"
                style={{ ...surfaceStyle(isDark) }}
                styles={{ body: { padding: '16px 20px' } }}
                onClick={() => navigate(`/models/${model.slug}`)}
              >
                <Row gutter={[16, 12]} align="middle" wrap>
                  <Col flex="auto" style={{ minWidth: 0 }}>
                    <Space size={8} wrap style={{ marginBottom: 4 }}>
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                        color: familyTile.fg(isDark), background: familyTile.bg(isDark),
                        padding: '3px 8px', borderRadius: 6,
                      }}>
                        {model.family}
                      </span>
                      <Text strong style={{ fontSize: 16 }}>{model.name}</Text>
                      {model.isFeatured && <StarFilled style={{ color: BRAND, fontSize: 14 }} />}
                      {model.status === 'beta' && <Tag color="gold" style={{ marginInlineEnd: 0 }}>{t('catalog:models.beta')}</Tag>}
                      {unavailable && <Tag style={{ marginInlineEnd: 0 }}>{t('catalog:models.comingSoon')}</Tag>}
                    </Space>
                    <Paragraph dir="auto"
                      type="secondary"
                      ellipsis={{ rows: 1 }}
                      style={{ margin: 0, fontSize: 13 }}
                    >
                      {model.shortDescription}
                    </Paragraph>
                  </Col>

                  <Col xs={24} sm={8} md={6}>
                    <Space size={16}>
                      {model.parameterSize && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 10, display: 'block', letterSpacing: '0.06em', fontWeight: 700 }}>
                            {t('catalog:models.params')}
                          </Text>
                          <Text strong style={{ fontSize: 13, ...monoNumeric }}>{model.parameterSize}</Text>
                        </div>
                      )}
                      {model.contextLength > 0 && (
                        <div>
                          <Text type="secondary" style={{ fontSize: 10, display: 'block', letterSpacing: '0.06em', fontWeight: 700 }}>
                            {t('catalog:models.context')}
                          </Text>
                          <Text strong style={{ fontSize: 13, ...monoNumeric }}>
                            {(model.contextLength / 1000).toFixed(0)}K
                          </Text>
                        </div>
                      )}
                    </Space>
                  </Col>

                  <Col xs={24} sm="auto">
                    <Space size={16} align="center">
                      <div style={{ textAlign: 'end' }}>
                        <Text strong style={{ fontSize: 18, color: BRAND, fontWeight: 800, ...monoNumeric }}>
                          {model.startingPricePerHour !== null
                            ? `${currency} ${formatRate(model.startingPricePerHour)}`
                            : '—'}
                        </Text>
                        <Text type="secondary" style={{ fontSize: 11 }}>{t('common:units.perHour')}</Text>
                      </div>
                      <Button
                        type="primary"
                        icon={<RocketOutlined />}
                        disabled={unavailable || !canDeploy}
                        onClick={(e) => startDeploy(e, model)}
                        style={{ borderRadius: 10, fontWeight: 600 }}
                      >
                        {t('catalog:models.deploy')}
                      </Button>
                    </Space>
                  </Col>
                </Row>
              </Card>
            );
          })}
        </Space>
      ) : (
        <Row gutter={[20, 20]}>
          {filtered.map((model) => {
            const familyTile = TILE[FAMILY_TONE[model.family]] || TILE.blue;
            return (
            <Col xs={24} sm={12} lg={8} key={model.id}>
              <Card
                hoverable
                className="card-hover spec-card"
                style={cardStyle}
                styles={{ body: { padding: 22, display: 'flex', flexDirection: 'column', flex: 1 } }}
                onClick={() => navigate(`/models/${model.slug}`)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <Space size={6} wrap style={{ marginBottom: 8 }}>
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                        color: familyTile.fg(isDark), background: familyTile.bg(isDark),
                        padding: '4px 9px', borderRadius: 6,
                      }}>
                        {model.family}
                      </span>
                      {model.status === 'beta' && <Tag color="gold" style={{ marginInlineEnd: 0 }}>{t('catalog:models.beta')}</Tag>}
                      {model.status === 'coming_soon' && <Tag style={{ marginInlineEnd: 0 }}>{t('catalog:models.comingSoon')}</Tag>}
                    </Space>
                    <Title level={4} style={{ margin: 0 }} ellipsis={{ tooltip: model.name }}>
                      {model.name}
                    </Title>
                  </div>
                  {model.isFeatured && <StarFilled style={{ color: BRAND, fontSize: 18 }} />}
                </div>

                <Paragraph dir="auto"
                  type="secondary"
                  ellipsis={{ rows: 2 }}
                  style={{ marginTop: 10, marginBottom: 12, minHeight: 44 }}
                >
                  {model.shortDescription}
                </Paragraph>

                <Space size={[6, 6]} wrap style={{ marginBottom: 14 }}>
                  {(model.modalities || []).map((m) => (
                    <Tag key={m} style={{ marginInlineEnd: 0 }}>{t(MODALITY_LABEL_KEY[m]) || m}</Tag>
                  ))}
                </Space>

                {/* Spec strip — the model's hard numbers, set apart from the prose */}
                <div style={{
                  display: 'flex', gap: 20, marginBottom: 18, padding: '12px 14px',
                  borderRadius: 10,
                  background: isDark ? 'rgba(255,255,255,0.03)' : '#F7F9FF',
                }}>
                  {model.parameterSize && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 10, display: 'block', letterSpacing: '0.06em', fontWeight: 700 }}>
                        <DatabaseOutlined /> {t('catalog:models.params')}
                      </Text>
                      <Text strong style={{ fontSize: 13, ...monoNumeric }}>{model.parameterSize}</Text>
                    </div>
                  )}
                  {model.contextLength > 0 && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 10, display: 'block', letterSpacing: '0.06em', fontWeight: 700 }}>
                        {t('catalog:models.context')}
                      </Text>
                      <Text strong style={{ fontSize: 13, ...monoNumeric }}>{(model.contextLength / 1000).toFixed(0)}K</Text>
                    </div>
                  )}
                </div>

                {/* Price + CTA pinned to the bottom so cards line up */}
                <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <div>
                    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{t('catalog:models.priceFrom')}</Text>
                    <Text strong style={{ fontSize: 24, color: BRAND, fontWeight: 800, letterSpacing: '-0.03em', ...monoNumeric }}>
                      {model.startingPricePerHour !== null
                        ? `${currency} ${formatRate(model.startingPricePerHour)}`
                        : '—'}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{t('common:units.perHour')}</Text>
                  </div>
                  <Button
                    type="primary"
                    icon={<ArrowRightOutlined />}
                    disabled={model.status === 'coming_soon' || !canDeploy}
                    onClick={(e) => startDeploy(e, model)}
                    style={{ borderRadius: 10, fontWeight: 600 }}
                  >
                    {t('catalog:models.deploy')}
                  </Button>
                </div>
              </Card>
            </Col>
            );
          })}
        </Row>
      )}
    </>
  );
};

export default ModelCatalogPage;
