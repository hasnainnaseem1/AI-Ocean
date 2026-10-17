import React from 'react';
import { Segmented, DatePicker } from 'antd';
import dayjs from 'dayjs';
import quarterOfYear from 'dayjs/plugin/quarterOfYear';

// `startOf('quarter')` is a plugin, not core dayjs — without this the "This
// quarter" preset silently returns the start of the current *day*.
dayjs.extend(quarterOfYear);

const { RangePicker } = DatePicker;

const PRESETS = [
  { label: '7 Days', value: '7d' },
  { label: '30 Days', value: '30d' },
  { label: '90 Days', value: '90d' },
  { label: '1 Year', value: '1y' },
];

/**
 * The window control: four presets, and a calendar for anything else.
 *
 * ── Why both, rather than only the calendar ──
 *
 * "Last 30 days" is what an operator wants nine times out of ten and it should
 * stay one click. The calendar is for the tenth — a particular month, a
 * quarter, the week something went wrong — which a preset list can never cover
 * without becoming a menu.
 *
 * ── Only one can be active ──
 *
 * A "Custom" chip appears in the preset row once a range is picked, so the
 * control always shows which window is in force. Without it, choosing a range
 * would leave "30 Days" looking selected while the page showed something else
 * — the kind of mismatch that makes somebody mistrust every figure on screen.
 * Clearing the calendar drops the chip and returns to the preset.
 */
const PeriodPicker = ({ period, range, onPeriod, onRange, size = 'small' }) => {
  const custom = !!range;

  return (
    <>
      <Segmented
        size={size}
        value={custom ? 'custom' : period}
        onChange={(value) => { if (value !== 'custom') onPeriod(value); }}
        options={custom ? [...PRESETS, { label: 'Custom', value: 'custom' }] : PRESETS}
      />
      <RangePicker
        size={size}
        value={range}
        onChange={onRange}
        allowClear
        /* Tomorrow has no data and asking for it reads as a broken report
           rather than an empty one. */
        disabledDate={(current) => current && current > dayjs().endOf('day')}
        /* The common custom windows, so the usual ones are still one click
           even inside the calendar. */
        presets={[
          { label: 'This month', value: [dayjs().startOf('month'), dayjs()] },
          { label: 'Last month', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
          { label: 'This quarter', value: [dayjs().startOf('quarter'), dayjs()] },
          { label: 'Year to date', value: [dayjs().startOf('year'), dayjs()] },
        ]}
        style={{ width: 250 }}
      />
    </>
  );
};

export default PeriodPicker;
export { PRESETS };
