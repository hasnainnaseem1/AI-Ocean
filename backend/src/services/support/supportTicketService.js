/**
 * Support tickets — a customer asks something, and one or more admins answer
 * it in a thread.
 *
 * A ticket belongs to the User who raised it, never to a Team. This is a
 * person asking a question, not something an account's money touches, so it
 * carries none of the team-context machinery the rest of the customer API
 * runs through — a ticket follows the person, not whichever organization
 * they happen to be switched into.
 *
 * ── Status, and what actually moves it ──
 *
 * Three values — `open`, `pending`, `solved` — were already defined on the
 * customer center's screens before any backend existed, `pending` included,
 * though nothing ever set it. This file is what gives it a real meaning, the
 * ordinary help-desk one: an admin's reply means the ball is in the
 * customer's court (`pending`); a customer's reply means it is back in
 * support's (`open`). Either side can also mark a ticket `solved` by hand, and
 * a customer replying to a solved ticket reopens it — nobody's message should
 * ever land in a thread that reads as finished.
 *
 * ── Notifying the right admin ──
 *
 * A ticket that is assigned tells only its assignee about a new customer
 * message — that is the entire point of assignment: nobody else has to track
 * it. An unassigned ticket, like a brand new one, tells every admin who can
 * see the queue, the same way the rest of this platform's admin alerts
 * (services/notification/adminNotifier.js) reach everyone until somebody
 * takes ownership of the thing.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');
const { paginate } = require('../../utils/helpers/pagination');
const { resolvePolicy } = require('../analytics/analyticsPolicyResolver');
const metrics = require('./supportTicketMetrics');

const fail = (status, code, message) => {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
};

const CATEGORIES = ['general', 'billing', 'technical', 'deployment'];
const STATUSES = ['open', 'pending', 'solved'];
/** What a customer may set directly — never `pending`, which only a reply produces. */
const CUSTOMER_STATUSES = ['open', 'solved'];

const customerUrl = (path) => `${(process.env.CUSTOMER_FRONTEND_URL || 'http://localhost:3002').replace(/\/$/, '')}${path}`;

const displayNumber = (n) => `TCK-${1000 + Number(n)}`;

const TICKET_SELECT = {
  id: true,
  number: true,
  subject: true,
  category: true,
  status: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
  firstResponseAt: true,
  resolvedAt: true,
  resolutionMinutes: true,
  resolvedAtEstimated: true,
  reopenedCount: true,
  slaFirstResponseMinutes: true,
  slaResolutionMinutes: true,
  assignedAdminId: true,
  assignedAdminName: true,
};

/** The fields `applyTransition` reads to decide what a transition implies. */
const TRANSITION_SELECT = {
  id: true, status: true, createdAt: true, firstResponseAt: true, reopenedCount: true,
};

/**
 * `forAdmin` is what decides whether the operational side of a ticket is sent.
 *
 * The priority a ticket carries, the SLA it is graded against, whether its
 * resolution time is a reconstruction and how often support had to reopen its
 * own work are the platform's internal view of its queue. They are not secret
 * exactly, but they are not the customer's business either, and publishing a
 * target is publishing a promise nobody made to them — the same boundary
 * `TeamActivity` keeps against `ActivityLog`. So the customer gets the ticket
 * as they experience it, and nothing is sent that a screen does not render.
 */
const shapeTicket = (row, { forAdmin = false } = {}) => ({
  id: row.id,
  number: displayNumber(row.number),
  subject: row.subject,
  category: row.category,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lastMessageAt: row.lastMessageAt,
  assignedAdmin: row.assignedAdminId
    ? { id: row.assignedAdminId, name: row.assignedAdminName }
    : null,
  ...(forAdmin ? {
    priority: row.priority,
    /*
     * The timing a support agent sees on the ticket itself. `estimated` rides
     * along with the resolution so the detail screen can say the same thing
     * the charts do — this one was reconstructed, not observed.
     */
    timing: {
      firstResponseAt: row.firstResponseAt ?? null,
      resolvedAt: row.resolvedAt ?? null,
      resolutionMinutes: row.resolutionMinutes ?? null,
      resolvedAtEstimated: !!row.resolvedAtEstimated,
      reopenedCount: row.reopenedCount ?? 0,
      slaFirstResponseMinutes: row.slaFirstResponseMinutes ?? null,
      slaResolutionMinutes: row.slaResolutionMinutes ?? null,
    },
  } : {}),
});

const shapeMessage = (row) => ({
  id: row.id,
  authorType: row.authorType,
  authorName: row.authorName,
  body: row.body,
  createdAt: row.createdAt,
});

// ── Notifying people ──

/** Everyone who should hear about a ticket right now: its assignee, or every admin. */
const recipientsFor = async (ticket) => {
  if (ticket.assignedAdminId) return [{ id: ticket.assignedAdminId }];
  const userService = require('../user/userService');
  return userService.listActiveAdmins();
};

const notifyAdminsOfMessage = async (ticket, customerName) => {
  try {
    const adminSettingsService = require('../admin/adminSettingsService');
    const settings = await adminSettingsService.getSettings();
    const ns = settings.notificationSettings || {};

    const admins = await recipientsFor(ticket);
    if (!admins.length) return;

    const notificationService = require('../notification/notificationService');
    const title = 'New reply on a support ticket';
    const message = `${customerName} replied to ${displayNumber(ticket.number)} — ${ticket.subject}.`;
    const action = {
      label: 'Open ticket',
      url: `${(process.env.ADMIN_FRONTEND_URL || 'http://localhost:3003').replace(/\/$/, '')}/support-tickets/${ticket.id}`,
    };
    await Promise.all(admins.map((a) => notificationService.createNotification({
      recipientId: a.id,
      recipientType: 'admin',
      type: 'support_ticket',
      title,
      message,
      priority: 'medium',
      senderName: 'System',
      metadata: { ticketId: ticket.id, ticketNumber: ticket.number },
      action,
    })));

    if (ns.enableEmailNotifications) {
      const emailService = require('../email/emailService');
      const rows = await prisma.user.findMany({ where: { id: { in: admins.map((a) => a.id) } }, select: { email: true } });
      await Promise.all(rows.map((r) => emailService.sendEmail({
        to: r.email,
        subject: `New reply: ${displayNumber(ticket.number)} — ${ticket.subject}`,
        html: `<h3>${title}</h3><p>${message}</p><p><a href="${action.url}">${action.label}</a></p>`,
        text: `${message} ${action.url}`,
      }).catch((err) => console.error(`[SupportTicket] Admin email to ${r.email} failed:`, err.message))));
    }
  } catch (error) {
    console.error('[SupportTicket] Could not notify admins:', error.message);
  }
};

/**
 * Told every time, no admin-settings gate — the customer is waiting on their
 * own ticket. Email reuses the same generic wrapper team notifications send
 * (`emailService.sendTeamNotificationEmail`) rather than a new template: the
 * bell's `contentKey` catalogue already renders this exact sentence in the
 * recipient's own language, so the email asks it for the same sentence and
 * drops it in the wrapper, the same way `services/team/teamNotifier.js` does
 * for team events. No ticket-specific template, no separate copy to keep in
 * step with the bell's.
 */
const notifyCustomerOfReply = async (ticket, customer, resolved) => {
  const contentKey = resolved ? 'support.ticketResolved' : 'support.ticketReplied';
  const action = { label: 'View ticket', url: customerUrl(`/support/${ticket.id}`) };
  const metadata = { ticketNumber: displayNumber(ticket.number), subject: ticket.subject };
  const title = resolved ? 'Your ticket was marked resolved' : 'Support replied to your ticket';
  const message = resolved
    ? `${displayNumber(ticket.number)} — ${ticket.subject} was marked resolved.`
    : `Support replied to ${displayNumber(ticket.number)} — ${ticket.subject}.`;

  let notification = null;
  try {
    const notificationService = require('../notification/notificationService');
    notification = await notificationService.createNotification({
      recipientId: customer.id,
      recipientType: 'customer',
      type: 'support_ticket',
      contentKey,
      title,
      message,
      priority: 'medium',
      senderName: 'Support',
      metadata,
      action,
    });
  } catch (error) {
    console.error('[SupportTicket] Could not notify the customer:', error.message);
  }

  // Email is always best-effort: a mail server being down must never undo
  // the bell entry that already landed above.
  try {
    if (!customer.email) return notification;
    const languageSettingsService = require('../i18n/languageSettingsService');
    const { renderCopy } = require('../notification/notificationCopy');
    const lang = await languageSettingsService.resolveLanguage(customer);
    const rendered = renderCopy(contentKey, metadata, lang, { title, message });

    const emailService = require('../email/emailService');
    await emailService.sendTeamNotificationEmail(customer, {
      title: rendered?.title || title,
      message: rendered?.message || message,
      actionLabel: action.label,
      actionUrl: action.url,
    });
  } catch (error) {
    console.error('[SupportTicket] Customer email failed:', error.message);
  }
  return notification;
};

const notifyAdminsOfNewTicket = async (ticket, customer) => {
  try {
    const adminSettingsService = require('../admin/adminSettingsService');
    const settings = await adminSettingsService.getSettings();
    const ns = settings.notificationSettings || {};
    if (!ns.notifyAdminOnNewTicket) return;

    const userService = require('../user/userService');
    const admins = await userService.listActiveAdmins();
    if (!admins.length) return;

    const notificationService = require('../notification/notificationService');
    const title = 'New support ticket';
    const customerLabel = customer.name || customer.email;
    const message = `${customerLabel} opened ${displayNumber(ticket.number)} — ${ticket.subject}.`;
    const action = {
      label: 'Open ticket',
      url: `${(process.env.ADMIN_FRONTEND_URL || 'http://localhost:3003').replace(/\/$/, '')}/support-tickets/${ticket.id}`,
    };
    await Promise.all(admins.map((a) => notificationService.createNotification({
      recipientId: a.id,
      recipientType: 'admin',
      type: 'support_ticket',
      title,
      message,
      priority: 'medium',
      senderName: 'System',
      metadata: { ticketId: ticket.id, ticketNumber: ticket.number, category: ticket.category },
      action,
    })));

    if (ns.enableEmailNotifications) {
      const emailService = require('../email/emailService');
      const rows = await prisma.user.findMany({ where: { id: { in: admins.map((a) => a.id) } }, select: { email: true } });
      await Promise.all(rows.map((r) => emailService.sendEmail({
        to: r.email,
        subject: `${title}: ${displayNumber(ticket.number)}`,
        html: `<h3>${title}</h3><p><strong>${customerLabel}:</strong> ${ticket.subject}</p><p><a href="${action.url}">${action.label}</a></p>`,
        text: `${message} ${action.url}`,
      }).catch((err) => console.error(`[SupportTicket] Admin email to ${r.email} failed:`, err.message))));
    }
  } catch (error) {
    console.error('[SupportTicket] Could not notify admins of a new ticket:', error.message);
  }
};

// ── Customer side ──

/** A ticket, plus its messages, only for the customer who owns it — null otherwise. */
const getForUser = async (ticketId, userId) => {
  const row = await prisma.supportTicket.findUnique({
    where: byPublicId(ticketId),
    select: { ...TICKET_SELECT, userId: true, messages: { orderBy: { createdAt: 'asc' } } },
  });
  // `userId` here is always the caller's own req.user.id — already a real,
  // trusted row id from the authenticated session, not something a client
  // handed us as a URL param, so it needs no byPublicId shape-guard.
  if (!row || String(row.userId) !== String(userId)) return null;
  return { ...shapeTicket(row), messages: row.messages.map(shapeMessage) };
};

const listForUser = async (userId) => {
  const rows = await prisma.supportTicket.findMany({
    where: { userId },
    select: TICKET_SELECT,
    orderBy: { lastMessageAt: 'desc' },
  });
  return rows.map(shapeTicket);
};

const create = async (user, { subject, category, message }) => {
  const clean = String(subject || '').trim();
  if (!clean || clean.length > 200) {
    throw fail(400, 'INVALID_SUBJECT', 'Enter a subject up to 200 characters.');
  }
  const body = String(message || '').trim();
  if (!body) throw fail(400, 'INVALID_MESSAGE', 'Enter a message.');
  const cat = CATEGORIES.includes(category) ? category : 'general';

  /*
   * The SLA this ticket is promised is copied from the policy here, at the
   * moment it opens, and never looked up again. An operator who tightens the
   * target next month is making a promise about next month's tickets — not
   * retroactively failing this one.
   */
  const policy = await resolvePolicy();
  const priority = metrics.defaultPriority(policy);

  const row = await prisma.supportTicket.create({
    data: {
      userId: user.id,
      subject: clean,
      category: cat,
      priority,
      ...metrics.slaFor(policy, priority),
      messages: {
        create: [{
          authorType: 'customer', authorId: user.id, authorName: user.name || user.email, body,
        }],
      },
      statusHistory: {
        create: [{
          status: 'open',
          byType: 'customer',
          byId: user.id,
          byName: user.name || user.email,
          note: 'Ticket opened',
        }],
      },
    },
    select: { ...TICKET_SELECT, messages: { orderBy: { createdAt: 'asc' } } },
  });

  await notifyAdminsOfNewTicket(row, user);
  return { ...shapeTicket(row), messages: row.messages.map(shapeMessage) };
};

const addMessageAsCustomer = async (ticketId, user, body) => {
  const text = String(body || '').trim();
  if (!text) throw fail(400, 'INVALID_MESSAGE', 'Enter a message.');

  const found = await prisma.supportTicket.findUnique({
    where: byPublicId(ticketId), select: { id: true, userId: true, number: true, subject: true, assignedAdminId: true },
  });
  if (!found || String(found.userId) !== String(user.id)) {
    throw fail(404, 'TICKET_NOT_FOUND', 'That ticket does not exist.');
  }

  // A customer's own reply always reopens the ticket — whatever it was
  // before (pending on support, or already marked solved), their message
  // needs a fresh look.
  const nextStatus = 'open';
  const now = new Date();
  /*
   * Interactive transaction, not the array form this used to use: whether this
   * counts as a reopen depends on the status at the instant of the write. Read
   * beforehand, two replies arriving together both see `solved` and the ticket
   * records two reopens for one — or, worse, the status is already `open` by
   * the time the read lands and a real reopen is never counted at all.
   */
  await prisma.$transaction(async (tx) => {
    const current = await tx.supportTicket.findUnique({
      where: { id: found.id }, select: TRANSITION_SELECT,
    });
    await tx.supportTicketMessage.create({
      data: {
        ticketId: found.id,
        authorType: 'customer',
        authorId: user.id,
        authorName: user.name || user.email,
        body: text,
        // The same instant the ticket's own stamps use. Left to default, the
        // row takes the database clock while `lastMessageAt` takes the
        // application's, and the two drift by a millisecond — enough to break
        // anything that matches a message to the timestamp it produced.
        createdAt: now,
      },
    });
    const data = await metrics.applyTransition(tx, current, nextStatus, {
      type: 'customer', id: user.id, name: user.name || user.email,
    }, { at: now, note: 'Customer replied' });
    await tx.supportTicket.update({
      where: { id: found.id }, data: { ...data, lastMessageAt: now },
    });
  });
  const ticket = { ...found, status: nextStatus };

  await notifyAdminsOfMessage({ ...ticket, status: nextStatus }, user.name || user.email);
  return getForUser(ticket.id, user.id);
};

const setStatusAsCustomer = async (ticketId, user, status) => {
  if (!CUSTOMER_STATUSES.includes(status)) {
    throw fail(400, 'INVALID_STATUS', `status must be one of: ${CUSTOMER_STATUSES.join(', ')}`);
  }
  const ticket = await prisma.supportTicket.findUnique({
    where: byPublicId(ticketId), select: { id: true, userId: true },
  });
  if (!ticket || String(ticket.userId) !== String(user.id)) {
    throw fail(404, 'TICKET_NOT_FOUND', 'That ticket does not exist.');
  }
  await prisma.$transaction(async (tx) => {
    const current = await tx.supportTicket.findUnique({
      where: { id: ticket.id }, select: TRANSITION_SELECT,
    });
    if (current.status === status) return;   // nothing happened; log nothing
    const data = await metrics.applyTransition(tx, current, status, {
      type: 'customer', id: user.id, name: user.name || user.email,
    }, {
      note: status === 'solved' ? 'Customer marked it solved' : 'Customer reopened it',
    });
    await tx.supportTicket.update({ where: { id: ticket.id }, data });
  });
  return getForUser(ticket.id, user.id);
};

// ── Admin side ──

const listForAdmin = async (query) => {
  const {
    page, limit, skip, take,
  } = paginate(query, { defaultLimit: 25, maxLimit: 100 });
  const status = String(query.status || '').trim();
  const category = String(query.category || '').trim();
  const assigned = String(query.assigned || '').trim();   // 'me' | 'unassigned' | ''
  const search = String(query.search || '').trim();
  const meAdminId = query.meAdminId ? byPublicId(query.meAdminId).id : null;

  const where = {
    ...(STATUSES.includes(status) ? { status } : {}),
    ...(CATEGORIES.includes(category) ? { category } : {}),
    ...(assigned === 'unassigned' ? { assignedAdminId: null } : {}),
    ...(assigned === 'me' && meAdminId ? { assignedAdminId: meAdminId } : {}),
    ...(search
      ? {
        OR: [
          { subject: { contains: search, mode: 'insensitive' } },
          { user: { email: { contains: search, mode: 'insensitive' } } },
          { user: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      select: { ...TICKET_SELECT, user: { select: { id: true, name: true, email: true } } },
      orderBy: { lastMessageAt: 'desc' },
      skip,
      take,
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return {
    tickets: rows.map((r) => ({ ...shapeTicket(r, { forAdmin: true }), customer: r.user })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
};

const getForAdmin = async (ticketId) => {
  const row = await prisma.supportTicket.findUnique({
    where: byPublicId(ticketId),
    select: {
      ...TICKET_SELECT,
      messages: { orderBy: { createdAt: 'asc' } },
      user: { select: { id: true, name: true, email: true, createdAt: true } },
    },
  });
  if (!row) return null;
  return {
    ...shapeTicket(row, { forAdmin: true }),
    messages: row.messages.map(shapeMessage),
    customer: row.user,
  };
};

const addMessageAsAdmin = async (ticketId, admin, body, { resolve = false } = {}) => {
  const text = String(body || '').trim();
  if (!text) throw fail(400, 'INVALID_MESSAGE', 'Enter a message.');

  const ticket = await prisma.supportTicket.findUnique({
    where: byPublicId(ticketId),
    select: {
      id: true, number: true, subject: true, assignedAdminId: true, user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!ticket) throw fail(404, 'TICKET_NOT_FOUND', 'That ticket does not exist.');

  const nextStatus = resolve ? 'solved' : 'pending';
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const current = await tx.supportTicket.findUnique({
      where: { id: ticket.id }, select: TRANSITION_SELECT,
    });
    await tx.supportTicketMessage.create({
      data: {
        ticketId: ticket.id,
        authorType: 'admin',
        authorId: admin.id,
        authorName: admin.name || admin.email,
        body: text,
        // Same instant as `firstResponseAt` and `lastMessageAt` — see the
        // customer path above for why this is not left to default.
        createdAt: now,
      },
    });
    // `isAdminMessage` is what stamps the first response — a reply, not a
    // status change an admin happened to make.
    const data = await metrics.applyTransition(tx, current, nextStatus, {
      type: 'admin', id: admin.id, name: admin.name || admin.email,
    }, {
      at: now,
      isAdminMessage: true,
      note: resolve ? 'Support replied and marked it solved' : 'Support replied',
    });
    await tx.supportTicket.update({
      where: { id: ticket.id }, data: { ...data, lastMessageAt: now },
    });
  });

  await notifyCustomerOfReply(ticket, ticket.user, resolve);
  return getForAdmin(ticket.id);
};

const setStatusAsAdmin = async (ticketId, status, admin = null) => {
  if (!STATUSES.includes(status)) {
    throw fail(400, 'INVALID_STATUS', `status must be one of: ${STATUSES.join(', ')}`);
  }
  const found = await prisma.supportTicket.findUnique({
    where: byPublicId(ticketId),
    select: { id: true, number: true, subject: true, user: { select: { id: true, name: true, email: true } } },
  });
  if (!found) throw fail(404, 'TICKET_NOT_FOUND', 'That ticket does not exist.');

  let changed = false;
  await prisma.$transaction(async (tx) => {
    const current = await tx.supportTicket.findUnique({
      where: { id: found.id }, select: TRANSITION_SELECT,
    });
    if (current.status === status) return;
    changed = true;
    const data = await metrics.applyTransition(tx, current, status, {
      type: 'admin', id: admin?.id || null, name: admin?.name || admin?.email || '',
    }, { note: `Support set the status to ${status}` });
    await tx.supportTicket.update({ where: { id: found.id }, data });
  });

  // Only on a real change: re-sending "your ticket was resolved" because
  // somebody clicked Solved on an already-solved ticket is a notification the
  // customer cannot explain.
  if (changed && status === 'solved') await notifyCustomerOfReply(found, found.user, true);
  return getForAdmin(found.id);
};

/**
 * Set a ticket's priority, and with it the SLA it is graded against.
 *
 * Support's call, never the customer's — a self-declared urgency is a field
 * where everything is urgent. Re-stamping the targets is the point: moving a
 * ticket to urgent is a new promise, and leaving yesterday's normal targets on
 * it would mean the queue reports hitting a target nobody is working to.
 */
const setPriority = async (ticketId, priority, admin = null) => {
  const policy = await resolvePolicy();
  const allowed = metrics.prioritiesFrom(policy);
  if (!allowed.includes(priority)) {
    throw fail(400, 'INVALID_PRIORITY', `priority must be one of: ${allowed.join(', ')}`);
  }
  const ticket = await prisma.supportTicket.findUnique({
    where: byPublicId(ticketId), select: { id: true, priority: true },
  });
  if (!ticket) throw fail(404, 'TICKET_NOT_FOUND', 'That ticket does not exist.');

  await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { priority, ...metrics.slaFor(policy, priority) },
  });
  return getForAdmin(ticket.id);
};

/**
 * What an admin may choose from, and what each tier promises.
 *
 * Sent from the server rather than listed in the admin frontend: the tiers,
 * their order, their wording and their targets are all policy, and a copy in
 * the client is a second place for them to be wrong.
 */
const priorityOptions = async () => {
  const policy = await resolvePolicy();
  return metrics.prioritiesFrom(policy).map((key) => ({
    key,
    label: metrics.labelFor(policy, key),
    ...metrics.slaFor(policy, key),
  }));
};

const assign = async (ticketId, targetAdminId) => {
  const ticket = await prisma.supportTicket.findUnique({ where: byPublicId(ticketId), select: { id: true } });
  if (!ticket) throw fail(404, 'TICKET_NOT_FOUND', 'That ticket does not exist.');

  let data = { assignedAdminId: null, assignedAdminName: null };
  if (targetAdminId) {
    const admin = await prisma.user.findUnique({
      where: byPublicId(targetAdminId), select: { id: true, name: true, accountType: true },
    });
    if (!admin || admin.accountType !== 'admin') throw fail(404, 'ADMIN_NOT_FOUND', 'No admin with that id.');
    data = { assignedAdminId: admin.id, assignedAdminName: admin.name };
  }

  await prisma.supportTicket.update({ where: { id: ticket.id }, data });
  return getForAdmin(ticket.id);
};

/** The "permanently delete customer" cascade in userDeletionService.js. */
const deleteAllForUsers = async (userIds, db = prisma) => {
  const users = await db.user.findMany({ where: byPublicIds(userIds), select: { id: true } });
  const ids = users.map((u) => u.id);
  if (!ids.length) return;
  // Messages cascade with the ticket (onDelete: Cascade in the migration).
  await db.supportTicket.deleteMany({ where: { userId: { in: ids } } });
};

module.exports = {
  CATEGORIES,
  STATUSES,
  CUSTOMER_STATUSES,
  displayNumber,
  listForUser,
  getForUser,
  create,
  addMessageAsCustomer,
  setStatusAsCustomer,
  listForAdmin,
  getForAdmin,
  addMessageAsAdmin,
  setStatusAsAdmin,
  setPriority,
  priorityOptions,
  assign,
  deleteAllForUsers,
};
