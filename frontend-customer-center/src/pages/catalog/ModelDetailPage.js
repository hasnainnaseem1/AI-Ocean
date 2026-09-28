import React, { useEffect, useState } from 'react';
import {
  Row, Col, Card, Typography, Tag, Descriptions, Button, Space,
  Table, Result,
} from 'antd';
import { ArrowLeftOutlined, RocketOutlined, LinkOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { DetailSkeleton } from '../../components/Skeletons';
import catalogApi from '../../api/catalogApi';
import { useTheme } from '../../context/ThemeContext';
import { useBilling } from '../../context/SiteContext';
import { useTeam } from '../../context/TeamContext';
import { formatRate } from '../../utils/money';
import { tierSpecLine } from '../deploy/journeyParts';
import { cardStyle as surfaceStyle, monoNumeric, ltrTechnical, TILE } from '../../theme/colors';
import { formatNumber, EMPTY } from '../../utils/format';
import { useTranslation } from 'react-i18next';

const { Title, Paragraph } = Typography;

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

const ModelDetailPage = () => {
  const { t } = useTranslation(['catalog', 'common']);
  // Only roles that may deploy in this account get a working Deploy button.
  const canDeploy = useTeam().can('deployments.create');
  const { slug } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const { currency } = useBilling();

  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    catalogApi
      .getModel(slug)
      .then((data) => {
        if (cancelled) return;
        setModel(data.model);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.message || t('catalog:model.loadFailed'));
      })
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
    // `t` changes identity with the language, so a switch refreshes rather
    // than leaving a message stranded in the previous one.
  }, [slug, t]);

  const card = surfaceStyle(isDark);

  if (loading) {
    return <DetailSkeleton />;
  }

  if (error || !model) {
    return (
        <Result
          status="404"
          title={t('catalog:model.notFound')}
          subTitle={error || t('catalog:model.removed')}
          extra={<Button type="primary" onClick={() => navigate('/models')}>{t('catalog:model.back')}</Button>}
        />
    );
  }

  const unavailable = model.status === 'coming_soon' || model.tiers.length === 0;

  return (
    <>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/models')}
        style={{ marginBottom: 16, paddingInlineStart: 0 }}
      >
        {t('catalog:model.back')}
      </Button>

      {/* Header */}
      <Card style={{ ...card, marginBottom: 20 }} styles={{ body: { padding: '24px 28px' } }}>
        <Row align="middle" gutter={[24, 16]}>
          <Col xs={24} md={16}>
            <Space size={8} wrap style={{ marginBottom: 10 }}>
              <span style={{
                fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: TILE.blue.fg(isDark), background: TILE.blue.bg(isDark),
                padding: '4px 9px', borderRadius: 6,
              }}>
                {model.family}
              </span>
              {(model.modalities || []).map((m) => (
                <Tag key={m} style={{ marginInlineEnd: 0 }}>{t(MODALITY_LABEL_KEY[m]) || m}</Tag>
              ))}
            </Space>
            <Title level={2} style={{ margin: 0 }}>{model.name}</Title>
            <Paragraph dir="auto" type="secondary" style={{ marginTop: 8, marginBottom: 0, maxWidth: 640 }}>
              {model.shortDescription}
            </Paragraph>
          </Col>
          <Col xs={24} md={8} style={{ textAlign: 'end' }}>
            <Button
              type="primary"
              size="large"
              icon={<RocketOutlined />}
              disabled={unavailable || !canDeploy}
              onClick={() => navigate(`/deploy/${model.slug}`)}
              style={{ fontWeight: 600 }}
            >
              {unavailable ? t('catalog:model.notAvailableYet') : t('catalog:model.deployThis')}
            </Button>
          </Col>
        </Row>
      </Card>

      <Row gutter={[24, 24]}>
        <Col xs={24} lg={15}>
          <Card title={t('catalog:model.about')} style={card} styles={{ body: { padding: 24 } }}>
            <Paragraph dir="auto" style={{ whiteSpace: 'pre-line' }}>{model.description}</Paragraph>
            {model.docsUrl && (
              <Button type="link" icon={<LinkOutlined />} href={model.docsUrl} target="_blank" rel="noopener noreferrer" style={{ paddingInlineStart: 0 }}>
                {t('catalog:model.documentation')}
              </Button>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={9}>
          <Card title={t('catalog:model.specifications')} style={card} styles={{ body: { padding: 24 } }}>
            <Descriptions column={1} size="small" colon={false}>
              <Descriptions.Item label={t('catalog:model.parameters')}>{model.parameterSize || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('catalog:model.contextLength')}>
                {model.contextLength ? t('catalog:model.tokens', { count: model.contextLength, formatted: formatNumber(model.contextLength) }) : EMPTY}
              </Descriptions.Item>
              <Descriptions.Item label={t('catalog:model.minimumVram')}>
                <span style={ltrTechnical}>{model.minVramGb ? `${model.minVramGb} GB` : '—'}</span>
              </Descriptions.Item>
              <Descriptions.Item label={t('catalog:model.license')}>{model.license || '—'}</Descriptions.Item>
              <Descriptions.Item label={t('catalog:model.modelId')}>{model.huggingFaceId || '—'}</Descriptions.Item>
            </Descriptions>
            {(model.tags || []).length > 0 && (
              <Space size={[6, 6]} wrap style={{ marginTop: 12 }}>
                {model.tags.map((t) => <Tag key={t} style={{ marginInlineEnd: 0 }}>{t}</Tag>)}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      {/*
        * The other half of the catalogue.
        *
        * This page has always received the full list of machines a model runs
        * on and used it for exactly one thing — a length check to decide
        * whether the Deploy button was enabled. The customer could not see
        * what their model would actually run on, or what it would cost,
        * without starting the deploy wizard. The data was already here.
        */}
      {(model.tiers || []).length > 0 && (
        <Card
          title={t('catalog:model.runsOn')}
          extra={(
            <Button type="link" style={{ padding: 0 }} onClick={() => navigate('/machines')}>
              {t('catalog:model.allMachineTypes')}
            </Button>
          )}
          style={{ ...card, marginTop: 20 }}
          styles={{ body: { padding: 0 } }}
        >
          <Table
            className="ledger-table"
            rowClassName="row-hover"
            // A machine's slug is nullable; buildTierOptions calls the id
            // `tierId`, not `id`.
            rowKey={(tier) => tier.tierId}
            onRow={(tier) => ({
              style: { cursor: 'pointer' },
              onClick: () => navigate(`/machines/${tier.slug || tier.tierId}`),
            })}
            pagination={false}
            scroll={{ x: 620 }}
            dataSource={model.tiers}
            columns={[
              {
                title: t('catalog:machines.columnMachine'),
                dataIndex: 'name',
                render: (name, tier) => (
                  <Space direction="vertical" size={2}>
                    <Space size={8} align="center" wrap>
                      <Button
                        type="link"
                        style={{ padding: 0, height: 'auto', fontWeight: 600 }}
                        onClick={(e) => { e.stopPropagation(); navigate(`/machines/${tier.slug || tier.tierId}`); }}
                      >
                        {name}
                      </Button>
                      {tier.recommended && <Tag color="green">{t('catalog:model.adminPick')}</Tag>}
                      {tier.underpowered && <Tag color="orange">{t('catalog:model.undersized')}</Tag>}
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12, ...ltrTechnical }}>
                      {tierSpecLine(tier, 'short')}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: t('catalog:machines.columnPerHour'),
                dataIndex: 'pricePerHour',
                width: 150,
                align: 'right',
                defaultSortOrder: 'ascend',
                sorter: (a, b) => a.pricePerHour - b.pricePerHour,
                render: (v) => (
                  <Typography.Text strong style={monoNumeric}>
                    {currency} {formatRate(v)}
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>{t('common:units.perHour')}</Typography.Text>
                  </Typography.Text>
                ),
              },
              {
                title: '',
                key: 'deploy',
                width: 130,
                align: 'right',
                // Named `tier`, not `t`: as `t` it shadowed the translator, so
                // the `t(...)` call below invoked the row object and the whole
                // page died with "t is not a function" — a blank screen, not a
                // missing label.
                render: (_, tier) => (
                  <Button
                    type="primary"
                    size="small"
                    icon={<RocketOutlined />}
                    disabled={unavailable || !canDeploy}
                    // The machine is known on this row too, so carry it —
                    // same as the machine catalogue. `tier.tierId` here, because
                    // these rows come from buildTierOptions rather than the
                    // catalogue's tier serializer.
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/deploy/${model.slug}?machine=${encodeURIComponent(tier.slug || tier.tierId)}`);
                    }}
                  >
                    {t('catalog:models.deploy')}
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}
    </>
  );
};

export default ModelDetailPage;
