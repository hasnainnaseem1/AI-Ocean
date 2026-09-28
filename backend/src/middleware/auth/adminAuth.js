const jwt = require('jsonwebtoken');
const activityLogService = require('../../services/admin/activityLogService');
const userService = require('../../services/user/userService');
const { getClientIP } = require('../../utils/helpers/ipHelper');

const adminAuth = async (req, res, next) => {
  try {
    const clientIP = getClientIP(req);

    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token, access denied'
      });
    }

    // Verify token — the payload's userId is the public id every other
    // the row's own id (see userService.js).
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find user (includes customRole, needed for permission checks downstream)
    const user = await userService.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found, token invalid'
      });
    }

    // Check if user is an admin
    if (user.accountType !== 'admin') {
      // Log unauthorized access attempt
      await activityLogService.logActivity({
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        action: 'login',
        actionType: 'auth',
        description: 'Unauthorized admin access attempt',
        ipAddress: clientIP,
        userAgent: req.get('user-agent'),
        status: 'failed',
        errorMessage: 'User is not an admin'
      });

      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }

    // Check if account is active
    if (user.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact support.'
      });
    }

    if (user.status === 'banned') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been banned.'
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Your account is not active. Please contact support.'
      });
    }

    // Attach user to request
    req.user = user;
    req.userId = user.id;

    next();
  } catch (error) {
    console.error('Admin auth middleware error:', error);

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired, please login again'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Authentication error'
    });
  }
};

module.exports = adminAuth;
