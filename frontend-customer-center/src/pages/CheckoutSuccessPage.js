import React, { useEffect, useRef, useState } from 'react';
import { Result, Button, Space, Typography, Spin, Statistic } from 'antd';
import {
  CheckCircleOutlined, DashboardOutlined,
  LoadingOutlined, WalletOutlined,
} from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getBrand } from '../theme/colors';
import billingApi from '../api/billingApi';
import walletApi from '../api/walletApi';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

/**
 * Landing page after a gateway checkout — every checkout on this platform is
 * a prepaid credit top-up.
 *
 * verifySession is the local-dev fallback for when webhooks can't reach
 * localhost. It's idempotent on the server, so calling it after the webhook
 * has already run is safe.
 */
const CheckoutSuccessPage = () => {
  const { t } = useTranslation(['billing', 'common']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token, fetchMe } = useAuth();
  const { isDark } = useTheme();
  const BRAND = getBrand(isDark);
  const hasFetched = useRef(false);

  const [verifying, setVerifying] = useState(true);
  const [verifyError, setVerifyError] = useState(null);
  const [wallet, setWallet] = useState(null);

  useEffect(() => {
    if (!token || hasFetched.current) return;
    hasFetched.current = true;

    const sessionId = searchParams.get('session_id');

    const confirm = async () => {
      try {
        if (sessionId) {
          await billingApi.verifySession(sessionId);
        }

        // Always show a fresh balance, whichever gateway confirmed the top-up
        const w = await walletApi.get();
        setWallet(w.wallet);
      } catch (err) {
        try { await fetchMe(token); } catch (_) { /* ignore */ }
        setVerifyError(t('billing:credits.topUpNotConfirmed'));
      } finally {
        setVerifying(false);
      }
    };

    confirm();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (verifying) {
    return (
        <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 48, color: BRAND }} spin />} />
          <div style={{ marginTop: 24 }}>
            <Text type="secondary" style={{ fontSize: 16 }}>
              {t('billing:checkout.addingCredit')}
            </Text>
          </div>
        </div>
    );
  }

  return (
      <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
        <Result
          icon={<CheckCircleOutlined style={{ color: '#52c41a', fontSize: 72 }} />}
          title={t('billing:checkout.successTitle')}
          subTitle={
            <>
              <Text type="secondary" style={{ fontSize: 16 }}>
                {t('billing:checkout.successBody')}
              </Text>

              {wallet && (
                <div style={{ marginTop: 24 }}>
                  <Statistic
                    title={t('billing:checkout.newBalance')}
                    value={wallet.balance}
                    precision={2}
                    prefix={wallet.currency}
                    styles={{ content: { color: BRAND, fontWeight: 700 } }}
                  />
                </div>
              )}

              {verifyError && (
                <div style={{ marginTop: 12 }}>
                  <Text type="warning" style={{ fontSize: 14 }}>{verifyError}</Text>
                </div>
              )}
            </>
          }
          extra={
            <Space size="middle" wrap>
              <Button
                type="primary"
                size="large"
                icon={<DashboardOutlined />}
                onClick={() => navigate('/dashboard')}
                style={{ fontWeight: 600, height: 46 }}
              >
                {t('billing:checkout.goToDashboard')}
              </Button>
              <Button
                size="large"
                icon={<WalletOutlined />}
                onClick={() => navigate('/wallet')}
                style={{ fontWeight: 600, height: 46, borderRadius: 10 }}
              >
                {t('billing:checkout.viewWallet')}
              </Button>
            </Space>
          }
        />
      </div>
  );
};

export default CheckoutSuccessPage;
