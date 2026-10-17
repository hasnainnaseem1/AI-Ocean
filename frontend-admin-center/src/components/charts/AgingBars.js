import React from 'react';
import { Typography, Tooltip } from 'antd';
import { useTheme } from '../../contexts/ThemeContext';
import { STATUS_COLORS, muted, hairline, monoNumeric } from '../../theme/colors';

const { Text } = Typography;

/**
 * Receivables by age.
 *
 * Deliberately coloured by AGE rather than by amount: a large balance that is
 * four days old is a customer who has not been invoiced yet, and a small one
 * that is ninety days old is money the platform is probably not getting back.
 * A chart that sizes by amount alone puts those the wrong way round, so the
 * oldest bucket is always the most alarming colour regardless of how little
 * sits in it.
 *
 * Buckets come from the analytics policy — an operator who chases debt on a
 * different rhythm changes them there and this follows.
 */
const TONE_BY_POSITION = ['success', 'info', 'warning', 'warning', 'error'];

const AgingBars = ({ buckets = [], total = 0, currency = '$' }) => {
  const { isDark } = useTheme();
  if (!buckets.length) {
    return <Text type="secondary" style={{ fontSize: 12.5 }}>Nothing outstanding</Text>;
  }

  const sum = total || buckets.reduce((s, b) => s + Number(b.amount || 0), 0);
  const biggest = Math.max(...buckets.map((b) => Number(b.amount || 0)), 1);

  return (
    <div>
      {buckets.map((bucket, i) => {
        // Oldest bucket always takes the last (most severe) tone, however many
        // buckets the policy defines.
        const toneIndex = Math.min(
          TONE_BY_POSITION.length - 1,
          Math.round((i / Math.max(1, buckets.length - 1)) * (TONE_BY_POSITION.length - 1)),
        );
        const colour = STATUS_COLORS[TONE_BY_POSITION[toneIndex]][isDark ? 'dark' : 'light'];
        const amount = Number(bucket.amount || 0);
        const share = sum > 0 ? Math.round((amount / sum) * 100) : 0;

        return (
          <div key={bucket.key} style={{ marginBottom: i === buckets.length - 1 ? 0 : 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
              <Text style={{ fontSize: 12 }}>{bucket.label}</Text>
              <Tooltip title={`${bucket.accounts} account${bucket.accounts === 1 ? '' : 's'} · ${share}% of what is owed`}>
                <span style={{ ...monoNumeric, fontSize: 12, whiteSpace: 'nowrap' }}>
                  {currency}{amount.toFixed(2)}
                  <Text style={{ fontSize: 10.5, color: muted(isDark), marginInlineStart: 6 }}>
                    {bucket.accounts}
                  </Text>
                </span>
              </Tooltip>
            </div>
            <div style={{ height: 7, background: hairline(isDark), borderRadius: 999, marginTop: 3, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${amount > 0 ? Math.max(3, (amount / biggest) * 100) : 0}%`,
                  height: '100%',
                  background: colour,
                  borderRadius: 999,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default AgingBars;
