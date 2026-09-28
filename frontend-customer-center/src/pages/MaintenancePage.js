import React from 'react';
import { Typography } from 'antd';
import { ToolOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../context/ThemeContext';
import { cardStyle, getBrand, pageBg } from '../theme/colors';

const { Text } = Typography;

const MaintenancePage = ({ message }) => {
  const { t } = useTranslation('auth');
  const { isDark } = useTheme();
  const brand = getBrand(isDark);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: pageBg(isDark),
        padding: 24,
      }}
    >
      <div
        style={{
          ...cardStyle(isDark, true),
          padding: '48px 40px',
          maxWidth: 480,
          width: '100%',
          textAlign: 'center',
        }}
      >
        <ToolOutlined
          style={{
            fontSize: 44,
            color: brand,
            marginBottom: 20,
          }}
        />
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: isDark ? '#E6E8EC' : '#101828',
            marginBottom: 12,
          }}
        >
          {t("maintenance.title")}
        </h1>
        <Text
          type="secondary"
          style={{ fontSize: 15, lineHeight: 1.6, display: 'block' }}
        >
          {message || t('maintenance.defaultMessage')}
        </Text>
      </div>
    </div>
  );
};

export default MaintenancePage;
