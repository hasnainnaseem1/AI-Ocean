// Role definitions
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MODERATOR: 'moderator',
  VIEWER: 'viewer',
  CUSTOM: 'custom',
};

// Account types
export const ACCOUNT_TYPES = {
  CUSTOMER: 'customer',
  ADMIN: 'admin',
};

// User / account statuses
export const STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
  INACTIVE: 'inactive',
  PENDING_VERIFICATION: 'pending_verification',
};

export const STATUS_COLORS = {
  active: 'green',
  suspended: 'orange',
  banned: 'red',
  inactive: 'default',
  pending_verification: 'blue',
};

// Activity log action types
export const ACTION_TYPES = ['create', 'read', 'update', 'delete', 'auth', 'export', 'system'];

// Notification priorities
export const PRIORITY_COLORS = {
  low: 'default',
  medium: 'blue',
  high: 'orange',
  urgent: 'red',
};

// Departments for admin users
export const DEPARTMENTS = [
  { value: 'engineering', label: 'Engineering' },
  { value: 'support', label: 'Customer Support' },
  { value: 'sales', label: 'Sales' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'product', label: 'Product Management' },
  { value: 'operations', label: 'Operations' },
  { value: 'hr', label: 'Human Resources' },
  { value: 'finance', label: 'Finance' },
  { value: 'legal', label: 'Legal' },
  { value: 'executive', label: 'Executive' },
];

// Date format
export const DATE_FORMAT = 'MMM DD, YYYY';
export const DATETIME_FORMAT = 'MMM DD, YYYY HH:mm';

// Pagination defaults
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = ['10', '20', '50', '100'];
