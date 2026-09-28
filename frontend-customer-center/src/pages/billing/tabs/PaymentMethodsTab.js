import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Row, Col, Card, Typography, Button, Empty, Modal, Alert, Space, Tag, Spin, message,
} from 'antd';
import {
  PlusOutlined, CreditCardOutlined, DeleteOutlined, CheckCircleOutlined, WarningFilled,
} from '@ant-design/icons';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements, PaymentElement, useStripe, useElements,
} from '@stripe/react-stripe-js';
import { useTheme } from '../../../context/ThemeContext';
import { usePayments } from '../../../context/SiteContext';
import { cardStyle as surfaceStyle, monoNumeric, STATUS_COLORS, TILE } from '../../../theme/colors';
import paymentMethodsApi from '../../../api/paymentMethodsApi';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

const BRAND_TONE = { visa: 'blue', mastercard: 'amber', amex: 'cyan' };

/**
 * A Stripe Elements instance needs its publishable key up front and cannot be
 * re-created cheaply, so it is memoised at module scope rather than per
 * render — `loadStripe` itself already caches by key, but this avoids calling
 * it again on every keystroke elsewhere in the tree.
 */
let stripePromiseCache = null;
export const getStripePromise = (publishableKey) => {
  if (!publishableKey) return null;
  if (!stripePromiseCache) stripePromiseCache = loadStripe(publishableKey);
  return stripePromiseCache;
};

/**
 * The actual card-entry form, rendered inside <Elements>.
 *
 * Deliberately thin: Stripe's own PaymentElement collects and validates the
 * card, and `stripe.confirmSetup` talks to Stripe directly from the browser.
 * The card number never reaches our server — only the resulting
 * SetupIntent id does, which this component hands to `onVerified`.
 */
export const CardEntryForm = ({ onVerified, onCancel }) => {
  const { t } = useTranslation(['billing', 'common']);
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const { error: stripeError, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });

    if (stripeError) {
      setError(stripeError.message || t('billing:cards.verifyFailed'));
      setSubmitting(false);
      return;
    }

    if (setupIntent?.status !== 'succeeded') {
      setError(t('billing:cards.needsVerification'));
      setSubmitting(false);
      return;
    }

    try {
      await onVerified(setupIntent.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && (
        <Alert type="error" showIcon message={error} style={{ marginTop: 16, borderRadius: 8 }} />
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <Button onClick={onCancel} disabled={submitting}>{t('common:action.cancel')}</Button>
        <Button type="primary" onClick={handleSubmit} loading={submitting} disabled={!stripe}>
          {t('billing:cards.saveCard')}
        </Button>
      </div>
    </div>
  );
};

/**
 * Saved payment methods — the card-on-file gate that pay-as-you-go and debt
 * collection both depend on.
 *
 * This used to be a local mock (`utils/billingMock`) that stored a typed card
 * number in an antd Input and kept it in localStorage — no gateway involved,
 * and a plaintext card number handled by our own JavaScript. This replaces it
 * with Stripe Elements end to end: the card is entered directly into Stripe's
 * own iframe, verified with a SetupIntent, and only Stripe's reference id and
 * display details (brand, last 4, expiry) ever reach our server.
 */
const PaymentMethodsTab = () => {
  const { t } = useTranslation(['billing', 'common']);
  const { isDark } = useTheme();
  const card = surfaceStyle(isDark);
  const { cardGateAvailable, activeGateway, stripePublishableKey } = usePayments();

  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [starting, setStarting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const stripePromise = useMemo(
    () => getStripePromise(stripePublishableKey),
    [stripePublishableKey]
  );

  const refresh = useCallback(() => {
    setLoading(true);
    paymentMethodsApi.list()
      .then((data) => setCards(data.paymentMethods || []))
      .catch(() => message.error(t('billing:cards.loadFailed')))
      .finally(() => setLoading(false));
    // `t` changes identity with the language, so a switch refreshes rather
    // than leaving a message stranded in the previous one.
  }, [t]);

  useEffect(() => {
    if (cardGateAvailable) refresh();
    else setLoading(false);
  }, [cardGateAvailable, refresh]);

  /**
   * Stripe: open the in-page Elements modal below. Polar has no equivalent
   * modal — card management is entirely on Polar's own hosted Customer
   * Portal — so this instead redirects there; the portal's own return_url
   * sends the customer back to this same tab, and the next `list()` call
   * (on mount) picks up anything they saved via syncFromPolar server-side.
   */
  const openAddCard = async () => {
    setStarting(true);
    try {
      if (activeGateway === 'polar') {
        const { url } = await paymentMethodsApi.startPolarPortal();
        window.location.href = url;
        return;
      }
      const { clientSecret: secret } = await paymentMethodsApi.createSetupIntent();
      setClientSecret(secret);
      setModalOpen(true);
    } catch (err) {
      message.error(err.response?.data?.message || t('billing:cards.startFailed'));
    } finally {
      setStarting(false);
    }
  };

  const handleVerified = async (setupIntentId) => {
    try {
      await paymentMethodsApi.attach(setupIntentId);
      message.success(t('billing:cards.added'));
      setModalOpen(false);
      setClientSecret(null);
      refresh();
    } catch (err) {
      message.error(err.response?.data?.message || t('billing:cards.saveFailed'));
    }
  };

  const handleSetDefault = async (id) => {
    setBusyId(id);
    try {
      await paymentMethodsApi.setDefault(id);
      message.success(t('billing:cards.defaultUpdated'));
      refresh();
    } catch (err) {
      message.error(err.response?.data?.message || t('billing:cards.defaultUpdateFailed'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmRemove = (c) => {
    Modal.confirm({
      title: t('billing:cards.removeConfirm', { brand: c.brand, last4: c.last4 }),
      content: t('billing:cards.removeWarning'),
      okText: t('billing:cards.removeCard'),
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusyId(c.id);
        try {
          await paymentMethodsApi.remove(c.id);
          message.success(t('billing:cards.removed'));
          refresh();
        } catch (err) {
          const data = err.response?.data;
          if (data?.code === 'LAST_CARD') {
            message.error(data.message);
          } else {
            message.error(data?.message || t('billing:cards.removeFailed'));
          }
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  /**
   * LemonSqueezy cannot store a card or charge one later — it has no API for
   * either. Rather than show a form that can only ever fail, this tab says so
   * plainly and points at what still works (wallet top-ups go through the
   * gateway already configured on that page).
   */
  if (!cardGateAvailable) {
    return (
      <Card style={card}>
        <Empty
          image={<CreditCardOutlined style={{ fontSize: 40, opacity: 0.4 }} />}
          description={
            <div style={{ maxWidth: 420, margin: '0 auto' }}>
              <Text strong style={{ display: 'block', marginBottom: 6 }}>
                Saved cards aren&apos;t available right now
              </Text>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {activeGateway === 'lemonsqueezy'
                  ? "This platform's payment provider doesn't support saving a card for later billing. "
                    + t('billing:cards.topUpsStillWork')
                  : t('billing:cards.notConfigured')}
              </Text>
            </div>
          }
          style={{ padding: 32 }}
        />
      </Card>
    );
  }

  // Polar has no in-page "add" step — it always redirects to the hosted
  // portal, which is also where a customer manages/removes cards on Polar's
  // own side, so the button reads t('billing:cards.manageCards') rather than t('billing:cards.addNewCard').
  const addCardLabel = activeGateway === 'polar' ? t('billing:cards.manageCards') : t('billing:cards.addNewCard');

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <div>
          <Title level={5} style={{ margin: 0 }}>{t('billing:tabs.paymentMethods')}</Title>
          <Text type="secondary" style={{ fontSize: 12.5 }}>
            {t('billing:cards.defaultCardNote')}
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} loading={starting} onClick={openAddCard}>
          {addCardLabel}
        </Button>
      </div>

      {loading ? (
        <Card style={card}><Spin /></Card>
      ) : cards.length === 0 ? (
        <Card style={card}>
          <Empty description={t('billing:cards.empty')} style={{ padding: 32 }}>
            <Button type="primary" icon={<PlusOutlined />} loading={starting} onClick={openAddCard}>
              {addCardLabel}
            </Button>
          </Empty>
        </Card>
      ) : (
        <Row gutter={[20, 20]}>
          {cards.map((c) => {
            const tone = TILE[BRAND_TONE[(c.brand || '').toLowerCase()] || 'blue'];
            return (
              <Col xs={24} sm={12} lg={8} key={c.id}>
                <Card
                  style={{ ...card, height: '100%' }}
                  styles={{ body: { padding: 20, display: 'flex', flexDirection: 'column', height: '100%' } }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{
                      width: 44, height: 30, borderRadius: 6, flexShrink: 0,
                      background: tone.bg(isDark), color: tone.fg(isDark),
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                    }}>
                      <CreditCardOutlined />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text strong style={{ display: 'block', fontSize: 13.5, textTransform: 'capitalize' }}>
                        {c.brand}
                      </Text>
                      {c.isDefault && (
                        <Text style={{ fontSize: 11.5, color: STATUS_COLORS.success.light, fontWeight: 600 }}>
                          <CheckCircleOutlined /> {t('billing:cards.default')}
                        </Text>
                      )}
                    </div>
                  </div>

                  <Text style={{ fontSize: 15, letterSpacing: '0.08em', ...monoNumeric }}>
                    •••• •••• •••• {c.last4}
                  </Text>
                  <Space size={6} style={{ marginTop: 4, marginBottom: 16 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Expires {String(c.expMonth).padStart(2, '0')}/{String(c.expYear).slice(-2)}
                    </Text>
                    {c.isExpired && <Tag color="red" style={{ fontSize: 11 }}>{t('billing:cards.expired')}</Tag>}
                    {!c.isExpired && c.daysUntilExpiry !== null && c.daysUntilExpiry <= 30 && (
                      <Tag color="orange" style={{ fontSize: 11 }} icon={<WarningFilled />}>
                        {t('billing:cards.expiringSoon')}
                      </Tag>
                    )}
                  </Space>

                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                    {!c.isDefault && (
                      <Button
                        size="small"
                        loading={busyId === c.id}
                        onClick={() => handleSetDefault(c.id)}
                      >
                        {t('billing:cards.makeDefault')}
                      </Button>
                    )}
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      loading={busyId === c.id}
                      onClick={() => confirmRemove(c)}
                    >
                      {t('billing:cards.remove')}
                    </Button>
                  </div>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      <Modal
        title={t('billing:cards.title')}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setClientSecret(null); }}
        footer={null}
        destroyOnHidden
      >
        <Text type="secondary" style={{ fontSize: 12.5, display: 'block', marginBottom: 16 }}>
          {t('billing:cards.stripeNote')}
        </Text>
        {clientSecret && stripePromise ? (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: isDark ? 'night' : 'stripe' } }}>
            <CardEntryForm
              onVerified={handleVerified}
              onCancel={() => { setModalOpen(false); setClientSecret(null); }}
            />
          </Elements>
        ) : (
          <Spin />
        )}
      </Modal>
    </>
  );
};

export default PaymentMethodsTab;
