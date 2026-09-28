import React from 'react';
import { Card, Empty } from 'antd';
import { useTheme } from '../../contexts/ThemeContext';
import { chartConfig } from '../../theme/chartTheme';

let Line;
try {
  Line = require('@ant-design/charts').Line;
} catch {
  Line = null;
}

const TrendChart = ({ data = [], loading = false }) => {
  const { isDark } = useTheme();

  if (!Line) {
    return (
      <Card title="Deployment Trends" loading={loading}>
        <Empty description="Charts unavailable" />
      </Card>
    );
  }

  const chartData = data.flatMap((item) => [
    { date: item.date, value: item.requested || 0, type: 'Requested' },
    { date: item.date, value: item.wentLive || 0, type: 'Went live' },
  ]);

  const config = {
    ...chartConfig(isDark),
    data: chartData,
    xField: 'date',
    yField: 'value',
    colorField: 'type',
    smooth: true,
    height: 300,
    interaction: { tooltip: { marker: true } },
    style: { lineWidth: 2 },
  };

  return (
    <Card title="Deployment Trends" loading={loading}>
      {chartData.length > 0 ? <Line {...config} /> : <Empty description="No data available" />}
    </Card>
  );
};

export default TrendChart;
