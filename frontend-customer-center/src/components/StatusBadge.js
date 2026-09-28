import React from 'react';
import { useTheme } from '../context/ThemeContext';
import { STATUS_COLORS } from '../theme/colors';

/**
 * Dot + label status indicator — reads at a glance, and separates semantic
 * state (running/paused/failed…) from the brand accent color. `pulse` puts a
 * soft animated ring around the dot for states that are actively live
 * ("running", "provisioning").
 *
 * Usage: <StatusBadge tone="success" label="Running" pulse />
 */
const StatusBadge = ({ tone = 'neutral', label, pulse = false, size = 'default' }) => {
  const { isDark } = useTheme();
  const c = STATUS_COLORS[tone] || STATUS_COLORS.neutral;
  const dotColor = isDark ? c.dark : c.light;
  const small = size === 'small';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: small ? '2px 8px 2px 6px' : '3px 10px 3px 7px',
        borderRadius: 999,
        background: c.bg(isDark),
        fontSize: small ? 11.5 : 12.5,
        fontWeight: 600,
        color: dotColor,
        lineHeight: 1.6,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        className={pulse ? 'status-dot pulse' : 'status-dot'}
        style={{ background: dotColor, width: small ? 6 : 7, height: small ? 6 : 7 }}
      />
      {label}
    </span>
  );
};

export default StatusBadge;
