import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, Typography, Card, Radio, Button, Alert, Spin, Space, Tag, InputNumber, message,
} from 'antd';
import {
  WalletOutlined, ThunderboltOutlined, CreditCardOutlined, CheckCircleFilled,
} from '@ant-design/icons';
import { Elements } from '@stripe/react-stripe-js';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import { usePayments, useBilling } from '../../context/SiteContext';
import { cardStyle as surfaceStyle, getBrand, brandSoft, monoNumeric, STATUS_COLORS } from '../../theme/colors';
import { CardEntryForm, getStripePromise } from '../billing/tabs/PaymentMethodsTab';
import deploymentsApi from '../../api/deploymentsApi';
import walletApi from '../../api/walletApi';
import paymentMethodsApi from '../../api/paymentMethodsApi';
import { formatRate, formatAmount } from '../../utils/money';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

/**
 * The one place a customer commits real money, or a promise of it. Loads
 * fresh from `checkout-options` every time it opens — a customer can go Back
 * and change their answers or tier while the journey is open, so a stale
 * quote here would be actively wrong, not just outdated.
 *
 * Card verification is asked for regardless of which method is chosen when
 * the admin has the card gate on: "card first, deployment second" applies to
 * pay-as-you-go and prepaid alike, not only where the wallet happens to be
 * short.
 */
const CheckoutModal = ({
  open, onClose, model, tier, region, journeyKey, requirements, deploymentName,
  onDeployed, onMissingRequirements,
}) => {
  const { t } = useTranslation(['deploy', 'common']);
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const { stripePublishableKey } = usePayments();
  // A team member who may not see money (Developer) can still deploy, but is
  // shown no balance and offered no top-up or card — only who to ask. The
  // server sends them no wallet figures and refuses those actions anyway.
  const { creditsEnabled: money } = useBilling();
  const stripePromise = useMemo(() => getStripePromise(stripePublishableKey), [stripePublishableKey]);

  const [options, setOptions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [method, setMethod] = useState('prepaid');

  const [cardBusy, setCardBusy] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);

  const [topUpAmount, setTopUpAmount] = useState(null);
  const [toppingUp, setToppingUp] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitErrorCode, setSubmitErrorCode] = useState(null);

  // Minted once per open, resent on every retry so a double-click or a lost
  // response can never create two deployments for one checkout attempt.
  const idempotencyKeyRef = useRef(null);

  /**
   * How this machine is named to the server. A catalogue machine is an id; a
   * custom one is the parts list it was built from, which has to be re-priced
   * server-side rather than trusted from here. Both the quote and the create
   * below send the identical object, so they cannot disagree about what is
   * being bought.
   */
  const machineRef = useMemo(() => (
    tier?.isCustom ? { customBuild: { picks: tier.customPicks } } : { tierId: tier?.tierId }
  ), [tier]);

  const loadOptions = useCallback(async () => {
    if (!model || !tier) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await deploymentsApi.getCheckoutOptions({ modelId: model.id, ...machineRef });
      setOptions(result);
      setMethod((current) => {
        if (result.prepaid?.ok) return 'prepaid';
        if (result.payg?.available && result.payg?.eligible) return 'payg';
        return current;
      });
    } catch (err) {
      setLoadError(err.response?.data?.message || t('deploy:checkout.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, model, tier, machineRef]);

  useEffect(() => {
    if (!open) return;
    idempotencyKeyRef.current = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    setSubmitError(null);
    setTopUpAmount(null);
    loadOptions();
    // A custom machine has no id to key on — its parts list is its identity,
    // so the serialised reference is what tells us the machine changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, model?.id, JSON.stringify(machineRef)]);

  const openAddCard = async () => {
    setCardBusy(true);
    try {
      const { clientSecret: secret } = await paymentMethodsApi.createSetupIntent();
      setClientSecret(secret);
    } catch (err) {
      message.error(err.response?.data?.message || t('deploy:checkout.cardStartFailed'));
    } finally {
      setCardBusy(false);
    }
  };

  const handleCardVerified = async (setupIntentId) => {
    try {
      await paymentMethodsApi.attach(setupIntentId);
      message.success(t('deploy:checkout.cardVerified'));
      setClientSecret(null);
      await loadOptions();
    } catch (err) {
      message.error(err.response?.data?.message || t('deploy:checkout.cardSaveFailed'));
    }
  };

  const handleInstantTopUp = async () => {
    const amount = topUpAmount || Math.ceil((options?.prepaid?.shortfall || 0) * 100) / 100;
    if (!amount || amount <= 0) return;
    setToppingUp(true);
    try {
      await walletApi.createInstantTopUp(amount);
      message.success(t('deploy:checkout.toppedUp'));
      await loadOptions();
    } catch (err) {
      message.error(err.response?.data?.message || t('deploy:checkout.topUpFailed'));
    } finally {
      setToppingUp(false);
    }
  };

  const handleDeploy = async () => {
    if (!model || !tier) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitErrorCode(null);
    try {
      const result = await deploymentsApi.create({
        deploymentName: (deploymentName || '').trim(),
        modelId: model.id,
        ...machineRef,
        region,
        journeyKey: journeyKey || '',
        requirements,
        billingMethod: method,
        idempotencyKey: idempotencyKeyRef.current,
      });
      onDeployed(result.deployment);
    } catch (err) {
      const data = err.response?.data;
      if (data?.code === 'MISSING_REQUIREMENTS' && onMissingRequirements) {
        onMissingRequirements(data.missing);
        return;
      }
      setSubmitError(data?.message || t('deploy:checkout.submitFailed'));
      setSubmitErrorCode(data?.code || null);
      // The account-wide picture (debt, dispute hold, card) may have changed
      // since we loaded — refresh so the modal reflects why it just failed.
      loadOptions();
    } finally {
      setSubmitting(false);
    }
  };

  const currency = options?.currency || 'USD';
  const cardGate = options?.cardGate;
  const needsCard = !!cardGate && cardGate.required && !cardGate.hasVerifiedCard;
  const selected = method === 'payg' ? options?.payg : options?.prepaid;
  const canDeploy = !!selected?.ok && !needsCard;

  return (
    <Modal
      title={t('deploy:checkout.title')}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={560}
    >
      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}><Spin /></div>
      ) : loadError ? (
        <Alert type="error" showIcon message={loadError} />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {t('deploy:checkout.summary', { model: model?.name, machine: tier?.name, rate: `${currency} ${formatRate(options.pricing.effectiveRate)}` })}
          </Text>

          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <MethodCard
              value="prepaid"
              active={method === 'prepaid'}
              onSelect={() => setMethod('prepaid')}
              icon={<WalletOutlined />}
              title={t('deploy:checkout.prepaid')}
              subtitle={money && options.wallet
                ? `Wallet: ${currency} ${formatAmount((options.wallet.balance || 0))}`
                : t('deploy:checkout.fromAccountBalance')}
              status={options.prepaid.code === 'SPEND_LIMIT_REACHED'
                ? { ...options.prepaid, message: t('deploy:checkout.spendLimitReached') }
                : options.prepaid}
              isDark={isDark}
            />
            <MethodCard
              value="payg"
              available={options.payg.available}
              active={method === 'payg'}
              onSelect={() => setMethod('payg')}
              icon={<ThunderboltOutlined />}
              title={t('deploy:checkout.payg')}
              subtitle={t('deploy:checkout.paygSubtitle')}
              // Unavailable is two different situations: PAYG off on the
              // platform, or off for this one account. Said in the reader's
              // language rather than the server's English.
              status={options.payg.code === 'SPEND_LIMIT_REACHED'
                ? { ...options.payg, message: t('deploy:checkout.spendLimitReached') }
                : options.payg.code === 'PAYG_UNAVAILABLE'
                ? {
                  ...options.payg,
                  message: t(options.payg.reason === 'CUSTOMER_BLOCKED'
                    ? 'deploy:checkout.paygUnavailableAccount'
                    : 'deploy:checkout.paygUnavailablePlatform'),
                }
                : options.payg}
              isDark={isDark}
            />
          </Space>

          {money && method === 'prepaid' && options.prepaid.code === 'INSUFFICIENT_CREDIT' && (
            <Card style={surfaceStyle(isDark)} styles={{ body: { padding: 16 } }}>
              <Text strong style={{ fontSize: 13.5, display: 'block', marginBottom: 8 }}>
                {t('deploy:checkout.addFunds')}
              </Text>
              {cardGate?.hasVerifiedCard ? (
                <Space>
                  <InputNumber
                    min={1}
                    prefix={currency}
                    value={topUpAmount ?? Math.ceil((options.prepaid.shortfall || 0) * 100) / 100}
                    onChange={setTopUpAmount}
                    style={{ width: 140 }}
                  />
                  <Button type="primary" loading={toppingUp} onClick={handleInstantTopUp}>
                    {t('deploy:checkout.topUpNow')}
                  </Button>
                </Space>
              ) : (
                <Text type="secondary" style={{ fontSize: 12.5 }}>
                  {t('deploy:checkout.addCardFirst')}
                </Text>
              )}
            </Card>
          )}

          <div>
            <Text strong style={{ fontSize: 13.5, display: 'block', marginBottom: 8 }}>
              {t('deploy:checkout.paymentMethod')}
            </Text>
            {cardGate?.hasVerifiedCard ? (
              <Space size={8}>
                <CheckCircleFilled style={{ color: STATUS_COLORS.success[isDark ? 'dark' : 'light'] }} />
                <Text type="secondary" style={{ fontSize: 13 }}>{t('deploy:checkout.cardOnFile')}</Text>
              </Space>
            ) : !money ? (
              <Text type="secondary" style={{ fontSize: 12.5 }}>
                {needsCard ? t('deploy:checkout.askBillingCard') : t('deploy:checkout.cardHandledByBilling')}
              </Text>
            ) : clientSecret && stripePromise ? (
              <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: isDark ? 'night' : 'stripe' } }}>
                <CardEntryForm onVerified={handleCardVerified} onCancel={() => setClientSecret(null)} />
              </Elements>
            ) : (
              <Space direction="vertical" size={6}>
                {needsCard && (
                  <Text type="secondary" style={{ fontSize: 12.5 }}>
                    {options.prepaid.code === 'CARD_REQUIRED' ? options.prepaid.message : t('deploy:checkout.cardRequired')}
                  </Text>
                )}
                <Button icon={<CreditCardOutlined />} loading={cardBusy} onClick={openAddCard}>
                  {t('deploy:checkout.addVerifiedCard')}
                </Button>
              </Space>
            )}
          </div>

          {submitError && (
            <Alert
              type="error"
              showIcon
              closable
              message={submitError}
              onClose={() => setSubmitError(null)}
              action={submitErrorCode === 'DEPLOYMENT_LIMIT_REACHED' ? (
                <Button size="small" onClick={() => navigate('/billing?tab=plans')}>
                  {t('deploy:checkout.seePlans')}
                </Button>
              ) : null}
            />
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button onClick={onClose}>{t('common:action.cancel')}</Button>
            <Button type="primary" loading={submitting} disabled={!canDeploy} onClick={handleDeploy}>
              {t('deploy:checkout.deploy')}
            </Button>
          </div>
        </Space>
      )}
    </Modal>
  );
};

const MethodCard = ({ active, available = true, onSelect, icon, title, subtitle, status, isDark }) => {
  const blocked = available === false || !status?.ok;
  const BRAND = getBrand(isDark);
  const base = surfaceStyle(isDark);

  return (
    <Card
      style={{
        ...base,
        border: active ? `1.5px solid ${BRAND}` : base.border,
        background: active ? brandSoft(isDark) : undefined,
        opacity: available === false ? 0.55 : 1,
        cursor: available === false ? 'not-allowed' : 'pointer',
      }}
      styles={{ body: { padding: 16 } }}
      onClick={available === false ? undefined : onSelect}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <Radio checked={active} disabled={available === false} style={{ marginTop: 2 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size={8}>
            {icon}
            <Text strong style={{ fontSize: 14.5 }}>{title}</Text>
          </Space>
          <div>
            <Text type="secondary" style={{ fontSize: 12.5, ...monoNumeric }}>{subtitle}</Text>
          </div>
          {blocked && status?.message && (
            <Tag color={available === false ? 'default' : 'orange'} style={{ marginTop: 8, whiteSpace: 'normal' }}>
              {status.message}
            </Tag>
          )}
        </div>
      </div>
    </Card>
  );
};

export default CheckoutModal;
