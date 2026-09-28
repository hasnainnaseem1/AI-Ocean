/**
 * Departments — the small, admin-editable list a User's `department` field
 * (a soft string reference, never a real FK — see the migration plan) picks
 * from. Ported to Prisma as part of the Admin domain.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicId } = require('../../utils/helpers/publicId');



const toDoc = (row, ctx) => ({
  id: row.id,
  name: row.name,
  value: row.value,
  description: row.description,
  isActive: row.isActive,
  isDefault: row.isDefault,
  createdBy: ctx?.createdById ?? null,
  updatedBy: ctx?.updatedById ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const INCLUDE = { createdBy: { select: { id: true } }, updatedBy: { select: { id: true } } };

const wrap = (row) => toDoc(row, {
  createdById: row.createdBy?.id || null,
  updatedById: row.updatedBy?.id || null,
});

const userCountFor = (value) => prisma.user.count({ where: { department: value } });

const list = async ({ active, search } = {}) => {
  const where = {};
  if (active !== undefined) where.isActive = active === 'true' || active === true;
  if (search) where.name = { contains: search, mode: 'insensitive' };

  const rows = await prisma.department.findMany({ where, include: INCLUDE, orderBy: { name: 'asc' } });
  const withCounts = await Promise.all(rows.map(async (row) => ({ ...wrap(row), userCount: await userCountFor(row.value) })));
  return withCounts;
};

const getActive = async () => {
  const rows = await prisma.department.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return rows.map((row) => wrap({ ...row, createdBy: null, updatedBy: null }));
};

const findById = async (id) => {
  const row = await prisma.department.findUnique({ where: byPublicId(id), include: INCLUDE });
  if (!row) return null;
  return { ...wrap(row), userCount: await userCountFor(row.value) };
};

const findByValue = async (value) => {
  const row = await prisma.department.findUnique({ where: { value }, include: INCLUDE });
  return row ? wrap(row) : null;
};

const create = async ({ name, description, createdBy, isDefault = false }) => {
  const value = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

  const existing = await prisma.department.findUnique({ where: { value } });
  if (existing) {
    const err = new Error('A department with similar name already exists');
    err.status = 400;
    throw err;
  }

  const createdByPg = createdBy ? await prisma.user.findUnique({ where: byPublicId(createdBy), select: { id: true } }) : null;
  const row = await prisma.department.create({
    data: {
      name, value, description: description || null, isDefault: !!isDefault, createdById: createdByPg?.id || null,
    },
  });

  const doc = toDoc(row, { createdById: createdBy || null, updatedById: null });
  return doc;
};

/**
 * Update a department, including the rename cascade — every User currently
 * pointing at the old `value` is repointed at the new one. This was
 * deliberately deferred in Phase 1 ("cosmetic field only") because Department
 * and `User.department` is a soft string reference, not a foreign key, so
 * nothing updates those users automatically. The rename and the cascade run in
 * one transaction: a rename that half-applied would leave users pointing at a
 * department value that no longer exists.
 */
const update = async (id, { name, description, isActive, updatedBy }) => {
  const existing = await prisma.department.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  if (existing.isDefault && isActive === false) {
    const err = new Error('Cannot deactivate default department');
    err.status = 400;
    throw err;
  }

  const data = {};
  let newValue = existing.value;

  if (name) {
    data.name = name;
    newValue = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (newValue !== existing.value) {
      const conflict = await prisma.department.findUnique({ where: { value: newValue } });
      if (conflict && conflict.id !== existing.id) {
        const err = new Error('A department with similar name already exists');
        err.status = 400;
        throw err;
      }
      data.value = newValue;
    }
  }
  if (description !== undefined) data.description = description;
  if (isActive !== undefined) data.isActive = isActive;
  if (updatedBy) {
    const updatedByPg = await prisma.user.findUnique({ where: byPublicId(updatedBy), select: { id: true } });
    data.updatedById = updatedByPg?.id || null;
  }

  const [updated] = await prisma.$transaction([
    prisma.department.update({ where: { id: existing.id }, data, include: INCLUDE }),
    ...(data.value ? [prisma.user.updateMany({ where: { department: existing.value }, data: { department: data.value } })] : []),
  ]);

  const doc = toDoc(updated, {
    createdById: updated.createdBy?.id || null,
    updatedById: updated.updatedBy?.id || null,
  });
  return doc;
};

/** Blocks the delete if any user is still assigned to this department (the same guard as before). */
const deleteOne = async (id) => {
  const existing = await prisma.department.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  if (existing.isDefault) {
    const err = new Error('Cannot delete default department');
    err.status = 400;
    throw err;
  }

  const userCount = await userCountFor(existing.value);
  if (userCount > 0) {
    const err = new Error(`Cannot delete department. ${userCount} user(s) are assigned to this department.`);
    err.status = 400;
    throw err;
  }

  await prisma.department.delete({ where: { id: existing.id } });
  return { name: existing.name };
};

module.exports = {
  list, getActive, findById, findByValue, create, update, deleteOne, userCountFor,
};
