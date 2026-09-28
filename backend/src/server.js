require('dotenv').config();
const prisma = require('./lib/prismaClient');
const app = require('./app');
const { initializeJobs } = require('./jobs');

// ==========================================
// DATABASE CONNECTION
// ==========================================

const connectDB = async () => {
  try {
    // A cheap round-trip so a bad DATABASE_URL fails fast at boot rather than
    // on the first real request.
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Postgres connected successfully');
  } catch (error) {
    console.error('❌ Postgres connection error:', error.message);
    process.exit(1);
  }
};

// ==========================================
// START SERVER
// ==========================================

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

const startServer = async () => {
  // Connect to database first
  await connectDB();

  // Start Express server
  app.listen(PORT, () => {
    // Initialize cron jobs after server starts
    initializeJobs();

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚀 Server Started Successfully');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📍 Environment: ${NODE_ENV}`);
    const HOST = process.env.HOST || 'localhost';
    const BASE = `http://${HOST}:${PORT}`;
    console.log(`🌐 Server: ${BASE}`);
    console.log(`📡 API Base: ${BASE}/api`);
    console.log(`🏥 Health Check: ${BASE}/api/health`);
    console.log('');
    console.log('Available Endpoints:');
    console.log(`   Customer Login:  POST ${BASE}/api/v1/auth/customer/login`);
    console.log(`   Admin Login:   POST ${BASE}/api/v1/auth/admin/login`);
    console.log(`   Model Catalog: GET  ${BASE}/api/v1/customer/catalog/models`);
    console.log(`   Deployments:   POST ${BASE}/api/v1/customer/deployments`);
    console.log(`   Wallet:        GET  ${BASE}/api/v1/customer/wallet`);
    console.log(`   Analytics:     GET  ${BASE}/api/v1/admin/analytics/overview`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
  });
};

// ==========================================
// GRACEFUL SHUTDOWN
// ==========================================

const gracefulShutdown = async () => {
  console.log('\n🔄 Shutting down gracefully...');

  try {
    // Close database connection
    await prisma.$disconnect();
    console.log('✅ Postgres connection closed');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Promise Rejection:', err);
  gracefulShutdown();
});

// ==========================================
// INITIALIZE
// ==========================================

startServer();
