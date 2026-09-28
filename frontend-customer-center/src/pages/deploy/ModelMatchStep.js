import React from 'react';
import { Card, Typography, Space, Tag, Row, Col, Empty } from 'antd';
import { CheckCircleFilled, WarningFilled, TrophyFilled } from '@ant-design/icons';
import { useTheme } from '../../context/ThemeContext';
import {
  cardStyle as surfaceStyle, getBrand, brandSoft, monoNumeric,
  STATUS_COLORS, SURFACE,
} from '../../theme/colors';
import { StepHeading, findSharedBlocker, BlockerNotice } from './journeyParts';
import { formatRate } from '../../utils/money';
import { formatNumber } from '../../utils/format';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

const VERDICT_TONE = {
  good: 'success',
  caution: 'warning',
  poor: 'error',
};

/**
 * One candidate model, with the reasons it ranked where it did.
 *
 * Models that scored badly are still shown rather than hidden — the customer
 * asked what their options are, and quietly dropping the ones we dislike would
 * make the list look shorter than the catalogue actually is.
 */
export const MatchCard = ({ match, rank, selected, currency, onChoose, isDark }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const BRAND = getBrand(isDark);
  const { model, verdict, matchReasons, recommendedTier, estimatedMonthlyCost, score } = match;

  const tone = STATUS_COLORS[VERDICT_TONE[verdict]] || STATUS_COLORS.neutral;
  const toneColor = tone[isDark ? 'dark' : 'light'];
  const best = rank === 0;

  return (
    <Card
      hoverable
      className="card-hover journey-option"
      onClick={onChoose}
      style={{
        ...surfaceStyle(isDark, best),
        // Complete shorthand rather than patching colour/width over the one
        // surfaceStyle already set — mixing the two makes React warn.
        ...(selected || best
          ? { border: `1.5px solid ${BRAND}` }
          : {}),
        background: selected ? brandSoft(isDark) : undefined,
        height: '100%',
        animationDelay: `${rank * 60}ms`,
      }}
      styles={{ body: { padding: 22, display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}>
          {best && (
            <Space size={6} style={{ marginBottom: 6 }}>
              <TrophyFilled style={{ color: BRAND, fontSize: 12 }} />
              <Text style={{
                fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: BRAND,
              }}>
                {t('deploy:match.bestMatch')}
              </Text>
            </Space>
          )}
          <Title level={4} style={{ margin: 0 }} ellipsis={{ tooltip: model.name }}>
            {model.name}
          </Title>
          <Text type="secondary" style={{ fontSize: 12, ...monoNumeric }}>
            {model.parameterSize}
            {model.contextLength > 0 && ` · ${(model.contextLength / 1000).toFixed(0)}K context`}
          </Text>
        </div>

        <div style={{
          flexShrink: 0, textAlign: 'center',
          padding: '4px 10px', borderRadius: 9,
          background: tone.bg(isDark),
        }}>
          <Text strong style={{ fontSize: 15, color: toneColor, ...monoNumeric }}>{score}</Text>
          <Text style={{ fontSize: 9, display: 'block', color: toneColor, fontWeight: 700, letterSpacing: '0.05em' }}>
            MATCH
          </Text>
        </div>
      </div>

      <Text dir="auto" type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 14 }}>
        {model.shortDescription}
      </Text>

      {/* Why it ranked here */}
      <Space direction="vertical" size={7} style={{ width: '100%', marginBottom: 14 }}>
        {(matchReasons || []).map((reason, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <CheckCircleFilled style={{
              color: STATUS_COLORS.success[isDark ? 'dark' : 'light'],
              fontSize: 12, marginTop: 3, flexShrink: 0,
            }} />
            <Text style={{ fontSize: 12.5 }}>{reason.text}</Text>
          </div>
        ))}

        {/* Honest about the downsides too, not just the sales pitch */}
        {(match.issues || []).slice(0, 2).map((issue, i) => (
          <div key={`i${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <WarningFilled style={{
              color: STATUS_COLORS.warning[isDark ? 'dark' : 'light'],
              fontSize: 12, marginTop: 3, flexShrink: 0,
            }} />
            <Text type="secondary" style={{ fontSize: 12.5 }}>{issue.message}</Text>
          </div>
        ))}
      </Space>

      <div style={{
        marginTop: 'auto', paddingTop: 14,
        borderTop: `1px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
      }}>
        {recommendedTier ? (
          <Row align="bottom" justify="space-between" gutter={8}>
            <Col style={{ minWidth: 0 }}>
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>on {recommendedTier.name}</Text>
              <Text strong style={{ fontSize: 19, color: BRAND, fontWeight: 800, ...monoNumeric }}>
                {currency} {formatRate(recommendedTier.pricePerHour)}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{t('common:units.perHour')}</Text>
            </Col>
            <Col>
              {estimatedMonthlyCost !== null && (
                <Text type="secondary" style={{ fontSize: 11.5, ...monoNumeric }}>
                  ~{currency} {formatNumber(Math.round(estimatedMonthlyCost))}{t('common:units.perMonth')}
                </Text>
              )}
            </Col>
          </Row>
        ) : (
          <Tag color="red">{t('deploy:recommendation.noHardwareShort')}</Tag>
        )}
      </div>
    </Card>
  );
};

const ModelMatchStep = ({
  step, matches, currency, chosenModelId, onChooseModel, onEditAnswer,
  blockerTemplates, eyebrow,
}) => {
  const { t } = useTranslation(['deploy', 'common']);
  const { isDark } = useTheme();

  if (!matches || !matches.length) {
    return (
      <div>
        <StepHeading eyebrow={eyebrow} title={step.title || t('deploy:match.noModels')} />
        <Empty description={t('deploy:match.noModelsBody')} />
      </div>
    );
  }

  // Same check the recommendation screen runs, from the same module: if one
  // hard constraint rules out every candidate, say so before the customer
  // works through four cards that all fail the same way.
  const blocker = findSharedBlocker(matches);

  return (
    <div>
      <StepHeading
        eyebrow={eyebrow}
        title={step.title || t('deploy:match.title')}
        subtitle={step.subtitle || t('deploy:match.subtitle')}
      />

      {blocker && (
        <BlockerNotice
          blocker={blocker}
          matches={matches}
          currency={currency}
          templates={blockerTemplates}
          onEditAnswer={onEditAnswer}
        />
      )}

      <Row gutter={[16, 16]} align="stretch">
        {matches.map((match, rank) => (
          <Col xs={24} md={12} key={match.model.id}>
            <MatchCard
              match={match}
              rank={rank}
              selected={String(chosenModelId) === String(match.model.id)}
              currency={currency}
              onChoose={() => onChooseModel(match.model)}
              isDark={isDark}
            />
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default ModelMatchStep;
