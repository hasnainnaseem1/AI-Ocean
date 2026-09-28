/**
 * Recommendation Policies — every weight, penalty, threshold and
 * customer-facing sentence the sizing engine uses, editable from the admin
 * center. Ported to Prisma as part of the Admin domain.
 *
 * Each nested policy section (`modelRanking`, `tierScoring`,
 * `suitability`, every `*Templates` map, ...) collapses to one opaque `Json`
 * column per the schema's design — the engine always deep-merges whatever is
 * set over `policyDefaults.js`, so there's no field-by-field mapping to
 * maintain here, unlike Catalog/Billing/Deployment.
 *
 * "Exactly one policy active" is enforced two ways, same reasoning as
 * MarketingPage's "only one homepage": a hand-written partial unique index
 * (migration `20260906114845_recommendation_policy_single_active`) is the
 * hard backstop, but `activate()` also proactively retires every other
 * policy in the same `$transaction` as the actual write, so the index is
 * never actually hit as a rejection during normal use — same as the old
 * save hook did.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicId } = require('../../utils/helpers/publicId');



const JSON_FIELDS = [
  'modelRanking', 'tierScoring', 'suitability', 'fitWeights', 'uptimeRanks', 'confidence', 'modalityLabels',
  'reasonTemplates', 'suitabilityTemplates', 'tierIssueTemplates', 'matchReasonTemplates', 'alternativeTemplates',
  'blockerTemplates', 'matchReasonLimits',
];

const toDoc = (row, updatedById) => {
  const doc = {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    cacheTtlSeconds: row.cacheTtlSeconds,
    updatedBy: updatedById || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  for (const field of JSON_FIELDS) doc[field] = row[field] ?? undefined;
  return doc;
};

const INCLUDE = { updatedBy: { select: { id: true } } };
const wrap = (row) => toDoc(row, row.updatedBy?.id);

const jsonColumns = (fields) => {
  const data = {};
  for (const field of JSON_FIELDS) {
    if (fields[field] !== undefined) data[field] = fields[field];
  }
  return data;
};

const list = async () => {
  const rows = await prisma.recommendationPolicy.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: INCLUDE });
  return rows.map(wrap);
};

const findById = async (id) => {
  const row = await prisma.recommendationPolicy.findUnique({ where: byPublicId(id), include: INCLUDE });
  return row ? wrap(row) : null;
};

/** The live policy, or null when none is configured (engine uses defaults). */
const getActive = async () => {
  const row = await prisma.recommendationPolicy.findFirst({ where: { isActive: true }, include: INCLUDE });
  return row ? wrap(row) : null;
};

/** Retire every other policy — part of the same transaction as the actual activating write. */
const retireOthers = (exceptPgId) => prisma.recommendationPolicy.updateMany({
  where: { isActive: true, ...(exceptPgId ? { id: { not: exceptPgId } } : {}) },
  data: { isActive: false },
});

const create = async (fields) => {
  const {
    key, name, description, isActive, cacheTtlSeconds, updatedBy,
  } = fields;

  // Checked before the lookup: `findUnique({ where: { key: undefined } })`
  // makes Prisma throw, and that exception used to be returned to the client
  // complete with the server file path and a source excerpt.
  if (!key || typeof key !== 'string' || !key.trim()) {
    const err = new Error('A policy key is required');
    err.status = 400;
    throw err;
  }

  const existing = await prisma.recommendationPolicy.findUnique({ where: { key } });
  if (existing) {
    const err = new Error('A policy with that key already exists');
    err.status = 400;
    throw err;
  }

  const updatedByPg = updatedBy ? await prisma.user.findUnique({ where: byPublicId(updatedBy), select: { id: true } }) : null;
  const ops = [];
  if (isActive) ops.push(retireOthers(null));
  ops.push(prisma.recommendationPolicy.create({
    data: {

      key,
      name,
      description: description || '',
      isActive: !!isActive,
      cacheTtlSeconds: cacheTtlSeconds ?? null,
      updatedById: updatedByPg?.id || null,
      ...jsonColumns(fields),
    },
    include: INCLUDE,
  }));

  const results = await prisma.$transaction(ops);
  const row = results[results.length - 1];
  const doc = wrap(row);
  return doc;
};

/** The key is a stable identifier the seed matches on — never changed once created. */
const update = async (id, fields) => {
  const existing = await prisma.recommendationPolicy.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  const {
    name, description, isActive, cacheTtlSeconds, updatedBy,
  } = fields;

  const data = { ...jsonColumns(fields) };
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (cacheTtlSeconds !== undefined) data.cacheTtlSeconds = cacheTtlSeconds;

  const updatedByPg = updatedBy ? await prisma.user.findUnique({ where: byPublicId(updatedBy), select: { id: true } }) : null;
  if (updatedByPg) data.updatedById = updatedByPg.id;

  const ops = [];
  if (isActive && !existing.isActive) ops.push(retireOthers(existing.id));
  if (isActive !== undefined) data.isActive = isActive;
  ops.push(prisma.recommendationPolicy.update({ where: { id: existing.id }, data, include: INCLUDE }));

  const results = await prisma.$transaction(ops);
  const row = results[results.length - 1];
  const doc = wrap(row);
  return doc;
};

/** Make this policy the one live policy — retires every other one atomically. */
const activate = async (id, updatedBy) => update(id, { isActive: true, updatedBy });

const duplicate = async (id, { key, name, updatedBy }) => {
  const source = await findById(id);
  if (!source) return null;

  return create({
    ...Object.fromEntries(JSON_FIELDS.map((f) => [f, source[f]])),
    cacheTtlSeconds: source.cacheTtlSeconds,
    key: key || `${source.key}-copy-${Date.now().toString(36)}`,
    name: name || `${source.name} (copy)`,
    isActive: false, // Never steal live traffic by duplicating.
    updatedBy,
  });
};

const deleteOne = async (id) => {
  const existing = await prisma.recommendationPolicy.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  if (existing.isActive) {
    const err = new Error('This policy is live. Activate another policy before deleting this one.');
    err.status = 400;
    throw err;
  }

  await prisma.recommendationPolicy.delete({ where: { id: existing.id } });
  return existing;
};

module.exports = {
  list, findById, getActive, create, update, activate, duplicate, deleteOne,
};
