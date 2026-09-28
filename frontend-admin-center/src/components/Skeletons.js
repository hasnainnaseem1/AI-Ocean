import React from 'react';
import { Row, Col, Card } from 'antd';
import { useTheme } from '../contexts/ThemeContext';
import { adminCardStyle, hairline, ADMIN_DENSITY } from '../theme/colors';
import { StatRow, StatCard } from './StatRow';

/**
 * Purpose-built loading skeletons — shaped like the page they stand in for,
 * rather than a generic centered spinner. Every DataTable and detail page in
 * this redesign uses one of these while its first fetch is in flight instead
 * of a `<Spin>`, so the page looks like it is arriving rather than starting
 * over.
 *
 * Ported from the customer center with the admin center's tighter row padding
 * (see ADMIN_DENSITY) — a 10px-padding table row skeleton next to a 16px one
 * would visibly mismatch once the real data swaps in.
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 13 }}>
          <Block w={ADMIN_DENSITY.iconTile} h={ADMIN_DENSITY.iconTile} r={11} />
          <Block w={82} h={11} />
        </div>
        <Block w={96} h={ADMIN_DENSITY.statValueSize} />
        <Block w="65%" h={12} style={{ marginTop: 10 }} />
      </StatCard>
    ))}
  </StatRow>
);

export const CardGridSkeleton = ({ count = 6 }) => {
  const { isDark } = useTheme();
  const card = adminCardStyle(isDark);
  return (
    <Row gutter={[16, 16]}>
      {Array.from({ length: count }).map((_, i) => (
        <Col xs={24} sm={12} lg={8} key={i}>
          <Card style={card} styles={{ body: { padding: 18 } }}>
            <Block w={70} h={20} r={999} style={{ marginBottom: 13 }} />
            <Block w="70%" h={19} style={{ marginBottom: 9 }} />
            <Block w="100%" h={12} style={{ marginBottom: 6 }} />
            <Block w="85%" h={12} style={{ marginBottom: 16 }} />
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <Block w={56} h={20} r={6} />
              <Block w={64} h={20} r={6} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
              <Block w={74} h={22} />
              <Block w={84} h={30} r={8} />
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
};

/**
 * The default loading state for DataTable — rows sized to the admin center's
 * denser table padding (10px/16px, vs the customer center's 14px/24px), so
 * swapping in real rows doesn't visibly shift the page height.
 */
export const TableRowsSkeleton = ({ rows = 5 }) => {
  const { isDark } = useTheme();
  const card = adminCardStyle(isDark);
  const border = hairline(isDark);
  return (
    <Card style={card} styles={{ body: { padding: 0 } }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: `${ADMIN_DENSITY.rowPaddingY + 2}px ${ADMIN_DENSITY.rowPaddingX}px`,
            borderBottom: i < rows - 1 ? `1px solid ${border}` : 'none',
          }}
        >
          <Block w={30} h={30} r={7} />
          <div style={{ flex: 1 }}>
            <Block w="28%" h={13} style={{ marginBottom: 7 }} />
            <Block w="16%" h={10} />
          </div>
          <Block w={64} h={20} r={999} />
          <Block w={56} h={13} />
        </div>
      ))}
    </Card>
  );
};

export const DetailSkeleton = () => {
  const { isDark } = useTheme();
  const card = adminCardStyle(isDark);
  return (
    <div>
      <Block w={150} h={12} style={{ marginBottom: 14 }} />
      <Card style={{ ...card, marginBottom: 18 }} styles={{ body: { padding: '20px 24px' } }}>
        <Block w={84} h={19} r={999} style={{ marginBottom: 11 }} />
        <Block w="40%" h={26} style={{ marginBottom: 9 }} />
        <Block w="60%" h={14} />
      </Card>
      <Row gutter={[14, 14]}>
        <Col xs={24} lg={14}>
          <Card style={card} styles={{ body: { padding: 20 } }}>
            <Block w="100%" h={12} style={{ marginBottom: 7 }} />
            <Block w="90%" h={12} style={{ marginBottom: 7 }} />
            <Block w="75%" h={12} />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card style={card} styles={{ body: { padding: 20 } }}>
            <Block w="100%" h={12} style={{ marginBottom: 11 }} />
            <Block w="100%" h={12} style={{ marginBottom: 11 }} />
            <Block w="100%" h={12} />
          </Card>
        </Col>
      </Row>
    </div>
  );
};

const Skeletons = { StatCardsSkeleton, CardGridSkeleton, TableRowsSkeleton, DetailSkeleton };

export default Skeletons;
