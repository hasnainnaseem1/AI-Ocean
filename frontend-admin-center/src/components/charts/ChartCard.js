import React from 'react';
import { Card, Empty, Button, Typography, Space } from 'antd';
import { ReloadOutlined, BarChartOutlined } from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { adminCardStyle, muted } from '../../theme/colors';
import { chartsAvailable } from './chartLoader';
import { ChartSkeleton } from '../Skeletons';
import MetricLegend from './MetricLegend';

const { Text } = Typography;

/**
 * The frame every chart on the Dashboard and Analytics pages sits in.
 *
 * It owns the four states a chart actually has — loading, failed, empty, and
 * drawn — so no chart component has to, and so they cannot each answer them
 * differently. Before this, each call site wrote its own
 * `{ data?.length && Line ? <Line/> : <Empty/> }`, which meant a failed fetch
 * and a genuinely quiet week looked identical: both rendered "No data".
 *
 * Those two are now distinguishable, which matters more than it sounds. "We
 * sold nothing on Tuesday" is information. "We could not find out what
 * happened on Tuesday" is a different thing entirely, and an operator who
 * cannot tell them apart will eventually act on the wrong one.
 *
 * `definition` / `caveat` are passed through to `MetricLegend` beneath the
 * chart — this is the component that makes "every number carries its reason"
 * the default rather than something each page remembers.
 */
const ChartCard = ({
  title,
  subtitle,
  extra,
  loading = false,
  error = null,
  onRetry,
  empty = false,
  emptyText = 'Nothing recorded in this period',
  height = 280,
  definition,
  window: windowLabel,
  source,
  caveat,
  children,
  style,
}) => {
  const { isDark } = useTheme();

  const body = () => {
    if (loading) return <ChartSkeleton height={height} />;

    if (error) {
      return (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={(
              <Space direction="vertical" size={6}>
                <Text type="secondary" style={{ fontSize: 13 }}>{error}</Text>
                {onRetry && (
                  <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>Retry</Button>
                )}
              </Space>
            )}
          />
        </div>
      );
    }

    // The library itself failed to load — a different failure from "no data",
    // and one an operator can do nothing about, so say so plainly.
    if (!chartsAvailable) {
      return (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty
            image={<BarChartOutlined style={{ fontSize: 34, color: muted(isDark) }} />}
            description={<Text type="secondary" style={{ fontSize: 13 }}>Charts could not be loaded in this browser</Text>}
          />
        </div>
      );
    }

    if (empty) {
      return (
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Text type="secondary" style={{ fontSize: 13 }}>{emptyText}</Text>}
          />
        </div>
      );
    }

    return children;
  };

  return (
    <Card
      style={{ ...adminCardStyle(isDark), ...style }}
      styles={{ body: { padding: '14px 16px 12px' } }}
      title={(
        <div style={{ paddingTop: 2 }}>
          <Text strong style={{ fontSize: 14 }}>{title}</Text>
          {subtitle && (
            <div>
              <Text style={{ fontSize: 11.5, color: muted(isDark), fontWeight: 400 }}>{subtitle}</Text>
            </div>
          )}
        </div>
      )}
      extra={extra}
    >
      {body()}
      {!loading && !error && (
        <MetricLegend
          definition={definition}
          window={windowLabel}
          source={source}
          caveat={caveat}
        />
      )}
    </Card>
  );
};

export default ChartCard;
