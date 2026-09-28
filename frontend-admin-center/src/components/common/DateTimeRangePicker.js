import React from 'react';
import { DatePicker } from 'antd';

const { RangePicker } = DatePicker;

/**
 * Reusable DateTime Range Picker Component
 * 
 * @component
 * @param {Object} props - Component props
 * @param {Array} props.value - Current value (array of 2 dayjs objects)
 * @param {Function} props.onChange - Callback when value changes (required)
 * @param {string} [props.format='DD/MM/YYYY hh:mm A'] - Date-time format string
 * @param {boolean} [props.use24HourFormat=false] - Use 24-hour format instead of 12-hour
 * @param {boolean} [props.showTime=true] - Show time selection
 * @param {Array} [props.placeholder=['Start Date & Time', 'End Date & Time']] - Placeholder text
 * @param {Object} [props.style={ width: '100%' }] - Custom styles
 * @param {string} [props.size='middle'] - Size: 'small', 'middle', 'large'
 * @param {boolean} [props.allowClear=true] - Allow clearing the selection
 * @param {boolean} [props.disabled=false] - Disable the picker
 * @param {Function} [props.disabledDate=null] - Function to disable specific dates
 * @param {boolean} [props.showNow=true] - Show 'Now' button in time picker
 * 
 * @example
 * // Basic usage with AM/PM (default)
 * <DateTimeRangePicker
 *   value={dateRange}
 *   onChange={setDateRange}
 * />
 * 
 * @example
 * // 24-hour format
 * <DateTimeRangePicker
 *   value={dateRange}
 *   onChange={setDateRange}
 *   use24HourFormat={true}
 * />
 */
const DateTimeRangePicker = ({
  value,
  onChange,
  format = 'DD/MM/YYYY hh:mm A', // Default: 12-hour format with AM/PM
  use24HourFormat = false,
  showTime = true,
  placeholder = ['Start Date & Time', 'End Date & Time'],
  style = { width: '100%' },
  size = 'middle',
  allowClear = true,
  disabled = false,
  disabledDate = null,
  showNow = true,
  ...restProps
}) => {
  // Determine format based on use24HourFormat prop
  const dateTimeFormat = use24HourFormat ? 'DD/MM/YYYY HH:mm' : format;

  // Time picker configuration
  const timePickerProps = showTime ? {
    format: use24HourFormat ? 'HH:mm' : 'hh:mm A',
    use12Hours: !use24HourFormat,
    showNow: showNow,
  } : false;

  return (
    <RangePicker
      value={value}
      onChange={onChange}
      format={dateTimeFormat}
      showTime={timePickerProps}
      placeholder={placeholder}
      style={style}
      size={size}
      allowClear={allowClear}
      disabled={disabled}
      disabledDate={disabledDate}
      {...restProps}
    />
  );
};

export default DateTimeRangePicker;
