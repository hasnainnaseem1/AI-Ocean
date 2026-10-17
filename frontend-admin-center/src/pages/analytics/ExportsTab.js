import React, { useEffect, useState } from 'react';
import {
  Card, Space, Typography, Button, Tag, Tooltip, message,
} from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import TabHeader from '../../components/analytics/TabHeader';
import PeriodPicker from '../../components/analytics/PeriodPicker';
import useAnalyticsWindow from '../../hooks/useAnalyticsWindow';
import MetricLegend from '../../components/charts/MetricLegend';
import { TableRowsSkeleton } from '../../components/Skeletons';
import exportApi from '../../api/exportApi';
import { usePermission } from '../../hooks/usePermission';
import { PERMISSIONS } from '../../utils/permissions';
import { useTheme } from '../../contexts/ThemeContext';
import { TILE, muted, hairline } from '../../theme/colors';

const { Text } = Typography;

const TAB_LABEL = {
  infrastructure: 'Infrastructure',
  customers: 'Customers',
  revenue: 'Revenue & Billing',
  support: 'Support',
  retention: 'Retention',
  'churn-risk': 'At-Risk Accounts',
  traffic: 'Traffic',
};

/**
 * Taking the data away.
 *
 * The datasets are listed by the server, not by this file. Adding an export is
 * an entry in the backend registry; if this page held its own copy of the list
 * it would be a second place to forget.
 *
 * ── Why this still exists now every tab has its own button ──
 *
 * The buttons on the other tabs each offer what is on that screen. This is the
 * whole catalogue in one place, for somebody who wants a file and does not
 * already know which screen it lives behind. Each row says which tab it comes
 * from, so the two views read as one list rather than as two lists that might
 * disagree — and they cannot disagree, because both are the same registry.
 *
 * Reached only with `analytics.export` — the tab is not rendered at all
 * without it. Looking at a figure and walking out with the customer list
 * behind it are different rights, and this is the one that leaves the
 * building.
 */
const ExportsTab = () => {
  const { isDark } = useTheme();
  const { hasPermission } = usePermission();
  const canSeeRevenue = hasPermission(PERMISSIONS.ANALYTICS_REVENUE);

  const [datasets, setDatasets] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const { params: windowParams, picker } = useAnalyticsWindow();

  useEffect(() => {
    exportApi.list()
      .then((d) => setDatasets(d.datasets || []))
      .catch(() => setDatasets([]));
  }, []);

  const download = async (key) => {
    setDownloading(key);
    try {
      message.success(`Downloaded ${await exportApi.download(key, windowParams)}`);
    } catch (err) {
      message.error(err.response?.status === 403
        ? 'Exporting needs the Analytics Export permission'
        : 'Could not build that export');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div>
      <TabHeader
        subtitle="Every dataset below honours the window you pick here, and each download is written to the activity log"
        extra={<PeriodPicker {...picker} />}
      />

      <Card
        size="small"
        title={(
          <Space size={7}>
            <DownloadOutlined style={{ color: TILE.green.fg(isDark) }} />
            <Text strong style={{ fontSize: 14 }}>Available datasets</Text>
          </Space>
        )}
      >
        {datasets === null ? <TableRowsSkeleton rows={4} /> : (
          <>
            {datasets.map((d, i) => (
              <div
                key={d.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: i === datasets.length - 1 ? 'none' : `1px solid ${hairline(isDark)}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Space size={7} align="baseline">
                    <Text strong style={{ fontSize: 12.5 }}>{d.label}</Text>
                    {TAB_LABEL[d.tab] && (
                      <Tag style={{ fontSize: 10 }}>{TAB_LABEL[d.tab]}</Tag>
                    )}
                    {d.hasMoney && (
                      <Tooltip title={canSeeRevenue
                        ? 'Includes amount columns'
                        : 'The amount columns are left out of your copy — the rest still downloads'}
                      >
                        <Tag color={canSeeRevenue ? 'green' : 'default'} style={{ fontSize: 10 }}>
                          {canSeeRevenue ? 'has money' : 'money hidden'}
                        </Tag>
                      </Tooltip>
                    )}
                  </Space>
                  <div><Text style={{ fontSize: 11.5, color: muted(isDark) }}>{d.description}</Text></div>
                </div>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  loading={downloading === d.key}
                  onClick={() => download(d.key)}
                >
                  CSV
                </Button>
              </div>
            ))}
            {!datasets.length && (
              <Text type="secondary" style={{ fontSize: 12.5 }}>Nothing is exportable yet</Text>
            )}
            <MetricLegend
              definition="Every dataset is also one click away on its own tab. The list comes from the server, so a dataset added later appears in both places without a release."
              /* Two separate rights, stated where somebody is about to use
                 one of them. */
              caveat="Amount columns are removed for anyone without the Revenue Analytics permission — the rest of the file still downloads."
            />
          </>
        )}
      </Card>
    </div>
  );
};

export default ExportsTab;
