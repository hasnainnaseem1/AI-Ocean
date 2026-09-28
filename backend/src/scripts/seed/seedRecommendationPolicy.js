/**
 * Seed the recommendation policy.
 *
 * Writes the engine's built-in defaults into an editable database record, so
 * the admin center has something concrete to open rather than a blank form.
 * The engine behaves identically whether or not this has been run — with no
 * policy it falls back to the same values — so this seed changes nothing about
 * the suggestions until somebody deliberately edits the record.
 *
 * Run with:  node src/scripts/seed/seedRecommendationPolicy.js [--force]
 */
require('dotenv').config();
const { connect, prisma, upsertAll, finish, fail } = require('./seedHelpers');
const { DEFAULT_POLICY } = require('../../services/recommendation/policyDefaults');

const POLICY = {
  key: 'default',
  name: 'Default recommendation policy',
  description:
    'How the engine weighs answers against the catalog, and every sentence it '
    + 'shows a customer. Editing this changes the suggestions immediately — no deploy.',
  isActive: true,
  ...DEFAULT_POLICY,
};

const seed = async () => {
  await connect();

  const counts = await upsertAll('recommendationPolicy', 'key', [POLICY], {
    label: (p) => `${p.key} — ${p.name}`,
  });

  const active = await prisma.recommendationPolicy.findFirst({ where: { isActive: true } });
  console.log(active
    ? `Active policy: ${active.key} — ${active.name}`
    : 'No policy is active yet — activate one in Admin Center → Recommendation Policy.');

  await finish('Recommendation policy seeded', counts);
};

seed().catch((err) => fail('Recommendation policy seed', err));
