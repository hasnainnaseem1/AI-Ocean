import React from 'react';
import { Typography, Tooltip } from 'antd';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, muted, hairline, monoNumeric } from '../../theme/colors';

const { Text } = Typography;

/** Stock level → the colour it reads as. Levels come from the policy, so the
 *  boundaries are the operator's to move; only the palette lives here. */
const LEVEL_TONE = {
  out: 'error',
  critical: 'error',
  low: 'warning',
  ok: 'success',
  unlimited: 'info',
};

const LEVEL_LABEL = {
  out: 'Out of stock',
  critical: 'Critical',
  low: 'Running low',
  ok: 'Healthy',
  unlimited: 'No ceiling set',
};

/**
 * One machine type's stock, as a bar.
 *
 * A number ("4 of 6 allocated") makes an operator do the arithmetic before
 * they can tell whether to care; a filled bar does not. The colour is the
 * stock LEVEL rather than the raw percentage, so the thresholds an operator
 * set in the policy are what they actually see — move "low" from 25% to 40%
 * and these bars change colour with it.
 *
 * A tier with no declared ceiling (`capacityTotal = 0`) gets a hatched,
 * neutral bar rather than an empty red one: it is not out of stock, it simply
 * has no limit configured, and those two must never look the same.
 */
const StockBar = ({ tier, onClick }) => {
  const { isDark } = useTheme();
  const tone = LEVEL_TONE[tier.stockLevel] || 'info';
  const colour = STATUS_COLORS[tone][isDark ? 'dark' : 'light'];
  const track = hairline(isDark);
  const unlimited = tier.stockLevel === 'unlimited';

  const filledPercent = unlimited
    ? 0
    : Math.min(100, Math.max(0, tier.utilisationPercent ?? 0));

  return (
    <Tooltip
      title={unlimited
        ? 'No capacity ceiling is set for this machine type, so it can never report as out of stock.'
        : `${tier.capacityAllocated} of ${tier.capacityTotal} allocated · ${tier.available} free (${tier.freePercent}%) · ${LEVEL_LABEL[tier.stockLevel]}`}
    >
      <div
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => { if (onClick && e.key === 'Enter') onClick(); }}
        style={{ marginBottom: 12, cursor: onClick ? 'pointer' : 'default' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <Text strong style={{ fontSize: 12.5 }}>{tier.name}</Text>
          <Text style={{ ...monoNumeric, fontSize: 11.5, color: unlimited ? muted(isDark) : colour }}>
            {unlimited ? '—' : `${tier.available}/${tier.capacityTotal} free`}
          </Text>
        </div>

        <div
          style={{
            height: 7,
            borderRadius: 999,
            background: track,
            marginTop: 5,
            overflow: 'hidden',
            // A tier with no ceiling gets stripes rather than a bar, so it
            // cannot be misread as "completely full".
            ...(unlimited ? {
              backgroundImage: `repeating-linear-gradient(45deg, ${track}, ${track} 4px, transparent 4px, transparent 8px)`,
            } : {}),
          }}
        >
          {!unlimited && (
            <div style={{ width: `${filledPercent}%`, height: '100%', background: colour, borderRadius: 999 }} />
          )}
        </div>

        <Text style={{ fontSize: 11, color: muted(isDark) }}>
          {unlimited
            ? 'No ceiling set'
            : `${tier.activeDeployments} running · ${LEVEL_LABEL[tier.stockLevel]}`}
        </Text>
      </div>
    </Tooltip>
  );
};

export default StockBar;
