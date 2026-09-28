const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const router = express.Router();
const activityLogService = require('../../../services/admin/activityLogService');
const adminSettingsService = require('../../../services/admin/adminSettingsService');
const { checkPermission } = require('../../../middleware/security');
const { bustMaintenanceCache } = require('../../../middleware/security/maintenanceMode');
const { getClientIP } = require('../../../utils/helpers/ipHelper');
const emailService = require('../../../services/email/emailService');
const languageSettingsService = require('../../../services/i18n/languageSettingsService');
const teamService = require('../../../services/team/teamService');

// @route   GET /api/admin/settings
// @desc    Get all admin settings
// @access  Private (Admin with settings.view permission)
router.get('/', checkPermission('settings.view'), async (req, res) => {
  try {
    const settings = await adminSettingsService.getSettings();

    // Hide sensitive information for non-super admins
    const sanitizedSettings = { ...settings.toObject() };
    
    if (req.user.role !== 'super_admin') {
      delete sanitizedSettings.emailSettings.smtpPassword;
      delete sanitizedSettings.stripeSettings?.secretKey;
      delete sanitizedSettings.stripeSettings?.webhookSecret;
      // Hide LemonSqueezy secrets from non-super-admins
      if (sanitizedSettings.lemonSqueezySettings) {
        delete sanitizedSettings.lemonSqueezySettings.apiKey;
        delete sanitizedSettings.lemonSqueezySettings.webhookSecret;
      }
      // Hide Polar secrets from non-super-admins
      if (sanitizedSettings.polarSettings) {
        delete sanitizedSettings.polarSettings.accessToken;
        delete sanitizedSettings.polarSettings.webhookSecret;
      }
      // Hide Google SSO secret from non-super-admins
      if (sanitizedSettings.googleSSOSettings) {
        delete sanitizedSettings.googleSSOSettings.clientSecret;
      }
    }

    /*
     * Language settings are resolved rather than returned raw. Defaults are
     * only written when the settings row is first created, so a platform that
     * predates this feature has no `features.languages` block at all — and the
     * admin form would populate with nothing. This is the same read the public
     * site payload does, so the two can never show the admin different answers.
     */
    sanitizedSettings.features = {
      ...(sanitizedSettings.features || {}),
      languages: await languageSettingsService.getLanguageSettings(),
      // Same reasoning for organizations: a settings row written before any of
      // these existed has no `features.teams` block, and the admin form would
      // populate with blanks rather than the defaults actually in force.
      teams: await require('../../../services/team/teamSettingsService').getTeamSettings(),
    };

    res.json({
      success: true,
      settings: sanitizedSettings,
      // The catalogue of everything the product *can* speak, as opposed to what
      // is currently switched on. Sent alongside so the admin UI does not keep
      // its own copy of a list the server owns.
      availableLanguages: languageSettingsService.SUPPORTED_LANGUAGES,
    });

  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching settings'
    });
  }
});

// @route   PUT /api/admin/settings/general
// @desc    Update general settings
// @access  Private (Admin with settings.edit permission)
router.put('/general', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { siteName, siteDescription, supportEmail, contactEmail } = req.body;
    const clientIP = getClientIP(req);

    const settings = await adminSettingsService.getSettings();

    if (siteName) settings.siteName = siteName;
    if (siteDescription) settings.siteDescription = siteDescription;
    if (supportEmail) settings.supportEmail = supportEmail;
    if (contactEmail) settings.contactEmail = contactEmail;

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'Updated general settings',
      metadata: req.body,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'General settings updated successfully'
    });

  } catch (error) {
    console.error('Update general settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating settings'
    });
  }
});

// @route   PUT /api/admin/settings/email
// @desc    Update email settings
// @access  Private (Super Admin or Admin with settings.edit permission)
router.put('/email', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { smtpHost, smtpPort, smtpUser, smtpPassword, smtpSecure, fromEmail, fromName } = req.body;
    const clientIP = getClientIP(req);

    const settings = await adminSettingsService.getSettings();

    if (smtpHost) settings.emailSettings.smtpHost = smtpHost;
    if (smtpPort) {
      settings.emailSettings.smtpPort = smtpPort;
      // Auto-correct smtpSecure flag based on port to prevent SSL mismatch errors.
      // Port 465 = implicit TLS → secure: true.  Anything else (587, 25) = STARTTLS → secure: false.
      settings.emailSettings.smtpSecure = Number(smtpPort) === 465;
    }
    if (smtpUser) settings.emailSettings.smtpUser = smtpUser;
    if (smtpPassword) settings.emailSettings.smtpPassword = smtpPassword;
    if (typeof smtpSecure === 'boolean') settings.emailSettings.smtpSecure = smtpSecure;
    if (fromEmail) settings.emailSettings.fromEmail = fromEmail;
    if (fromName) settings.emailSettings.fromName = fromName;

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Invalidate the cached SMTP transporter so the next email uses the new settings
    emailService.resetTransporter();

    // Log activity (without password)
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'Updated email settings',
      metadata: { ...req.body, smtpPassword: '***' },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Email settings updated successfully'
    });

  } catch (error) {
    console.error('Update email settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating email settings'
    });
  }
});

// @route   POST /api/admin/settings/email/test
// @desc    Send a test email to verify SMTP configuration
// @access  Private (Admin with settings.edit permission)
router.post('/email/test', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { recipientEmail } = req.body;
    const clientIP = getClientIP(req);

    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email is required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address'
      });
    }

    // Send test email
    const result = await emailService.sendTestEmail(recipientEmail);

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'test_email_sent',
      actionType: 'create',
      targetModel: 'Settings',
      description: `Sent test email to ${recipientEmail}`,
      metadata: { recipientEmail },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: result.message || `Test email sent successfully to ${recipientEmail}`,
      messageId: result.messageId
    });

  } catch (error) {
    console.error('Send test email error:', error);
    
    // Log failed attempt
    const clientIP = getClientIP(req);
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'test_email_failed',
      actionType: 'create',
      targetModel: 'Settings',
      description: `Failed to send test email: ${error.message}`,
      metadata: { error: error.message },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'error'
    });

    failure(res, error, 'Failed to send test email. Please check your SMTP configuration.');
  }
});

// @route   PUT /api/admin/settings/customer
// @desc    Update customer settings
// @access  Private (Admin with settings.edit permission)
router.put('/customer', checkPermission('settings.edit'), async (req, res) => {
  try {
    const {
      requireEmailVerification,
      allowTemporaryEmails,
      autoApproveNewcustomers
    } = req.body;
    const clientIP = getClientIP(req);

    const settings = await adminSettingsService.getSettings();

    if (requireEmailVerification !== undefined) {
      settings.customerSettings.requireEmailVerification = requireEmailVerification;
    }
    if (allowTemporaryEmails !== undefined) {
      settings.customerSettings.allowTemporaryEmails = allowTemporaryEmails;
    }
    if (autoApproveNewcustomers !== undefined) {
      settings.customerSettings.autoApproveNewcustomers = autoApproveNewcustomers;
    }

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'Updated customer settings',
      metadata: req.body,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Customer settings updated successfully'
    });

  } catch (error) {
    console.error('Update customer settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating customer settings'
    });
  }
});

// @route   PUT /api/admin/settings/security
// @desc    Update security settings
// @access  Private (Super Admin)
router.put('/security', checkPermission('settings.edit'), async (req, res) => {
  try {
    const {
      maxLoginAttempts,
      lockoutDuration,
      passwordMinLength,
      requireStrongPassword,
      sessionTimeout,
      twoFactorEnabled
    } = req.body;
    const clientIP = getClientIP(req);

    const settings = await adminSettingsService.getSettings();

    if (maxLoginAttempts) settings.securitySettings.maxLoginAttempts = maxLoginAttempts;
    if (lockoutDuration) settings.securitySettings.lockoutDuration = lockoutDuration;
    if (passwordMinLength) settings.securitySettings.passwordMinLength = passwordMinLength;
    if (requireStrongPassword !== undefined) {
      settings.securitySettings.requireStrongPassword = requireStrongPassword;
    }
    if (sessionTimeout) settings.securitySettings.sessionTimeout = sessionTimeout;
    if (twoFactorEnabled !== undefined) {
      settings.securitySettings.twoFactorEnabled = twoFactorEnabled;
    }

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'Updated security settings',
      metadata: req.body,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Security settings updated successfully'
    });

  } catch (error) {
    console.error('Update security settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating security settings'
    });
  }
});

// @route   PUT /api/admin/settings/notification
// @desc    Update notification settings
// @access  Private (Admin with settings.edit permission)
router.put('/notification', checkPermission('settings.edit'), async (req, res) => {
  try {
    const {
      enableEmailNotifications,
      enablePushNotifications,
      notifyAdminOnNewcustomer,
      notifyAdminOnAutoSuspend
    } = req.body;
    const clientIP = getClientIP(req);

    const settings = await adminSettingsService.getSettings();

    if (enableEmailNotifications !== undefined) {
      settings.notificationSettings.enableEmailNotifications = enableEmailNotifications;
    }
    if (enablePushNotifications !== undefined) {
      settings.notificationSettings.enablePushNotifications = enablePushNotifications;
    }
    if (notifyAdminOnNewcustomer !== undefined) {
      settings.notificationSettings.notifyAdminOnNewcustomer = notifyAdminOnNewcustomer;
    }
    if (notifyAdminOnAutoSuspend !== undefined) {
      settings.notificationSettings.notifyAdminOnAutoSuspend = notifyAdminOnAutoSuspend;
    }

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'Updated notification settings',
      metadata: req.body,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Notification settings updated successfully'
    });

  } catch (error) {
    console.error('Update notification settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating notification settings'
    });
  }
});

// @route   PUT /api/admin/settings/maintenance
// @desc    Toggle maintenance mode
// @access  Private (Super Admin)
router.put('/maintenance', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { enabled, message, allowAdminAccess } = req.body;
    const clientIP = getClientIP(req);

    // Only super admin can toggle maintenance mode
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super admin can toggle maintenance mode'
      });
    }

    const settings = await adminSettingsService.getSettings();

    if (enabled !== undefined) settings.maintenanceMode.enabled = enabled;
    if (message) settings.maintenanceMode.message = message;
    if (allowAdminAccess !== undefined) {
      settings.maintenanceMode.allowAdminAccess = allowAdminAccess;
    }

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Bust maintenance cache so changes take effect immediately
    bustMaintenanceCache();

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'system_maintenance',
      actionType: 'system',
      targetModel: 'Settings',
      description: `Maintenance mode ${enabled ? 'enabled' : 'disabled'}`,
      metadata: req.body,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: `Maintenance mode ${enabled ? 'enabled' : 'disabled'} successfully`
    });

  } catch (error) {
    console.error('Update maintenance mode error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating maintenance mode'
    });
  }
});

// @route   PUT /api/admin/settings/features
// @desc    Toggle feature flags
// @access  Private (Super Admin or Admin with settings.edit permission)
router.put('/features', checkPermission('settings.edit'), async (req, res) => {
  try {
    const {
      enableCustomerSignup,
      enableLogin,
      enableModelCatalog,
      enableDeployments,
      enablePlayground,
      enableCustomRoles,
      enableActivityLogs,
      languages,
      teams
    } = req.body;
    const clientIP = getClientIP(req);

    const settings = await adminSettingsService.getSettings();

    if (enableCustomerSignup !== undefined) settings.features.enableCustomerSignup = enableCustomerSignup;
    if (enableLogin !== undefined) settings.features.enableLogin = enableLogin;
    if (enableModelCatalog !== undefined) settings.features.enableModelCatalog = enableModelCatalog;
    if (enableDeployments !== undefined) settings.features.enableDeployments = enableDeployments;
    if (enablePlayground !== undefined) settings.features.enablePlayground = enablePlayground;
    if (enableCustomRoles !== undefined) settings.features.enableCustomRoles = enableCustomRoles;
    if (enableActivityLogs !== undefined) settings.features.enableActivityLogs = enableActivityLogs;

    /**
     * Which languages the customer center offers.
     *
     * Corrected here rather than trusted, and deliberately not validated in a
     * schema: an unknown code is silently dropped, English is always kept
     * (every missing translation key falls back to it, so a platform without
     * it would render blanks), and a default outside the enabled set is pulled
     * back in. Rejecting instead of correcting would let one stale checkbox
     * fail the whole save.
     */
    if (languages !== undefined) {
      const current = await languageSettingsService.getLanguageSettings();
      const enabled = languageSettingsService.sanitizeEnabled(
        languages.enabled === undefined ? current.enabled : languages.enabled
      );
      const wantedDefault = languages.default === undefined ? current.default : languages.default;

      settings.features.languages = {
        enabled,
        default: enabled.includes(wantedDefault)
          ? wantedDefault
          : languageSettingsService.BASE_LANGUAGE,
        firstVisitPromptEnabled: languages.firstVisitPromptEnabled === undefined
          ? current.firstVisitPromptEnabled
          : !!languages.firstVisitPromptEnabled,
      };
    }

    /**
     * Everything about organizations: how big they get, how people are let in,
     * what a seat costs.
     *
     * Corrected rather than rejected, like the languages block above, and by
     * the same service that reads these settings everywhere else
     * (services/team/teamSettingsService.sanitize) — so a number typed out of
     * range comes back clamped instead of failing the save, and a block saved
     * before a setting existed still gets that setting's default.
     */
    if (teams !== undefined) {
      const teamSettingsService = require('../../../services/team/teamSettingsService');
      const current = await teamSettingsService.getTeamSettings();
      settings.features.teams = teamSettingsService.sanitize({ ...current, ...teams });
    }

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'Updated feature flags',
      metadata: req.body,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Feature flags updated successfully'
    });

  } catch (error) {
    console.error('Update feature flags error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating feature flags'
    });
  }
});

// @route   GET /api/v1/admin/settings/billing
// @desc    Get billing mode + credit settings
// @access  Private (Admin with settings.view permission)
router.get('/billing', checkPermission('settings.view'), async (req, res) => {
  try {
    const billingModeService = require('../../../services/billing/billingModeService');
    const billingSettings = await billingModeService.getBillingSettings();
    // Customers with their own PAYG setting, which the platform switch does
    // not reach — shown next to that switch (fundingService.resolvePaygAccess).
    const paygOverrides = await teamService.countPaygOverrides();

    res.json({ success: true, billingSettings, paygOverrides });
  } catch (error) {
    console.error('Get billing settings error:', error);
    res.status(500).json({ success: false, message: 'Error fetching billing settings' });
  }
});

// @route   PUT /api/v1/admin/settings/billing
// @desc    Set the credit-wallet parameters
// @access  Private (Super Admin or Admin with settings.edit permission)
router.put('/billing', checkPermission('settings.edit'), async (req, res) => {
  try {
    const clientIP = getClientIP(req);
    const settings = await adminSettingsService.getSettings();

    if (!settings.billingSettings) settings.billingSettings = {};

    const {
      currency, minTopUp, maxTopUp, maxManualAdjustment, topUpPresets, signupBonusCredits,
      lowBalanceThreshold, lowBalanceHours, graceBalance, autoSuspendAtZero,
      minHoursBalanceToDeploy, billStorageWhileStopped,
      hoursPerMonth, paygCreditLimit, paygMaxDebtDays,
      paygEnabled, paygAutoChargeThreshold, paygAutoChargeRetryDays,
      paygMinLifetimeSpend, paygMinAccountAgeDays,
      cardGateRequireVerifiedCard, cardGateVerifyWithAuthHold,
      cardGateAuthHoldAmount, cardGateAuthHoldMaxAgeHours,
      customBuildEnabled, customBuildMarkupPercent,
      cardGateWhenGatewayCannotStoreCards, cardGateGrandfatherUntil,
      storageGraceEnabled, storageGraceDays, storageGraceTerminateAtEnd,
      storageGraceWarnDailyFrom, suspendOrder, staleProvisioningDays,
      cardExpiryWarningDays,
      copyAutoSuspendedMessage, copyStorageDebtMessage,
      copyCheckoutCardRequiredMessage, copyCheckoutPaygIneligibleMessage,
    } = req.body;

    if (currency !== undefined) settings.billingSettings.currency = currency;
    if (minTopUp !== undefined) settings.billingSettings.minTopUp = minTopUp;
    if (maxTopUp !== undefined) settings.billingSettings.maxTopUp = maxTopUp;
    if (maxManualAdjustment !== undefined && Number(maxManualAdjustment) > 0) {
      settings.billingSettings.maxManualAdjustment = Number(maxManualAdjustment);
    }
    if (Array.isArray(topUpPresets)) {
      settings.billingSettings.topUpPresets = topUpPresets
        .map(Number)
        .filter((n) => !Number.isNaN(n) && n > 0);
    }
    if (signupBonusCredits !== undefined) settings.billingSettings.signupBonusCredits = signupBonusCredits;
    if (lowBalanceThreshold !== undefined) settings.billingSettings.lowBalanceThreshold = lowBalanceThreshold;
    if (graceBalance !== undefined) settings.billingSettings.graceBalance = graceBalance;
    if (autoSuspendAtZero !== undefined) settings.billingSettings.autoSuspendAtZero = autoSuspendAtZero;
    if (minHoursBalanceToDeploy !== undefined) settings.billingSettings.minHoursBalanceToDeploy = minHoursBalanceToDeploy;
    if (lowBalanceHours !== undefined) settings.billingSettings.lowBalanceHours = lowBalanceHours;
    if (billStorageWhileStopped !== undefined) settings.billingSettings.billStorageWhileStopped = billStorageWhileStopped;
    if (hoursPerMonth !== undefined && Number(hoursPerMonth) > 0) {
      settings.billingSettings.hoursPerMonth = Number(hoursPerMonth);
    }
    /*
     * `storageDebtPolicy` is gone. Its two values were "let the wallet go
     * negative" and "write the unpaid storage off"; the first was money in a
     * ledger nothing collects from, the second was a deliberate giveaway.
     * Unpaid storage now always lands on the outstanding balance.
     */
    if (!settings.billingSettings.payg) settings.billingSettings.payg = {};
    if (paygEnabled !== undefined) settings.billingSettings.payg.enabled = !!paygEnabled;
    if (paygCreditLimit !== undefined && Number(paygCreditLimit) >= 0) {
      settings.billingSettings.payg.creditLimit = Number(paygCreditLimit);
    }
    if (paygMaxDebtDays !== undefined && Number(paygMaxDebtDays) >= 0) {
      settings.billingSettings.payg.maxDebtDays = Number(paygMaxDebtDays);
    }
    if (paygAutoChargeThreshold !== undefined && Number(paygAutoChargeThreshold) >= 0) {
      settings.billingSettings.payg.autoChargeThreshold = Number(paygAutoChargeThreshold);
    }
    if (Array.isArray(paygAutoChargeRetryDays)) {
      settings.billingSettings.payg.autoChargeRetryDays = paygAutoChargeRetryDays
        .map(Number)
        .filter((n) => !Number.isNaN(n) && n > 0)
        .sort((a, b) => a - b);
    }
    if (!settings.billingSettings.payg.eligibility) settings.billingSettings.payg.eligibility = {};
    if (paygMinLifetimeSpend !== undefined && Number(paygMinLifetimeSpend) >= 0) {
      settings.billingSettings.payg.eligibility.minLifetimeSpend = Number(paygMinLifetimeSpend);
    }
    if (paygMinAccountAgeDays !== undefined && Number(paygMinAccountAgeDays) >= 0) {
      settings.billingSettings.payg.eligibility.minAccountAgeDays = Number(paygMinAccountAgeDays);
    }

    if (!settings.billingSettings.cardGate) settings.billingSettings.cardGate = {};
    const cardGateWasOff = !settings.billingSettings.cardGate.requireVerifiedCard;
    if (cardGateRequireVerifiedCard !== undefined) {
      settings.billingSettings.cardGate.requireVerifiedCard = !!cardGateRequireVerifiedCard;
    }
    if (cardGateVerifyWithAuthHold !== undefined) {
      settings.billingSettings.cardGate.verifyWithAuthHold = !!cardGateVerifyWithAuthHold;
    }
    if (cardGateAuthHoldAmount !== undefined && Number(cardGateAuthHoldAmount) > 0) {
      settings.billingSettings.cardGate.authHoldAmount = Number(cardGateAuthHoldAmount);
    }
    if (cardGateAuthHoldMaxAgeHours !== undefined && Number(cardGateAuthHoldMaxAgeHours) >= 0) {
      settings.billingSettings.cardGate.authHoldMaxAgeHours = Number(cardGateAuthHoldMaxAgeHours);
    }
    if (cardGateWhenGatewayCannotStoreCards !== undefined) {
      if (!['prepaid_only', 'block_all_deployments'].includes(cardGateWhenGatewayCannotStoreCards)) {
        return res.status(400).json({
          success: false,
          message: 'whenGatewayCannotStoreCards must be one of: prepaid_only, block_all_deployments',
        });
      }
      settings.billingSettings.cardGate.whenGatewayCannotStoreCards = cardGateWhenGatewayCannotStoreCards;
    }
    if (cardGateGrandfatherUntil !== undefined) {
      settings.billingSettings.cardGate.grandfatherUntil = cardGateGrandfatherUntil
        ? new Date(cardGateGrandfatherUntil)
        : null;
    }

    if (!settings.billingSettings.customBuild) settings.billingSettings.customBuild = {};
    if (customBuildEnabled !== undefined) {
      settings.billingSettings.customBuild.enabled = !!customBuildEnabled;
    }
    if (customBuildMarkupPercent !== undefined && Number(customBuildMarkupPercent) >= 0) {
      settings.billingSettings.customBuild.markupPercent = Number(customBuildMarkupPercent);
    }

    if (!settings.billingSettings.storageGrace) settings.billingSettings.storageGrace = {};
    if (storageGraceEnabled !== undefined) settings.billingSettings.storageGrace.enabled = !!storageGraceEnabled;
    if (storageGraceDays !== undefined && Number(storageGraceDays) > 0) {
      settings.billingSettings.storageGrace.graceDays = Number(storageGraceDays);
    }
    if (storageGraceTerminateAtEnd !== undefined) {
      settings.billingSettings.storageGrace.terminateAtEnd = !!storageGraceTerminateAtEnd;
    }
    if (storageGraceWarnDailyFrom !== undefined && Number(storageGraceWarnDailyFrom) >= 0) {
      settings.billingSettings.storageGrace.warnDailyFrom = Number(storageGraceWarnDailyFrom);
    }

    if (suspendOrder !== undefined) {
      if (!['most_expensive', 'least_expensive', 'newest', 'oldest'].includes(suspendOrder)) {
        return res.status(400).json({
          success: false,
          message: 'suspendOrder must be one of: most_expensive, least_expensive, newest, oldest',
        });
      }
      settings.billingSettings.suspendOrder = suspendOrder;
    }
    if (staleProvisioningDays !== undefined && Number(staleProvisioningDays) > 0) {
      settings.billingSettings.staleProvisioningDays = Number(staleProvisioningDays);
    }
    if (Array.isArray(cardExpiryWarningDays)) {
      settings.billingSettings.cardExpiryWarningDays = cardExpiryWarningDays
        .map(Number)
        .filter((n) => !Number.isNaN(n) && n > 0)
        .sort((a, b) => b - a);
    }

    if (!settings.billingSettings.copy) settings.billingSettings.copy = {};
    if (copyAutoSuspendedMessage !== undefined) {
      settings.billingSettings.copy.autoSuspendedMessage = String(copyAutoSuspendedMessage).slice(0, 1000);
    }
    if (copyStorageDebtMessage !== undefined) {
      settings.billingSettings.copy.storageDebtMessage = String(copyStorageDebtMessage).slice(0, 1000);
    }
    if (copyCheckoutCardRequiredMessage !== undefined) {
      settings.billingSettings.copy.checkoutCardRequiredMessage = String(copyCheckoutCardRequiredMessage).slice(0, 1000);
    }
    if (copyCheckoutPaygIneligibleMessage !== undefined) {
      settings.billingSettings.copy.checkoutPaygIneligibleMessage = String(copyCheckoutPaygIneligibleMessage).slice(0, 1000);
    }

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    /**
     * The gate just turned on — apply it to what's already running, not only
     * to the next transition. See fundingService.enforceCardGateNow for why
     * this can't just wait for the daily job or the next resume.
     */
    let cardGateEnforcement = null;
    if (cardGateWasOff && settings.billingSettings.cardGate.requireVerifiedCard) {
      const fundingService = require('../../../services/billing/fundingService');
      try {
        cardGateEnforcement = await fundingService.enforceCardGateNow({
          settings: settings.billingSettings,
          actor: req.user,
        });
      } catch (err) {
        console.error('[Settings] Card gate enforcement failed:', err.message);
      }
    }

    /**
     * Pay-as-you-go is off platform-wide — move every PAYG deployment whose
     * owner has not been individually allowed onto prepaid now, rather than
     * leaving it running up debt until the next hourly run notices. Run on
     * every save while it is off, not only on the on→off edge: it is cheap,
     * and it heals anything a failed earlier attempt left behind. See
     * fundingService.enforcePaygAccessNow.
     */
    let paygEnforcement = null;
    if (!settings.billingSettings.payg?.enabled) {
      const fundingService = require('../../../services/billing/fundingService');
      try {
        paygEnforcement = await fundingService.enforcePaygAccessNow({
          settings: settings.billingSettings,
          actor: req.user,
        });
      } catch (err) {
        console.error('[Settings] Pay-as-you-go enforcement failed:', err.message);
      }
    }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'Updated billing settings',
      metadata: { ...req.body, cardGateEnforcement, paygEnforcement },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({
      success: true,
      message: 'Billing settings updated successfully',
      billingSettings: settings.billingSettings,
      cardGateEnforcement,
      paygEnforcement,
    });
  } catch (error) {
    console.error('Update billing settings error:', error);
    res.status(500).json({ success: false, message: 'Error updating billing settings' });
  }
});

// @route   GET /api/v1/admin/settings/theme
// @desc    Get theme/branding settings
// @access  Private (Admin with settings.view permission)
router.get('/theme', checkPermission('settings.view'), async (req, res) => {
  try {
    const settings = await adminSettingsService.getSettings();

    res.json({
      success: true,
      themeSettings: settings.themeSettings
    });

  } catch (error) {
    console.error('Get theme settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching theme settings'
    });
  }
});

// @route   PUT /api/v1/admin/settings/theme
// @desc    Update theme/branding settings
// @access  Private (Admin with settings.edit permission)
router.put('/theme', checkPermission('settings.edit'), async (req, res) => {
  try {
    const {
      appName,
      appTagline,
      appDescription,
      logoUrl,
      logoSmallUrl,
      faviconUrl,
      primaryService,
      secondaryService,
      targetPlatform,
      toolType,
      welcomeTitle,
      welcomeMessage,
      emailVerificationMessage,
      primaryColor,
      secondaryColor,
      accentColor,
      companyName
    } = req.body;
    const clientIP = getClientIP(req);

    const settings = await adminSettingsService.getSettings();

    // Update theme settings
    if (appName !== undefined) settings.themeSettings.appName = appName;
    if (appTagline !== undefined) settings.themeSettings.appTagline = appTagline;
    if (appDescription !== undefined) settings.themeSettings.appDescription = appDescription;
    if (logoUrl !== undefined) settings.themeSettings.logoUrl = logoUrl;
    if (logoSmallUrl !== undefined) settings.themeSettings.logoSmallUrl = logoSmallUrl;
    if (faviconUrl !== undefined) settings.themeSettings.faviconUrl = faviconUrl;
    if (primaryService !== undefined) settings.themeSettings.primaryService = primaryService;
    if (secondaryService !== undefined) settings.themeSettings.secondaryService = secondaryService;
    if (targetPlatform !== undefined) settings.themeSettings.targetPlatform = targetPlatform;
    if (toolType !== undefined) settings.themeSettings.toolType = toolType;
    if (welcomeTitle !== undefined) settings.themeSettings.welcomeTitle = welcomeTitle;
    if (welcomeMessage !== undefined) settings.themeSettings.welcomeMessage = welcomeMessage;
    if (emailVerificationMessage !== undefined) settings.themeSettings.emailVerificationMessage = emailVerificationMessage;
    if (primaryColor !== undefined) settings.themeSettings.primaryColor = primaryColor;
    if (secondaryColor !== undefined) settings.themeSettings.secondaryColor = secondaryColor;
    if (accentColor !== undefined) settings.themeSettings.accentColor = accentColor;
    if (companyName !== undefined) settings.themeSettings.companyName = companyName;

    await settings.save();

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'AdminSettings',
      targetId: settings.id,
      description: 'Theme/branding settings updated',
      metadata: { updatedFields: Object.keys(req.body) },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Theme settings updated successfully',
      themeSettings: settings.themeSettings
    });

  } catch (error) {
    console.error('Update theme settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating theme settings'
    });
  }
});

// @route   GET /api/admin/settings/email-blocking/domains
// @desc    Get blocked temporary email domains
// @access  Private (Admin with settings.view permission)
router.get('/email-blocking/domains', checkPermission('settings.view'), async (req, res) => {
  try {
    const settings = await adminSettingsService.getSettings();
    const blockedDomains = settings.customerSettings.blockedTemporaryEmailDomains || [];

    res.json({
      success: true,
      domains: blockedDomains,
      total: blockedDomains.length
    });

  } catch (error) {
    console.error('Get blocked domains error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching blocked domains'
    });
  }
});

// @route   PUT /api/admin/settings/email-blocking/domains
// @desc    Update blocked temporary email domains
// @access  Private (Admin with settings.edit permission)
router.put('/email-blocking/domains', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { domains } = req.body;
    const clientIP = getClientIP(req);

    if (!Array.isArray(domains)) {
      return res.status(400).json({
        success: false,
        message: 'Domains must be an array'
      });
    }

    // Normalize domains (lowercase)
    const normalizedDomains = domains.map(d => d.toLowerCase().trim()).filter(d => d.length > 0);

    const settings = await adminSettingsService.getSettings();
    settings.customerSettings.blockedTemporaryEmailDomains = normalizedDomains;
    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: `Updated blocked temporary email domains (${normalizedDomains.length} domains)`,
      metadata: { domainCount: normalizedDomains.length },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Blocked domains updated successfully',
      domains: normalizedDomains,
      total: normalizedDomains.length
    });

  } catch (error) {
    console.error('Update blocked domains error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating blocked domains'
    });
  }
});

// @route   POST /api/admin/settings/email-blocking/domains/:domain
// @desc    Add a single blocked temporary email domain
// @access  Private (Admin with settings.edit permission)
router.post('/email-blocking/domains/:domain', checkPermission('settings.edit'), async (req, res) => {
  try {
    const domain = req.params.domain.toLowerCase().trim();
    const clientIP = getClientIP(req);

    if (!domain || domain.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Domain is required'
      });
    }

    const settings = await adminSettingsService.getSettings();
    const domains = settings.customerSettings.blockedTemporaryEmailDomains || [];

    if (domains.includes(domain)) {
      return res.status(400).json({
        success: false,
        message: 'Domain already blocked'
      });
    }

    domains.push(domain);
    settings.customerSettings.blockedTemporaryEmailDomains = domains;
    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: `Added blocked domain: ${domain}`,
      metadata: { domain },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: `Domain ${domain} blocked successfully`,
      domains
    });

  } catch (error) {
    console.error('Add blocked domain error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding blocked domain'
    });
  }
});

// @route   DELETE /api/admin/settings/email-blocking/domains/:domain
// @desc    Remove a blocked temporary email domain
// @access  Private (Admin with settings.edit permission)
router.delete('/email-blocking/domains/:domain', checkPermission('settings.edit'), async (req, res) => {
  try {
    const domain = req.params.domain.toLowerCase().trim();
    const clientIP = getClientIP(req);

    if (!domain || domain.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Domain is required'
      });
    }

    const settings = await adminSettingsService.getSettings();
    const domains = settings.customerSettings.blockedTemporaryEmailDomains || [];

    const initialLength = domains.length;
    const updatedDomains = domains.filter(d => d !== domain);

    if (updatedDomains.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'Domain not found in blocked list'
      });
    }

    settings.customerSettings.blockedTemporaryEmailDomains = updatedDomains;
    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Log activity
    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: `Removed blocked domain: ${domain}`,
      metadata: { domain },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: `Domain ${domain} unblocked successfully`,
      domains: updatedDomains
    });

  } catch (error) {
    console.error('Remove blocked domain error:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing blocked domain'
    });
  }
});

// @route   PUT /api/v1/admin/settings/google-sso
// @desc    Update Google SSO settings
// @access  Private (Super Admin only)
router.put('/google-sso', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { enabled, clientId, clientSecret } = req.body;
    const clientIP = getClientIP(req);

    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can update Google SSO settings' });
    }

    const settings = await adminSettingsService.getSettings();

    if (!settings.googleSSOSettings) settings.googleSSOSettings = {};

    if (enabled !== undefined) settings.googleSSOSettings.enabled = enabled;
    if (clientId !== undefined) settings.googleSSOSettings.clientId = clientId.trim();
    // Only update secret if a new one is provided (non-empty)
    if (clientSecret && clientSecret.trim()) {
      settings.googleSSOSettings.clientSecret = clientSecret.trim();
    }

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: `Google SSO settings updated — ${enabled ? 'enabled' : 'disabled'}`,
      metadata: { enabled, clientId: clientId ? '***set***' : '(unchanged)' },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Google SSO settings saved successfully',
      googleSSOSettings: {
        enabled: settings.googleSSOSettings.enabled,
        clientId: settings.googleSSOSettings.clientId,
        // Never return the secret
      }
    });

  } catch (error) {
    console.error('Update Google SSO settings error:', error);
    res.status(500).json({ success: false, message: 'Error updating Google SSO settings' });
  }
});

// @route   PUT /api/v1/admin/settings/stripe
// @desc    Update Stripe integration settings
// @access  Private (Super Admin only)
router.put('/stripe', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { publicKey, secretKey, webhookSecret } = req.body;
    const clientIP = getClientIP(req);

    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can update Stripe settings' });
    }

    const settings = await adminSettingsService.getSettings();

    if (!settings.stripeSettings) settings.stripeSettings = {};

    if (publicKey !== undefined) settings.stripeSettings.publicKey = publicKey.trim();
    // Only update secrets if new values are provided (non-empty)
    if (secretKey && secretKey.trim()) {
      settings.stripeSettings.secretKey = secretKey.trim();
    }
    if (webhookSecret && webhookSecret.trim()) {
      settings.stripeSettings.webhookSecret = webhookSecret.trim();
    }

    settings.lastUpdatedBy = req.userId;
    await settings.save();

    // Clear cached Stripe instance so it reinitializes with new keys
    try {
      const stripeService = require('../../../services/stripe/stripeService');
      if (stripeService.stripe) stripeService.stripe = null;
    } catch (e) { /* ignore */ }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: 'Stripe integration settings updated',
      metadata: { publicKey: publicKey ? '***set***' : '(unchanged)' },
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({
      success: true,
      message: 'Stripe settings saved successfully',
      stripeSettings: {
        publicKey: settings.stripeSettings.publicKey,
        // Never return secrets
      }
    });

  } catch (error) {
    console.error('Update Stripe settings error:', error);
    res.status(500).json({ success: false, message: 'Error updating Stripe settings' });
  }
});

// @route   PUT /api/v1/admin/settings/lemonsqueezy
// @desc    Update LemonSqueezy integration settings
// @access  Private (Super Admin only)
const lsController = require('../../../controllers/admin/lemonSqueezySettingsController');
router.put('/lemonsqueezy', checkPermission('settings.edit'), lsController.updateLemonSqueezy);

// @route   PUT /api/v1/admin/settings/polar
// @desc    Update Polar integration settings
// @access  Private (Super Admin only)
const polarController = require('../../../controllers/admin/polarSettingsController');
router.put('/polar', checkPermission('settings.edit'), polarController.updatePolar);

// @route   PUT /api/v1/admin/settings/payment-gateway
// @desc    Set the active payment gateway (stripe, lemonsqueezy, or polar)
// @access  Private (Super Admin only)
router.put('/payment-gateway', checkPermission('settings.edit'), lsController.updatePaymentGateway);

// @route   PUT /api/v1/admin/settings/integrations/:type/toggle
// @desc    Enable or disable an integration card (stripe/lemonsqueezy/polar/email/google-sso)
// @access  Private (Super Admin only)
const integrationsController = require('../../../controllers/admin/integrationsController');
router.put('/integrations/:type/toggle', checkPermission('settings.edit'), integrationsController.toggleIntegration);

// ==========================================
// EMAIL TEMPLATES
// ==========================================

/**
 * Which language an email-template request is about.
 *
 * Defaults to English so every existing caller — including the admin UI as it
 * shipped before this parameter existed — keeps working untouched.
 *
 * Validated against the whole supported catalogue rather than the *enabled*
 * list on purpose: an operator should be able to write and proof-read a
 * translation before switching that language on for customers.
 */
const resolveTemplateLang = (req) => {
  const raw = (req.query.lang || 'en').toString();
  const known = languageSettingsService.SUPPORTED_LANGUAGES.some((l) => l.code === raw);
  return known ? raw : null;
};

/**
 * Where one language's override lives inside a template record.
 *
 * English stays in the flat `{subject, body}` it has always used — that is what
 * makes this change need no data migration. Other languages nest under `i18n`.
 */
const overrideFor = (record, lang) => {
  if (!record) return null;
  return lang === 'en' ? record : (record.i18n && record.i18n[lang]) || null;
};

// @route   GET /api/v1/admin/settings/email-templates
// @desc    Get all email templates (custom + defaults) for one language
// @access  Private (Admin with settings.view)
router.get('/email-templates', checkPermission('settings.view'), async (req, res) => {
  try {
    const lang = resolveTemplateLang(req);
    if (!lang) {
      return res.status(400).json({ success: false, message: `Unsupported language: ${req.query.lang}` });
    }

    const settings = await adminSettingsService.getSettings();
    const { getDefaults, TEMPLATE_KEYS, TEMPLATE_VARIABLES } = require('../../../services/email/defaultTemplates');
    // The shipped copy for THIS language is what the editor shows as the
    // placeholder, so an admin editing Arabic proof-reads against the Arabic
    // original rather than against English.
    const shipped = getDefaults(lang);

    const templates = {};
    for (const key of TEMPLATE_KEYS) {
      const custom = overrideFor(settings.emailTemplates?.[key], lang);
      templates[key] = {
        subject: (custom?.subject && custom.subject.trim()) || '',
        body: (custom?.body && custom.body.trim()) || '',
        defaultSubject: shipped[key].subject,
        defaultBody: shipped[key].body,
        variables: TEMPLATE_VARIABLES[key] || [],
      };
    }

    res.json({
      success: true,
      language: lang,
      languages: languageSettingsService.SUPPORTED_LANGUAGES,
      templates,
    });
  } catch (error) {
    console.error('Get email templates error:', error);
    res.status(500).json({ success: false, message: 'Error fetching email templates' });
  }
});

// @route   PUT /api/v1/admin/settings/email-templates/:key
// @desc    Update a single email template
// @access  Private (Admin with settings.edit)
router.put('/email-templates/:key', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { key } = req.params;
    const { subject, body } = req.body;
    const clientIP = getClientIP(req);
    const { TEMPLATE_KEYS } = require('../../../services/email/defaultTemplates');

    if (!TEMPLATE_KEYS.includes(key)) {
      return res.status(400).json({ success: false, message: `Invalid template key: ${key}` });
    }

    const lang = resolveTemplateLang(req);
    if (!lang) {
      return res.status(400).json({ success: false, message: `Unsupported language: ${req.query.lang}` });
    }

    const settings = await adminSettingsService.getSettings();
    if (!settings.emailTemplates) settings.emailTemplates = {};
    if (!settings.emailTemplates[key]) settings.emailTemplates[key] = {};

    // Empty string means "use default"
    const record = settings.emailTemplates[key];
    if (lang === 'en') {
      record.subject = (subject || '').trim();
      record.body = (body || '').trim();
    } else {
      if (!record.i18n) record.i18n = {};
      record.i18n[lang] = { subject: (subject || '').trim(), body: (body || '').trim() };
    }
    settings.markModified('emailTemplates');
    await settings.save();

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      description: `Email template "${key}" (${lang}) updated`,
      ipAddress: clientIP,
      userAgent: req.get('user-agent'),
      status: 'success'
    });

    res.json({ success: true, message: `Email template "${key}" saved successfully` });
  } catch (error) {
    console.error('Update email template error:', error);
    res.status(500).json({ success: false, message: 'Error updating email template' });
  }
});

// @route   DELETE /api/v1/admin/settings/email-templates/:key
// @desc    Reset a template to default (clear custom)
// @access  Private (Admin with settings.edit)
router.delete('/email-templates/:key', checkPermission('settings.edit'), async (req, res) => {
  try {
    const { key } = req.params;
    const { TEMPLATE_KEYS } = require('../../../services/email/defaultTemplates');

    if (!TEMPLATE_KEYS.includes(key)) {
      return res.status(400).json({ success: false, message: `Invalid template key: ${key}` });
    }

    const lang = resolveTemplateLang(req);
    if (!lang) {
      return res.status(400).json({ success: false, message: `Unsupported language: ${req.query.lang}` });
    }

    const settings = await adminSettingsService.getSettings();
    const record = settings.emailTemplates?.[key];
    if (record) {
      // Reset clears only the language being edited. Resetting the Spanish copy
      // must not silently throw away a customised English one.
      if (lang === 'en') {
        record.subject = '';
        record.body = '';
      } else if (record.i18n) {
        delete record.i18n[lang];
      }
      settings.markModified('emailTemplates');
      await settings.save();
    }

    res.json({ success: true, message: `Email template "${key}" reset to default` });
  } catch (error) {
    console.error('Reset email template error:', error);
    res.status(500).json({ success: false, message: 'Error resetting email template' });
  }
});

// @route   POST /api/v1/admin/settings/email-templates/:key/preview
// @desc    Preview a template with sample data
// @access  Private (Admin with settings.view)
router.post('/email-templates/:key/preview', checkPermission('settings.view'), async (req, res) => {
  try {
    const { key } = req.params;
    const { subject: customSubject, body: customBody } = req.body;
    const { TEMPLATE_KEYS } = require('../../../services/email/defaultTemplates');

    if (!TEMPLATE_KEYS.includes(key)) {
      return res.status(400).json({ success: false, message: `Invalid template key: ${key}` });
    }

    const lang = resolveTemplateLang(req);
    if (!lang) {
      return res.status(400).json({ success: false, message: `Unsupported language: ${req.query.lang}` });
    }

    const customTemplate = (customSubject || customBody)
      ? { subject: customSubject, body: customBody }
      : null;

    const result = await emailService.previewTemplate(key, customTemplate, lang);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Preview email template error:', error);
    res.status(500).json({ success: false, message: 'Error previewing template' });
  }
});

module.exports = router;
