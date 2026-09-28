/**
 * Admin Recommendation Policy Routes
 *
 * How the deployment journey's suggestion engine makes up its mind: every
 * weight, penalty, threshold and customer-facing sentence. These live in the
 * database so tuning the recommendations is an admin action rather than a
 * code change and a deploy.
 *
 * Two things here differ from the other builders and are deliberate:
 *
 *   1. `GET /defaults` returns the engine's built-in values. The UI needs
 *      them to show what a field falls back to when it is left blank, which
 *      is what makes "override one knob" a safe thing to do.
 *   2. `POST /:id/preview` scores a real model against real answers under an
 *      UNSAVED policy. Tuning a scoring weight blind is guesswork; this lets
 *      the admin see the effect before committing it to live traffic.
 */
const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const router = express.Router();
const activityLogService = require('../../../services/admin/activityLogService');
const recommendationPolicyService = require('../../../services/admin/recommendationPolicyService');
const { checkPermission } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');
const { DEFAULT_POLICY, deepMerge } = require('../../../services/recommendation/policyDefaults');
const recommendation = require('../../../services/recommendation');
const catalogCache = require('../../../services/recommendation/catalogCache');

const logChange = async (req, action, policy, description) => {
  await activityLogService.logActivity({
    userId: req.userId,
    userName: req.user.name,
    userEmail: req.user.email,
    userRole: req.user.role,
    action,
    actionType: action.endsWith('_created') ? 'create' : action.endsWith('_deleted') ? 'delete' : 'update',
    targetModel: 'RecommendationPolicy',
    targetId: policy?.id,
    targetName: policy?.key,
    description,
    ipAddress: getClientIP(req),
    userAgent: req.get('user-agent'),
    status: 'success',
  });
};

/**
 * The engine caches the active policy, so a save that does not clear it
 * leaves the admin staring at stale output for up to the TTL and concluding
 * their edit did nothing.
 */
const applyImmediately = () => catalogCache.clear();

// @route   GET /api/v1/admin/recommendation-policy/defaults
// Must be declared before /:id or "defaults" is read as an id.
router.get('/defaults', checkPermission('models.view'), (req, res) => {
  res.json({ success: true, defaults: DEFAULT_POLICY });
});

// @route   GET /api/v1/admin/recommendation-policy
router.get('/', checkPermission('models.view'), async (req, res) => {
  try {
    const policies = await recommendationPolicyService.list();

    res.json({
      success: true,
      policies,
      total: policies.length,
      // With no policy at all the engine still runs on the built-in defaults,
      // so the UI can say that rather than implying the feature is broken.
      usingBuiltInDefaults: !policies.some((p) => p.isActive),
    });
  } catch (error) {
    console.error('List recommendation policies error:', error);
    res.status(500).json({ success: false, message: 'Error fetching policies' });
  }
});

// @route   GET /api/v1/admin/recommendation-policy/:id
router.get('/:id', checkPermission('models.view'), async (req, res) => {
  try {
    const policy = await recommendationPolicyService.findById(req.params.id);
    if (!policy) {
      return res.status(404).json({ success: false, message: 'Policy not found' });
    }

    res.json({
      success: true,
      policy,
      // What the engine will actually use once defaults fill the gaps.
      effective: deepMerge(DEFAULT_POLICY, policy),
    });
  } catch (error) {
    console.error('Get recommendation policy error:', error);
    res.status(500).json({ success: false, message: 'Error fetching policy' });
  }
});

// @route   POST /api/v1/admin/recommendation-policy
router.post('/', checkPermission('models.create'), async (req, res) => {
  try {
    const policy = await recommendationPolicyService.create({ ...req.body, updatedBy: req.userId });

    applyImmediately();
    await logChange(req, 'recommendation_policy_created', policy, `Created recommendation policy "${policy.name}"`);

    res.status(201).json({ success: true, message: 'Policy created', policy });
  } catch (error) {
    failure(res, error, 'Error creating policy', { log: 'Create recommendation policy error' });
  }
});

// @route   PUT /api/v1/admin/recommendation-policy/:id
router.put('/:id', checkPermission('models.edit'), async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.key; // Stable identifier — the seed matches on it.

    const policy = await recommendationPolicyService.update(req.params.id, { ...updates, updatedBy: req.userId });
    if (!policy) {
      return res.status(404).json({ success: false, message: 'Policy not found' });
    }

    applyImmediately();
    await logChange(req, 'recommendation_policy_updated', policy, `Updated recommendation policy "${policy.name}"`);

    res.json({ success: true, message: 'Policy updated', policy });
  } catch (error) {
    failure(res, error, 'Error updating policy', { log: 'Update recommendation policy error' });
  }
});

// @route   POST /api/v1/admin/recommendation-policy/:id/activate
router.post('/:id/activate', checkPermission('models.edit'), async (req, res) => {
  try {
    const policy = await recommendationPolicyService.activate(req.params.id, req.userId);
    if (!policy) {
      return res.status(404).json({ success: false, message: 'Policy not found' });
    }

    applyImmediately();
    await logChange(req, 'recommendation_policy_updated', policy, `Made "${policy.name}" the live recommendation policy`);

    res.json({ success: true, message: `"${policy.name}" is now live`, policy });
  } catch (error) {
    failure(res, error, 'Error activating policy', { log: 'Activate recommendation policy error' });
  }
});

// @route   POST /api/v1/admin/recommendation-policy/:id/duplicate
router.post('/:id/duplicate', checkPermission('models.create'), async (req, res) => {
  try {
    const copy = await recommendationPolicyService.duplicate(req.params.id, {
      key: req.body.key, name: req.body.name, updatedBy: req.userId,
    });
    if (!copy) {
      return res.status(404).json({ success: false, message: 'Policy not found' });
    }

    await logChange(req, 'recommendation_policy_created', copy, `Duplicated recommendation policy "${copy.name}"`);

    res.status(201).json({ success: true, message: 'Policy duplicated', policy: copy });
  } catch (error) {
    failure(res, error, 'Error duplicating policy', { log: 'Duplicate recommendation policy error' });
  }
});

/**
 * @route POST /api/v1/admin/recommendation-policy/:id/preview
 *
 * Dry-run: score `modelId` against `answers` under this policy plus any
 * unsaved `overrides`. Writes nothing and never touches the live cache, so an
 * admin can try a weight before committing it.
 */
router.post('/:id/preview', checkPermission('models.view'), async (req, res) => {
  try {
    const { modelId, answers = [], overrides = {} } = req.body;

    if (!modelId) {
      return res.status(400).json({ success: false, message: 'modelId is required' });
    }
    if (!Array.isArray(answers)) {
      return res.status(400).json({ success: false, message: 'answers must be an array' });
    }

    const stored = req.params.id === 'unsaved'
      ? {}
      : (await recommendationPolicyService.findById(req.params.id)) || {};

    const model = await recommendation.findModelById(modelId);
    if (!model) {
      return res.status(404).json({ success: false, code: 'MODEL_NOT_FOUND', message: 'Model not found' });
    }

    const policy = deepMerge(deepMerge(DEFAULT_POLICY, stored), overrides);

    const [live, previewed] = await Promise.all([
      recommendation.sizeForModel(model, answers, 0),
      recommendation.sizeForModel(model, answers, 0, policy),
    ]);

    // Side by side, because "what changed" is the only useful question here.
    res.json({
      success: true,
      live: {
        tier: live.recommendation.primary ? live.recommendation.primary.name : null,
        verdict: live.suitability.verdict,
        reasons: (live.reasons || []).map((r) => r.text),
      },
      preview: {
        tier: previewed.recommendation.primary ? previewed.recommendation.primary.name : null,
        verdict: previewed.suitability.verdict,
        reasons: (previewed.reasons || []).map((r) => r.text),
        rankedTiers: (previewed.recommendation.allTiers || [])
          .map((t) => ({ name: t.name, score: t.score, pricePerHour: t.pricePerHour })),
      },
    });
  } catch (error) {
    console.error('Preview recommendation policy error:', error);
    failure(res, error, 'Error previewing policy');
  }
});

// @route   DELETE /api/v1/admin/recommendation-policy/:id
router.delete('/:id', checkPermission('models.delete'), async (req, res) => {
  try {
    const policy = await recommendationPolicyService.deleteOne(req.params.id);
    if (!policy) {
      return res.status(404).json({ success: false, message: 'Policy not found' });
    }

    await logChange(req, 'recommendation_policy_deleted', policy, `Deleted recommendation policy "${policy.name}"`);

    res.json({ success: true, message: 'Policy deleted' });
  } catch (error) {
    failure(res, error, 'Error deleting policy', { log: 'Delete recommendation policy error' });
  }
});

module.exports = router;
