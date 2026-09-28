/**
 * Comprehensive Admin Center API Test Suite
 * Run with: node src/scripts/testSuite.js
 * 
 * Prerequisites:
 *   - PostgreSQL running at localhost:5432 (see DATABASE_URL in .env)
 *   - Backend server running at localhost:3001
 *   - Super admin seeded (run: npm run seed)
 *
 * Credentials come from SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD in .env. They
 * used to be hardcoded here, which meant the entire suite failed with 401s the
 * moment the seeded password differed — while still printing a full-looking
 * test run, so nobody noticed it had stopped testing anything.
 */

require('dotenv').config();
const http = require('http');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001/api/v1';
const ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set in .env');
  process.exit(1);
}
let AUTH_TOKEN = '';
let createdUserId = '';
let createdCustomerId = '';
let createdRoleId = '';
let createdBlogPostId = '';
let createdRedirectId = '';
let createdRbacUserId = '';
let createdRbacRoleId = '';

const results = { passed: 0, failed: 0, skipped: 0, tests: [] };

// ─── HTTP Helper ───
function request(method, path, body = null, token = AUTH_TOKEN) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── Test Helper ───
async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    results.tests.push({ name, status: 'PASSED' });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.failed++;
    results.tests.push({ name, status: 'FAILED', error: err.message });
    console.log(`  ✗ ${name} — ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ═══════════════════════════════════════════════════════════════
//  TEST SUITES
// ═══════════════════════════════════════════════════════════════

async function testAuth() {
  console.log('\n── Authentication ──');

  await test('Login with wrong password fails', async () => {
    const res = await request('POST', '/auth/admin/login', { email: ADMIN_EMAIL, password: 'definitely-not-the-password' }, null);
    assert(res.status === 401 || res.status === 400, `Expected 401/400, got ${res.status}`);
  });

  await test('Login with valid super admin', async () => {
    const res = await request('POST', '/auth/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, null);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.token, 'Missing token in response');
    AUTH_TOKEN = res.data.token;
  });

  await test('Get current user profile', async () => {
    const res = await request('GET', '/auth/admin/me');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.user || res.data.admin, 'Missing user data');
  });

  await test('Access protected route without token fails', async () => {
    const res = await request('GET', '/admin/users', null, '');
    assert(res.status === 401 || res.status === 403, `Expected 401/403, got ${res.status}`);
  });
}

async function testUsers() {
  console.log('\n── User Management ──');

  await test('List users', async () => {
    const res = await request('GET', '/admin/users');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(Array.isArray(res.data.users) || Array.isArray(res.data), 'Expected users array');
  });

  await test('Create a new admin user', async () => {
    const user = {
      name: 'Test User',
      email: `testuser_${Date.now()}@test.com`,
      password: 'Test@1234',
      role: 'admin',
    };
    const res = await request('POST', '/admin/users', user);
    assert(res.status === 201 || res.status === 200, `Expected 201/200, got ${res.status}`);
    createdUserId = res.data.user?.id || res.data.user?.id || res.data.id || res.data.id;
    assert(createdUserId, 'Missing user ID in response');
  });

  await test('Get user by ID', async () => {
    if (!createdUserId) throw new Error('No user ID available');
    const res = await request('GET', `/admin/users/${createdUserId}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Update user', async () => {
    if (!createdUserId) throw new Error('No user ID available');
    const res = await request('PUT', `/admin/users/${createdUserId}`, { name: 'Updated Test User' });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Suspend user', async () => {
    if (!createdUserId) throw new Error('No user ID available');
    const res = await request('POST', `/admin/users/${createdUserId}/suspend`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Activate user', async () => {
    if (!createdUserId) throw new Error('No user ID available');
    const res = await request('POST', `/admin/users/${createdUserId}/activate`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });
}

async function testCustomers() {
  console.log('\n── Customer Management ──');

  await test('List customers', async () => {
    const res = await request('GET', '/admin/customers');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Get first customer (if exists)', async () => {
    const res = await request('GET', '/admin/customers');
    const customers = res.data.customers || res.data;
    if (Array.isArray(customers) && customers.length > 0) {
      createdCustomerId = customers[0].id || customers[0].id;
      const detail = await request('GET', `/admin/customers/${createdCustomerId}`);
      assert(detail.status === 200, `Expected 200, got ${detail.status}`);
    }
  });
}

async function testRoles() {
  console.log('\n── Role Management ──');

  await test('List roles', async () => {
    const res = await request('GET', '/admin/roles');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Create a custom role', async () => {
    const role = {
      name: `Test Role ${Date.now()}`,
      description: 'Automated test role',
      permissions: ['users.view', 'customers.view', 'analytics.view'],
    };
    const res = await request('POST', '/admin/roles', role);
    assert(res.status === 201 || res.status === 200, `Expected 201/200, got ${res.status}`);
    createdRoleId = res.data.role?.id || res.data.role?.id || res.data.id || res.data.id;
  });
}

async function testAnalytics() {
  console.log('\n── Analytics ──');

  await test('Get overview', async () => {
    const res = await request('GET', '/admin/analytics/overview?timeframe=30d');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    assert(res.data.overview, 'Missing overview data');
  });

  await test('Get user growth', async () => {
    const res = await request('GET', '/admin/analytics/users-growth?period=30d');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  // Was `/analytics/analyses-trend` — an endpoint from the product this
  // codebase used to be, which has not existed for a long time. The equivalent
  // here is the deployments trend.
  await test('Get deployments trend', async () => {
    const res = await request('GET', '/admin/analytics/deployments-trend?period=30d');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Get top customers', async () => {
    const res = await request('GET', '/admin/analytics/top-customers?limit=5');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Get recent activities', async () => {
    const res = await request('GET', '/admin/analytics/recent-activities?limit=5');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });
}

async function testBlog() {
  console.log('\n── Blog ──');

  await test('Get blog stats', async () => {
    const res = await request('GET', '/admin/blog/stats');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('List blog posts', async () => {
    const res = await request('GET', '/admin/blog/posts');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Create blog post', async () => {
    const post = {
      title: `Test Blog Post ${Date.now()}`,
      slug: `test-blog-${Date.now()}`,
      content: '<p>This is an automated test blog post.</p>',
      excerpt: 'Test excerpt',
      status: 'draft',
      category: 'testing',
      tags: ['test', 'automated'],
    };
    const res = await request('POST', '/admin/blog/posts', post);
    assert(res.status === 201 || res.status === 200, `Expected 201/200, got ${res.status}`);
    createdBlogPostId = res.data.post?.id || res.data.id || res.data.id;
    assert(createdBlogPostId, 'Missing blog post ID');
  });

  await test('Get blog post by ID', async () => {
    if (!createdBlogPostId) throw new Error('No blog post ID');
    const res = await request('GET', `/admin/blog/posts/${createdBlogPostId}`);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Update blog post status to published', async () => {
    if (!createdBlogPostId) throw new Error('No blog post ID');
    const res = await request('PUT', `/admin/blog/posts/${createdBlogPostId}/status`, { status: 'published' });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Get blog categories', async () => {
    const res = await request('GET', '/admin/blog/categories');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Blog posts filter by status (multi-select)', async () => {
    const res = await request('GET', '/admin/blog/posts?status=draft,published');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });
}

async function testSettings() {
  console.log('\n── Settings ──');

  await test('Get all settings', async () => {
    const res = await request('GET', '/admin/settings');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Get theme settings', async () => {
    const res = await request('GET', '/admin/settings/theme');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Update theme settings', async () => {
    const res = await request('PUT', '/admin/settings/theme', {
      appName: 'Test App',
      primaryColor: '#7C3AED',
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });
}

async function testSEO() {
  console.log('\n── SEO ──');

  await test('Get SEO settings', async () => {
    const res = await request('GET', '/admin/seo/settings');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Get redirects', async () => {
    const res = await request('GET', '/admin/seo/redirects');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Create a redirect', async () => {
    const redirect = {
      fromPath: `/test-redirect-${Date.now()}`,
      toPath: '/models',
      statusCode: 301,
      isActive: true,
    };
    const res = await request('POST', '/admin/seo/redirects', redirect);
    assert(res.status === 201 || res.status === 200, `Expected 201/200, got ${res.status}`);
    createdRedirectId = res.data.redirect?.id || res.data.id || res.data.id;
  });

  await test('Public sitemap endpoint', async () => {
    const res = await request('GET', '/public/seo/sitemap.xml', null, '');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Public robots.txt endpoint', async () => {
    const res = await request('GET', '/public/seo/robots.txt', null, '');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Public check-redirect endpoint', async () => {
    const res = await request('GET', '/public/seo/check-redirect?path=/nonexistent', null, '');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });
}

async function testPublicEndpoints() {
  console.log('\n── Public Endpoints ──');

  await test('Get public settings (site info)', async () => {
    const res = await request('GET', '/public/marketing/site', null, '');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Get public blog posts', async () => {
    const res = await request('GET', '/public/blog/posts', null, '');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Get public pages', async () => {
    const res = await request('GET', '/public/marketing/pages', null, '');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Get public navigation', async () => {
    const res = await request('GET', '/public/marketing/navigation', null, '');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });
}

async function testActivityLogs() {
  console.log('\n── Activity Logs ──');

  await test('Get activity logs', async () => {
    const res = await request('GET', '/admin/logs');
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });
}

async function testRBAC() {
  console.log('\n── RBAC Enforcement ──');

  // Create a restricted user with only users.view permission
  let restrictedToken = '';

  await test('Create restricted role', async () => {
    const role = {
      name: `RBAC Test Role ${Date.now()}`,
      description: 'Restricted role for RBAC test',
      permissions: ['users.view'],
    };
    const res = await request('POST', '/admin/roles', role);
    assert(res.status === 201 || res.status === 200, `Expected 201/200, got ${res.status}`);
    const roleId = res.data.role?.id || res.data.role?.id || res.data.id || res.data.id;
    assert(roleId, 'Missing role ID');
    createdRbacRoleId = roleId;

    // Create user with this role
    const email = `rbac_test_${Date.now()}@test.com`;
    const userRes = await request('POST', '/admin/users', {
      name: 'RBAC Test User',
      email,
      password: 'RbacTest@123',
      role: 'custom',
      customRoleId: roleId,
    });
    assert(userRes.status === 201 || userRes.status === 200, `User create: ${userRes.status}`);
    createdRbacUserId = userRes.data.user?.id || userRes.data.id;

    // Login as that user
    const loginRes = await request('POST', '/auth/admin/login', { email, password: 'RbacTest@123' }, null);
    assert(loginRes.status === 200, `Login: ${loginRes.status}`);
    restrictedToken = loginRes.data.token;
  });

  await test('Restricted user CAN access users list', async () => {
    if (!restrictedToken) throw new Error('No restricted token');
    const res = await request('GET', '/admin/users', null, restrictedToken);
    assert(res.status === 200, `Expected 200, got ${res.status}`);
  });

  await test('Restricted user CANNOT access analytics (no permission)', async () => {
    if (!restrictedToken) throw new Error('No restricted token');
    const res = await request('GET', '/admin/analytics/overview', null, restrictedToken);
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await test('Restricted user CANNOT create users (no users.create permission)', async () => {
    if (!restrictedToken) throw new Error('No restricted token');
    const res = await request('POST', '/admin/users', {
      name: 'Should Fail', email: 'fail@test.com', password: 'Fail@123', role: 'viewer'
    }, restrictedToken);
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await test('Restricted user CANNOT access settings (no settings.view permission)', async () => {
    if (!restrictedToken) throw new Error('No restricted token');
    const res = await request('GET', '/admin/settings', null, restrictedToken);
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });
}

// ─── Cleanup ───
async function cleanup() {
  console.log('\n── Cleanup ──');

  if (createdBlogPostId) {
    await test('Delete test blog post', async () => {
      const res = await request('DELETE', `/admin/blog/posts/${createdBlogPostId}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    });
  }

  if (createdRedirectId) {
    await test('Delete test redirect', async () => {
      const res = await request('DELETE', `/admin/seo/redirects/${createdRedirectId}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    });
  }

  if (createdUserId) {
    await test('Delete test user', async () => {
      const res = await request('DELETE', `/admin/users/${createdUserId}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    });
  }

  /*
   * The RBAC section creates a throwaway admin and a throwaway role. They used
   * to be left behind, so every run added another `rbac_test_*@test.com` admin
   * to the database — four had accumulated before anyone noticed. A test that
   * litters is a test people stop trusting.
   */
  if (createdRbacUserId) {
    await test('Delete RBAC test user', async () => {
      const res = await request('DELETE', `/admin/users/${createdRbacUserId}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    });
  }

  if (createdRbacRoleId) {
    await test('Delete RBAC test role', async () => {
      const res = await request('DELETE', `/admin/roles/${createdRbacRoleId}`);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
    });
  }

  // The custom role from testRoles() is left alone — nothing references it, and
  // unlike an admin account it cannot sign in.
}

// ═══════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Admin Center — Comprehensive API Test Suite');
  console.log('═══════════════════════════════════════════════════');

  try {
    await testAuth();
    await testUsers();
    await testCustomers();
    await testRoles();
    await testAnalytics();
    await testBlog();
    await testSettings();
    await testSEO();
    await testPublicEndpoints();
    await testActivityLogs();
    await testRBAC();
    await cleanup();
  } catch (err) {
    console.error('\n  FATAL ERROR:', err.message);
  }

  // ─── Final Report ───
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  FINAL REPORT');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total:   ${results.passed + results.failed}`);
  console.log(`  Passed:  ${results.passed}`);
  console.log(`  Failed:  ${results.failed}`);
  console.log(`  Rate:    ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);

  if (results.failed > 0) {
    console.log('\n  Failed Tests:');
    results.tests
      .filter((t) => t.status === 'FAILED')
      .forEach((t) => console.log(`    ✗ ${t.name}: ${t.error}`));
  }

  console.log('\n═══════════════════════════════════════════════════');
  process.exit(results.failed > 0 ? 1 : 0);
}

main();
