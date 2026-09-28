# DateTimeRangePicker Component

A reusable, feature-rich date-time range picker component for React applications using Ant Design.

## Features

✅ **AM/PM Support** - 12-hour format with AM/PM by default  
✅ **24-Hour Option** - Switch to 24-hour format with a single prop  
✅ **Highly Customizable** - Multiple props for different use cases  
✅ **TypeScript Ready** - PropTypes validation included  
✅ **Consistent UX** - Pre-configured sensible defaults  
✅ **Time Selection** - Optional time picker with configurable format  
✅ **Date Disabling** - Disable past/future dates as needed  

## Quick Start

### Basic Usage (12-hour with AM/PM)

```jsx
import DateTimeRangePicker from '../../components/common/DateTimeRangePicker';

const MyComponent = () => {
  const [dateRange, setDateRange] = useState(null);

  return (
    <DateTimeRangePicker
      value={dateRange}
      onChange={setDateRange}
    />
  );
};
```

This will render: `DD/MM/YYYY hh:mm AM/PM`

### 24-Hour Format

```jsx
<DateTimeRangePicker
  value={dateRange}
  onChange={setDateRange}
  use24HourFormat={true}
/>
```

This will render: `DD/MM/YYYY HH:mm`

### Date Only (No Time)

```jsx
<DateTimeRangePicker
  value={dateRange}
  onChange={setDateRange}
  showTime={false}
  format="DD/MM/YYYY"
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | Array | - | Current value (array of 2 dayjs objects) |
| `onChange` | Function | **required** | Callback when value changes |
| `format` | String | `'DD/MM/YYYY hh:mm A'` | Date-time display format |
| `use24HourFormat` | Boolean | `false` | Use 24-hour instead of 12-hour |
| `showTime` | Boolean | `true` | Show time selection |
| `placeholder` | Array | `['Start Date & Time', 'End Date & Time']` | Input placeholders |
| `style` | Object | `{ width: '100%' }` | Custom styles |
| `size` | String | `'middle'` | Size: 'small', 'middle', 'large' |
| `allowClear` | Boolean | `true` | Allow clearing selection |
| `disabled` | Boolean | `false` | Disable the picker |
| `disabledDate` | Function | `null` | Function to disable dates |
| `showNow` | Boolean | `true` | Show 'Now' button |

## Advanced Examples

### Activity Log Filtering

```jsx
const [activityDateRange, setActivityDateRange] = useState(null);

useEffect(() => {
  if (!activityDateRange) {
    setFilteredLogs(allLogs);
    return;
  }
  
  const [start, end] = activityDateRange;
  const filtered = allLogs.filter((log) => {
    const logDate = new Date(log.createdAt);
    return logDate >= start.toDate() && logDate <= end.toDate();
  });
  setFilteredLogs(filtered);
}, [activityDateRange]);

return (
  <DateTimeRangePicker
    value={activityDateRange}
    onChange={setActivityDateRange}
    placeholder={['From', 'To']}
  />
);
```

### Disable Past Dates

```jsx
import dayjs from 'dayjs';

const disablePastDates = (current) => {
  return current && current < dayjs().startOf('day');
};

<DateTimeRangePicker
  value={dateRange}
  onChange={setDateRange}
  disabledDate={disablePastDates}
/>
```

### Custom Size and Style

```jsx
<DateTimeRangePicker
  value={dateRange}
  onChange={setDateRange}
  size="large"
  style={{ width: '500px', borderRadius: '8px' }}
  placeholder={['Check-in', 'Check-out']}
/>
```

## Current Usage

This component is currently used in:

- **UserDetailPage** - Activity log date filtering with AM/PM format

## Migration Guide

If you have existing `<RangePicker>` usage, you can easily migrate:

**Before:**
```jsx
import { DatePicker } from 'antd';
const { RangePicker } = DatePicker;

<RangePicker
  showTime
  format="DD/MM/YYYY HH:mm"
  value={dateRange}
  onChange={setDateRange}
  style={{ width: '100%' }}
  placeholder={['Start', 'End']}
/>
```

**After:**
```jsx
import DateTimeRangePicker from '../../components/common/DateTimeRangePicker';

<DateTimeRangePicker
  value={dateRange}
  onChange={setDateRange}
  use24HourFormat={true}
  placeholder={['Start', 'End']}
/>
```

## Format Reference

| Format String | Output Example |
|---------------|----------------|
| `DD/MM/YYYY hh:mm A` | 15/02/2026 02:30 PM |
| `DD/MM/YYYY HH:mm` | 15/02/2026 14:30 |
| `MM/DD/YYYY hh:mm A` | 02/15/2026 02:30 PM |
| `YYYY-MM-DD HH:mm` | 2026-02-15 14:30 |
| `DD/MM/YYYY` | 15/02/2026 |
| `MMM DD, YYYY hh:mm A` | Feb 15, 2026 02:30 PM |

## Notes

- Uses Ant Design's `DatePicker.RangePicker` under the hood
- Fully compatible with dayjs
- Supports all RangePicker props via `...restProps`
- Default AM/PM format improves user experience for non-technical users
- 24-hour format available for technical/international audiences

## See Also

- [DateTimeRangePicker.examples.js](./DateTimeRangePicker.examples.js) - More examples
- [Ant Design RangePicker Docs](https://ant.design/components/date-picker#rangepicker)
