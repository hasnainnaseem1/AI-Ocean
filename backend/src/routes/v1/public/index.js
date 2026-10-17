const express = require('express');
const router = express.Router();

const marketingRoutes = require('./marketing.routes');
const blogRoutes = require('./blog.routes');
const seoRoutes = require('./seo.routes');
const catalogRoutes = require('./catalog.routes');
const { downloadInvoicePublic } = require('../../../controllers/customer/billingController');

/*
 * The traffic collector, FIRST.
 *
 * `router.use('/', marketingRoutes)` at the bottom of this file is a catch-all
 * on the root path: anything mounted after it is unreachable. This is the one
 * mount in the file whose position is a correctness requirement rather than a
 * matter of taste, so it goes at the top where it cannot be reordered by
 * accident.
 */
router.use('/track', require('./track.routes'));

// Public routes — no authentication required
router.use('/marketing', marketingRoutes);
router.use('/blog', blogRoutes);
router.use('/seo', seoRoutes);

// Team invitation preview — what the invite page shows before sign-in. The
// token in the link is the secret (256 random bits), so this reveals nothing
// to anyone who does not already hold the invitation.
// @route   GET /api/v1/public/join/:token
// @desc    What a join link's landing page may say to somebody not signed in:
//          the organization's name, its size and the role on offer. Nothing
//          about its people or its money — whoever holds this link has not
//          been approved by anyone yet.
router.get('/join/:token', async (req, res) => {
  try {
    const joinLinkService = require('../../../services/team/joinLinkService');
    res.json({ success: true, ...(await joinLinkService.preview(req.params.token)) });
  } catch (error) {
    const status = error.status && error.status < 500 ? error.status : 500;
    res.status(status).json({
      success: false,
      code: error.code || 'JOIN_LINK_INVALID',
      message: status === 500 ? 'Could not read that link' : error.message,
    });
  }
});

router.get('/invitations/:token', async (req, res) => {
  try {
    const invitationService = require('../../../services/team/invitationService');
    res.json({ success: true, invitation: await invitationService.preview(req.params.token) });
  } catch (error) {
    if (error.status && error.status < 500) {
      return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    console.error('Invitation preview error:', error);
    return res.status(500).json({ success: false, message: 'Could not load the invitation' });
  }
});
router.use('/catalog', catalogRoutes);

// Public invoice download — authenticated via signed token in query param
router.get('/invoice/:paymentId', downloadInvoicePublic);

// Convenience aliases so frontends can use /api/v1/public/site directly
router.use('/', marketingRoutes);

module.exports = router;
