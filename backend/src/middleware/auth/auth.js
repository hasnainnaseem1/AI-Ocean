const jwt = require('jsonwebtoken');
const userService = require('../../services/user/userService');
const { accountEnded } = require('./accountStatus');

const auth = async (req, res, next) => {
  try {
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

    // Find user
    const user = await userService.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found, token invalid'
      });
    }

    /**
     * Status is re-checked on every request, not just at login.
     *
     * Suspending an account only rejected the *next* login before this, so a
     * customer who was already signed in kept full read access for the
     * remaining life of their token — up to 7 days. adminAuth.js has always
     * checked this; the customer middleware simply never did.
     */
    const ended = accountEnded(user.status);
    if (ended) return res.status(403).json({ success: false, ...ended });

    // Attach user to request
    req.user = user;
    req.userId = user.id;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);

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

module.exports = auth;
