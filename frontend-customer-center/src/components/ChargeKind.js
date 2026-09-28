import React from 'react';
import { HddOutlined, CloudServerOutlined } from '@ant-design/icons';
import { STATUS_COLORS, getBrand } from '../theme/colors';

/**
 * The two things a deployment is charged for, with one colour and one icon
 * each — used by the billing Overview, the Invoices list and the invoice
 * detail page alike, so "amber means disk" holds on every billing screen
 * without anyone having to read a label.
 */
export const kindColor = (kind, isDark) => (kind === 'disk'
  ? (isDark ? STATUS_COLORS.warning.dark : STATUS_COLORS.warning.light)
  : getBrand(isDark));

export const KindIcon = ({ kind, isDark, style }) => (kind === 'disk'
  ? <HddOutlined style={{ color: kindColor('disk', isDark), ...style }} />
  : <CloudServerOutlined style={{ color: kindColor('compute', isDark), ...style }} />);
