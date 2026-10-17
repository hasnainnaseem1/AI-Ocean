import React from 'react';
import { Typography, Space } from 'antd';
import { useTheme } from '../../contexts/ThemeContext';
import { muted } from '../../theme/colors';

const { Text } = Typography;

/**
 * The strip at the top of an analytics tab: what this view is, and its own
 * controls.
 *
 * Each analytics page is reachable two ways — as a tab inside `/analytics`,
 * and (for a deep link or a bookmark) as a page of its own. As a page it draws
 * a `PageHeader` with a title and breadcrumbs; as a tab that would be a second
 * heading under the one the shell already drew, and a second breadcrumb trail
 * repeating what the tab bar just said.
 *
 * So a tab keeps only the two things the shell cannot provide: a sentence
 * saying what this particular view answers, and the controls that belong to
 * it — the period, a site filter, a Refresh. One component rather than the
 * same flex row written seven times.
 */
const TabHeader = ({ subtitle, extra }) => {
  const { isDark } = useTheme();

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 10,
      marginBottom: 14,
    }}
    >
      <Text style={{ fontSize: 12.5, color: muted(isDark) }}>{subtitle}</Text>
      {extra && <Space wrap>{extra}</Space>}
    </div>
  );
};

export default TabHeader;
