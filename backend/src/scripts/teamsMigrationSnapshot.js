/**
 * Money snapshot for the Teams migration (plan phase FOUNDATION).
 *
 * Moving every wallet, ledger row, card, payment, deployment and usage row
 * from "owned by a user" to "owned by a team" must not move a single cent.
 * Run this before the migration with `--save <file>`, and after it with
 * `--compare <file>`: it fails loudly on any difference.
 *
 * Before the migration it reads by user; after, by each user's personal team
 * (every existing customer gets exactly one), so the two are comparable.
 *
 *   node src/scripts/teamsMigrationSnapshot.js --save before.json
 *   node src/scripts/teamsMigrationSnapshot.js --compare before.json
 */
require('dotenv').config();
const fs = require('fs');
const prisma = require('../lib/prismaClient');

const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

const hasTeams = async () => {
  const rows = await prisma.$queryRaw`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_wallets' AND column_name = 'team_id'`;
  return rows.length > 0;
};

const snapshot = async () => {
  const teams = await hasTeams();
  const users = await prisma.user.findMany({
    where: { accountType: 'customer' }, select: { id: true, email: true }, orderBy: { email: 'asc' },
  });

  const out = {};
  for (const u of users) {
    // Owner column: user before the migration, the user's personal team after.
    const [{ owner } = {}] = teams
      ? await prisma.$queryRaw`SELECT id AS owner FROM teams WHERE created_by_id = ${u.id}::uuid AND kind = 'personal'`
      : [{ owner: u.id }];
    if (!owner) { out[u.email] = { missingPersonalTeam: true }; continue; }
    const col = teams ? 'team_id' : 'user_id';

    const q = async (sql) => (await prisma.$queryRawUnsafe(sql, owner))[0];
    const wallet = await q(`SELECT balance, outstanding_balance, lifetime_top_up, lifetime_spend FROM credit_wallets WHERE ${col} = $1::uuid`) || {};
    const ledger = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(debt_delta),0) AS debt FROM credit_transactions WHERE ${col} = $1::uuid`);
    const usage = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS amount FROM deployment_usages WHERE ${col} = $1::uuid`);
    const pays = await q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS amount FROM payments WHERE ${col} = $1::uuid`);
    const deps = await q(`SELECT COUNT(*)::int AS n FROM deployments WHERE ${col} = $1::uuid`);
    const cards = await q(`SELECT COUNT(*)::int AS n FROM payment_methods WHERE ${col} = $1::uuid`);

    out[u.email] = {
      balance: r4(wallet.balance), outstanding: r4(wallet.outstanding_balance),
      lifetimeTopUp: r4(wallet.lifetime_top_up), lifetimeSpend: r4(wallet.lifetime_spend),
      ledgerRows: ledger.n, ledgerAmount: r4(ledger.amount), ledgerDebt: r4(ledger.debt),
      usageRows: usage.n, usageAmount: r4(usage.amount),
      payments: pays.n, paymentAmount: r4(pays.amount),
      deployments: deps.n, cards: cards.n,
    };
  }
  return out;
};

(async () => {
  const [mode, file] = process.argv.slice(2);
  const now = await snapshot();
  if (mode === '--save') {
    fs.writeFileSync(file, JSON.stringify(now, null, 2));
    console.log(`Saved ${Object.keys(now).length} customers to ${file}`);
  } else if (mode === '--compare') {
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));
    let diffs = 0;
    for (const email of new Set([...Object.keys(before), ...Object.keys(now)])) {
      const a = JSON.stringify(before[email]);
      const b = JSON.stringify(now[email]);
      if (a !== b) { diffs += 1; console.log(`✖ ${email}\n  before ${a}\n  after  ${b}`); }
    }
    console.log(diffs ? `${diffs} customer(s) differ — FAIL` : `All ${Object.keys(now).length} customers identical — PASS`);
    process.exitCode = diffs ? 1 : 0;
  } else {
    console.log('Usage: --save <file> | --compare <file>');
  }
  await prisma.$disconnect();
})();
