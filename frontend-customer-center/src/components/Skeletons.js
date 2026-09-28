import React from 'react';
import { Row, Col, Card } from 'antd';
import { useTheme } from '../context/ThemeContext';
import { cardStyle } from '../theme/colors';
import { StatRow, StatCard } from './StatRow';

/**
 * Purpose-built loading skeletons — shaped like the page they stand in for,
 * rather than a generic centered spinner. Swapping a blank-then-spinner
 * transition for a skeleton that already has the right layout is one of the
 * cheapest wins for perceived speed: the page looks like it's arriving
 * instead of starting over.
 */

const Block = ({ w = '100%', h = 14, r = 6, style }) => {
  const { isDark } = useTheme();
  return (
    <div
      className={`aio-skeleton ${isDark ? 'dark-skeleton' : ''}`}
      style={{ width: w, height: h, borderRadius: r, ...style }}
    />
  );
};

export const StatCardsSkeleton = ({ count = 4 }) => (
  <StatRow>
    {Array.from({ length: count }).map((_, i) => (
      <StatCard key={i} count={count}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Block w={42} h={42} r={13} />
          <Block w={86} h={11} />
        </div>
        <Block w={110} h={30} />
        <Block w="65%" h={12} style={{ marginTop: 12 }} />
      </StatCard>
    ))}
  </StatRow>
);

export const CardGridSkeleton = ({ count = 6 }) => {
  const { isDark } = useTheme();
  const card = cardStyle(isDark);
  return (
    <Row gutter={[20, 20]}>
      {Array.from({ length: count }).map((_, i) => (
        <Col xs={24} sm={12} lg={8} key={i}>
          <Card style={card} styles={{ body: { padding: 20 } }}>
            <Block w={70} h={20} r={999} style={{ marginBottom: 14 }} />
            <Block w="70%" h={20} style={{ marginBottom: 10 }} />
            <Block w="100%" h={13} style={{ marginBottom: 6 }} />
            <Block w="85%" h={13} style={{ marginBottom: 18 }} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <Block w={60} h={22} r={6} />
              <Block w={70} h={22} r={6} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Block w={80} h={24} />
              <Block w={90} h={34} r={8} />
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
};

export const TableRowsSkeleton = ({ rows = 5 }) => {
  const { isDark } = useTheme();
  const card = cardStyle(isDark);
  return (
    <Card style={card} styles={{ body: { padding: 0 } }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 16,
            padding: '16px 24px',
            borderBottom: i < rows - 1 ? `1px solid ${isDark ? '#232838' : '#E5E7EB'}` : 'none',
          }}
        >
          <Block w={36} h={36} r={8} />
          <div style={{ flex: 1 }}>
            <Block w="30%" h={14} style={{ marginBottom: 8 }} />
            <Block w="18%" h={11} />
          </div>
          <Block w={70} h={22} r={999} />
          <Block w={60} h={14} />
        </div>
      ))}
    </Card>
  );
};

export const DetailSkeleton = () => {
  const { isDark } = useTheme();
  const card = cardStyle(isDark);
  return (
    <div>
      <Block w={160} h={13} style={{ marginBottom: 16 }} />
      <Card style={{ ...card, marginBottom: 20 }} styles={{ body: { padding: '24px 28px' } }}>
        <Block w={90} h={20} r={999} style={{ marginBottom: 12 }} />
        <Block w="40%" h={30} style={{ marginBottom: 10 }} />
        <Block w="60%" h={15} />
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card style={card} styles={{ body: { padding: 24 } }}>
            <Block w="100%" h={13} style={{ marginBottom: 8 }} />
            <Block w="90%" h={13} style={{ marginBottom: 8 }} />
            <Block w="75%" h={13} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card style={card} styles={{ body: { padding: 24 } }}>
            <Block w="100%" h={13} style={{ marginBottom: 12 }} />
            <Block w="100%" h={13} style={{ marginBottom: 12 }} />
            <Block w="100%" h={13} />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

const Skeletons = { StatCardsSkeleton, CardGridSkeleton, TableRowsSkeleton, DetailSkeleton };

export default Skeletons;
