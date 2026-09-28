import React, { useState } from 'react';
import {
  Card, Typography, Space, Button, Row, Col, Tag, Collapse,
} from 'antd';
import {
  CheckCircleFilled, WarningFilled, ThunderboltOutlined,
  ArrowDownOutlined, ArrowUpOutlined, InfoCircleOutlined, SlidersOutlined,
} from '@ant-design/icons';
import { useTheme } from '../../context/ThemeContext';
import { useBilling } from '../../context/SiteContext';
import {
  cardStyle as surfaceStyle, getBrand, brandSoft, monoNumeric,
  STATUS_COLORS, SURFACE,
} from '../../theme/colors';
import {
  StepHeading, ThinkingDots, findSharedBlocker, BlockerNotice, tierSpecLine,
} from './journeyParts';
import { MatchCard } from './ModelMatchStep';
import CustomMachineModal from './CustomMachineModal';
import { formatRate, formatAmount } from '../../utils/money';
import { formatNumber } from '../../utils/format';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

/* ── The chosen hardware, stated plainly and at size ─────────────────────── */

/**
 * How far the customer's current wallet balance actually goes at this tier's
 * rate — deliberately separate from the budget question asked earlier in the
 * journey. Budget is what they said they could spend monthly; this is what
 * they have on hand right now. Purely informational: the real go/no-go and
 * the choice of how to pay both happen in the checkout modal, which re-checks
 * live rather than trusting this snapshot.
 */
const AffordabilityLine = ({ tier, wallet, currency, isDark }) => {
  const { t } = useTranslation(['deploy', 'common']);
  if (!wallet) return null;
  const balance = wallet.balance || 0;
  const hours = tier.pricePerHour > 0 ? balance / tier.pricePerHour : null;

  return (
    <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginTop: 6, ...monoNumeric }}>
      {balance <= 0
        ? t('deploy:recommendation.walletEmpty')
        : hours !== null && hours < 1
          ? t('deploy:recommendation.walletUnderAnHour', { balance: `${currency} ${formatAmount(balance)}` })
          : t('deploy:recommendation.walletCoversHours', { balance: `${currency} ${formatAmount(balance)}`, count: Math.floor(hours) })}
    </Text>
  );
};

const HeroTier = ({ tier, currency, isDark, wallet, creditsEnabled, custom }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const BRAND = getBrand(isDark);

  return (
    <Card
      style={{
        ...surfaceStyle(isDark, true),
        // Full shorthand — surfaceStyle already sets `border`, and layering
        // borderColor/borderWidth on top of it makes React warn about mixing
        // shorthand and longhand for the same property.
        border: `1.5px solid ${BRAND}`,
        background: brandSoft(isDark),
      }}
      styles={{ body: { padding: '26px 28px' } }}
    >
      <Row align="middle" gutter={[20, 16]}>
        <Col flex="auto" style={{ minWidth: 0 }}>
          <Space size={8} style={{ marginBottom: 6 }}>
            {custom ? <SlidersOutlined style={{ color: BRAND }} /> : <ThunderboltOutlined style={{ color: BRAND }} />}
            <Text style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: BRAND,
            }}>
              {custom ? t('deploy:recommendation.builtByYou') : t('deploy:recommendation.recommendedForYou')}
            </Text>
          </Space>

          <Title level={3} style={{ margin: '0 0 6px', letterSpacing: '-0.02em' }}>
            {tier.name}
          </Title>

          <Text type="secondary" style={{ fontSize: 13.5, ...monoNumeric }}>
            {tierSpecLine(tier)}
          </Text>

          {tier.status === 'limited' && (
            <div style={{ marginTop: 8 }}>
              <Tag color="orange" style={{ marginInlineEnd: 0 }}>{t('deploy:recommendation.limitedAvailability')}</Tag>
            </div>
          )}
        </Col>

        <Col>
          <div style={{ textAlign: 'end' }}>
            <div>
              <Text strong style={{ fontSize: 34, color: BRAND, fontWeight: 800, letterSpacing: '-0.03em', ...monoNumeric }}>
                {currency} {formatRate(tier.pricePerHour)}
              </Text>
              <Text type="secondary" style={{ fontSize: 14 }}>{t('common:units.perHour')}</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12.5, ...monoNumeric }}>
              {t('deploy:recommendation.aboutPerMonth', { amount: `${currency} ${formatNumber(Math.round(tier.pricePerMonth))}` })}
            </Text>

            {/*
              Said here rather than buried in terms: pausing releases the
              compute but not the disk, so it is cheaper — not free. Better to
              learn that now than from a bill.
            */}
            {tier.stoppedPricePerHour > 0 && (
              <div style={{ marginTop: 6 }}>
                <Text type="secondary" style={{ fontSize: 12, ...monoNumeric }}>
                  {t('deploy:recommendation.whilePausedRate', { rate: `${currency} ${formatRate(tier.stoppedPricePerHour)}` })}
                  {tier.storageGb ? t('deploy:recommendation.keepsYourDisk', { size: tier.storageGb, kind: tier.storageType || t('deploy:recommendation.disk') }) : ''}
                </Text>
              </div>
            )}

            {creditsEnabled && (
              <AffordabilityLine tier={tier} wallet={wallet} currency={currency} isDark={isDark} />
            )}
          </div>
        </Col>
      </Row>
    </Card>
  );
};

/* ── Why we picked it ────────────────────────────────────────────────────── */

/**
 * The reasons the engine actually used, quoted back with the customer's own
 * answers. This is the whole argument for a rule engine over a language model:
 * every line here is traceable, so someone about to commit to thousands a
 * month can check our working rather than take it on faith.
 */
/**
 * Module-level, not defined inside WhyThis: a component declared during render
 * is a new type on every pass, so React unmounts and remounts the whole
 * subtree each time instead of updating it.
 */
const ReasonLine = ({ text, strong, isDark }) => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
    <CheckCircleFilled style={{
      color: STATUS_COLORS.success[isDark ? 'dark' : 'light'],
      fontSize: 14, marginTop: 3, flexShrink: 0,
    }} />
    <Text style={{ fontSize: 14, fontWeight: strong ? 600 : 400 }}>{text}</Text>
  </div>
);

const WhyThis = ({ reasons, isDark }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const primary = reasons.filter((r) => r.impact === 'primary' && r.severity !== 'warning');
  const supporting = reasons.filter((r) => r.impact !== 'primary' && r.severity !== 'warning');

  if (!primary.length && !supporting.length) return null;

  return (
    <Card
      title={t('deploy:recommendation.whyThis')}
      style={surfaceStyle(isDark)}
      styles={{ body: { padding: '20px 24px' } }}
    >
      {primary.map((reason, i) => (
        <ReasonLine key={`p${i}`} text={reason.text} strong isDark={isDark} />
      ))}

      {supporting.length > 0 && (
        primary.length > 0 ? (
          <Collapse
            ghost
            size="small"
            style={{ marginTop: 4 }}
            items={[{
              key: 'more',
              label: (
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {t('deploy:recommendation.moreFactors', { count: supporting.length })}
                </Text>
              ),
              children: supporting.map((reason, i) => (
                <ReasonLine key={`s${i}`} text={reason.text} isDark={isDark} />
              )),
            }]}
          />
        ) : (
          supporting.map((reason, i) => (
            <ReasonLine key={`s${i}`} text={reason.text} isDark={isDark} />
          ))
        )
      )}
    </Card>
  );
};

/* ── Suitability warning ─────────────────────────────────────────────────── */

/**
 * Shown when the model looks like a bad fit for what they described.
 *
 * Deliberately never blocks. The customer may know something we don't, and a
 * platform that refuses the order because its own heuristic disagreed would be
 * worse than one that says its piece and steps aside.
 */
const SuitabilityPanel = ({ suitability, modelName, warnings, onEditAnswer, isDark }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const poor = suitability.verdict === 'poor';
  const tone = poor ? STATUS_COLORS.error : STATUS_COLORS.warning;
  const color = tone[isDark ? 'dark' : 'light'];

  const issues = [
    ...suitability.issues,
    ...warnings.map((w) => ({ code: w.code, message: w.text, severity: 'medium', questionKey: w.questionKey })),
  ];

  if (!issues.length) return null;

  return (
    <Card
      style={{ ...surfaceStyle(isDark), border: `1.5px solid ${color}` }}
      styles={{ body: { padding: '20px 24px' } }}
    >
      <Space align="start" size={12} style={{ marginBottom: 14 }}>
        <WarningFilled style={{ color, fontSize: 18, marginTop: 2 }} />
        <div>
          <Text strong style={{ fontSize: 15.5, display: 'block' }}>
            {poor
              ? t('deploy:recommendation.notRightModel', { model: modelName })
              : t('deploy:recommendation.worthKnowing')}
          </Text>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('deploy:recommendation.ourReadNotRule')}
          </Text>
        </div>
      </Space>

      <div style={{ paddingInlineStart: 30 }}>
        {issues.map((issue, i) => (
          <div
            key={i}
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              justifyContent: 'space-between', marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <InfoCircleOutlined style={{ color, fontSize: 13, marginTop: 4, flexShrink: 0 }} />
              <Text style={{ fontSize: 13.5 }}>{issue.message}</Text>
            </div>
            {issue.questionKey && onEditAnswer && (
              <Button
                type="link" size="small"
                style={{ padding: 0, height: 'auto', flexShrink: 0, fontSize: 12.5 }}
                onClick={() => onEditAnswer(issue.questionKey)}
              >
                {t('deploy:question.changeAnswer')}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
};

/* ── Better-fitting models, chosen right here ────────────────────────────── */

/**
 * Shown in place of the hardware recommendation while the model itself is
 * still an open question. Hardware is quoted for a specific model, so
 * quoting it for one we just said might be wrong reads as contradictory —
 * this panel has to be resolved (pick one, or keep the current model) before
 * the hero tier below it makes sense.
 */
const AlternativeModelsPanel = ({
  modelName, matches, loading, currency, currentIssues, blockerTemplates,
  onSelect, onKeep, onEditAnswer, isDark,
}) => {
  const { t } = useTranslation(['deploy', 'common']);
  const blocker = !loading ? findSharedBlocker(matches, currentIssues) : null;

  return (
    <Card style={surfaceStyle(isDark)} styles={{ body: { padding: '20px 24px' } }}>
      <Text strong style={{ fontSize: 15.5, display: 'block', marginBottom: 4 }}>
        {t('deploy:match.betterFitting')}
      </Text>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 18 }}>
        {t('deploy:match.betterFittingBody')}
      </Text>

      {loading ? (
        <ThinkingDots label={t('deploy:match.looking')} />
      ) : matches.length ? (
        <>
          {blocker && (
            <BlockerNotice
              blocker={blocker} matches={matches} currency={currency}
              templates={blockerTemplates} onEditAnswer={onEditAnswer}
            />
          )}
          <Row gutter={[16, 16]}>
            {matches.map((match, rank) => (
              <Col xs={24} md={12} key={match.model.id}>
                <MatchCard
                  match={match}
                  rank={rank}
                  selected={false}
                  currency={currency}
                  onChoose={() => onSelect(match.model)}
                  isDark={isDark}
                />
              </Col>
            ))}
          </Row>
        </>
      ) : (
        <Text type="secondary" style={{ fontSize: 13 }}>
          {t('deploy:match.noBetterMatch')}
        </Text>
      )}

      <Button type="default" onClick={onKeep} style={{ marginTop: 18, borderRadius: 10 }}>
        Keep {modelName} anyway
      </Button>
    </Card>
  );
};

/* ── Alternatives ────────────────────────────────────────────────────────── */

const AlternativeCard = ({ tier, kind, currency, onChoose, isDark }) => {
  const { t } = useTranslation(['deploy', 'common']);
  const cheaper = kind === 'cheaper';
  const delta = cheaper ? tier.savingsPerMonth : tier.extraPerMonth;

  return (
    <Card
      hoverable
      className="card-hover"
      style={surfaceStyle(isDark)}
      styles={{ body: { padding: 18 } }}
      onClick={onChoose}
    >
      <Space size={6} style={{ marginBottom: 8 }}>
        {cheaper
          ? <ArrowDownOutlined style={{ fontSize: 12, opacity: 0.6 }} />
          : <ArrowUpOutlined style={{ fontSize: 12, opacity: 0.6 }} />}
        <Text type="secondary" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          {cheaper ? t('deploy:recommendation.spendLess') : t('deploy:recommendation.moreHeadroom')}
        </Text>
      </Space>

      <Text strong style={{ fontSize: 15, display: 'block', marginBottom: 2 }}>{tier.name}</Text>

      <Text style={{ fontSize: 15, fontWeight: 700, ...monoNumeric }}>
        {currency} {formatRate(tier.pricePerHour)}
      </Text>
      <Text type="secondary" style={{ fontSize: 12 }}>{t('common:units.perHour')}</Text>

      {delta > 0 && (
        <Text
          type={cheaper ? 'success' : 'secondary'}
          style={{ fontSize: 12, display: 'block', marginTop: 2, ...monoNumeric }}
        >
          {cheaper ? '−' : '+'}{currency} {formatNumber(Math.round(delta))}{t('common:units.perMonth')}
        </Text>
      )}

      <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginTop: 10 }}>
        {cheaper ? tier.tradeoff : tier.benefit}
      </Text>
    </Card>
  );
};

/* ── The step ────────────────────────────────────────────────────────────── */

/**
 * One machine in the "see all configurations" list.
 *
 * Extracted when that list moved up under the hero: it is the same row, but a
 * forty-line inline map inside an already long render made the new action row
 * above it impossible to read.
 */
const TierRow = ({ tier, active, currency, isDark, onChoose }) => {
  const { t } = useTranslation(['deploy', 'common']);
  return (
  <div
    role="button"
    tabIndex={0}
    onClick={onChoose}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChoose(); }
    }}
    style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '13px 16px', borderRadius: 12,
      cursor: tier.bookable ? 'pointer' : 'not-allowed',
      opacity: tier.bookable ? 1 : 0.5,
      border: `1.5px solid ${active ? getBrand(isDark) : (isDark ? SURFACE.borderDark : SURFACE.borderLight)}`,
      background: active ? brandSoft(isDark) : 'transparent',
    }}
  >
    <div style={{ flex: 1, minWidth: 0 }}>
      <Space size={8} wrap>
        <Text strong style={{ fontSize: 14 }}>{tier.name}</Text>
        {tier.recommended && <Tag color="green" style={{ marginInlineEnd: 0 }}>{t('deploy:recommendation.adminPick')}</Tag>}
        {!tier.meetsVram && <Tag color="orange" style={{ marginInlineEnd: 0 }}>{t('deploy:recommendation.undersized')}</Tag>}
        {!tier.bookable && <Tag color="red" style={{ marginInlineEnd: 0 }}>{t('deploy:recommendation.outOfStock')}</Tag>}
      </Space>
      <div>
        <Text type="secondary" style={{ fontSize: 12, ...monoNumeric }}>
          {tierSpecLine(tier, 'short')}
        </Text>
      </div>
    </div>
    <Text strong style={{ fontSize: 15, ...monoNumeric }}>
      {currency} {formatRate(tier.pricePerHour)}
    </Text>
  </div>
  );
};

const RecommendationStep = ({
  step, recommendation, model, modelName, currency, chosenTierId,
  onChooseTier, eyebrow, locked, alternativeModels = [], altLoading,
  onChooseAlternative, onKeepModel, onEditAnswer, blockerTemplates,
  wallet, creditsEnabled,
  customMachine, onUseCustomMachine,
}) => {
  const { t } = useTranslation(['deploy', 'common']);
  const { isDark } = useTheme();
  const { customBuildEnabled } = useBilling();
  const [showAll, setShowAll] = useState(false);
  const [customising, setCustomising] = useState(false);
  const [showModels, setShowModels] = useState(false);

  const { primary, cheaper, headroom, allTiers = [] } = recommendation.recommendation || {};
  const showAlternatives = step.settings?.showAlternatives !== false;

  // What the customer actually has selected, which may not be our pick — and
  // may not be in the catalogue at all if they built their own.
  const selected = customMachine
    || allTiers.find((t) => String(t.tierId) === String(chosenTierId))
    || primary;
  const overridden = !customMachine && primary && selected
    && String(selected.tierId) !== String(primary.tierId);

  const warnings = (recommendation.reasons || []).filter((r) => r.severity === 'warning');

  if (!primary) {
    return (
      <div>
        <StepHeading
          eyebrow={eyebrow}
          title={t('deploy:recommendation.noHardware')}
          subtitle={t('deploy:recommendation.noHardwareBody')}
        />
      </div>
    );
  }

  return (
    <div>
      <StepHeading
        eyebrow={eyebrow}
        title={step.title || t('deploy:recommendation.title')}
        subtitle={step.subtitle}
      />

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <SuitabilityPanel
          suitability={recommendation.suitability}
          modelName={modelName}
          warnings={warnings}
          onEditAnswer={onEditAnswer}
          isDark={isDark}
        />

        {locked ? (
          <AlternativeModelsPanel
            modelName={modelName}
            matches={alternativeModels}
            loading={altLoading}
            currency={currency}
            currentIssues={recommendation.suitability?.issues}
            blockerTemplates={blockerTemplates}
            onSelect={onChooseAlternative}
            onKeep={onKeepModel}
            onEditAnswer={onEditAnswer}
            isDark={isDark}
          />
        ) : (
          <>
            <HeroTier
              tier={selected}
              custom={!!customMachine}
              currency={currency}
              isDark={isDark}
              wallet={wallet}
              creditsEnabled={creditsEnabled}
            />

            {/*
              * The other ways out, all on one line directly under the hero.
              * "See all N configurations" used to sit at the very bottom, below
              * the reasons, the alternatives and the other-models list — so a
              * customer who wanted a different machine had to scroll past an
              * argument for this one to find out the choice existed at all.
              */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16,
              flexWrap: 'wrap', rowGap: 8,
            }}>
              {(overridden || customMachine) && (
                <Text type="secondary" style={{ fontSize: 13 }}>
                  {customMachine
                    ? t('deploy:recommendation.youBuiltThis')
                    : t('deploy:recommendation.youPickedThis')}
                  <Text strong style={{ fontSize: 13 }}>{primary.name}</Text>.{' '}
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0 }}
                    onClick={() => onChooseTier(primary.tierId)}
                  >
                    {t('deploy:recommendation.useOurSuggestion')}
                  </Button>
                </Text>
              )}

              {allTiers.length > 1 && (
                <Button type="link" style={{ padding: 0 }} onClick={() => setShowAll((v) => !v)}>
                  {showAll ? t('deploy:recommendation.hideOtherConfigurations') : t('deploy:recommendation.seeAllConfigurations', { count: allTiers.length })}
                </Button>
              )}

              {/* Left out entirely when the admin has the builder off — a
                  button that can only return a 403 is worse than no button. */}
              {customBuildEnabled && (
                <div style={{ marginInlineStart: 'auto' }}>
                  <Button
                    icon={<SlidersOutlined />}
                    onClick={() => setCustomising(true)}
                  >
                    {customMachine ? t('deploy:recommendation.editYourMachine') : t('deploy:recommendation.customize')}
                  </Button>
                </div>
              )}
            </div>

            {/*
              * The builder. Mounted here rather than in the journey shell so it
              * sits next to the thing it replaces — and it prices every change
              * server-side, so the rate it shows is the rate that gets charged.
              */}
            <CustomMachineModal
              open={customising}
              model={model}
              // Opens on whatever is on screen, so t('deploy:recommendation.customize') starts from the
              // machine they are looking at rather than an empty box.
              baseTier={selected}
              onClose={() => setCustomising(false)}
              onUse={(build) => {
                onUseCustomMachine(build);
                setCustomising(false);
              }}
            />

            {showAll && allTiers.length > 1 && (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {allTiers.map((tier) => (
                  <TierRow
                    key={tier.tierId}
                    tier={tier}
                    active={String(tier.tierId) === String(selected.tierId)}
                    currency={currency}
                    isDark={isDark}
                    onChoose={() => tier.bookable && onChooseTier(tier.tierId)}
                  />
                ))}
              </Space>
            )}

            <WhyThis reasons={recommendation.reasons || []} isDark={isDark} />

            {showAlternatives && (cheaper || headroom) && (
              <Row gutter={[16, 16]}>
                {cheaper && (
                  <Col xs={24} md={12}>
                    <AlternativeCard
                      tier={cheaper} kind="cheaper" currency={currency}
                      onChoose={() => onChooseTier(cheaper.tierId)} isDark={isDark}
                    />
                  </Col>
                )}
                {headroom && (
                  <Col xs={24} md={12}>
                    <AlternativeCard
                      tier={headroom} kind="headroom" currency={currency}
                      onChoose={() => onChooseTier(headroom.tierId)} isDark={isDark}
                    />
                  </Col>
                )}
              </Row>
            )}

            {/* Switching models is still on the table, scoped to the ones the
                engine already ranked for this workload — not the open catalog. */}
            {alternativeModels.length > 0 && (
              <>
                <Button type="link" style={{ padding: 0 }} onClick={() => setShowModels((v) => !v)}>
                  {showModels
                    ? t('deploy:recommendation.hide')
                    : t('deploy:recommendation.compareModels', { count: alternativeModels.length })}
                </Button>

                {showModels && (
                  altLoading ? (
                    <ThinkingDots label={t('deploy:match.lookingOthers')} />
                  ) : (
                    <Row gutter={[16, 16]}>
                      {alternativeModels.map((match, rank) => (
                        <Col xs={24} md={12} key={match.model.id}>
                          <MatchCard
                            match={match}
                            rank={rank}
                            selected={false}
                            currency={currency}
                            onChoose={() => onChooseAlternative(match.model)}
                            isDark={isDark}
                          />
                        </Col>
                      ))}
                    </Row>
                  )
                )}
              </>
            )}
          </>
        )}
      </Space>
    </div>
  );
};

export default RecommendationStep;
