/**
 * Admin Settings — the platform-wide singleton that almost everything else
 * reads: feature flags, billing policy, security policy, theme, SEO, email.
 * Around fifty call sites go through `getSettings()`, and the row is enforced
 * as a singleton by the database, not just by convention.
 *
 * Each section (`themeSettings`, `billingSettings`, `features`, …) is one
 * `Json` column, so a new setting needs no schema change — which is the point:
 * this is a white-label product, and an operator adding a knob should not need
 * a migration.
 *
 * The one real piece of work is defaults, because a brand new platform has
 * never had an admin touch any of these. They live in `adminSettingsDefaults.js`
 * as a single frozen object, deep-merged under whatever the row actually holds,
 * so a settings row written before a knob existed still reads correctly once it
 * does.
 *
 * Callers mutate the section they need and call `save()` on the object they
 * were handed; that method is attached here rather than being a free function
 * so that the read-modify-write stays one obvious motion at the call site.
 */
const prisma = require('../../lib/prismaClient');
const DEFAULTS = require('./adminSettingsDefaults');

const SECTION_KEYS = [
  'themeSettings', 'emailSettings', 'emailTemplates', 'customerSettings', 'securitySettings',
  'analyticsSettings', 'notificationSettings', 'stripeSettings', 'lemonSqueezySettings',
  'polarSettings',
  'maintenanceMode', 'seoSettings', 'billingSettings', 'deploymentSettings', 'features',
  'googleSSOSettings',
];
const SCALAR_KEYS = ['siteName', 'siteDescription', 'supportEmail', 'contactEmail', 'activePaymentGateway'];

/** Every default a brand-new settings row starts with. */
const defaultsSnapshot = () => JSON.parse(JSON.stringify(DEFAULTS));

const toSettingsDoc = (row) => {
  const doc = {};
  for (const key of SCALAR_KEYS) doc[key] = row[key];
  for (const key of SECTION_KEYS) doc[key] = row[key] ?? {};
  doc.createdAt = row.createdAt;
  doc.updatedAt = row.updatedAt;
  return doc;
};

/**
 * Attach `.save()`/`.toObject()`/`.markModified()` onto a plain doc, so every
 * caller across the app that mutates a section and calls `settings.save()`
 * (or `.markModified('sectionName')` for a Mixed-type section) keeps working
 * unchanged.
 */
const wrapSettings = (row) => {
  const wrapped = { id: row.id, ...toSettingsDoc(row) };

  Object.defineProperty(wrapped, '__internal', { enumerable: false, value: { pgId: row.id } });

  // Every write here persists every section unconditionally, so there is
  // nothing for markModified to actually flag — kept only so the 3 existing
  // call sites that still call it don't throw.
  wrapped.markModified = () => {};

  wrapped.toObject = () => {
    const out = { _id: wrapped.id };
    for (const key of [...SCALAR_KEYS, ...SECTION_KEYS, 'createdAt', 'updatedAt']) out[key] = wrapped[key];
    return JSON.parse(JSON.stringify(out));
  };

  wrapped.save = async () => {
    const data = {};
    for (const key of SCALAR_KEYS) data[key] = wrapped[key];
    for (const key of SECTION_KEYS) data[key] = wrapped[key];

    const updated = await prisma.adminSettings.update({ where: { id: wrapped.__internal.pgId }, data });

    // Keep this same instance usable after save, so a caller that saves and
    // then keeps reading the object sees the fresh `updatedAt`.
    wrapped.updatedAt = updated.updatedAt;
    return wrapped;
  };

  return wrapped;
};

/**
 * Get the singleton settings row, creating it with the original schema's
 * defaults the first time (mirroring today's `getSettings()` seeding
 * behavior — see the class comment).
 */
const getSettings = async () => {
  let row = await prisma.adminSettings.findFirst({ where: { isSingleton: true } });

  if (!row) {
    const defaults = defaultsSnapshot();
    const data = { isSingleton: true };
    for (const key of SCALAR_KEYS) data[key] = defaults[key];
    for (const key of SECTION_KEYS) data[key] = defaults[key];

    row = await prisma.adminSettings.create({ data });
  }

  return wrapSettings(row);
};

module.exports = { getSettings };
