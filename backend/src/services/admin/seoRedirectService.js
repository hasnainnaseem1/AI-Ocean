/**
 * SEO Redirects — 301/302 URL redirect rules, managed in the admin center and
 * consulted on every public page load (`routes/v1/public/seo.routes.js`'s
 * check-redirect). Ported to Prisma as part of the Admin domain.
 */
const prisma = require('../../lib/prismaClient');
const { paginate } = require('../../utils/helpers/pagination');
const { byPublicId } = require('../../utils/helpers/publicId');



const toDoc = (row, createdById) => ({
  id: row.id,
  fromPath: row.fromPath,
  toPath: row.toPath,
  statusCode: row.statusCode,
  isActive: row.isActive,
  hitCount: row.hitCount,
  lastHitAt: row.lastHitAt,
  note: row.note,
  createdBy: createdById || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const wrap = (row) => toDoc(row, row.createdBy?.id);
const INCLUDE = { createdBy: { select: { id: true } } };

const list = async ({ search, status, page = 1, limit = 50 } = {}) => {
  const where = {};
  if (search) {
    where.OR = [
      { fromPath: { contains: search, mode: 'insensitive' } },
      { toPath: { contains: search, mode: 'insensitive' } },
      { note: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (status === 'active') where.isActive = true;
  if (status === 'inactive') where.isActive = false;

  const { skip, take } = paginate({ page, limit });
  const [rows, total] = await Promise.all([
    prisma.seoRedirect.findMany({
      where, include: INCLUDE, orderBy: { createdAt: 'desc' }, skip, take,
    }),
    prisma.seoRedirect.count({ where }),
  ]);

  return { redirects: rows.map(wrap), total };
};

const findByPath = async (fromPath) => {
  const row = await prisma.seoRedirect.findUnique({ where: { fromPath }, include: INCLUDE });
  return row ? wrap(row) : null;
};

const findById = async (id) => {
  const row = await prisma.seoRedirect.findUnique({ where: byPublicId(id), include: INCLUDE });
  return row ? wrap(row) : null;
};

const create = async ({
  fromPath, toPath, statusCode, note, createdBy,
}) => {
  const existing = await prisma.seoRedirect.findUnique({ where: { fromPath } });
  if (existing) {
    const err = new Error('A redirect from this path already exists');
    err.status = 400;
    throw err;
  }

  const createdByPg = createdBy
    ? await prisma.user.findUnique({ where: byPublicId(createdBy), select: { id: true } })
    : null;

  const row = await prisma.seoRedirect.create({
    data: {
      fromPath, toPath, statusCode: statusCode || 301, note: note || '', createdById: createdByPg?.id || null,
    },
  });

  const doc = toDoc(row, createdBy || null);
  return doc;
};

const update = async (id, {
  fromPath, toPath, statusCode, isActive, note,
}) => {
  const existing = await prisma.seoRedirect.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  const data = {};
  if (fromPath !== undefined) {
    const conflict = await prisma.seoRedirect.findUnique({ where: { fromPath } });
    if (conflict && conflict.id !== existing.id) {
      const err = new Error('A redirect from this path already exists');
      err.status = 400;
      throw err;
    }
    data.fromPath = fromPath;
  }
  if (toPath !== undefined) data.toPath = toPath;
  if (statusCode !== undefined) data.statusCode = statusCode;
  if (isActive !== undefined) data.isActive = isActive;
  if (note !== undefined) data.note = note;

  const updated = await prisma.seoRedirect.update({ where: { id: existing.id }, data, include: INCLUDE });
  const doc = wrap(updated);
  return doc;
};

const toggleActive = async (id) => {
  const existing = await prisma.seoRedirect.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  const updated = await prisma.seoRedirect.update({
    where: { id: existing.id }, data: { isActive: !existing.isActive }, include: INCLUDE,
  });
  const doc = wrap(updated);
  return doc;
};

const deleteOne = async (id) => {
  const existing = await prisma.seoRedirect.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  await prisma.seoRedirect.delete({ where: { id: existing.id } });
  return existing;
};

/** The public check-redirect endpoint's hit-count bump — the hottest write path in this domain. */
const recordHit = async (fromPath) => {
  const existing = await prisma.seoRedirect.findFirst({ where: { fromPath, isActive: true } });
  if (!existing) return null;

  const now = new Date();
  const updated = await prisma.seoRedirect.update({
    where: { id: existing.id },
    data: { hitCount: { increment: 1 }, lastHitAt: now },
    include: INCLUDE,
  });
  return { toPath: updated.toPath, statusCode: updated.statusCode };
};

module.exports = {
  list, findByPath, findById, create, update, toggleActive, deleteOne, recordHit,
};
