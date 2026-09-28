import React from 'react';
import { Result, Button, Space, Typography } from 'antd';
import { CloseCircleOutlined, ArrowLeftOutlined, WalletOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const CheckoutCancelPage = () => {
  const { t } = useTranslation(['billing', 'common']);
  const navigate = useNavigate();

  return (
      <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
        <Result
          icon={<CloseCircleOutlined style={{ color: '#D97706', fontSize: 64 }} />}
          title={t('billing:checkout.cancelledTitle')}
          subTitle={
            <Text type="secondary" style={{ fontSize: 16 }}>
              {t('billing:checkout.cancelledBody')}
            </Text>
          }
          extra={
            <Space size="middle">
              <Button
                type="primary"
                size="large"
                icon={<WalletOutlined />}
                onClick={() => navigate('/wallet')}
                style={{ fontWeight: 600, height: 46 }}
              >
                {t('billing:checkout.backToWallet')}
              </Button>
              <Button
                size="large"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate('/dashboard')}
                style={{ fontWeight: 600, height: 46 }}
              >
                {t('billing:checkout.goToDashboard')}
              </Button>
            </Space>
          }
        />
      </div>
  );
};

export default CheckoutCancelPage;
