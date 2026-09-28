const express = require('express');
const cors = require('cors');
const path = require('path');
const { getAppInfo } = require('./utils/helpers');
require('dotenv').config();

const app = express();

// ==========================================
// MIDDLEWARE
// ==========================================

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Body Parsers
// Stripe webhooks need raw body — mount BEFORE json parser
app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }));
// LemonSqueezy webhooks also need raw body for HMAC signature verification
app.use('/api/v1/webhooks/lemonsqueezy', express.raw({ type: 'application/json' }));
// Polar webhooks also need raw body for Standard Webhooks signature verification
app.use('/api/v1/webhooks/polar', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Postgres can't store a NUL byte in a text column, so one anywhere in a body
// turned into a 500. Strip them before anything downstream sees the payload.
const { sanitizeInput } = require('./middleware/validation/sanitizeInput');
app.use(sanitizeInput);

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Request Logging (Development only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ==========================================
// MAINTENANCE MODE CHECK
// ==========================================
const { maintenanceMiddleware } = require('./middleware/security/maintenanceMode');
app.use(maintenanceMiddleware);

// ==========================================
// ROUTES
// ==========================================

// Import main routes
const routes = require('./routes');

// Mount API routes
app.use('/api', routes);

// Root endpoint - Simplified response
app.get('/', (req, res) => {
  // For testing/development - show basic info
  if (process.env.NODE_ENV === 'development') {
    const appInfo = getAppInfo();
    res.json({
      success: true,
      ...appInfo
    });
  } else {
    // For production - minimal response
    res.status(200).json({
      success: true,
      message: 'OK',
      status: 200
    });
  }
});

// ==========================================
// ERROR HANDLING
// ==========================================

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.path
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  const errorMessage = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;
  
  res.status(err.status || 500).json({
    success: false,
    message: errorMessage,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

module.exports = app;
