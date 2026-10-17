/**
 * Admin Support Ticket Routes
 *
 * Reads take `support.view`; replying, changing status and assigning take
 * `support.manage` — the same view/manage split billing and deployments
 * already use. `super_admin` bypasses both, as it does everywhere else.
 */
const express = require('express');
const supportTicketService = require('../../../services/support/supportTicketService');
const userService = require('../../../services/user/userService');
const { adminAuth } = require('../../../middleware/auth');
const { checkPermission } = require('../../../middleware/security');

const router = express.Router();

const sendError = (res, error, fallback) => {
  if (error.status && error.status < 500) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  }
  console.error(`${fallback}:`, error);
  return res.status(500).json({ success: false, message: fallback });
};

// @route   GET /api/v1/admin/support/admins
// @desc    Who a ticket can be assigned to. A dedicated endpoint rather than
//          reusing GET /admin/users, which needs `users.view` — a role built
//          only for support (support.view/manage, nothing else) still needs
//          this list to work the assign dropdown.
router.get('/admins', adminAuth, checkPermission('support.view'), async (req, res) => {
  try {
    res.json({ success: true, admins: await userService.listActiveAdmins() });
  } catch (error) {
    sendError(res, error, 'Could not load admins');
  }
});

// @route   GET /api/v1/admin/support/tickets
// @desc    Every ticket, paginated — filter by status/category/assignment/search
router.get('/tickets', adminAuth, checkPermission('support.view'), async (req, res) => {
  try {
    const query = { ...req.query, meAdminId: req.query.assigned === 'me' ? req.userId : null };
    res.json({ success: true, ...(await supportTicketService.listForAdmin(query)) });
  } catch (error) {
    sendError(res, error, 'Could not load tickets');
  }
});

// @route   GET /api/v1/admin/support/tickets/:id
// @desc    One ticket, its thread and the customer who raised it
router.get('/tickets/:id', adminAuth, checkPermission('support.view'), async (req, res) => {
  try {
    const ticket = await supportTicketService.getForAdmin(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, code: 'TICKET_NOT_FOUND', message: 'That ticket does not exist.' });
    res.json({ success: true, ticket });
  } catch (error) {
    sendError(res, error, 'Could not load the ticket');
  }
});

// @route   POST /api/v1/admin/support/tickets/:id/messages
// @desc    Reply — sets status to pending, or solved when the reply closes it out
router.post('/tickets/:id/messages', adminAuth, checkPermission('support.manage'), async (req, res) => {
  try {
    const ticket = await supportTicketService.addMessageAsAdmin(
      req.params.id, req.user, req.body?.body, { resolve: !!req.body?.resolve },
    );
    res.status(201).json({ success: true, ticket });
  } catch (error) {
    sendError(res, error, 'Could not send the reply');
  }
});

// @route   PATCH /api/v1/admin/support/tickets/:id/status
router.patch('/tickets/:id/status', adminAuth, checkPermission('support.manage'), async (req, res) => {
  try {
    // The admin is passed through so the status history records WHO moved it.
    const ticket = await supportTicketService.setStatusAsAdmin(req.params.id, req.body?.status, req.user);
    res.json({ success: true, ticket });
  } catch (error) {
    sendError(res, error, 'Could not update the ticket');
  }
});

// @route   GET /api/v1/admin/support/priorities
// @desc    The priority tiers and what each one promises, from the analytics
//          policy — so the dropdown follows an operator's edit without a deploy
router.get('/priorities', adminAuth, checkPermission('support.view'), async (req, res) => {
  try {
    res.json({ success: true, priorities: await supportTicketService.priorityOptions() });
  } catch (error) {
    sendError(res, error, 'Could not load the priority list');
  }
});

// @route   PATCH /api/v1/admin/support/tickets/:id/priority
// @desc    Set the priority, re-stamping the SLA targets the ticket is graded on
router.patch('/tickets/:id/priority', adminAuth, checkPermission('support.manage'), async (req, res) => {
  try {
    const ticket = await supportTicketService.setPriority(req.params.id, req.body?.priority, req.user);
    res.json({ success: true, ticket });
  } catch (error) {
    sendError(res, error, 'Could not change the priority');
  }
});

// @route   PATCH /api/v1/admin/support/tickets/:id/assign
// @desc    Assign to an admin, or unassign with a null/empty adminId
router.patch('/tickets/:id/assign', adminAuth, checkPermission('support.manage'), async (req, res) => {
  try {
    const ticket = await supportTicketService.assign(req.params.id, req.body?.adminId || null);
    res.json({ success: true, ticket });
  } catch (error) {
    sendError(res, error, 'Could not assign the ticket');
  }
});

module.exports = router;
