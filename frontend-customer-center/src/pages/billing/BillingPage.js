import React, { useEffect, useState } from 'react';
import { Typography, Segmented } from 'antd';
import {
  WalletOutlined, CreditCardOutlined, FileTextOutlined, PieChartOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import OverviewTab from './tabs/OverviewTab';
import CreditsTab from './tabs/CreditsTab';
import PaymentMethodsTab from './tabs/PaymentMethodsTab';
import InvoicesTab from './tabs/InvoicesTab';
import { useTranslation } from 'react-i18next';

const { Title, Text } = Typography;

/**
 * Holds translation keys, not labels — a module-level constant has no `t` in
 * scope, and a label resolved at import time would keep the first language the
 * tab bar ever rendered in. `tabItems` below translates them per render.
 */
const TABS = [
  { labelKey: 'billing:tabs.overview', value: 'overview', icon: <PieChartOutlined /> },
  { labelKey: 'billing:tabs.invoices', value: 'invoices', icon: <FileTextOutlined /> },
  { labelKey: 'billing:tabs.paymentMethods', value: 'cards', icon: <CreditCardOutlined /> },
  { labelKey: 'billing:tabs.creditBalance', value: 'credits', icon: <WalletOutlined /> },
];

/**
 * The single money hub — overview, invoices, payment methods, and the
 * prepaid credit wallet.
 */
const BillingPage = () => {
  const { t } = useTranslation(['billing', 'common']);
  const { isDark } = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(
    TABS.some((x) => x.value === requestedTab) ? requestedTab : TABS[0].value
  );

  // Deep links from elsewhere in the app (?tab=invoices) must still land, and
  // AppLayout no longer remounts pages on navigation — so react to the param
  // changing rather than only reading it once on mount.
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tab !== activeTab && TABS.some((x) => x.value === tab)) setActiveTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const goToTab = (value) => {
    setActiveTab(value);
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ marginBottom: 4 }}>{t('billing:page.title')}</Title>
        <Text type="secondary">{t('billing:page.subtitle')}</Text>
      </div>

      <Segmented
        value={activeTab}
        onChange={goToTab}
        // Translated here rather than in the constant, so the tab bar
        // follows a language change like everything else.
        options={TABS.map((tab) => ({ ...tab, label: t(tab.labelKey) }))}
        size="large"
        style={{
          marginBottom: 28,
          background: isDark ? 'rgba(255,255,255,0.04)' : '#EEF1FA',
          borderRadius: 12,
          padding: 4,
        }}
      />

      {activeTab === 'overview' && <OverviewTab onGoToTab={goToTab} />}
      {activeTab === 'invoices' && <InvoicesTab />}
      {activeTab === 'cards' && <PaymentMethodsTab />}
      {activeTab === 'credits' && <CreditsTab onGoToTab={goToTab} />}
    </>
  );
};

export default BillingPage;
