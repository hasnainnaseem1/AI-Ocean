require('dotenv').config();

const prisma = require('../../lib/prismaClient');
const userService = require('../../services/user/userService');
const teamLifecycleService = require('../../services/team/teamLifecycleService');
const creditService = require('../../services/billing/creditService');

/**
 * A demo organization with all five roles filled, for testing the Teams
 * feature by hand — the customer center's account switcher, role-gated UI,
 * invites, and spend limits all need more than one logged-in account to
 * actually exercise.
 *
 *   node -r dotenv/config src/scripts/seed/seedDemoTeam.js
 *
 * Not idempotent by design: running it twice is refused rather than silently
 * doubling the team, since "already ran" almost always means the tester
 * wants the existing credentials printed again, not a second organization.
 * Pass --reset to delete the previous run's team and everyone in it first.
 */

const PASSWORD = 'Demo@12345';
const TEAM_NAME = 'Acme Demo Co';
const DOMAIN = 'aiocean-test.com';

const PEOPLE = [
  { role: 'owner', name: 'Ayesha Khan', email: `owner-demo@${DOMAIN}` },
  { role: 'admin', name: 'Bilal Ahmed', email: `admin-demo@${DOMAIN}` },
  { role: 'billing', name: 'Sara Malik', email: `billing-demo@${DOMAIN}` },
  { role: 'developer', name: 'Usman Tariq', email: `developer-demo@${DOMAIN}`, spendLimitMonthly: 50 },
  { role: 'viewer', name: 'Hina Raza', email: `viewer-demo@${DOMAIN}` },
];

const WALLET_BALANCE = 200;

const printCredentials = (team) => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   DEMO ORGANIZATION — "${TEAM_NAME}"`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Same password for all five: ${PASSWORD}`);
  console.log('');
  PEOPLE.forEach((p) => {
    const tag = p.role === 'developer' ? `developer (spend limit $${p.spendLimitMonthly}/mo)` : p.role;
    console.log(`   ${p.email.padEnd(32)} ${p.name.padEnd(14)} ${tag}`);
  });
  console.log('');
  console.log(`   Wallet balance on the organization: $${WALLET_BALANCE.toFixed(2)}`);
  console.log('   Every person also has their own separate Personal account —');
  console.log('   log in as any of them and use the account switcher (top of the');
  console.log('   sidebar) to move between "Personal" and "Acme Demo Co".');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
};

const reset = async () => {
  const owner = await prisma.user.findUnique({ where: { email: PEOPLE[0].email } });
  if (!owner) return;
  const team = await prisma.team.findFirst({ where: { createdById: owner.id, kind: 'team', name: TEAM_NAME } });
  const emails = PEOPLE.map((p) => p.email);
  const users = await prisma.user.findMany({ where: { email: { in: emails } } });

  if (team) {
    await prisma.creditTransaction.deleteMany({ where: { wallet: { teamId: team.id } } });
    await prisma.creditWallet.deleteMany({ where: { teamId: team.id } });
    await prisma.teamActivity.deleteMany({ where: { teamId: team.id } });
    await prisma.teamMember.deleteMany({ where: { teamId: team.id } });
    await prisma.team.delete({ where: { id: team.id } });
  }
  for (const u of users) {
    const personal = await prisma.team.findFirst({ where: { createdById: u.id, kind: 'personal' } });
    if (personal) {
      await prisma.creditTransaction.deleteMany({ where: { wallet: { teamId: personal.id } } });
      await prisma.creditWallet.deleteMany({ where: { teamId: personal.id } });
      await prisma.team.delete({ where: { id: personal.id } });
    }
  }
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  console.log('🗑️  Previous demo organization and its people removed.');
};

const run = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Connected to Postgres');

    if (process.argv.includes('--reset')) {
      await reset();
    }

    const existingOwner = await prisma.user.findUnique({ where: { email: PEOPLE[0].email } });
    if (existingOwner) {
      console.log('⚠️  A demo owner with this email already exists — nothing created.');
      console.log('   Run again with --reset to delete the old one and start fresh:');
      console.log('   node -r dotenv/config src/scripts/seed/seedDemoTeam.js --reset');
      const existingTeam = await prisma.team.findFirst({
        where: { createdById: existingOwner.id, kind: 'team', name: TEAM_NAME },
      });
      if (existingTeam) printCredentials(existingTeam);
      return 0;
    }

    // Each person is a real, active, verified customer — createUser also
    // gives them their own Personal account, exactly as real signup does.
    const created = {};
    for (const p of PEOPLE) {
      created[p.role] = await userService.createUser({
        name: p.name,
        email: p.email,
        password: PASSWORD,
        accountType: 'customer',
        status: 'active',
        isEmailVerified: true,
      });
    }
    console.log(`✅ Created ${PEOPLE.length} demo customers (and their personal accounts)`);

    const team = await teamLifecycleService.createTeam(created.owner, { name: TEAM_NAME });
    console.log(`✅ Created organization "${TEAM_NAME}", owned by ${created.owner.email}`);

    for (const p of PEOPLE) {
      if (p.role === 'owner') continue;
      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: created[p.role].id,
          role: p.role,
          ...(p.spendLimitMonthly ? { spendLimitMonthly: p.spendLimitMonthly } : {}),
        },
      });
    }
    console.log('✅ Added admin, billing, developer (with a $50/mo spend limit) and viewer');

    await creditService.adjust(team.id, WALLET_BALANCE, {
      description: 'Demo seed balance',
      createdBy: created.owner.id,
    });
    console.log(`✅ Funded the organization's wallet with $${WALLET_BALANCE.toFixed(2)}`);

    printCredentials(team);
    return 0;
  } catch (error) {
    console.error('❌ Error seeding the demo organization:', error.message);
    console.error(error.stack);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
};

run().then((code) => process.exit(code));
