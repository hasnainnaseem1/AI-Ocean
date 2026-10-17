/**
 * Support tickets — the signed-in customer's own. Not behind teamContext: a
 * ticket belongs to the person who raised it, never to whichever account
 * they happen to be switched into (see services/support/supportTicketService.js).
 */
const express = require('express');
const supportTicketService = require('../../../services/support/supportTicketService');

const router = express.Router();

const sendError = (res, error, fallback) => {
  if (error.status && error.status < 500) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message });
  }
  console.error(`${fallback}:`, error);
  return res.status(500).json({ success: false, message: fallback });
};

// @route   GET /api/v1/customer/support/tickets
// @desc    The caller's own tickets, most recently active first
router.get('/tickets', async (req, res) => {
  try {
    res.json({ success: true, tickets: await supportTicketService.listForUser(req.user.id) });
  } catch (error) {
    sendError(res, error, 'Could not load your tickets');
  }
});

// @route   POST /api/v1/customer/support/tickets
// @desc    Open a new ticket with its first message
router.post('/tickets', async (req, res) => {
  try {
    const { subject, category, message } = req.body || {};
    const ticket = await supportTicketService.create(req.user, { subject, category, message });
    res.status(201).json({ success: true, ticket });
  } catch (error) {
    sendError(res, error, 'Could not open the ticket');
  }
});

// @route   GET /api/v1/customer/support/tickets/:id
// @desc    One ticket and its thread — 404 (not 403) if it is not the caller's,
//          so a guessed id cannot reveal that a ticket exists.
router.get('/tickets/:id', async (req, res) => {
  try {
    const ticket = await supportTicketService.getForUser(req.params.id, req.user.id);
    if (!ticket) return res.status(404).json({ success: false, code: 'TICKET_NOT_FOUND', message: 'That ticket does not exist.' });
    res.json({ success: true, ticket });
  } catch (error) {
    sendError(res, error, 'Could not load the ticket');
  }
});

// @route   POST /api/v1/customer/support/tickets/:id/messages
// @desc    Reply — always reopens the ticket, whatever its status was
router.post('/tickets/:id/messages', async (req, res) => {
  try {
    const ticket = await supportTicketService.addMessageAsCustomer(req.params.id, req.user, req.body?.body);
    res.status(201).json({ success: true, ticket });
  } catch (error) {
    sendError(res, error, 'Could not send your message');
  }
});

// @route   PATCH /api/v1/customer/support/tickets/:id/status
// @desc    Mark a ticket solved, or reopen it — the customer's own toggle
router.patch('/tickets/:id/status', async (req, res) => {
  try {
    const ticket = await supportTicketService.setStatusAsCustomer(req.params.id, req.user, req.body?.status);
    res.json({ success: true, ticket });
  } catch (error) {
    sendError(res, error, 'Could not update the ticket');
  }
});

module.exports = router;
