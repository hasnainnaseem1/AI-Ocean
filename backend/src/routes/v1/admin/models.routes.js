/**
 * Admin AI Model Catalog Routes
 *
 * CRUD for the models customers can deploy. Mirrors the structure of
 * plans.routes.js / features.routes.js so the admin UI patterns carry over.
 */
const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const router = express.Router();
const prisma = require('../../../lib/prismaClient');
const catalogService = require('../../../services/catalog/catalogService');
const deploymentService = require('../../../services/deployment/deploymentService');
const activityLogService = require('../../../services/admin/activityLogService');
const { checkPermission } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');
const { byPublicId } = require('../../../utils/helpers/publicId');

const isUniqueViolation = (error) => error.code === 'P2002';

const logChange = async (req, action, model, description, metadata = {}) => {
  await activityLogService.logActivity({
    userId: req.userId,
    userName: req.user.name,
    userEmail: req.user.email,
    userRole: req.user.role,
    action,
    actionType: action.endsWith('_created') ? 'create' : action.endsWith('_deleted') ? 'delete' : 'update',
    targetModel: 'AIModel',
    targetId: model?.id,
    targetName: model?.name,
    description,
    metadata,
    ipAddress: getClientIP(req),
    userAgent: req.get('user-agent'),
    status: 'success',
  });
};

// @route   GET /api/v1/admin/models
// @desc    List all catalog models
router.get('/', checkPermission('models.view'), async (req, res) => {
  try {
    const { search, family, status, isActive } = req.query;

    const where = {};
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (family) where.family = family;
    if (status) where.status = status;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const models = await prisma.aIModel.findMany({
      where,
      include: catalogService.AIMODEL_INCLUDE,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    // Deployment counts per model, so the admin can see what's actually used
    const countMap = await deploymentService.countByModelGrouped();

    res.json({
      success: true,
      models: models.map((m) => ({
        ...catalogService.toAIModelJSON(m),
        deploymentCount: countMap[m.id] || 0,
      })),
      total: models.length,
    });
  } catch (error) {
    console.error('List models error:', error);
    res.status(500).json({ success: false, message: 'Error fetching models' });
  }
});

// @route   GET /api/v1/admin/models/:id
router.get('/:id', checkPermission('models.view'), async (req, res) => {
  try {
    const model = await prisma.aIModel.findUnique({
      where: byPublicId(req.params.id),
      include: catalogService.AIMODEL_INCLUDE,
    });
    if (!model) {
      return res.status(404).json({ success: false, message: 'Model not found' });
    }

    // Attach the full tier records so the form can render names and prices
    const tiers = await prisma.tier.findMany({
      where: { isActive: true },
      include: catalogService.TIER_INCLUDE,
      orderBy: { displayOrder: 'asc' },
    });

    res.json({
      success: true,
      model: catalogService.toAIModelJSON(model),
      availableTiers: tiers.map(catalogService.toTierJSON),
    });
  } catch (error) {
    console.error('Get model error:', error);
    res.status(500).json({ success: false, message: 'Error fetching model' });
  }
});

// @route   POST /api/v1/admin/models
router.post('/', checkPermission('models.create'), async (req, res) => {
  try {
    const model = await catalogService.createAIModel(req.body, req.user.id);
    await logChange(req, 'model_created', model, `Created AI model "${model.name}"`);

    res.status(201).json({ success: true, message: 'Model created successfully', model });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json({ success: false, message: 'A model with that name or slug already exists' });
    }
    console.error('Create model error:', error);
    failure(res, error, 'Error creating model');
  }
});

// @route   PUT /api/v1/admin/models/:id
router.put('/:id', checkPermission('models.edit'), async (req, res) => {
  try {
    const existing = await prisma.aIModel.findUnique({ where: byPublicId(req.params.id) });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Model not found' });
    }

    const model = await catalogService.updateAIModel(existing, req.body, req.user.id);
    await logChange(req, 'model_updated', model, `Updated AI model "${model.name}"`, req.body);

    res.json({ success: true, message: 'Model updated successfully', model });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json({ success: false, message: 'A model with that name or slug already exists' });
    }
    console.error('Update model error:', error);
    failure(res, error, 'Error updating model');
  }
});

// @route   PATCH /api/v1/admin/models/:id/toggle
// @desc    Flip a model's active flag
router.patch('/:id/toggle', checkPermission('models.edit'), async (req, res) => {
  try {
    const existing = await prisma.aIModel.findUnique({ where: byPublicId(req.params.id) });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Model not found' });
    }

    const model = await catalogService.toggleAIModel(existing, req.user.id);

    await logChange(req, 'model_updated', model,
      `${model.isActive ? 'Enabled' : 'Disabled'} AI model "${model.name}"`);

    res.json({ success: true, message: `Model ${model.isActive ? 'enabled' : 'disabled'}`, model });
  } catch (error) {
    console.error('Toggle model error:', error);
    res.status(500).json({ success: false, message: 'Error toggling model' });
  }
});

// @route   PUT /api/v1/admin/models/reorder
// @desc    Persist drag-and-drop ordering
router.put('/order/bulk', checkPermission('models.edit'), async (req, res) => {
  try {
    const { order } = req.body; // [{ id, displayOrder }]
    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, message: 'order must be an array' });
    }

    await catalogService.reorderAIModels(order, req.user.id);

    res.json({ success: true, message: 'Order updated' });
  } catch (error) {
    console.error('Reorder models error:', error);
    res.status(500).json({ success: false, message: 'Error reordering models' });
  }
});

// @route   DELETE /api/v1/admin/models/:id
router.delete('/:id', checkPermission('models.delete'), async (req, res) => {
  try {
    const model = await prisma.aIModel.findUnique({ where: byPublicId(req.params.id) });
    if (!model) {
      return res.status(404).json({ success: false, message: 'Model not found' });
    }

    // Refuse to delete a model that customers are still running — deactivate
    // it instead so their deployment records keep making sense.
    const activeCount = await deploymentService.countActiveForModel(model.id);

    if (activeCount > 0) {
      return res.status(409).json({
        success: false,
        message:
          `${activeCount} active deployment(s) still use "${model.name}". ` +
          'Disable the model instead of deleting it so existing deployments stay intact.',
        activeDeployments: activeCount,
      });
    }

    await catalogService.deleteAIModel(model);
    await logChange(req, 'model_deleted', { id: model.id, name: model.name }, `Deleted AI model "${model.name}"`);

    res.json({ success: true, message: 'Model deleted successfully' });
  } catch (error) {
    console.error('Delete model error:', error);
    res.status(500).json({ success: false, message: 'Error deleting model' });
  }
});

module.exports = router;
