/**
 * Admin Analytics Policy Routes.
 *
 * Every threshold the analytics layer interprets a number with: what counts as
 * dormant, when stock is low, how long a ticket may go unanswered, what each
 * churn signal is worth, which query keys are stripped from a recorded URL,
 * and every customer-facing sentence built from them.
 *
 * ── Why these are on `settings.edit`, not `analytics.view` ──
 *
 * Reading a dashboard and deciding what its numbers MEAN are different rights.
 * Changing `dormantDays` from 30 to 90 does not reveal anything, but it
 * silently re-grades every account on the platform — so it sits with the
 * settings permissions, beside the other things that change how the platform
 * behaves.
 *
 * `GET /defaults` returns the shipped values so the editor can show what each
 * field falls back to when left blank. That is what makes overriding one knob
 * a safe thing to do rather than a guess about what else it affects.
 */
const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const activityLogService = require('../../../services/admin/activityLogService');
const analyticsPolicyService = require('../../../services/admin/analyticsPolicyService');
const { checkPermission } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');
const { invalidate } = require('../../../services/analytics/analyticsPolicyResolver');

const router = express.Router();

const logChange = async (req, action, policy, description) => {
  await activityLogService.logActivity({
    userId: req.userId,
    userName: req.user.name,
    userEmail: req.user.email,
    userRole: req.user.role,
    action,
    actionType: action.endsWith('_created') ? 'create' : action.endsWith('_deleted') ? 'delete' : 'update',
    targetModel: 'AnalyticsPolicy',
    targetId: policy?.id,
    targetName: policy?.key,
    description,
    ipAddress: getClientIP(req),
    userAgent: req.get('user-agent'),
    status: 'success',
  }).catch(() => { /* an audit write must not fail the operator's save */ });
};

/**
 * Every cached aggregate was computed under the OLD thresholds, so a save that
 * only clears the policy cache leaves an admin staring at figures their edit
 * did not change — and concluding it did not save. `invalidate()` drops both.
 */
const applyImmediately = () => invalidate();

// @route   GET /api/v1/admin/analytics-policy/defaults
// Declared before `/:id`, or "defaults" is read as an id.
router.get('/defaults', checkPermission('settings.view'), (req, res) => {
  res.json({
    success: true,
    defaults: analyticsPolicyService.DEFAULTS,
    sections: analyticsPolicyService.JSON_FIELDS,
    scalars: analyticsPolicyService.SCALAR_FIELDS,
  });
});

// @route   GET /api/v1/admin/analytics-policy
router.get('/', checkPermission('settings.view'), async (req, res) => {
  try {
    const policies = await analyticsPolicyService.list();
    res.json({
      success: true,
      policies,
      total: policies.length,
      /*
       * With no policy at all the analytics layer still runs, on the shipped
       * defaults. The UI says that rather than implying something is broken.
       */
      usingDefaults: !policies.some((p) => p.isActive),
    });
  } catch (error) {
    failure(res, error, 'Could not load the analytics policies', { log: 'Analytics policy list' });
  }
});

// @route   GET /api/v1/admin/analytics-policy/:id
router.get('/:id', checkPermission('settings.view'), async (req, res) => {
  try {
    const policy = await analyticsPolicyService.findById(req.params.id);
    if (!policy) return res.status(404).json({ success: false, message: 'No policy with that id' });
    return res.json({ success: true, policy });
  } catch (error) {
    return failure(res, error, 'Could not load that policy', { log: 'Analytics policy read' });
  }
});

// @route   POST /api/v1/admin/analytics-policy
router.post('/', checkPermission('settings.edit'), async (req, res) => {
  try {
    const policy = await analyticsPolicyService.create({ ...req.body, updatedBy: req.userId });
    applyImmediately();
    await logChange(req, 'analytics_policy_created', policy, `Created analytics policy "${policy.key}"`);
    res.status(201).json({ success: true, policy });
  } catch (error) {
    failure(res, error, 'Could not create the policy', { log: 'Analytics policy create' });
  }
});

// @route   PUT /api/v1/admin/analytics-policy/:id
router.put('/:id', checkPermission('settings.edit'), async (req, res) => {
  try {
    const policy = await analyticsPolicyService.update(req.params.id, { ...req.body, updatedBy: req.userId });
    applyImmediately();
    await logChange(req, 'analytics_policy_updated', policy, `Updated analytics policy "${policy.key}"`);
    res.json({ success: true, policy });
  } catch (error) {
    failure(res, error, 'Could not save the policy', { log: 'Analytics policy update' });
  }
});

// @route   POST /api/v1/admin/analytics-policy/:id/activate
// @desc    Make this the live policy, retiring whichever was
router.post('/:id/activate', checkPermission('settings.edit'), async (req, res) => {
  try {
    const policy = await analyticsPolicyService.activate(req.params.id, req.userId);
    applyImmediately();
    await logChange(req, 'analytics_policy_activated', policy, `Activated analytics policy "${policy.key}"`);
    res.json({ success: true, policy });
  } catch (error) {
    failure(res, error, 'Could not activate that policy', { log: 'Analytics policy activate' });
  }
});

// @route   POST /api/v1/admin/analytics-policy/:id/duplicate
// @desc    Copy it under a new key — how an operator keeps a tuning that works
router.post('/:id/duplicate', checkPermission('settings.edit'), async (req, res) => {
  try {
    const policy = await analyticsPolicyService.duplicate(req.params.id, {
      key: req.body?.key, name: req.body?.name, updatedBy: req.userId,
    });
    await logChange(req, 'analytics_policy_created', policy, `Duplicated into analytics policy "${policy.key}"`);
    res.status(201).json({ success: true, policy });
  } catch (error) {
    failure(res, error, 'Could not duplicate that policy', { log: 'Analytics policy duplicate' });
  }
});

// @route   DELETE /api/v1/admin/analytics-policy/:id
router.delete('/:id', checkPermission('settings.edit'), async (req, res) => {
  try {
    const removed = await analyticsPolicyService.deleteOne(req.params.id);
    applyImmediately();
    await logChange(req, 'analytics_policy_deleted', removed, `Deleted analytics policy "${removed.key}"`);
    res.json({ success: true, message: 'Policy deleted' });
  } catch (error) {
    failure(res, error, 'Could not delete that policy', { log: 'Analytics policy delete' });
  }
});

module.exports = router;
