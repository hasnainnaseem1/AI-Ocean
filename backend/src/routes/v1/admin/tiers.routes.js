/**
 * Admin Tier Routes
 *
 * CRUD for the machines customers deploy onto — our own cloud, whatever shape
 * the platform owner assembles: accelerated, CPU-optimised, memory-optimised.
 *
 * A tier's price is either a flat hourly rate the admin types, or the sum of
 * its resource components plus a markup. Either way the saved `pricePerHour`
 * and `stoppedPricePerHour` are what everything downstream reads, and changing
 * them never affects a live deployment — rates are frozen onto each deployment
 * at order time.
 */
const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const router = express.Router();
const prisma = require('../../../lib/prismaClient');
const catalogService = require('../../../services/catalog/catalogService');
const tierPricing = require('../../../services/catalog/tierPricing');
const deploymentService = require('../../../services/deployment/deploymentService');
const activityLogService = require('../../../services/admin/activityLogService');
const { checkPermission } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');
const catalogCache = require('../../../services/recommendation/catalogCache');
const { byPublicId } = require('../../../utils/helpers/publicId');

const isUniqueViolation = (error) => error.code === 'P2002';

const logChange = async (req, action, tier, description, metadata = {}) => {
  await activityLogService.logActivity({
    userId: req.userId,
    userName: req.user.name,
    userEmail: req.user.email,
    userRole: req.user.role,
    action,
    actionType: action.endsWith('_created') ? 'create' : action.endsWith('_deleted') ? 'delete' : 'update',
    targetModel: 'Tier',
    targetId: tier?.id,
    targetName: tier?.name,
    description,
    metadata,
    ipAddress: getClientIP(req),
    userAgent: req.get('user-agent'),
    status: 'success',
  });
};

/** Catalog reads are cached for the sizing engine; a price edit must show up now. */
const applyImmediately = () => catalogCache.clear();

// @route   GET /api/v1/admin/tiers
router.get('/', checkPermission('models.view'), async (req, res) => {
  try {
    const { isActive, categoryId } = req.query;
    const where = {};
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (categoryId) where.categoryId = await catalogService.resolveTierCategoryId(categoryId);

    const tiers = await prisma.tier.findMany({
      where,
      include: catalogService.TIER_INCLUDE,
      orderBy: [{ displayOrder: 'asc' }, { pricePerHour: 'asc' }],
    });

    // How many running deployments sit on each tier
    const countMap = await deploymentService.countActiveByTier();

    res.json({
      success: true,
      tiers: tiers.map((t) => {
        const json = catalogService.toTierJSON(t);
        return {
          ...json,
          category: t.category ? catalogService.toTierCategoryJSON(t.category) : null,
          activeDeployments: countMap[t.id] || 0,
          availableUnits: t.capacityTotal
            ? Math.max(0, t.capacityTotal - (t.capacityAllocated || 0))
            : null,
        };
      }),
      total: tiers.length,
    });
  } catch (error) {
    console.error('List tiers error:', error);
    res.status(500).json({ success: false, message: 'Error fetching tiers' });
  }
});

/**
 * @route POST /api/v1/admin/tiers/price-preview
 *
 * What a set of component picks would cost, without saving anything. The tier
 * builder shows a live total as the admin adjusts quantities, and it has to be
 * the same arithmetic we will actually bill — so it is computed here rather
 * than in the browser.
 *
 * Registered before `/:id` so "price-preview" is never read as an id.
 */
router.post('/price-preview', checkPermission('models.view'), async (req, res) => {
  try {
    const { components = [], markupPercent = 0 } = req.body;
    const quote = await tierPricing.quote(components, markupPercent);
    const hasStorage = quote.lines.some((l) => l.kind === 'storage');

    res.json({
      success: true,
      ...quote,
      freeComputeWarnings: tierPricing.computeFreeComputeWarnings({
        pricePerHour: quote.pricePerHour,
        stoppedPricePerHour: quote.stoppedPricePerHour,
        storageGb: hasStorage ? 1 : 0, // only "is there any storage at all" matters here
      }),
    });
  } catch (error) {
    console.error('Tier price preview error:', error);
    failure(res, error, 'Could not price these components');
  }
});

// @route   GET /api/v1/admin/tiers/:id
router.get('/:id', checkPermission('models.view'), async (req, res) => {
  try {
    const tier = await prisma.tier.findUnique({
      where: byPublicId(req.params.id),
      include: catalogService.TIER_INCLUDE,
    });
    if (!tier) return res.status(404).json({ success: false, message: 'Tier not found' });

    res.json({
      success: true,
      tier: { ...catalogService.toTierJSON(tier), category: tier.category ? catalogService.toTierCategoryJSON(tier.category) : null },
    });
  } catch (error) {
    console.error('Get tier error:', error);
    res.status(500).json({ success: false, message: 'Error fetching tier' });
  }
});

// @route   POST /api/v1/admin/tiers
router.post('/', checkPermission('models.create'), async (req, res) => {
  try {
    const { tier, dropped } = await catalogService.createTier(req.body, req.user.id);
    applyImmediately();

    await logChange(req, 'tier_created', tier,
      `Created tier "${tier.name}" at ${tier.currency} ${tier.pricePerHour}/hr `
      + `(${tier.currency} ${tier.stoppedPricePerHour}/hr while stopped)`);

    res.status(201).json({
      success: true,
      message: 'Tier created successfully',
      tier,
      freeComputeWarnings: tierPricing.computeFreeComputeWarnings(tier),
      ...(dropped.length ? { warning: `${dropped.length} component(s) no longer exist and were skipped` } : {}),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json({ success: false, message: 'A tier with that name or slug already exists' });
    }
    console.error('Create tier error:', error);
    failure(res, error, 'Error creating tier');
  }
});

// @route   PUT /api/v1/admin/tiers/:id
router.put('/:id', checkPermission('models.edit'), async (req, res) => {
  try {
    const existing = await prisma.tier.findUnique({
      where: byPublicId(req.params.id),
      include: catalogService.TIER_INCLUDE,
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Tier not found' });

    const {
      tier, dropped, priceChanged, oldPrice, oldStopped,
    } = await catalogService.updateTier(existing, req.body, req.user.id);
    applyImmediately();

    await logChange(req, 'tier_updated', tier,
      priceChanged
        ? `Repriced "${tier.name}": ${oldPrice} → ${tier.pricePerHour}/hr running, `
          + `${oldStopped} → ${tier.stoppedPricePerHour}/hr stopped `
          + '(existing deployments keep their frozen rate)'
        : `Updated tier "${tier.name}"`,
      req.body);

    res.json({
      success: true,
      message: 'Tier updated successfully',
      tier,
      freeComputeWarnings: tierPricing.computeFreeComputeWarnings(tier),
      ...(dropped.length ? { warning: `${dropped.length} component(s) no longer exist and were skipped` } : {}),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json({ success: false, message: 'A tier with that name or slug already exists' });
    }
    console.error('Update tier error:', error);
    failure(res, error, 'Error updating tier');
  }
});

// @route   PATCH /api/v1/admin/tiers/:id/toggle
router.patch('/:id/toggle', checkPermission('models.edit'), async (req, res) => {
  try {
    const existing = await prisma.tier.findUnique({ where: byPublicId(req.params.id) });
    if (!existing) return res.status(404).json({ success: false, message: 'Tier not found' });

    const tier = await catalogService.toggleTier(existing, req.user.id);
    applyImmediately();

    await logChange(req, 'tier_updated', tier, `${tier.isActive ? 'Enabled' : 'Disabled'} tier "${tier.name}"`);

    res.json({ success: true, message: `Tier ${tier.isActive ? 'enabled' : 'disabled'}`, tier });
  } catch (error) {
    console.error('Toggle tier error:', error);
    res.status(500).json({ success: false, message: 'Error toggling tier' });
  }
});

// @route   DELETE /api/v1/admin/tiers/:id
router.delete('/:id', checkPermission('models.delete'), async (req, res) => {
  try {
    const tier = await prisma.tier.findUnique({ where: byPublicId(req.params.id) });
    if (!tier) return res.status(404).json({ success: false, message: 'Tier not found' });

    const activeCount = await deploymentService.countActiveForTier(tier.id);

    if (activeCount > 0) {
      return res.status(409).json({
        success: false,
        message:
          `${activeCount} active deployment(s) run on "${tier.name}". ` +
          'Disable the tier instead of deleting it.',
        activeDeployments: activeCount,
      });
    }

    await catalogService.deleteTier(tier);
    applyImmediately();
    await logChange(req, 'tier_deleted', { id: tier.id, name: tier.name }, `Deleted tier "${tier.name}"`);

    res.json({ success: true, message: 'Tier deleted successfully' });
  } catch (error) {
    console.error('Delete tier error:', error);
    res.status(500).json({ success: false, message: 'Error deleting tier' });
  }
});

module.exports = router;
