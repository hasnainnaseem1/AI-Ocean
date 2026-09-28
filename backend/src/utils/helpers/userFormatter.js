/**
 * Format user response based on account type
 */
const formatUserResponse = (user, options = {}) => {
  const {
    includePermissions = false,
    includeSensitiveData = false,
  } = options;

  const baseUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    accountType: user.accountType,
    role: user.role,
    // Only the fields a client needs. The raw relation carries internal
    // Postgres columns (createdById/updatedById, id) that no other
    // endpoint exposes.
    customRole: user.customRole ? {
      id: user.customRole.id,
      name: user.customRole.name,
      description: user.customRole.description,
      permissions: user.customRole.permissions,
      isActive: user.customRole.isActive,
    } : user.customRole,
    status: user.status,
    isEmailVerified: user.isEmailVerified,
    // Which language this person reads the product in. Explicit because this
    // formatter is a whitelist — and support needs to see what a customer is
    // actually looking at when they describe a screen.
    language: user.language || 'en',
    createdAt: user.createdAt,
  };

  // Add admin-specific fields
  if (user.accountType === 'admin') {
    baseUser.department = user.department;
    baseUser.assignedBy = user.assignedBy;
  }

  // Add optional fields
  if (includeSensitiveData) {
    baseUser.lastLogin = user.lastLogin;
    baseUser.lastLoginIP = user.lastLoginIP;
    baseUser.loginAttempts = user.loginAttempts;
    baseUser.lockUntil = user.lockUntil;
  }

  if (includePermissions && user.accountType === 'admin') {
    baseUser.permissions = user.permissions;
  }

  return baseUser;
};

module.exports = {
  formatUserResponse,
};
