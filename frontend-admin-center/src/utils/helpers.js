import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { DATETIME_FORMAT, DATE_FORMAT } from './constants';

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Get user timezone from localStorage or default to UTC
 */
export const getUserTimezone = () => {
  return localStorage.getItem('userTimezone') || 'UTC';
};

/**
 * Format a date string/timestamp to display format (timezone-aware)
 */
export const formatDate = (date, tz = null) => {
  if (!date) return '—';
  const timezone = tz || getUserTimezone();
  return dayjs(date).tz(timezone).format(DATE_FORMAT);
};

/**
 * Format a datetime string/timestamp to display format (timezone-aware)
 */
export const formatDateTime = (date, tz = null) => {
  if (!date) return '—';
  const timezone = tz || getUserTimezone();
  return dayjs(date).tz(timezone).format(DATETIME_FORMAT);
};

/**
 * Relative time (e.g. "2 hours ago")
 */
export const timeAgo = (date) => {
  if (!date) return '—';
  return dayjs(date).fromNow();
};

/**
 * Get initials from a name, e.g. "John Doe" → "JD"
 */
export const getInitials = (name) => {
  if (!name) return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

/**
 * Truncate text
 */
export const truncate = (text, length = 50) => {
  if (!text) return '';
  if (text.length <= length) return text;
  return text.slice(0, length) + '...';
};

/**
 * Format a number with commas
 */
export const formatNumber = (num) => {
  if (num === null || num === undefined) return '0';
  return Number(num).toLocaleString();
};

/**
 * Format currency
 */
export const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '$0';
  return `$${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

/**
 * Capitalize first letter
 */
export const capitalize = (str) => {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * Format status string for display: "pending_verification" → "Pending Verification"
 */
export const formatStatus = (status) => {
  if (!status) return '';
  return status
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

/**
 * Build query string from params object (removing empty values)
 */
export const buildQueryParams = (params) => {
  const filtered = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      filtered[key] = value;
    }
  });
  return filtered;
};

/**
 * Format IP address for display
 * Converts localhost and private IPs to friendly format
 */
export const formatIPAddress = (ip) => {
  if (!ip || ip === 'Unknown') {
    return 'Unknown';
  }
  
  // Localhost variations
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost') {
    return 'Localhost (127.0.0.1)';
  }
  
  // Private network ranges
  if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return `${ip} (Private Network)`;
  }
  
  return ip;
};

/**
 * Download a blob as a file
 */
export const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};
