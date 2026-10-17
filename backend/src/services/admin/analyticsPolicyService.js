/**
 * Analytics policies, as records.
 *
 * Every threshold the analytics layer interprets a number with — what counts
 * as dormant, when stock is low, how long a ticket may go unanswered, what
 * each churn signal is worth, and every customer-facing sentence built from
 * them — lives in these rows rather than in the source.
 *
 * Deliberately the same shape as `recommendationPolicyService`: many named
 * policies, exactly one active, a partial unique index in the database making
 * that true rather than a promise in code. Two patterns for "policy as data"
 * in one codebase would be one pattern too many.
 *
 * ── Why many policies instead of one editable row ──
 *
 * An operator tuning a churn weighting wants to keep the settings that are
 * working while they try something else. Editing one row in place makes every
 * experiment destructive, so the previous tuning only exists in somebody's
 * memory.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicId } = require('../../utils/helpers/publicId');
const { DEFAULT_ANALYTICS_POLICY } = require('../analytics/analyticsPolicyDefaults');

/**
 * The sections an operator may override, as stored.
 *
 * An unset (null) column inherits the whole default subtree — that is what
 * makes "change one threshold" safe, and it is why these are nullable Json
 * rather than a flattened set of columns with their own defaults.
 */
const JSON_FIELDS = [
  'windows', 'capacity', 'engagement', 'customers', 'churn',
  'retention', 'receivables', 'support', 'traffic', 'dashboard',
];

const SCALAR_FIELDS = ['cacheTtlSeconds', 'heavyWindowCacheTtlSeconds', 'heavyWindowDays'];

const toDoc = (row, updatedById) => {
  const doc = {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    updatedBy: updatedById || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  for (const field of SCALAR_FIELDS) doc[field] = row[field] ?? null;
  /*
   * `undefined`, not null, for an unset section — the UI reads that as
   * "inherits the default" and shows the default greyed out, where a null
   * would read as "deliberately empty".
   */
  for (const field of JSON_FIELDS) doc[field] = row[field] ?? undefined;
  return doc;
};

const INCLUDE = { updatedBy: { select: { id: true } } };
const wrap = (row) => toDoc(row, row.updatedBy?.id);

const fail = (status, message) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const writableColumns = (fields) => {
  const data = {};
  for (const field of JSON_FIELDS) {
    if (fields[field] !== undefined) data[field] = fields[field];
  }
  for (const field of SCALAR_FIELDS) {
    if (fields[field] !== undefined) {
      const value = fields[field];
      data[field] = value === null || value === '' ? null : Number(value);
    }
  }
  if (fields.name !== undefined) data.name = String(fields.name).trim();
  if (fields.description !== undefined) data.description = String(fields.description);
  return data;
};

const list = async () => {
  const rows = await prisma.analyticsPolicy.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: INCLUDE,
  });
  return rows.map(wrap);
};

const findById = async (id) => {
  const row = await prisma.analyticsPolicy.findUnique({ where: byPublicId(id), include: INCLUDE });
  return row ? wrap(row) : null;
};

/** The live policy, or null when none is configured — the layer then runs on
 *  the shipped defaults, which is a working state rather than a broken one. */
const getActive = async () => {
  const row = await prisma.analyticsPolicy.findFirst({ where: { isActive: true }, include: INCLUDE });
  return row ? wrap(row) : null;
};

const retireOthers = (exceptId) => prisma.analyticsPolicy.updateMany({
  where: { isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
  data: { isActive: false },
});

const create = async (fields) => {
  const key = String(fields.key || '').trim();
  // Checked before the lookup: `findUnique({ where: { key: undefined } })`
  // makes Prisma throw, and that exception carries a server file path.
  if (!key) throw fail(400, 'A policy key is required');
  if (!/^[a-z0-9][a-z0-9-_]{0,60}$/i.test(key)) {
    throw fail(400, 'A key may only contain letters, numbers, dashes and underscores');
  }

  const existing = await prisma.analyticsPolicy.findUnique({ where: { key } });
  if (existing) throw fail(409, 'A policy with that key already exists');

  const data = {
    key,
    name: String(fields.name || key).trim(),
    description: String(fields.description || ''),
    isActive: !!fields.isActive,
    ...writableColumns(fields),
    ...(fields.updatedBy ? { updatedById: byPublicId(fields.updatedBy).id } : {}),
  };

  /*
   * Activating and retiring the previous one happen together. Done
   * separately, a failure between them leaves either two active policies or
   * none — and "none" silently reverts the whole platform to shipped
   * defaults, which looks like the operator's tuning never saved.
   */
  const row = fields.isActive
    ? await prisma.$transaction(async (tx) => {
      await tx.analyticsPolicy.updateMany({ where: { isActive: true }, data: { isActive: false } });
      return tx.analyticsPolicy.create({ data, include: INCLUDE });
    })
    : await prisma.analyticsPolicy.create({ data, include: INCLUDE });

  return wrap(row);
};

const update = async (id, fields) => {
  const where = byPublicId(id);
  const current = await prisma.analyticsPolicy.findUnique({ where });
  if (!current) throw fail(404, 'No policy with that id');

  const data = {
    ...writableColumns(fields),
    ...(fields.isActive !== undefined ? { isActive: !!fields.isActive } : {}),
    ...(fields.updatedBy ? { updatedById: byPublicId(fields.updatedBy).id } : {}),
  };

  const row = fields.isActive
    ? await prisma.$transaction(async (tx) => {
      await tx.analyticsPolicy.updateMany({
        where: { isActive: true, id: { not: current.id } }, data: { isActive: false },
      });
      return tx.analyticsPolicy.update({ where, data, include: INCLUDE });
    })
    : await prisma.analyticsPolicy.update({ where, data, include: INCLUDE });

  return wrap(row);
};

const activate = async (id, updatedBy) => update(id, { isActive: true, updatedBy });

/**
 * Copy a policy under a new key.
 *
 * The reason the list is a list: an operator about to retune something keeps
 * the version that works, rather than discovering afterwards that the only
 * record of it was the row they just overwrote. A copy is never active.
 */
const duplicate = async (id, { key, name, updatedBy }) => {
  const source = await prisma.analyticsPolicy.findUnique({ where: byPublicId(id) });
  if (!source) throw fail(404, 'No policy with that id');

  const fields = { key, name: name || `${source.name} (copy)`, description: source.description, updatedBy };
  for (const field of JSON_FIELDS) fields[field] = source[field] ?? undefined;
  for (const field of SCALAR_FIELDS) fields[field] = source[field] ?? undefined;
  return create({ ...fields, isActive: false });
};

const deleteOne = async (id) => {
  const where = byPublicId(id);
  const row = await prisma.analyticsPolicy.findUnique({ where });
  if (!row) throw fail(404, 'No policy with that id');
  /*
   * Deleting the live policy would silently revert every threshold on the
   * platform to the shipped defaults, and the next person to notice would be
   * whoever wondered why the dashboard changed overnight. Refused with the
   * reason, rather than allowed with a warning nobody reads.
   */
  if (row.isActive) {
    throw fail(409, 'This policy is live. Activate another one first, then delete this.');
  }
  await prisma.analyticsPolicy.delete({ where });
  return { id: row.id, key: row.key };
};

module.exports = {
  JSON_FIELDS,
  SCALAR_FIELDS,
  DEFAULTS: DEFAULT_ANALYTICS_POLICY,
  list,
  findById,
  getActive,
  retireOthers,
  create,
  update,
  activate,
  duplicate,
  deleteOne,
};
