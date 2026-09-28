/**
 * Admin Resource Component Routes
 *
 * CRUD for the priced building blocks a tier is assembled from — disks, vCPUs,
 * RAM, accelerators — and for the categories tiers are filed under.
 *
 * The one thing worth knowing: editing a component's price reprices every
 * component-built tier that uses it, immediately, and the response says how
 * many changed. Live deployments are untouched, because their rates were
 * frozen at order time.
 */
const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const router = express.Router();
const prisma = require('../../../lib/prismaClient');
const catalogService = require('../../../services/catalog/catalogService');
const activityLogService = require('../../../services/admin/activityLogService');
const { checkPermission } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');
const billingModeService = require('../../../services/billing/billingModeService');
const catalogCache = require('../../../services/recommendation/catalogCache');
const { byPublicId } = require('../../../utils/helpers/publicId');

const logChange = async (req, action, targetModel, doc, description, metadata = {}) => {
  await activityLogService.logActivity({
    userId: req.userId,
    userName: req.user.name,
    userEmail: req.user.email,
    userRole: req.user.role,
    action,
    actionType: action.endsWith('_created') ? 'create' : action.endsWith('_deleted') ? 'delete' : 'update',
    targetModel,
    targetId: doc?.id,
    targetName: doc?.name,
    description,
    metadata,
    ipAddress: getClientIP(req),
    userAgent: req.get('user-agent'),
    status: 'success',
  });
};

const isUniqueViolation = (error) => error.code === 'P2002';
const num = (d) => (d === null || d === undefined ? d : Number(d));

/* ────────────────────────────────────────────────────────────
   Categories — the shelves tiers sit on
   ──────────────────────────────────────────────────────────── */

// @route GET /api/v1/admin/resource-components/categories
router.get('/categories', checkPermission('models.view'), async (req, res) => {
  try {
    const categories = await prisma.tierCategory.findMany({
      include: catalogService.TIER_CATEGORY_INCLUDE,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    const counts = await prisma.tier.groupBy({
      by: ['categoryId'],
      where: { categoryId: { not: null } },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.categoryId, c._count._all]));

    res.json({
      success: true,
      categories: categories.map((c) => ({
        ...catalogService.toTierCategoryJSON(c),
        tierCount: countMap.get(c.id) || 0,
      })),
    });
  } catch (error) {
    console.error('List tier categories error:', error);
    res.status(500).json({ success: false, message: 'Error fetching categories' });
  }
});

// @route POST /api/v1/admin/resource-components/categories
router.post('/categories', checkPermission('models.create'), async (req, res) => {
  try {
    const category = await catalogService.createTierCategory(req.body, req.user.id);
    await logChange(req, 'tier_category_created', 'TierCategory', category,
      `Created tier category "${category.name}"`);
    res.status(201).json({ success: true, message: 'Category created', category });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json({ success: false, message: 'A category with that name already exists' });
    }
    console.error('Create tier category error:', error);
    failure(res, error, 'Error creating category');
  }
});

// @route PUT /api/v1/admin/resource-components/categories/:id
router.put('/categories/:id', checkPermission('models.edit'), async (req, res) => {
  try {
    const category = await prisma.tierCategory.findUnique({ where: byPublicId(req.params.id) });
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

    const updated = await catalogService.updateTierCategory(category, req.body, req.user.id);

    await logChange(req, 'tier_category_updated', 'TierCategory', updated,
      `Updated tier category "${updated.name}"`, req.body);
    res.json({ success: true, message: 'Category updated', category: updated });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json({ success: false, message: 'A category with that name already exists' });
    }
    console.error('Update tier category error:', error);
    failure(res, error, 'Error updating category');
  }
});

// @route DELETE /api/v1/admin/resource-components/categories/:id
router.delete('/categories/:id', checkPermission('models.delete'), async (req, res) => {
  try {
    const category = await prisma.tierCategory.findUnique({ where: byPublicId(req.params.id) });
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

    const clearedCount = await catalogService.deleteTierCategory(category);

    await logChange(req, 'tier_category_deleted', 'TierCategory', { id: category.id, name: category.name },
      `Deleted tier category "${category.name}" — ${clearedCount} tier(s) left uncategorised`);

    res.json({
      success: true,
      message: clearedCount
        ? `Category deleted — ${clearedCount} tier(s) are now uncategorised`
        : 'Category deleted',
    });
  } catch (error) {
    console.error('Delete tier category error:', error);
    res.status(500).json({ success: false, message: 'Error deleting category' });
  }
});

/* ────────────────────────────────────────────────────────────
   Components — the priced parts
   ──────────────────────────────────────────────────────────── */

// @route GET /api/v1/admin/resource-components
router.get('/', checkPermission('models.view'), async (req, res) => {
  try {
    const { kind, isActive } = req.query;
    const where = {};
    if (kind) where.kind = kind;
    if (isActive !== undefined) where.isActive = isActive === 'true';

    const [components, settings, usage] = await Promise.all([
      prisma.resourceComponent.findMany({
        where,
        include: catalogService.RESOURCE_COMPONENT_INCLUDE,
        orderBy: [{ kind: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }],
      }),
      billingModeService.getBillingSettings(),
      catalogService.componentUsage(),
    ]);

    res.json({
      success: true,
      components: components.map((c) => {
        const json = catalogService.toResourceComponentJSON(c);
        const used = usage.get(c.id);
        return {
          ...json,
          pricePerUnitPerMonth: Math.round((json.pricePerUnitPerHour || 0) * (json.hoursPerMonth || 730) * 100) / 100,
          tierCount: used?.tierCount || 0,
          tierNames: used ? [...used.tierNames] : [],
        };
      }),
      kinds: catalogService.COMPONENT_KINDS,
      hoursPerMonth: settings.hoursPerMonth || 730,
      billStorageWhileStopped: settings.billStorageWhileStopped !== false,
      total: components.length,
    });
  } catch (error) {
    console.error('List resource components error:', error);
    res.status(500).json({ success: false, message: 'Error fetching components' });
  }
});

// @route POST /api/v1/admin/resource-components
router.post('/', checkPermission('models.create'), async (req, res) => {
  try {
    const settings = await billingModeService.getBillingSettings();
    const component = await catalogService.createResourceComponent(req.body, req.user.id, settings.hoursPerMonth);

    await logChange(req, 'resource_component_created', 'ResourceComponent', component,
      `Created ${component.kind} component "${component.name}" at ${component.currency} `
      + `${component.pricePerUnitPerHour}/${component.unitLabel}/hour`
      + `${component.billedWhileStopped ? ' — billed while stopped' : ''}`);

    res.status(201).json({ success: true, message: 'Component created', component });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json({ success: false, message: 'A component with that name already exists' });
    }
    console.error('Create resource component error:', error);
    failure(res, error, 'Error creating component');
  }
});

// @route PUT /api/v1/admin/resource-components/:id
router.put('/:id', checkPermission('models.edit'), async (req, res) => {
  try {
    const component = await prisma.resourceComponent.findUnique({ where: byPublicId(req.params.id) });
    if (!component) return res.status(404).json({ success: false, message: 'Component not found' });

    const oldRate = num(component.pricePerUnitPerHour);
    const updated = await catalogService.updateResourceComponent(component, req.body, req.user.id);

    /**
     * Push the new price through to every tier built from this component.
     * Without this, editing "NVMe SSD" would change nothing anyone can see —
     * the tier holds a snapshot of the price it was built at.
     */
    const { repriced, changed } = await catalogService.repriceTiersUsingComponent(component.id);
    catalogCache.clear();

    await logChange(req, 'resource_component_updated', 'ResourceComponent', updated,
      oldRate !== updated.pricePerUnitPerHour
        ? `Repriced "${updated.name}" from ${oldRate} to ${updated.pricePerUnitPerHour} `
          + `per ${updated.unitLabel}/hour — ${changed.length} tier(s) repriced`
        : `Updated component "${updated.name}"`,
      { updates: req.body, changed });

    res.json({
      success: true,
      message: changed.length
        ? `Component updated — ${changed.length} tier price(s) recalculated`
        : 'Component updated',
      component: updated,
      repricedTiers: changed,
      tiersChecked: repriced,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(400).json({ success: false, message: 'A component with that name already exists' });
    }
    console.error('Update resource component error:', error);
    failure(res, error, 'Error updating component');
  }
});

// @route PATCH /api/v1/admin/resource-components/:id/toggle
router.patch('/:id/toggle', checkPermission('models.edit'), async (req, res) => {
  try {
    const component = await prisma.resourceComponent.findUnique({ where: byPublicId(req.params.id) });
    if (!component) return res.status(404).json({ success: false, message: 'Component not found' });

    const updated = await catalogService.toggleResourceComponent(component, req.user.id);

    await logChange(req, 'resource_component_updated', 'ResourceComponent', updated,
      `${updated.isActive ? 'Enabled' : 'Disabled'} component "${updated.name}"`);

    res.json({ success: true, message: `Component ${updated.isActive ? 'enabled' : 'disabled'}`, component: updated });
  } catch (error) {
    console.error('Toggle resource component error:', error);
    res.status(500).json({ success: false, message: 'Error toggling component' });
  }
});

// @route DELETE /api/v1/admin/resource-components/:id
router.delete('/:id', checkPermission('models.delete'), async (req, res) => {
  try {
    const component = await prisma.resourceComponent.findUnique({ where: byPublicId(req.params.id) });
    if (!component) return res.status(404).json({ success: false, message: 'Component not found' });

    await catalogService.deleteResourceComponent(component);
    await logChange(req, 'resource_component_deleted', 'ResourceComponent',
      { id: component.id, name: component.name }, `Deleted component "${component.name}"`);

    res.json({ success: true, message: 'Component deleted' });
  } catch (error) {
    if (error.tiers) {
      return res.status(409).json({ success: false, message: error.message, tiers: error.tiers });
    }
    console.error('Delete resource component error:', error);
    res.status(500).json({ success: false, message: 'Error deleting component' });
  }
});

module.exports = router;
