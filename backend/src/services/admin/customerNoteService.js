/**
 * Customer Notes — internal admin comments on a customer's account, never
 * shown to the customer. Ported to Prisma as part of the Admin domain (see
 * the migration plan); `wrapNote` attaches `_id` = `id` and a
 * notes are addressed by id and always scoped to their customer.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicId, byPublicIds, isSameRow } = require('../../utils/helpers/publicId');

const toDoc = (row, ctx) => ({
  id: row.id,
  customerId: ctx.customerId,
  authorId: ctx.authorId,
  authorName: row.authorName,
  text: row.text,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const listForCustomer = async (customerId) => {
  const customer = await prisma.user.findUnique({ where: byPublicId(customerId), select: { id: true } });
  if (!customer) return [];

  const rows = await prisma.customerNote.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: 'desc' },
    include: { author: { select: { id: true } } },
  });

  return rows.map((row) => toDoc(row, { customerId: String(customerId), authorId: row.author?.id || null }));
};

const create = async ({ customerId, authorId, authorName, text }) => {
  const [customer, author] = await Promise.all([
    prisma.user.findUnique({ where: byPublicId(customerId), select: { id: true } }),
    prisma.user.findUnique({ where: byPublicId(authorId), select: { id: true } }),
  ]);
  if (!customer) throw new Error(`No user found for id ${customerId}`);
  if (!author) throw new Error(`No user found for id ${authorId}`);

  const row = await prisma.customerNote.create({
    data: {
      customerId: customer.id, authorId: author.id, authorName, text,
    },
  });

  const doc = toDoc(row, { customerId: String(customerId), authorId: String(authorId) });
  return doc;
};

/** Delete one note, scoped to the customer it belongs to (matches the old `findOneAndDelete` guard). */
const deleteOne = async (noteId, customerId) => {
  const row = await prisma.customerNote.findUnique({ where: byPublicId(noteId), include: { customer: { select: { id: true } } } });
  if (!row || !isSameRow(row.customer, customerId)) return null;

  await prisma.customerNote.delete({ where: { id: row.id } });
  return row;
};

/** The "permanently delete customer" cascade in admin/customers.routes.js. */
const deleteAllForUsers = async (customerIds, db = prisma) => {
  const customers = await db.user.findMany({ where: byPublicIds(customerIds), select: { id: true } });
  const customerPgIds = customers.map((c) => c.id);
  if (!customerPgIds.length) return;

  await db.customerNote.deleteMany({ where: { customerId: { in: customerPgIds } } });
};

module.exports = { listForCustomer, create, deleteOne, deleteAllForUsers };
