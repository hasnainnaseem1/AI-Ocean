import React, { useState } from 'react';
import { Card, Typography, Space, Select, Alert, Button } from 'antd';
import { WalletOutlined } from '@ant-design/icons';
import { useTheme } from '../../context/ThemeContext';
import {
  cardStyle as surfaceStyle, getBrand, monoNumeric, SURFACE,
} from '../../theme/colors';
import { BigInput, StepHeading, tierSpecLine } from './journeyParts';
import { formatRate, formatAmount } from '../../utils/money';
import { formatNumber } from '../../utils/format';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

/* ── Name the deployment ─────────────────────────────────────────────────── */

export const NameStep = ({ step, value, onChange, onEnter, eyebrow, error }) => {
  const { t } = useTranslation('deploy');
  return (
  <div>
    <StepHeading
      eyebrow={eyebrow}
      // The admin's own wording wins when a journey step carries one; these
      // are the fallbacks for a step that does not.
      title={step.title || t('name.title')}
      subtitle={step.subtitle || t('name.subtitle')}
    />
    <BigInput
      autoFocus
      value={value}
      onChange={onChange}
      onEnter={onEnter}
      placeholder="my-deployment"
    />
    {error && (
      <Text type="danger" style={{ fontSize: 13, display: 'block', marginTop: 12 }}>{error}</Text>
    )}
  </div>
  );
};

/* ── Final review ────────────────────────────────────────────────────────── */

/**
 * A label on the left, its value on the right.
 *
 * Deliberately plain flexbox rather than antd's Row/Col: this screen renders a
 * dozen of these, and every antd Row subscribes to the global responsive
 * observer. A burst of media-query events — resizing the window — then fans
 * out into a setState per row, which is both wasted work and enough nested
 * updates to trip React's depth guard. A two-item row never needed a grid.
 */
const Line = ({ label, children, isDark }) => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
      padding: '11px 0',
      borderBottom: `1px solid ${isDark ? SURFACE.borderDark : SURFACE.borderLight}`,
    }}
  >
    <Text type="secondary" style={{ fontSize: 13.5 }}>{label}</Text>
    <div style={{ textAlign: 'end', minWidth: 0 }}>{children}</div>
  </div>
);

/**
 * The last screen before committing. Everything that determines the bill is
 * repeated here — hardware, rate, and what the balance means in days — because
 * this is the moment a customer is entitled to see the whole picture at once
 * rather than reconstruct it from earlier screens.
 */
const ReviewStep = ({
  step, model, tier, deploymentName, region, regions, onRegionChange,
  answers, questions, currency, wallet, creditsEnabled, eyebrow,
  machineOptions, onChangeMachine,
}) => {
  const { t } = useTranslation(['deploy', 'common']);
  const { isDark } = useTheme();
  const BRAND = getBrand(isDark);
  const [changingMachine, setChangingMachine] = useState(false);

  /*
   * When the customer arrives having already chosen their machine, the
   * recommendation screen is dropped from the journey — and that screen was
   * the only place the machine could be seen or swapped. So this becomes it.
   * Switching here rather than sending them back to the catalogue is what
   * stops a change of mind from costing them every answer they have given.
   *
   * Both props are optional: on the recommendation-driven path they are absent
   * and this renders exactly as it always did.
   */
  const canSwitchMachine = typeof onChangeMachine === 'function'
    && (machineOptions || []).length > 1;

  const daily = tier ? tier.pricePerHour * 24 : 0;
  const monthly = tier ? tier.pricePerMonth : 0;
  const runwayDays = wallet && daily > 0 ? wallet.balance / daily : null;

  // Show the answers back, resolved to their labels rather than raw values.
  const answered = (questions || [])
    .map((q) => {
      const value = answers[q.key];
      if (value === undefined || value === null || value === '') return null;
      if (Array.isArray(value) && !value.length) return null;

      const labelFor = (v) => (q.options || []).find((o) => o.value === v)?.label ?? String(v);
      const display = Array.isArray(value)
        ? value.map(labelFor).join(', ')
        : q.type === 'boolean'
          ? (value ? t('deploy:question.yes') : t('deploy:question.no'))
          : labelFor(value);

      return { key: q.key, question: q.question, display };
    })
    .filter(Boolean);

  return (
    <div>
      <StepHeading
        eyebrow={eyebrow}
        title={step.title || t('deploy:review.title')}
        subtitle={step.subtitle || t('deploy:review.subtitle')}
      />

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card style={surfaceStyle(isDark)} styles={{ body: { padding: '8px 24px 20px' } }}>
          <Line label={t('common:label.name')} isDark={isDark}>
            <Text strong style={{ fontSize: 14 }}>{deploymentName}</Text>
          </Line>
          <Line label={t('common:label.model')} isDark={isDark}>
            <Text strong style={{ fontSize: 14 }}>{model?.name}</Text>
          </Line>
          <Line label={t('deploy:review.machine')} isDark={isDark}>
            <div>
              {changingMachine ? (
                <Select
                  autoFocus
                  defaultOpen
                  size="small"
                  value={tier?.tierId}
                  onChange={(id) => { onChangeMachine(id); setChangingMachine(false); }}
                  onBlur={() => setChangingMachine(false)}
                  style={{ minWidth: 320 }}
                  options={(machineOptions || []).map((machine) => ({
                    value: machine.tierId,
                    label: `${machine.name} · ${tierSpecLine(machine, 'short')} · ${currency} ${formatRate(machine.pricePerHour)}${t('common:units.perHour')}`,
                  }))}
                />
              ) : (
                <>
                  <Text strong style={{ fontSize: 14, display: 'block' }}>{tier?.name}</Text>
                  <Text type="secondary" style={{ fontSize: 12, ...monoNumeric }}>
                    {tierSpecLine(tier)}
                  </Text>
                  {canSwitchMachine && (
                    <Button
                      type="link"
                      size="small"
                      // Its own line: inline it ran straight on from the spec
                      // string and read as part of the hardware description.
                      style={{ padding: 0, height: 'auto', fontSize: 12, display: 'block', marginTop: 2 }}
                      onClick={() => setChangingMachine(true)}
                    >
                      {t('deploy:review.changeMachine')}
                    </Button>
                  )}
                </>
              )}
            </div>
          </Line>

          {/*
            * Stock is checked again at checkout, where it is enforced. Saying so
            * here means a customer who is about to be refused finds out before
            * they fill in a payment method, not after.
            */}
          {tier && tier.bookable === false && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12, borderRadius: 10 }}
              message={t('deploy:review.outOfStockTitle', { machine: tier.name })}
              description={t('deploy:review.outOfStockBody')}
            />
          )}

          {regions && regions.length > 1 && (
            <Line label={t('common:label.region')} isDark={isDark}>
              <Select
                size="small"
                value={region}
                onChange={onRegionChange}
                options={regions.map((r) => ({ value: r, label: r }))}
                style={{ minWidth: 140 }}
              />
            </Line>
          )}

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 12, padding: '16px 0 4px',
          }}>
            <Text strong style={{ fontSize: 14 }}>{t('common:label.rate')}</Text>
            <div style={{ textAlign: 'end' }}>
              <div>
                <Text strong style={{ fontSize: 24, color: BRAND, fontWeight: 800, ...monoNumeric }}>
                  {currency} {formatRate(tier?.pricePerHour)}
                </Text>
                <Text type="secondary" style={{ fontSize: 13 }}>{t('common:units.perHour')}</Text>
              </div>
              <Text type="secondary" style={{ fontSize: 12, ...monoNumeric }}>
                {t('deploy:review.perDayPerMonth', { daily: `${currency} ${formatAmount(daily)}`, monthly: `${currency} ${formatNumber(Math.round(monthly))}` })}
              </Text>

              {/* Pausing is cheaper, not free — say so before they commit. */}
              {tier?.stoppedPricePerHour > 0 && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12, ...monoNumeric }}>
                    {t('deploy:review.whilePausedOrStopped', { rate: `${currency} ${formatRate(tier.stoppedPricePerHour)}` })}
                    {tier.storageGb ? t('deploy:review.yourDiskStays', { size: tier.storageGb, kind: tier.storageType || t('deploy:review.disk') }) : ''}
                  </Text>
                </div>
              )}
            </div>
          </div>
        </Card>

        {creditsEnabled && wallet && (
          <Card style={surfaceStyle(isDark)} styles={{ body: { padding: '16px 24px' } }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            }}>
              <Space size={8}>
                <WalletOutlined style={{ opacity: 0.6 }} />
                <Text type="secondary" style={{ fontSize: 13 }}>{t('deploy:review.yourBalance')}</Text>
              </Space>
              <div style={{ textAlign: 'end' }}>
                <Text strong style={{ fontSize: 16, ...monoNumeric }}>
                  {currency} {formatAmount(wallet.balance)}
                </Text>
                {runwayDays !== null && (
                  <Text
                    type={runwayDays < 2 ? 'danger' : 'secondary'}
                    style={{ fontSize: 12, display: 'block', ...monoNumeric }}
                  >
                    ≈ {runwayDays.toFixed(1)} day{runwayDays === 1 ? '' : 's'} at this rate
                  </Text>
                )}
              </div>
            </div>
          </Card>
        )}

        {answered.length > 0 && (
          <Card
            title={t('deploy:review.whatYouToldUs')}
            style={surfaceStyle(isDark)}
            styles={{ body: { padding: '8px 24px 16px' } }}
          >
            {answered.map((a) => (
              <Line key={a.key} label={a.question} isDark={isDark}>
                <Text style={{ fontSize: 13.5 }}>{a.display}</Text>
              </Line>
            ))}
          </Card>
        )}

        <Alert
          type="info"
          showIcon
          message={t('deploy:review.underReview')}
          description={t('deploy:review.underReviewBody')}
          style={{ borderRadius: 12 }}
        />
      </Space>
    </div>
  );
};

export default ReviewStep;
