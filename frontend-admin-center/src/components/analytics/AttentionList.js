import React from 'react';
import { Card, Typography, Empty, Space } from 'antd';
import {
  CheckCircleOutlined, RightOutlined, ExclamationCircleFilled, WarningFilled, InfoCircleFilled,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import {
  adminCardStyle, STATUS_COLORS, muted, hairline, monoNumeric, ADMIN_DENSITY,
} from '../../theme/colors';
import { TableRowsSkeleton } from '../Skeletons';

const { Text } = Typography;

const SEVERITY = {
  error: { icon: ExclamationCircleFilled, tone: 'error', rank: 0 },
  warning: { icon: WarningFilled, tone: 'warning', rank: 1 },
  info: { icon: InfoCircleFilled, tone: 'info', rank: 2 },
};

/**
 * The first thing on the Dashboard: what needs a human today.
 *
 * Deliberately a dense list rather than a row of cards. These are a work
 * queue, and a queue is read top to bottom — cards would imply each item is a
 * standalone metric worth the same glance, when in fact the ordering IS the
 * message. Severity comes from the policy, so an operator who disagrees about
 * what counts as urgent changes it there rather than arguing with this file.
 *
 * Each row is built to be actionable on its own: the count, a plain sentence
 * naming the real number and the threshold it crossed, and a click that lands
 * on the screen where the thing gets fixed. A row that cannot say what to do
 * about it does not belong here.
 *
 * The empty state is a real answer, not a placeholder. "Nothing needs
 * attention" is the single most valuable thing this page can tell someone,
 * and it should look like a conclusion rather than like a failed fetch.
 */
const AttentionList = ({ items = [], loading = false, error = null, checkedAt }) => {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const border = hairline(isDark);

  if (loading) return <TableRowsSkeleton rows={3} />;

  const sorted = [...items].sort(
    (a, b) => (SEVERITY[a.severity]?.rank ?? 9) - (SEVERITY[b.severity]?.rank ?? 9),
  );

  return (
    <Card
      // 14, like every other gap on the page (PageHeader, StatRow, card rows).
      // It was 16, which made the one gap under the attention list visibly
      // looser than the rest and read as a mistake rather than as emphasis.
      style={{ ...adminCardStyle(isDark), marginBottom: 14 }}
      styles={{ body: { padding: 0 } }}
      title={(
        <Space size={8}>
          <Text strong style={{ fontSize: 14 }}>Needs attention</Text>
          {sorted.length > 0 && (
            <span style={{
              ...monoNumeric,
              fontSize: 11.5,
              fontWeight: 700,
              padding: '1px 7px',
              borderRadius: 999,
              background: STATUS_COLORS.error.bg(isDark),
              color: STATUS_COLORS.error[isDark ? 'dark' : 'light'],
            }}
            >
              {sorted.length}
            </span>
          )}
        </Space>
      )}
      extra={checkedAt && (
        <Text style={{ fontSize: 11, color: muted(isDark) }}>
          checked {new Date(checkedAt).toLocaleTimeString()}
        </Text>
      )}
    >
      {error && (
        <div style={{ padding: 20 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Text type="secondary" style={{ fontSize: 13 }}>{error}</Text>}
          />
        </div>
      )}

      {!error && sorted.length === 0 && (
        <div style={{ padding: '28px 20px', textAlign: 'center' }}>
          <CheckCircleOutlined
            style={{ fontSize: 26, color: STATUS_COLORS.success[isDark ? 'dark' : 'light'] }}
          />
          <div style={{ marginTop: 8 }}>
            <Text strong style={{ fontSize: 13.5 }}>Nothing needs attention</Text>
          </div>
          <Text style={{ fontSize: 12, color: muted(isDark) }}>
            No stock-outs, overdue debt, unanswered tickets or failing jobs right now.
          </Text>
        </div>
      )}

      {!error && sorted.map((item, i) => {
        const meta = SEVERITY[item.severity] || SEVERITY.info;
        const Icon = meta.icon;
        const colour = STATUS_COLORS[meta.tone][isDark ? 'dark' : 'light'];
        return (
          <div
            key={item.key}
            role="button"
            tabIndex={0}
            onClick={() => item.href && navigate(item.href)}
            onKeyDown={(e) => { if (e.key === 'Enter' && item.href) navigate(item.href); }}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 11,
              padding: `${ADMIN_DENSITY.rowPaddingY + 3}px ${ADMIN_DENSITY.rowPaddingX + 4}px`,
              borderTop: i === 0 ? 'none' : `1px solid ${border}`,
              // The severity reads as a rule down the left edge rather than as
              // a filled row — a page of filled red rows stops meaning urgent.
              borderLeft: `3px solid ${colour}`,
              cursor: item.href ? 'pointer' : 'default',
            }}
            className={item.href ? 'row-hover' : undefined}
          >
            <Icon style={{ color: colour, fontSize: 15, marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong style={{ fontSize: 13.2, display: 'block' }}>{item.title}</Text>
              <Text style={{ fontSize: 12, color: muted(isDark) }}>{item.detail}</Text>
            </div>
            {item.href && (
              <RightOutlined style={{ fontSize: 11, color: muted(isDark), marginTop: 4, flexShrink: 0 }} />
            )}
          </div>
        );
      })}
    </Card>
  );
};

export default AttentionList;
