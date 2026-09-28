/**
 * Accepting or declining a team invitation — as the signed-in customer, with
 * the token from the invitation link. Not behind teamContext: the caller is
 * not a member of that team yet, which is the whole point.
 */
const express = require('express');
const invitationService = require('../../../services/team/invitationService');
const { sendError } = require('./teams.routes');

const router = express.Router();

router.post('/accept', async (req, res) => {
  try {
    res.json({ success: true, ...(await invitationService.accept(req.body?.token, req.user)) });
  } catch (error) {
    sendError(res, error, 'Could not accept the invitation');
  }
});

router.post('/decline', async (req, res) => {
  try {
    res.json({ success: true, ...(await invitationService.decline(req.body?.token, req.user)) });
  } catch (error) {
    sendError(res, error, 'Could not decline the invitation');
  }
});

module.exports = router;
