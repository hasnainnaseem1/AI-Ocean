const express = require('express');
const router = express.Router();
const userService = require('../../../services/user/userService');
const activityLogService = require('../../../services/admin/activityLogService');
const { checkPermission } = require('../../../middleware/security/rbac');
const { getClientIP } = require('../../../utils/helpers/ipHelper');

// Only allow in development or with special permission
const isDevelopment = process.env.NODE_ENV === 'development';

// @route   POST /api/v1/admin/dev-utils/verify-customer
// @desc    Manually verify a customer email (for testing without SMTP)
// @access  Private (Admin with users.edit permission)
router.post('/verify-customer', checkPermission('users.edit'), async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    // Find the customer
    const customer = await userService.findByEmail(email, { accountType: 'customer' });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    // Already verified
    if (customer.isEmailVerified && customer.status === 'active') {
      return res.json({
        success: true,
        message: 'Customer is already verified',
        customer: {
          name: customer.name,
          email: customer.email,
          status: customer.status,
          isEmailVerified: customer.isEmailVerified,
        },
      });
    }

    // Verify the customer
    await userService.updateUser(customer, {
      isEmailVerified: true,
      status: 'active',
      emailVerificationToken: null,
      emailVerificationExpires: null,
    });

    // Log the activity
    await activityLogService.logActivity({
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'customer_verified_manually',
      actionType: 'update',
      targetModel: 'User',
      targetId: customer.id,
      targetName: customer.name,
      description: `Admin ${req.user.name} manually verified customer: ${customer.email}`,
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
      metadata: {
        customerEmail: customer.email,
        reason: 'Testing without SMTP',
      },
    });

    res.json({
      success: true,
      message: 'Customer verified successfully',
      customer: {
        name: customer.name,
        email: customer.email,
        status: customer.status,
        isEmailVerified: customer.isEmailVerified,
      },
    });

  } catch (error) {
    console.error('Verify customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying customer',
    });
  }
});

// @route   POST /api/v1/admin/dev-utils/create-test-customer
// @desc    Create a test customer with auto-verification (for testing)
// @access  Private (Admin with users.create permission)
router.post('/create-test-customer', checkPermission('users.create'), async (req, res) => {
  try {
    const { name, email, password = 'test123456' } = req.body;

    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required',
      });
    }

    // Check if user already exists
    const existingUser = await userService.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
      });
    }

    // Create test customer with verification already done
    const user = await userService.createUser({
      name,
      email,
      password,
      accountType: 'customer',
      role: 'customer',
      status: 'active',
      isEmailVerified: true, // Auto-verified
    });

    // Give the test customer the same wallet a real signup would get
    const { provisionWallet } = require('../../../services/billing/walletProvisioning');
    await provisionWallet(user);

    // Log activity
    await activityLogService.logActivity({
      userId: req.user.id,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'test_customer_created',
      actionType: 'create',
      targetModel: 'User',
      targetId: user.id,
      targetName: user.name,
      description: `Admin ${req.user.name} created test customer: ${user.email}`,
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
      metadata: {
        customerEmail: user.email,
        autoVerified: true,
      },
    });

    res.status(201).json({
      success: true,
      message: 'Test customer created successfully (auto-verified)',
      customer: {
        name: user.name,
        email: user.email,
        password: password,
        status: user.status,
        isEmailVerified: user.isEmailVerified,
      },
      loginCredentials: {
        email: user.email,
        password: password,
      },
    });

  } catch (error) {
    console.error('Create test customer error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating test customer',
    });
  }
});

module.exports = router;
