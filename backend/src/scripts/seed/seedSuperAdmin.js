require('dotenv').config();

const prisma = require('../../lib/prismaClient');
const userService = require('../../services/user/userService');
const adminSettingsService = require('../../services/admin/adminSettingsService');

/**
 * Creates the first Super Admin.
 *
 * This is the bootstrap step for a brand-new deployment — run once, before
 * anyone can log in:  npm run seed
 */

const createSuperAdmin = async () => {
  try {
    // Fail fast on a bad DATABASE_URL rather than midway through the seed
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Connected to Postgres');

    const existingSuperAdmin = await prisma.user.findFirst({ where: { role: 'super_admin' } });

    if (existingSuperAdmin) {
      console.log('⚠️  Super Admin already exists!');
      console.log(`   Email: ${existingSuperAdmin.email}`);
      console.log('   If you want to create another super admin, use the admin panel.');
      return 0;
    }

    const superAdminData = {
      name: process.env.SUPER_ADMIN_NAME || 'Super Admin',
      email: process.env.SUPER_ADMIN_EMAIL || 'admin@example.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123',
      accountType: 'admin',
      role: 'super_admin',
      status: 'active',
      isEmailVerified: true,
    };

    if (superAdminData.email === 'admin@example.com'
      || superAdminData.password === 'SuperAdmin@123') {
      console.log('⚠️  WARNING: Using default credentials!');
      console.log('   Please set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD in .env file');
      console.log('   Or change them after first login for security.');
    }

    // Goes through userService so the password is hashed and a id
    // (the app's public-facing `_id`) is minted, exactly as it would be for a
    // user created through the admin UI.
    const superAdmin = await userService.createUser(superAdminData);

    console.log('✅ Super Admin created successfully!');
    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('   SUPER ADMIN CREDENTIALS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Email:    ${superAdmin.email}`);
    console.log(`   Password: ${superAdminData.password}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('⚠️  IMPORTANT SECURITY NOTES:');
    console.log('   1. Change the password immediately after first login');
    console.log('   2. Store credentials securely');
    console.log('   3. Never commit .env file to version control');
    console.log('');

    // Creates the singleton settings row with its defaults if it isn't there yet
    const settings = await adminSettingsService.getSettings();
    console.log(`Welcome to ${settings.siteName || process.env.APP_NAME || 'Admin Panel'}`);

    console.log('');
    console.log('🎉 Setup complete! You can now:');
    console.log(`   1. Login at: ${process.env.ADMIN_FRONTEND_URL || 'http://localhost:3003'}/login`);
    console.log('   2. Create additional admin users');
    console.log('   3. Configure system settings');
    console.log('');

    return 0;
  } catch (error) {
    console.error('❌ Error creating super admin:', error.message);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
};

createSuperAdmin().then((code) => process.exit(code));

/**
 * Usage:
 *
 * 1. Add to .env file:
 *    SUPER_ADMIN_NAME=Your Name
 *    SUPER_ADMIN_EMAIL=your.email@example.com
 *    SUPER_ADMIN_PASSWORD=YourSecurePassword123!
 *
 * 2. Run: npm run seed
 *
 * 3. Login with the credentials
 *
 * 4. Change password immediately
 */
