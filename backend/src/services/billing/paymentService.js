/**
 * Payment Service
 *
 * Prisma-backed CRUD for `Payment` — Stripe/LemonSqueezy top-up and one-time
 * payment records. Ported alongside the rest of the billing domain (see the
 * migration plan); `wrapPayment` attaches `_id` = `id` so
 * `services/invoice/invoiceService.js` (reads `payment._id`/`.amount`/
 * `.metadata`/etc.) keeps working unchanged.
 */
const prisma = require('../../lib/prismaClient');
const { paginate } = require('../../utils/helpers/pagination');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');

const num = (d) => (d === null || d === undefined ? d : Number(d));

// `teamId` is the account the money was paid into; `userId` the member who paid.
const toPaymentDoc = (row) => ({
  teamId: row.teamId,
  userId: row.userId,
  stripePaymentIntentId: row.stripePaymentIntentId,
  stripeInvoiceId: row.stripeInvoiceId,
  type: row.type,
  creditsAdded: num(row.creditsAdded),
  amount: num(row.amount),
  currency: row.currency,
  status: row.status,
  description: row.description,
  receiptUrl: row.receiptUrl,
  invoiceUrl: row.invoiceUrl,
  metadata: row.metadata || {},
  paidAt: row.paidAt,
  createdAt: row.createdAt,
});
const wrapPayment = (row) => (row ? { id: row.id, ...toPaymentDoc(row) } : null);

/** Idempotency check for webhook handlers — a payment already recorded for this gateway reference. */
const findByStripePaymentIntentId = async (stripePaymentIntentId) => {
  if (!stripePaymentIntentId) return null;
  const row = await prisma.payment.findUnique({ where: { stripePaymentIntentId } });
  return wrapPayment(row);
};

const findByLemonSqueezyOrderId = async (orderId) => {
  if (!orderId) return null;
  const row = await prisma.payment.findFirst({
    where: { metadata: { path: ['lemonSqueezyOrderId'], equals: String(orderId) } },
  });
  return wrapPayment(row);
};

/** Same pattern as findByLemonSqueezyOrderId — Polar has no dedicated Payment column, just like LemonSqueezy. */
const findByPolarOrderId = async (orderId) => {
  if (!orderId) return null;
  const row = await prisma.payment.findFirst({
    where: { metadata: { path: ['polarOrderId'], equals: String(orderId) } },
  });
  return wrapPayment(row);
};

const findById = async (id) => {
  if (!id) return null;
  const row = await prisma.payment.findUnique({ where: byPublicId(id) });
  return wrapPayment(row);
};

/** `data.teamId` — the account paid into; `data.userId` — the member who paid. */
const create = async (data) => {
  const [team, user] = await Promise.all([
    prisma.team.findUnique({ where: byPublicId(data.teamId), select: { id: true } }),
    prisma.user.findUnique({ where: byPublicId(data.userId), select: { id: true } }),
  ]);
  if (!team) throw new Error(`No account found for id ${data.teamId}`);
  if (!user) throw new Error(`No user found for id ${data.userId}`);

  const row = await prisma.payment.create({
    data: {
      teamId: team.id,
      userId: user.id,
      stripePaymentIntentId: data.stripePaymentIntentId || null,
      stripeInvoiceId: data.stripeInvoiceId || null,
      type: data.type || 'topup',
      creditsAdded: data.creditsAdded || 0,
      amount: data.amount,
      currency: (data.currency || 'usd').toLowerCase(),
      status: data.status || 'pending',
      description: data.description || null,
      receiptUrl: data.receiptUrl || null,
      invoiceUrl: data.invoiceUrl || null,
      metadata: data.metadata || {},
      paidAt: data.paidAt || null,
    },
  });

  return wrapPayment(row);
};

/** Paginated payment history for an account. */
const listForTeam = async (teamId, { page = 1, limit = 20 } = {}) => {
  const where = { teamId: byPublicId(teamId).id };
  const { skip, take } = paginate({ page, limit });
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.payment.count({ where }),
  ]);

  return { payments: rows.map(wrapPayment), total };
};

/** Admin "Payments" tab for an account — paginated, optionally by status. */
const listForTeamAdmin = async (teamId, { page = 1, limit = 20, status } = {}) => {
  const where = { teamId: byPublicId(teamId).id, ...(status ? { status } : {}) };
  const { skip, take } = paginate({ page, limit });
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where, orderBy: { createdAt: 'desc' }, skip, take,
    }),
    prisma.payment.count({ where }),
  ]);
  return { payments: rows.map(wrapPayment), total };
};

/** Admin billing stats summary for an account. */
const getBillingStats = async (teamId) => {
  const key = byPublicId(teamId).id;

  const [succeeded, refunded, failed, pending] = await Promise.all([
    prisma.payment.aggregate({
      where: { teamId: key, status: 'succeeded' },
      _sum: { amount: true },
      _count: { _all: true },
      _avg: { amount: true },
      _max: { paidAt: true },
      _min: { paidAt: true },
    }),
    prisma.payment.aggregate({ where: { teamId: key, status: 'refunded' }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.payment.count({ where: { teamId: key, status: 'failed' } }),
    prisma.payment.count({ where: { teamId: key, status: 'pending' } }),
  ]);

  return {
    totalSpent: num(succeeded._sum.amount) || 0,
    totalPayments: succeeded._count._all,
    totalRefunded: num(refunded._sum.amount) || 0,
    refundCount: refunded._count._all,
    failedPayments: failed,
    pendingPayments: pending,
    lastPaymentDate: succeeded._max.paidAt,
    firstPaymentDate: succeeded._min.paidAt,
    avgPaymentAmount: num(succeeded._avg.amount) || 0,
  };
};

/** Admin monthly spending trend for an account (succeeded payments only). */
const getMonthlyTrend = async (teamId, since) => {
  const key = byPublicId(teamId).id;

  const rows = await prisma.$queryRaw`
    SELECT to_char(date_trunc('month', "created_at"), 'YYYY-MM') AS month,
           SUM("amount")::float AS amount,
           COUNT(*)::int AS count
    FROM "payments"
    WHERE "team_id" = ${key}::uuid AND "status" = 'succeeded' AND "created_at" >= ${since}
    GROUP BY 1
    ORDER BY 1
  `;
  return rows.map((r) => ({ month: r.month, amount: Math.round(r.amount * 100) / 100, count: r.count }));
};

/** The "permanently delete customer" cascade — payments of their personal account. */
const deleteAllForTeams = async (teamIds, db = prisma) => {
  const ids = byPublicIds(teamIds).id.in;
  if (!ids.length) return;

  await db.payment.deleteMany({ where: { teamId: { in: ids } } });
};

module.exports = {
  findById,
  findByStripePaymentIntentId,
  findByLemonSqueezyOrderId,
  findByPolarOrderId,
  create,
  listForTeam,
  listForTeamAdmin,
  getBillingStats,
  getMonthlyTrend,
  wrapPayment,
  toPaymentDoc,
  deleteAllForTeams,
};
