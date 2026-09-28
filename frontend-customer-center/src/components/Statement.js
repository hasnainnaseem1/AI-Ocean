import React from 'react';
import { Typography } from 'antd';
import { monoNumeric } from '../theme/colors';

const { Text } = Typography;

/**
 * The building blocks of every money statement on the billing screens — the
 * Overview's bill summary and the Invoices tab's "where your money went" —
 * so both read the same way and a change to one reaches the other.
 */

/**
 * One section of a statement, drawn as its own bordered box. The border is
 * doing real work: sections answer different questions, and the whole problem
 * with a single undivided list was that nothing told the reader where one
 * ledger ended and the next began.
 */
export const StatementBox = ({ border, children }) => (
  <div style={{
    border: `1px solid ${border}`,
    borderRadius: 10,
    padding: '14px 16px',
    height: '100%',
  }}>
    {children}
  </div>
);

export const SectionHeading = ({ children }) => (
  <Text
    type="secondary"
    style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', display: 'block', marginBottom: 8,
    }}
  >
    {children}
  </Text>
);

/**
 * A label on the left and a figure on the right — nothing else, so a column
 * of these reads as a column of numbers instead of a paragraph. `total` rules
 * a line above it and sets both halves bold (what makes a section visibly add
 * up); `lead` rules a line below it, for a figure that the lines under it
 * split up rather than add up to.
 */
export const StatementLine = ({
  label, sub, value, color, total, lead, indent, border,
}) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
    padding: total ? '9px 0 0' : lead ? '0 0 8px' : '5px 0',
    marginTop: total ? 5 : 0,
    marginBottom: lead ? 6 : 0,
    borderTop: total ? `1px solid ${border}` : undefined,
    borderBottom: lead ? `1px solid ${border}` : undefined,
  }}>
    <Text
      type={(total || lead) ? undefined : 'secondary'}
      strong={!!(total || lead)}
      style={{ fontSize: 13, paddingInlineStart: indent ? 12 : 0 }}
    >
      {label}
      {sub && (
        <Text type="secondary" style={{ fontSize: 11, marginInlineStart: 6 }}>{sub}</Text>
      )}
    </Text>
    <Text strong style={{ fontSize: 13.5, whiteSpace: 'nowrap', ...monoNumeric, color }}>
      {value}
    </Text>
  </div>
);
