import React from 'react';
import { Typography, Tooltip } from 'antd';
import { InfoCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { useTheme } from '../../contexts/ThemeContext';
import { muted, STATUS_COLORS } from '../../theme/colors';

const { Text } = Typography;

/**
 * The sentence under a number that says what the number is.
 *
 * A figure on an analytics page is only useful if the reader knows what was
 * counted, over what window, and whether it can be trusted. Without that, two
 * people read the same "Machine hours: 412" as two different claims — is that
 * billed or elapsed? does it include paused machines? is it this month or the
 * last 30 days? — and the page quietly stops being evidence.
 *
 * So every chart and every non-obvious KPI carries one of these. It is small
 * and grey on purpose: present for the person who needs it, out of the way of
 * the person who does not.
 *
 * `caveat` is the load-bearing one. It is where a figure admits it is an
 * estimate — "resolution times before 12 Oct are estimated", "no comparison
 * available, the previous period was empty". A number that is partly guessed
 * and does not say so is worse than no number.
 */
const MetricLegend = ({ definition, window, source, caveat, style }) => {
  const { isDark } = useTheme();
  if (!definition && !window && !source && !caveat) return null;

  const grey = muted(isDark);
  const warn = STATUS_COLORS.warning[isDark ? 'dark' : 'light'];

  const parts = [definition, window, source].filter(Boolean);

  return (
    <div style={{ marginTop: 8, lineHeight: 1.5, ...style }}>
      {parts.length > 0 && (
        <Text style={{ fontSize: 11.5, color: grey, display: 'block' }}>
          <InfoCircleOutlined style={{ marginRight: 5, opacity: 0.7 }} />
          {/*
            Each part is its own non-breaking span rather than one joined
            string. The window label is short and always last ("30d · UTC"), so
            in a narrow card the line used to break inside it and leave "UTC"
            alone on the next line. A part either fits on the line or moves to
            the next one whole.
          */}
          {parts.map((part, i) => (
            <span key={part} style={{ whiteSpace: i === 0 ? 'normal' : 'nowrap' }}>
              {i > 0 && ' · '}
              {part}
            </span>
          ))}
        </Text>
      )}
      {caveat && (
        <Tooltip title={caveat}>
          <Text style={{ fontSize: 11.5, color: warn, display: 'block', marginTop: 3 }}>
            <WarningOutlined style={{ marginRight: 5 }} />
            {caveat}
          </Text>
        </Tooltip>
      )}
    </div>
  );
};

export default MetricLegend;
