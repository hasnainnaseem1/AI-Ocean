/**
 * Admin Deployment Routes — the fulfillment queue.
 *
 * In phase 1 an admin reads the customer's requirements here, builds the model
 * on the server by hand, then records the result: status, endpoint URL and API
 * key. Every transition goes through deploymentService so the customer emails,
 * notifications, billing watermarks and audit log stay consistent — and so
 * phase 2's provisioning automation can replace the admin action without
 * touching anything else.
 */
const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const { meta } = require('../../../utils/helpers/pagination');
const router = express.Router();
const activityLogService = require('../../../services/admin/activityLogService');
const { checkPermission } = require('../../../middleware/security');
const deploymentService = require('../../../services/deployment/deploymentService');
const deploymentUsageService = require('../../../services/deployment/deploymentUsageService');
const endpointService = require('../../../services/deployment/endpointService');
const { hasLiveAccess } = require('../../../services/deployment/deploymentConstants');
const userService = require('../../../services/user/userService');
const { cryptoHelper } = require('../../../utils/helpers');
const { getClientIP } = require('../../../utils/helpers/ipHelper');

/** Never send credentials in a response — only status about them. */
const endpointSummary = (d) => ({
  url: d.endpoint?.url || '',
  apiKeyMasked: d.endpoint?.apiKeyMasked || '',
  hasApiKey: !!d.endpoint?.apiKeyEncrypted,
  active: hasLiveAccess(d),
  suspended: d.endpoint?.active === false && !d.endpoint?.revokedAt,
  revoked: !!d.endpoint?.revokedAt,
  suspendedAt: d.endpoint?.suspendedAt || null,
  suspendReason: d.endpoint?.suspendReason || '',
  revokedAt: d.endpoint?.revokedAt || null,
  keyVersion: d.endpoint?.keyVersion || 1,
  // The human half — see services/deployment/provisioningDriver.js. True means
  // our records already closed this off but nobody has confirmed the actual
  // hardware is switched off yet.
  shutdownRequired: !!d.endpoint?.shutdownRequired,
  shutdownRequestedAt: d.endpoint?.shutdownRequestedAt || null,
  shutdownCompletedAt: d.endpoint?.shutdownCompletedAt || null,
});

/** Shape a deployment for the admin JSON response, with owner/assignee names attached. */
const serialize = (d) => ({
  ...d.toObject(),
  userId: { _id: d.userId, name: d.ownerRef?.name || '', email: d.ownerRef?.email || '' },
  assignedTo: d.assignedTo ? { _id: d.assignedTo, name: d.assignedToRef?.name || '', email: d.assignedToRef?.email || '' } : null,
  endpoint: { ...d.toObject().endpoint, ...endpointSummary(d) },
});

// @route   GET /api/v1/admin/deployments
// @desc    The queue — filterable by status, model, customer
router.get('/', checkPermission('deployments.view'), async (req, res) => {
  try {
    const {
      status, modelId, userId, search, needsShutdown, page = 1, limit = 20,
    } = req.query;

    const { deployments, total, statusCounts, shutdownPending } = await deploymentService.listForAdmin({
      status, modelId, userId, search, needsShutdown, page, limit,
    });

    res.json({
      success: true,
      deployments: deployments.map((d) => serialize(d)),
      statusCounts,
      // Surfaced so the queue can badge "N endpoints still need to be switched
      // off" regardless of what status filter is currently applied
      shutdownPending,
      pagination: meta({ page, limit }, total),
    });
  } catch (error) {
    console.error('List deployments error:', error);
    res.status(500).json({ success: false, message: 'Error fetching deployments' });
  }
});

// @route   GET /api/v1/admin/deployments/:id
// @desc    Full detail including the customer's questionnaire answers
router.get('/:id', checkPermission('deployments.view'), async (req, res) => {
  try {
    const deployment = await deploymentService.findById(req.params.id);
    if (!deployment) {
      return res.status(404).json({ success: false, message: 'Deployment not found' });
    }

    const usage = await deploymentUsageService.listRecent(deployment.id, 50);

    res.json({
      success: true,
      deployment: {
        ...serialize(deployment),
        endpoint: {
          ...endpointSummary(deployment),
          docsUrl: deployment.endpoint?.docsUrl || '',
          extra: deployment.endpoint?.extra || {},
        },
      },
      usage,
      allowedTransitions: deploymentService.ALLOWED_TRANSITIONS[deployment.status] || [],
    });
  } catch (error) {
    console.error('Get deployment error:', error);
    res.status(500).json({ success: false, message: 'Error fetching deployment' });
  }
});

// @route   PUT /api/v1/admin/deployments/:id/status
// @desc    Move a deployment through its lifecycle
router.put('/:id/status', checkPermission('deployments.manage'), async (req, res) => {
  try {
    const { status, note, forceUnfunded } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'A target status is required' });
    }

    const deployment = await deploymentService.findById(req.params.id);
    if (!deployment) {
      return res.status(404).json({ success: false, message: 'Deployment not found' });
    }

    // Going live without an endpoint would email the customer a blank URL
    if (status === 'running' && !deployment.endpoint?.url) {
      return res.status(400).json({
        success: false,
        code: 'ENDPOINT_REQUIRED',
        message: 'Set the endpoint URL and API key before marking this deployment as running.',
      });
    }

    if (status === 'rejected' && !note) {
      return res.status(400).json({
        success: false,
        message: 'Please give a reason — it is shown to the customer.',
      });
    }

    /**
     * Going live is only allowed when the customer's account can actually
     * fund it — transition() asks fundingService itself. `forceUnfunded` is
     * the deliberate admin override for the rare case that calls for it
     * (comped access, a manual arrangement outside the wallet); transition()
     * logs it to the activity trail whenever it's used, so it is always a
     * decision on the record, never a silent bypass.
     */
    await deploymentService.transition(deployment, status, {
      actor: req.user,
      note,
      forceUnfunded: !!forceUnfunded,
    });

    // Never hand back the raw document as-is — it carries the encrypted key
    // ciphertext, and this response should say only what happened to it.
    res.json({
      success: true,
      message: `Deployment marked as ${status}`,
      deployment: serialize(deployment),
      allowedTransitions: deploymentService.ALLOWED_TRANSITIONS[deployment.status] || [],
    });
  } catch (error) {
    if (error.status === 400) {
      return failure(res, error, 'Something went wrong. Please try again.');
    }
    if (error.status === 402) {
      return res.status(402).json({
        success: false,
        code: error.code,
        message: error.message,
        balance: error.balance,
        required: error.requiredBalance,
        topUpRequired: error.shortfall,
        // Tells the admin UI this specific failure can be overridden, and how
        forceUnfundedAvailable: true,
      });
    }
    console.error('Update deployment status error:', error);
    res.status(500).json({ success: false, message: 'Error updating deployment status' });
  }
});

// @route   PUT /api/v1/admin/deployments/:id/endpoint
// @desc    Record the endpoint an admin provisioned by hand
router.put('/:id/endpoint', checkPermission('deployments.manage'), async (req, res) => {
  try {
    const { url, apiKey, docsUrl, extra, generateKey } = req.body;

    const deployment = await deploymentService.findById(req.params.id);
    if (!deployment) {
      return res.status(404).json({ success: false, message: 'Deployment not found' });
    }

    const key = generateKey ? cryptoHelper.generateApiKey() : apiKey;

    await deploymentService.setEndpoint(
      deployment,
      { url, apiKey: key, docsUrl, extra },
      req.user
    );

    res.json({
      success: true,
      message: 'Endpoint saved',
      endpoint: { ...endpointSummary(deployment), docsUrl: deployment.endpoint.docsUrl },
      // Returned once, on creation, so the admin can hand it over if needed
      ...(generateKey ? { generatedApiKey: key } : {}),
    });
  } catch (error) {
    console.error('Set deployment endpoint error:', error);
    res.status(500).json({ success: false, message: 'Error saving endpoint' });
  }
});

// @route   POST /api/v1/admin/deployments/:id/endpoint/confirm-shutdown
// @desc    An admin confirming they have actually switched the machine off.
//
// This exists because provisioning is manual today: closing our own records
// (suspend/revoke) does not stop the customer's traffic by itself, so
// `endpoint.shutdownRequired` stays true — and shows up in this queue — until
// a human says otherwise. It is deliberately its own action rather than
// something inferred from status, because the whole point of the flag is that
// our records and the real hardware can disagree.
router.post(
  '/:id/endpoint/confirm-shutdown',
  checkPermission('deployments.manage'),
  async (req, res) => {
    try {
      const deployment = await deploymentService.findById(req.params.id);
      if (!deployment) {
        return res.status(404).json({ success: false, message: 'Deployment not found' });
      }

      await endpointService.markShutdownComplete(deployment, req.user);

      res.json({
        success: true,
        message: 'Shutdown confirmed',
        endpoint: endpointSummary(deployment),
      });
    } catch (error) {
      console.error('Confirm shutdown error:', error);
      res.status(500).json({ success: false, message: 'Error confirming shutdown' });
    }
  }
);

// @route   PUT /api/v1/admin/deployments/:id/notes
// @desc    Internal notes + assignment (never shown to the customer)
router.put('/:id/notes', checkPermission('deployments.manage'), async (req, res) => {
  try {
    const { adminNotes, assignedTo } = req.body;

    const deployment = await deploymentService.findById(req.params.id);
    if (!deployment) {
      return res.status(404).json({ success: false, message: 'Deployment not found' });
    }

    if (adminNotes !== undefined) deployment.adminNotes = adminNotes;

    if (assignedTo !== undefined) {
      if (assignedTo === null || assignedTo === '') {
        deployment.assignedTo = null;
      } else {
        const assignee = await userService.findById(assignedTo);
        if (!assignee || assignee.accountType !== 'admin') {
          return res.status(400).json({ success: false, message: 'Assignee must be an admin user' });
        }
        deployment.assignedTo = assignee.id;
      }
    }

    await deployment.save();

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'deployment_status_changed',
      actionType: 'update',
      targetModel: 'Deployment',
      targetId: deployment.id,
      targetName: deployment.deploymentName,
      description: `Updated internal notes/assignment for "${deployment.deploymentName}"`,
      ipAddress: getClientIP(req),
      userAgent: req.get('user-agent'),
      status: 'success',
    });

    res.json({ success: true, message: 'Saved', deployment: serialize(deployment) });
  } catch (error) {
    console.error('Update deployment notes error:', error);
    res.status(500).json({ success: false, message: 'Error saving notes' });
  }
});

module.exports = router;
