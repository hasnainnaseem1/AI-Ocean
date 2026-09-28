const { ComponentKind } = require('@prisma/client');
const prisma = require('../../lib/prismaClient');
const tierPricing = require('./tierPricing');
const { byPublicId, byPublicIds, mapByPublicId, isPublicId } = require('../../utils/helpers/publicId');

/**
 * The catalog: use-case tags, tier categories, resource components, tiers
 * ("machines"), and the AI models that run on them.
 *
 * This file owns every read and write of those five tables, and the JSON shape
 * they take in an API response. Pricing arithmetic lives next door in
 * `tierPricing.js` — component resolution and the rollup that derives a tier's
 * hourly rate — so that the maths can be exercised without touching the
 * database.
 *
 * `tier.isBookable()` and `model.rateForTier(tier)` were record methods once;
 * they are plain exported functions here, taking a record and returning a
 * value.
 *
 * Every id this file hands back — the row's own `id`, plus `categoryId`,
 * `components[].componentId` and `supportedTiers[].tierId` — is the row's UUID
 * primary key, which is also what every route accepts back.
 */

const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const round6 = (n) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
const num = (d) => (d === null || d === undefined ? d : Number(d));
const userRef = (u) => u?.id || null;

const slugify = (name) => String(name)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '');

const COMPONENT_KINDS = Object.values(ComponentKind);

// ── Shared includes ──────────────────────────────────────────────────────

const TIER_CATEGORY_INCLUDE = { createdBy: true, updatedBy: true };
const RESOURCE_COMPONENT_INCLUDE = { createdBy: true, updatedBy: true };
const TIER_INCLUDE = {
  category: true,
  createdBy: true,
  updatedBy: true,
  components: { include: { component: true }, orderBy: { order: 'asc' } },
};
const AIMODEL_INCLUDE = {
  createdBy: true,
  updatedBy: true,
  supportedTiers: { include: { tier: true }, orderBy: { order: 'asc' } },
  useCases: { orderBy: { order: 'asc' } },
};

// ── Id resolution: client/API ids are always id ──────────────

const idByPublicId = async (delegate, id) => {
  if (!id) return null;
  const row = await delegate.findUnique({ where: byPublicId(id), select: { id: true } });
  return row?.id || null;
};

const resolveTierCategoryId = (id) => idByPublicId(prisma.tierCategory, id);
const resolveTierDbId = (id) => idByPublicId(prisma.tier, id);

// ── Response shape builders ────────

const toTierCategoryDoc = (row) => ({
  name: row.name,
  slug: row.slug,
  description: row.description,
  icon: row.icon,
  color: row.color,
  displayOrder: row.displayOrder,
  isActive: row.isActive,
  createdBy: userRef(row.createdBy),
  updatedBy: userRef(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
const toTierCategoryJSON = (row) => ({ id: row.id, ...toTierCategoryDoc(row) });

const toResourceComponentDoc = (row) => ({
  name: row.name,
  slug: row.slug,
  kind: row.kind,
  description: row.description,
  unitLabel: row.unitLabel,
  pricePerUnit: num(row.pricePerUnit),
  pricingPeriod: row.pricingPeriod,
  pricePerUnitPerHour: num(row.pricePerUnitPerHour),
  hoursPerMonth: row.hoursPerMonth,
  currency: row.currency,
  billedWhileStopped: row.billedWhileStopped,
  minQuantity: row.minQuantity,
  maxQuantity: row.maxQuantity,
  stepQuantity: row.stepQuantity,
  specs: row.specs || {},
  availableForCustomBuilds: row.availableForCustomBuilds,
  displayOrder: row.displayOrder,
  isActive: row.isActive,
  createdBy: userRef(row.createdBy),
  updatedBy: userRef(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
const toResourceComponentJSON = (row) => ({ id: row.id, ...toResourceComponentDoc(row) });

const toTierDoc = (row) => ({
  name: row.name,
  slug: row.slug,
  description: row.description,
  categoryId: row.category?.id || null,
  components: (row.components || []).map((c) => ({
    componentId: c.component?.id || null,
    kind: c.kind,
    name: c.name,
    slug: c.slug,
    unitLabel: c.unitLabel,
    quantity: num(c.quantity),
    unitPricePerHour: num(c.unitPricePerHour),
    billedWhileStopped: c.billedWhileStopped,
    lineTotalPerHour: num(c.lineTotalPerHour),
    specs: c.specs || {},
  })),
  pricing: {
    mode: row.pricingMode,
    flatPricePerHour: num(row.pricingFlatPricePerHour),
    flatStoppedPricePerHour: num(row.pricingFlatStoppedPricePerHour),
    markupPercent: num(row.pricingMarkupPercent),
    componentSubtotalPerHour: num(row.pricingComponentSubtotalPerHour),
    componentStoppedSubtotalPerHour: num(row.pricingComponentStoppedSubtotalPerHour),
  },
  pricePerHour: num(row.pricePerHour),
  stoppedPricePerHour: num(row.stoppedPricePerHour),
  currency: row.currency,
  gpuModel: row.gpuModel,
  gpuCount: row.gpuCount,
  vramGb: row.vramGb,
  vcpu: row.vcpu,
  ramGb: row.ramGb,
  storageGb: row.storageGb,
  storageType: row.storageType,
  networkGbps: row.networkGbps,
  regions: row.regions,
  capacity: { total: row.capacityTotal, allocated: row.capacityAllocated },
  status: row.status,
  displayOrder: row.displayOrder,
  isActive: row.isActive,
  metadata: row.metadata || {},
  createdBy: userRef(row.createdBy),
  updatedBy: userRef(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
const toTierJSON = (row) => ({ id: row.id, ...toTierDoc(row) });

const toAIModelDoc = (row) => ({
  name: row.name,
  slug: row.slug,
  family: row.family,
  version: row.version,
  shortDescription: row.shortDescription,
  description: row.description,
  logoUrl: row.logoUrl,
  docsUrl: row.docsUrl,
  huggingFaceId: row.huggingFaceId,
  license: row.license,
  modalities: row.modalities,
  parameterSize: row.parameterSize,
  contextLength: row.contextLength,
  minVramGb: row.minVramGb,
  supportedTiers: (row.supportedTiers || []).map((st) => ({
    tierId: st.tier?.id || null,
    tierName: st.tierName,
    recommended: st.recommended,
    priceMultiplier: num(st.priceMultiplier),
    notes: st.notes,
  })),
  useCases: (row.useCases || []).map((uc) => ({
    key: uc.key,
    label: uc.label,
    fit: uc.fit,
    note: uc.note,
  })),
  strengths: row.strengths,
  limitations: row.limitations,
  status: row.status,
  category: row.category,
  tags: row.tags,
  displayOrder: row.displayOrder,
  isActive: row.isActive,
  isFeatured: row.isFeatured,
  metadata: row.metadata || {},
  createdBy: userRef(row.createdBy),
  updatedBy: userRef(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
const toAIModelJSON = (row) => ({ id: row.id, ...toAIModelDoc(row) });

const toUseCaseTagDoc = (row) => ({
  key: row.key,
  label: row.label,
  description: row.description,
  icon: row.icon,
  displayOrder: row.displayOrder,
  isActive: row.isActive,
  createdBy: userRef(row.createdBy),
  updatedBy: userRef(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

// ── TierCategory ──────────────────────────────────────────────────────────

const createTierCategory = async (body, actorId) => {
  const created = await prisma.tierCategory.create({
    data: {

      name: body.name,
      slug: slugify(body.slug || body.name),
      description: body.description || '',
      icon: body.icon || '',
      color: body.color || '',
      displayOrder: body.displayOrder || 0,
      isActive: body.isActive !== false,
      createdById: actorId,
      updatedById: actorId,
    },
    include: TIER_CATEGORY_INCLUDE,
  });
  return toTierCategoryJSON(created);
};

const updateTierCategory = async (category, body, actorId) => {
  const nameChanged = body.name && body.name !== category.name;
  const updated = await prisma.tierCategory.update({
    where: { id: category.id },
    data: {
      name: body.name ?? category.name,
      slug: nameChanged ? slugify(body.name) : category.slug,
      description: body.description ?? category.description,
      icon: body.icon ?? category.icon,
      color: body.color ?? category.color,
      displayOrder: body.displayOrder ?? category.displayOrder,
      isActive: body.isActive ?? category.isActive,
      updatedById: actorId,
    },
    include: TIER_CATEGORY_INCLUDE,
  });
  return toTierCategoryJSON(updated);
};

/** Clears (never blocks on) any tier still filed under this category. */
/**
 * Same reasoning as deleteTier: orphaning the category's tiers and removing
 * the category are one change. A failure between them leaves every tier
 * uncategorised while the category it belonged to is still there.
 */
const deleteTierCategory = async (category) => {
  const affected = await prisma.tier.count({ where: { categoryId: category.id } });

  await prisma.$transaction([
    ...(affected
      ? [prisma.tier.updateMany({ where: { categoryId: category.id }, data: { categoryId: null } })]
      : []),
    prisma.tierCategory.delete({ where: { id: category.id } }),
  ]);

  return affected;
};

// ── ResourceComponent ─────────────────────────────────────────────────────

const derivePricePerUnitPerHour = ({ pricePerUnit, pricingPeriod, hoursPerMonth }) => {
  const hours = hoursPerMonth > 0 ? hoursPerMonth : 730;
  const price = pricePerUnit || 0;
  return pricingPeriod === 'month' ? round6(price / hours) : round6(price);
};

const createResourceComponent = async (body, actorId, defaultHoursPerMonth) => {
  const hoursPerMonth = body.hoursPerMonth || defaultHoursPerMonth || 730;
  const pricingPeriod = body.pricingPeriod || 'hour';
  const pricePerUnit = Number(body.pricePerUnit) || 0;

  const created = await prisma.resourceComponent.create({
    data: {

      name: body.name,
      slug: slugify(body.slug || body.name),
      kind: body.kind,
      description: body.description || '',
      unitLabel: body.unitLabel || 'unit',
      pricePerUnit,
      pricingPeriod,
      pricePerUnitPerHour: derivePricePerUnitPerHour({ pricePerUnit, pricingPeriod, hoursPerMonth }),
      hoursPerMonth,
      currency: (body.currency || 'USD').toUpperCase(),
      billedWhileStopped: !!body.billedWhileStopped,
      minQuantity: body.minQuantity ?? 1,
      maxQuantity: body.maxQuantity ?? 0,
      stepQuantity: body.stepQuantity ?? 1,
      specs: body.specs || {},
      availableForCustomBuilds: body.availableForCustomBuilds !== false,
      displayOrder: body.displayOrder || 0,
      isActive: body.isActive !== false,
      createdById: actorId,
      updatedById: actorId,
    },
    include: RESOURCE_COMPONENT_INCLUDE,
  });
  return toResourceComponentJSON(created);
};

const updateResourceComponent = async (component, body, actorId) => {
  const nameChanged = body.name && body.name !== component.name;
  const pricePerUnit = body.pricePerUnit !== undefined ? Number(body.pricePerUnit) : num(component.pricePerUnit);
  const pricingPeriod = body.pricingPeriod ?? component.pricingPeriod;
  const hoursPerMonth = body.hoursPerMonth ?? component.hoursPerMonth;

  const updated = await prisma.resourceComponent.update({
    where: { id: component.id },
    data: {
      name: body.name ?? component.name,
      slug: nameChanged ? slugify(body.name) : component.slug,
      kind: body.kind ?? component.kind,
      description: body.description ?? component.description,
      unitLabel: body.unitLabel ?? component.unitLabel,
      pricePerUnit,
      pricingPeriod,
      pricePerUnitPerHour: derivePricePerUnitPerHour({ pricePerUnit, pricingPeriod, hoursPerMonth }),
      hoursPerMonth,
      currency: body.currency ? body.currency.toUpperCase() : component.currency,
      billedWhileStopped: body.billedWhileStopped ?? component.billedWhileStopped,
      minQuantity: body.minQuantity ?? component.minQuantity,
      maxQuantity: body.maxQuantity ?? component.maxQuantity,
      stepQuantity: body.stepQuantity ?? component.stepQuantity,
      specs: body.specs ?? component.specs,
      availableForCustomBuilds: body.availableForCustomBuilds ?? component.availableForCustomBuilds,
      displayOrder: body.displayOrder ?? component.displayOrder,
      isActive: body.isActive ?? component.isActive,
      updatedById: actorId,
    },
    include: RESOURCE_COMPONENT_INCLUDE,
  });
  return toResourceComponentJSON(updated);
};

const toggleResourceComponent = async (component, actorId) => {
  const updated = await prisma.resourceComponent.update({
    where: { id: component.id },
    data: { isActive: !component.isActive, updatedById: actorId },
    include: RESOURCE_COMPONENT_INCLUDE,
  });
  return toResourceComponentJSON(updated);
};

/** Which tiers use each component right now — for the admin's usage column and delete guard. */
const componentUsage = async () => {
  const rows = await prisma.tierComponent.findMany({
    select: { componentId: true, tier: { select: { name: true } } },
  });
  const map = new Map();
  rows.forEach((r) => {
    const entry = map.get(r.componentId) || { tierCount: 0, tierNames: new Set() };
    entry.tierCount += 1;
    entry.tierNames.add(r.tier.name);
    map.set(r.componentId, entry);
  });
  return map;
};

const deleteResourceComponent = async (component) => {
  const inUse = await prisma.tierComponent.findMany({
    where: { componentId: component.id },
    include: { tier: { select: { name: true } } },
  });
  if (inUse.length) {
    const names = [...new Set(inUse.map((tc) => tc.tier.name))];
    const err = new Error(
      `"${component.name}" is part of ${names.length} tier(s): ${names.join(', ')}. `
      + 'Remove it from those tiers, or disable it instead of deleting.'
    );
    err.tiers = names;
    throw err;
  }
  await prisma.resourceComponent.delete({ where: { id: component.id } });
};

// ── Tier ──────────────────────────────────────────────────────────────────

const componentCreateInputs = (lines) => lines.map((l, i) => ({
  order: i,
  componentId: l.componentDbId,
  kind: l.kind,
  name: l.name,
  slug: l.slug,
  unitLabel: l.unitLabel,
  quantity: l.quantity,
  unitPricePerHour: l.unitPricePerHour,
  billedWhileStopped: l.billedWhileStopped,
  lineTotalPerHour: l.lineTotalPerHour,
  specs: l.specs,
}));

const createTier = async (body, actorId) => {
  const categoryId = body.categoryId ? await resolveTierCategoryId(body.categoryId) : null;

  const { lines, dropped } = Array.isArray(body.components)
    ? await tierPricing.resolveComponents(body.components)
    : { lines: [], dropped: [] };

  const rollup = tierPricing.rollupComponents(lines);
  const pricingMode = body.pricing?.mode || 'flat';
  const pricingFlatPricePerHour = Number(body.pricing?.flatPricePerHour) || 0;
  const pricingFlatStoppedPricePerHour = Number(body.pricing?.flatStoppedPricePerHour) || 0;
  const pricingMarkupPercent = Number(body.pricing?.markupPercent) || 0;

  const { pricePerHour, stoppedPricePerHour } = tierPricing.derivePricing({
    mode: pricingMode,
    flatPricePerHour: pricingFlatPricePerHour,
    flatStoppedPricePerHour: pricingFlatStoppedPricePerHour,
    markupPercent: pricingMarkupPercent,
    componentSubtotalPerHour: rollup.componentSubtotalPerHour,
    componentStoppedSubtotalPerHour: rollup.componentStoppedSubtotalPerHour,
  });

  const created = await prisma.tier.create({
    data: {

      name: body.name,
      slug: slugify(body.slug || body.name),
      description: body.description || '',
      categoryId,
      pricingMode,
      pricingFlatPricePerHour,
      pricingFlatStoppedPricePerHour,
      pricingMarkupPercent,
      pricingComponentSubtotalPerHour: rollup.componentSubtotalPerHour,
      pricingComponentStoppedSubtotalPerHour: rollup.componentStoppedSubtotalPerHour,
      pricePerHour,
      stoppedPricePerHour,
      currency: (body.currency || 'USD').toUpperCase(),
      gpuModel: rollup.specs.gpuModel ?? body.gpuModel ?? '',
      gpuCount: rollup.specs.gpuCount ?? body.gpuCount ?? 0,
      vramGb: rollup.specs.vramGb ?? body.vramGb ?? 0,
      vcpu: rollup.specs.vcpu ?? body.vcpu ?? 0,
      ramGb: rollup.specs.ramGb ?? body.ramGb ?? 0,
      storageGb: rollup.specs.storageGb ?? body.storageGb ?? 0,
      storageType: rollup.specs.storageType ?? body.storageType ?? '',
      networkGbps: rollup.specs.networkGbps ?? body.networkGbps ?? 0,
      regions: body.regions?.length ? body.regions : ['default'],
      capacityTotal: body.capacity?.total || 0,
      capacityAllocated: body.capacity?.allocated || 0,
      status: body.status || 'available',
      displayOrder: body.displayOrder || 0,
      isActive: body.isActive !== false,
      metadata: body.metadata || {},
      createdById: actorId,
      updatedById: actorId,
      components: { create: componentCreateInputs(lines) },
    },
    include: TIER_INCLUDE,
  });

  return { tier: toTierJSON(created), dropped };
};

const updateTier = async (tier, body, actorId) => {
  const oldPrice = num(tier.pricePerHour);
  const oldStopped = num(tier.stoppedPricePerHour);
  const nameChanged = body.name && body.name !== tier.name;

  const categoryId = body.categoryId === '' || body.categoryId === null
    ? null
    : body.categoryId !== undefined
      ? await resolveTierCategoryId(body.categoryId)
      : tier.categoryId;

  let lines = null;
  let dropped = [];
  if (Array.isArray(body.components)) {
    ({ lines, dropped } = await tierPricing.resolveComponents(body.components));
  }
  const usingLines = lines !== null ? lines : tier.components.map((c) => ({
    componentDbId: c.componentId,
    kind: c.kind,
    name: c.name,
    slug: c.slug,
    unitLabel: c.unitLabel,
    quantity: num(c.quantity),
    unitPricePerHour: num(c.unitPricePerHour),
    billedWhileStopped: c.billedWhileStopped,
    lineTotalPerHour: num(c.lineTotalPerHour),
    specs: c.specs || {},
  }));

  const rollup = tierPricing.rollupComponents(usingLines);
  const pricingMode = body.pricing?.mode ?? tier.pricingMode;
  const pricingFlatPricePerHour = body.pricing?.flatPricePerHour !== undefined
    ? Number(body.pricing.flatPricePerHour) : num(tier.pricingFlatPricePerHour);
  const pricingFlatStoppedPricePerHour = body.pricing?.flatStoppedPricePerHour !== undefined
    ? Number(body.pricing.flatStoppedPricePerHour) : num(tier.pricingFlatStoppedPricePerHour);
  const pricingMarkupPercent = body.pricing?.markupPercent !== undefined
    ? Number(body.pricing.markupPercent) : num(tier.pricingMarkupPercent);

  const { pricePerHour, stoppedPricePerHour } = tierPricing.derivePricing({
    mode: pricingMode,
    flatPricePerHour: pricingFlatPricePerHour,
    flatStoppedPricePerHour: pricingFlatStoppedPricePerHour,
    markupPercent: pricingMarkupPercent,
    componentSubtotalPerHour: rollup.componentSubtotalPerHour,
    componentStoppedSubtotalPerHour: rollup.componentStoppedSubtotalPerHour,
  });

  const scalarData = {
    name: body.name ?? tier.name,
    slug: nameChanged ? slugify(body.name) : tier.slug,
    description: body.description ?? tier.description,
    categoryId,
    pricingMode,
    pricingFlatPricePerHour,
    pricingFlatStoppedPricePerHour,
    pricingMarkupPercent,
    pricingComponentSubtotalPerHour: rollup.componentSubtotalPerHour,
    pricingComponentStoppedSubtotalPerHour: rollup.componentStoppedSubtotalPerHour,
    pricePerHour,
    stoppedPricePerHour,
    currency: body.currency ? body.currency.toUpperCase() : tier.currency,
    gpuModel: rollup.specs.gpuModel ?? body.gpuModel ?? tier.gpuModel,
    gpuCount: rollup.specs.gpuCount ?? body.gpuCount ?? tier.gpuCount,
    vramGb: rollup.specs.vramGb ?? body.vramGb ?? tier.vramGb,
    vcpu: rollup.specs.vcpu ?? body.vcpu ?? tier.vcpu,
    ramGb: rollup.specs.ramGb ?? body.ramGb ?? tier.ramGb,
    storageGb: rollup.specs.storageGb ?? body.storageGb ?? tier.storageGb,
    storageType: rollup.specs.storageType ?? body.storageType ?? tier.storageType,
    networkGbps: rollup.specs.networkGbps ?? body.networkGbps ?? tier.networkGbps,
    regions: body.regions ?? tier.regions,
    capacityTotal: body.capacity?.total ?? tier.capacityTotal,
    capacityAllocated: body.capacity?.allocated ?? tier.capacityAllocated,
    status: body.status ?? tier.status,
    displayOrder: body.displayOrder ?? tier.displayOrder,
    isActive: body.isActive ?? tier.isActive,
    metadata: body.metadata ?? tier.metadata,
    updatedById: actorId,
  };

  const updated = await prisma.$transaction(async (tx) => {
    await tx.tierComponent.deleteMany({ where: { tierId: tier.id } });
    return tx.tier.update({
      where: { id: tier.id },
      data: { ...scalarData, components: { create: componentCreateInputs(usingLines) } },
      include: TIER_INCLUDE,
    });
  });


  // Keep the denormalised tier name on model links in sync
  if (nameChanged) {
    await prisma.aIModelSupportedTier.updateMany({ where: { tierId: tier.id }, data: { tierName: updated.name } });
  }

  const priceChanged = num(updated.pricePerHour) !== oldPrice || num(updated.stoppedPricePerHour) !== oldStopped;

  return {
    tier: toTierJSON(updated), dropped, priceChanged, oldPrice, oldStopped,
  };
};

const toggleTier = async (tier, actorId) => {
  const updated = await prisma.tier.update({
    where: { id: tier.id },
    data: { isActive: !tier.isActive, updatedById: actorId },
    include: TIER_INCLUDE,
  });
  return toTierJSON(updated);
};

/** Drops the tier from any model that offered it, then deletes it. */
/**
 * Detaching the tier from every model that offered it, and deleting the tier
 * itself, are one change. Split apart, a failure on the second leaves models
 * that have silently stopped offering a machine which still exists and is
 * still bookable from elsewhere.
 */
const deleteTier = async (tier) => {
  await prisma.$transaction([
    prisma.aIModelSupportedTier.deleteMany({ where: { tierId: tier.id } }),
    prisma.tier.delete({ where: { id: tier.id } }),
  ]);
};

/**
 * Re-read live component prices onto a tier that already has a bill of
 * materials. Only touches tiers priced from components — a flat-priced tier
 * is a number the admin negotiated and typed, and nothing should move it.
 */
const repriceTier = async (tier) => {
  if (tier.pricingMode !== 'components' || !tier.components?.length) return null;

  const componentIds = tier.components.map((c) => c.componentId);
  const fresh = await prisma.resourceComponent.findMany({ where: { id: { in: componentIds } } });
  const byId = new Map(fresh.map((c) => [c.id, c]));

  const lines = tier.components
    .filter((c) => byId.has(c.componentId))
    .map((c) => {
      const component = byId.get(c.componentId);
      const quantity = num(c.quantity);
      const unitPricePerHour = num(component.pricePerUnitPerHour);
      return {
        componentDbId: component.id,
        kind: component.kind,
        name: component.name,
        slug: component.slug,
        unitLabel: component.unitLabel,
        quantity,
        unitPricePerHour,
        billedWhileStopped: !!component.billedWhileStopped,
        lineTotalPerHour: round4(quantity * unitPricePerHour),
        specs: component.specs || {},
      };
    });

  const rollup = tierPricing.rollupComponents(lines);
  const { pricePerHour, stoppedPricePerHour } = tierPricing.derivePricing({
    mode: 'components',
    markupPercent: num(tier.pricingMarkupPercent),
    componentSubtotalPerHour: rollup.componentSubtotalPerHour,
    componentStoppedSubtotalPerHour: rollup.componentStoppedSubtotalPerHour,
  });

  const before = num(tier.pricePerHour);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.tierComponent.deleteMany({ where: { tierId: tier.id } });
    return tx.tier.update({
      where: { id: tier.id },
      data: {
        pricingComponentSubtotalPerHour: rollup.componentSubtotalPerHour,
        pricingComponentStoppedSubtotalPerHour: rollup.componentStoppedSubtotalPerHour,
        pricePerHour,
        stoppedPricePerHour,
        gpuModel: rollup.specs.gpuModel ?? tier.gpuModel,
        gpuCount: rollup.specs.gpuCount ?? tier.gpuCount,
        vramGb: rollup.specs.vramGb ?? tier.vramGb,
        vcpu: rollup.specs.vcpu ?? tier.vcpu,
        ramGb: rollup.specs.ramGb ?? tier.ramGb,
        storageGb: rollup.specs.storageGb ?? tier.storageGb,
        storageType: rollup.specs.storageType ?? tier.storageType,
        networkGbps: rollup.specs.networkGbps ?? tier.networkGbps,
        components: { create: componentCreateInputs(lines) },
      },
      include: TIER_INCLUDE,
    });
  });

  return { tier: updated, before, after: num(updated.pricePerHour) };
};

/** Reprice every component-priced tier that uses this component (by its Postgres id). */
const repriceTiersUsingComponent = async (componentDbId) => {
  const tiers = await prisma.tier.findMany({
    where: { pricingMode: 'components', components: { some: { componentId: componentDbId } } },
    include: TIER_INCLUDE,
  });

  const changed = [];
  for (const tier of tiers) {
    try {
      const result = await repriceTier(tier);
      if (result && result.before !== result.after) {
        changed.push({
          tierId: tier.id, name: tier.name, before: result.before, after: result.after,
        });
      }
    } catch (err) {
      console.error(`[catalogService] Failed to reprice "${tier.name}":`, err.message);
    }
  }

  return { repriced: tiers.length, changed };
};

/**
 * Keep `Tier.capacity.allocated` in step as deployments come and go. Called
 * from `services/deployment/deploymentService.js` (the one write into this
 * domain from outside it) — Postgres is the source of truth for a tier's
 * stock, so this writes there first and mirrors the result, the same as
 * every other write in this file.
 */
const adjustTierAllocation = async (legacyTierId, delta) => {
  if (!legacyTierId) return;
  try {
    const tier = await prisma.tier.findUnique({ where: byPublicId(legacyTierId) });
    if (!tier) return;

    const capacityAllocated = Math.max(0, (tier.capacityAllocated || 0) + delta);
    let status = tier.status;
    if (tier.capacityTotal > 0) {
      const remaining = tier.capacityTotal - capacityAllocated;
      status = remaining <= 0 ? 'out_of_stock' : remaining <= 2 ? 'limited' : 'available';
    }

    await prisma.tier.update({
      where: { id: tier.id },
      data: { capacityAllocated, status },
      include: TIER_INCLUDE,
    });
  } catch (err) {
    console.error('[catalogService] Failed to adjust tier allocation:', err.message);
  }
};

// ── AIModel ───────────────────────────────────────────────────────────────

const resolveSupportedTiers = async (links = []) => {
  const ids = links.filter((l) => l && l.tierId).map((l) => String(l.tierId));
  if (!ids.length) return [];
  const tiers = await prisma.tier.findMany({ where: byPublicIds(ids) });
  const byId = mapByPublicId(tiers);
  return links
    .filter((l) => l && l.tierId && byId.has(String(l.tierId)))
    .map((l) => {
      const tier = byId.get(String(l.tierId));
      return {
        tierDbId: tier.id,
        tierName: tier.name,
        recommended: !!l.recommended,
        priceMultiplier: l.priceMultiplier == null ? 1 : Number(l.priceMultiplier),
        notes: l.notes || '',
      };
    });
};

const supportedTierCreateInputs = (links) => links.map((l, i) => ({
  order: i,
  tierId: l.tierDbId,
  tierName: l.tierName,
  recommended: l.recommended,
  priceMultiplier: l.priceMultiplier,
  notes: l.notes,
}));

const useCaseCreateInputs = (useCases) => useCases.map((uc, i) => ({
  order: i,
  key: String(uc.key).toLowerCase().trim(),
  label: uc.label || '',
  fit: uc.fit || 'good',
  note: uc.note || '',
}));

const createAIModel = async (body, actorId) => {
  const supportedTiers = Array.isArray(body.supportedTiers) ? await resolveSupportedTiers(body.supportedTiers) : [];
  const useCases = Array.isArray(body.useCases) ? body.useCases : [];

  const created = await prisma.aIModel.create({
    data: {

      name: body.name,
      slug: slugify(body.slug || body.name),
      family: body.family || 'custom',
      version: body.version || '',
      shortDescription: body.shortDescription || '',
      description: body.description || '',
      logoUrl: body.logoUrl || '',
      docsUrl: body.docsUrl || '',
      huggingFaceId: body.huggingFaceId || '',
      license: body.license || '',
      modalities: body.modalities?.length ? body.modalities : ['chat'],
      parameterSize: body.parameterSize || '',
      contextLength: body.contextLength || 0,
      minVramGb: body.minVramGb || 0,
      strengths: body.strengths || [],
      limitations: body.limitations || [],
      status: body.status || 'available',
      category: body.category || 'General',
      tags: body.tags || [],
      displayOrder: body.displayOrder || 0,
      isActive: body.isActive !== false,
      isFeatured: !!body.isFeatured,
      metadata: body.metadata || {},
      createdById: actorId,
      updatedById: actorId,
      supportedTiers: { create: supportedTierCreateInputs(supportedTiers) },
      useCases: { create: useCaseCreateInputs(useCases) },
    },
    include: AIMODEL_INCLUDE,
  });

  return toAIModelJSON(created);
};

const updateAIModel = async (model, body, actorId) => {
  const supportedTiers = Array.isArray(body.supportedTiers) ? await resolveSupportedTiers(body.supportedTiers) : null;
  const useCases = Array.isArray(body.useCases) ? body.useCases : null;
  const nameChanged = body.name && body.name !== model.name;

  const scalarData = {
    name: body.name ?? model.name,
    slug: nameChanged ? slugify(body.name) : model.slug,
    family: body.family ?? model.family,
    version: body.version ?? model.version,
    shortDescription: body.shortDescription ?? model.shortDescription,
    description: body.description ?? model.description,
    logoUrl: body.logoUrl ?? model.logoUrl,
    docsUrl: body.docsUrl ?? model.docsUrl,
    huggingFaceId: body.huggingFaceId ?? model.huggingFaceId,
    license: body.license ?? model.license,
    modalities: body.modalities ?? model.modalities,
    parameterSize: body.parameterSize ?? model.parameterSize,
    contextLength: body.contextLength ?? model.contextLength,
    minVramGb: body.minVramGb ?? model.minVramGb,
    strengths: body.strengths ?? model.strengths,
    limitations: body.limitations ?? model.limitations,
    status: body.status ?? model.status,
    category: body.category ?? model.category,
    tags: body.tags ?? model.tags,
    displayOrder: body.displayOrder ?? model.displayOrder,
    isActive: body.isActive ?? model.isActive,
    isFeatured: body.isFeatured ?? model.isFeatured,
    metadata: body.metadata ?? model.metadata,
    updatedById: actorId,
  };

  const updated = await prisma.$transaction(async (tx) => {
    if (supportedTiers !== null) await tx.aIModelSupportedTier.deleteMany({ where: { aiModelId: model.id } });
    if (useCases !== null) await tx.aIModelUseCase.deleteMany({ where: { aiModelId: model.id } });

    return tx.aIModel.update({
      where: { id: model.id },
      data: {
        ...scalarData,
        ...(supportedTiers !== null ? { supportedTiers: { create: supportedTierCreateInputs(supportedTiers) } } : {}),
        ...(useCases !== null ? { useCases: { create: useCaseCreateInputs(useCases) } } : {}),
      },
      include: AIMODEL_INCLUDE,
    });
  });

  return toAIModelJSON(updated);
};

const toggleAIModel = async (model, actorId) => {
  const updated = await prisma.aIModel.update({
    where: { id: model.id },
    data: { isActive: !model.isActive, updatedById: actorId },
    include: AIMODEL_INCLUDE,
  });
  return toAIModelJSON(updated);
};

/** Child rows (supportedTiers/useCases) cascade-delete with the model. */
const deleteAIModel = async (model) => {
  await prisma.aIModel.delete({ where: { id: model.id } });
};

// ── Pure pricing/availability helpers — ported from the original
// instance methods (`model.rateForTier(tier)`, `tier.isBookable()`), now
// plain functions since a catalog "record" is a Prisma-shaped plain object,
// not a document with methods attached. Operate on the JSON shape
// `toAIModelJSON`/`toTierJSON` produce. ────────────────────────────────────

/** The hourly rate a model+tier combination bills at, or null if unsupported. */
const rateForTier = (model, tier) => {
  if (!tier) return null;
  const link = (model.supportedTiers || []).find((t) => t.tierId === tier.id);
  if (!link) return null;
  const multiplier = link.priceMultiplier == null ? 1 : link.priceMultiplier;
  return Math.round(tier.pricePerHour * multiplier * 10000) / 10000;
};

/** The storage-only rate while paused/stopped, for a model+tier combination. */
const stoppedRateForTier = (model, tier) => {
  if (!tier) return null;
  const link = (model.supportedTiers || []).find((t) => t.tierId === tier.id);
  if (!link) return null;
  const multiplier = link.priceMultiplier == null ? 1 : link.priceMultiplier;
  return Math.round((tier.stoppedPricePerHour || 0) * multiplier * 10000) / 10000;
};

/** Remaining capacity on a tier (null = untracked/unlimited). */
const availableUnits = (tier) => {
  if (!tier.capacity || !tier.capacity.total) return null;
  return Math.max(0, tier.capacity.total - (tier.capacity.allocated || 0));
};

/** Can a customer actually book this tier right now? */
const isBookable = (tier) => {
  if (!tier.isActive || tier.status === 'out_of_stock') return false;
  const available = availableUnits(tier);
  return available === null || available > 0;
};

// ── Read-only catalog queries — customer/public catalog + the recommendation engine ──

/** Active tier categories, for building an id→category display map. */
const listActiveTierCategories = async () => {
  const rows = await prisma.tierCategory.findMany({ where: { isActive: true }, include: TIER_CATEGORY_INCLUDE });
  return rows.map(toTierCategoryJSON);
};

/** Active, non-deprecated models — the customer/public catalog list. */
const listActiveModels = async ({ family, modality, search } = {}) => {
  const where = { isActive: true, status: { not: 'deprecated' } };
  if (family) where.family = family;
  if (modality) where.modalities = { has: modality };
  if (search) where.name = { contains: search, mode: 'insensitive' };

  const rows = await prisma.aIModel.findMany({
    where, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }], include: AIMODEL_INCLUDE,
  });
  return rows.map(toAIModelJSON);
};

/** One active model by slug — the customer/public catalog detail page. */
const findActiveModelBySlug = async (slug) => {
  const row = await prisma.aIModel.findFirst({ where: { slug, isActive: true }, include: AIMODEL_INCLUDE });
  return row ? toAIModelJSON(row) : null;
};

/** Active tiers, optionally sorted by price — the customer/public catalog. */
const listActiveTiers = async ({ orderByPrice = false } = {}) => {
  const orderBy = orderByPrice ? [{ displayOrder: 'asc' }, { pricePerHour: 'asc' }] : { displayOrder: 'asc' };
  const rows = await prisma.tier.findMany({ where: { isActive: true }, orderBy, include: TIER_INCLUDE });
  return rows.map(toTierJSON);
};

/**
 * Which models run on each machine — the reverse of `AIModel.supportedTiers`.
 *
 * The join is owned by the model and every existing caller reads it in that
 * direction ("what can this model run on"). The machine catalogue asks the
 * opposite question, and nothing has ever asked it: `Tier.supportedByModels`
 * has existed in the schema unused. The `@@index([tierId])` it needs is
 * already there.
 *
 * One query for the whole catalogue, returned as a Map the caller indexes by
 * tier id — the alternative is a query per machine, which is a page load that
 * gets slower every time an admin adds hardware.
 *
 * Inactive and deprecated models are excluded so a machine never links to
 * something the model catalogue itself will not list.
 *
 * Ordered admin picks first, then by the model catalogue's own ordering.
 * Deliberately NOT by the join row's `order`: that is the model's index of its
 * own tier list, so two models can both be `order: 0` on the same machine and
 * the result would vary between requests.
 *
 * @param {string[]|null} tierIds  restrict to these tiers; null = every tier
 * @returns {Promise<Map<string, object[]>>}
 */
const listModelsByTier = async (tierIds = null) => {
  const ids = tierIds ? tierIds.filter(isPublicId) : null;
  if (ids && ids.length === 0) return new Map();

  const rows = await prisma.aIModelSupportedTier.findMany({
    where: {
      ...(ids ? { tierId: { in: ids } } : {}),
      aiModel: { isActive: true, status: { not: 'deprecated' } },
    },
    orderBy: [
      { recommended: 'desc' },
      { aiModel: { displayOrder: 'asc' } },
      { aiModel: { name: 'asc' } },
    ],
    select: {
      tierId: true,
      recommended: true,
      priceMultiplier: true,
      notes: true,
      aiModel: {
        select: {
          id: true,
          name: true,
          slug: true,
          family: true,
          status: true,
          minVramGb: true,
          shortDescription: true,
        },
      },
    },
  });

  const byTier = new Map();
  for (const row of rows) {
    const list = byTier.get(row.tierId) || [];
    list.push({
      id: row.aiModel.id,
      name: row.aiModel.name,
      slug: row.aiModel.slug,
      family: row.aiModel.family,
      status: row.aiModel.status,
      minVramGb: num(row.aiModel.minVramGb),
      shortDescription: row.aiModel.shortDescription,
      recommended: row.recommended,
      priceMultiplier: row.priceMultiplier == null ? 1 : num(row.priceMultiplier),
      notes: row.notes,
    });
    byTier.set(row.tierId, list);
  }
  return byTier;
};

/** Active use-case tags, for the public "what can you build" section. */
const listActiveUseCaseTags = async () => {
  const rows = await prisma.useCaseTag.findMany({ where: { isActive: true }, orderBy: [{ displayOrder: 'asc' }, { label: 'asc' }] });
  return rows.map(toUseCaseTagDoc).map((doc, i) => ({ id: rows[i].id, ...doc }));
};

/** Load a model by its legacy public id or its slug, whichever the caller has. */
const findModelByIdentifier = async (identifier) => {
  if (!identifier) return null;
  const row = isPublicId(identifier)
    ? await prisma.aIModel.findUnique({ where: byPublicId(identifier), include: AIMODEL_INCLUDE })
    : await prisma.aIModel.findUnique({ where: { slug: identifier }, include: AIMODEL_INCLUDE });
  return row ? toAIModelJSON(row) : null;
};

/** Load a tier by its id or its slug, whichever the caller has. */
const findTierByIdentifier = async (identifier) => {
  if (!identifier) return null;
  const row = isPublicId(identifier)
    ? await prisma.tier.findUnique({ where: byPublicId(identifier), include: TIER_INCLUDE })
    : await prisma.tier.findUnique({ where: { slug: identifier }, include: TIER_INCLUDE });
  return row ? toTierJSON(row) : null;
};

/** Load a tier category by its legacy public id. */
const findTierCategoryById = async (id) => {
  if (!id) return null;
  const row = await prisma.tierCategory.findUnique({ where: byPublicId(id) });
  return row ? toTierCategoryJSON(row) : null;
};

const reorderAIModels = async (order, actorId) => {
  await Promise.all(order.map((item) => prisma.aIModel.update({
    where: byPublicId(item.id),
    data: { displayOrder: item.displayOrder, updatedById: actorId },
  })));
};

module.exports = {
  COMPONENT_KINDS,
  TIER_CATEGORY_INCLUDE,
  RESOURCE_COMPONENT_INCLUDE,
  TIER_INCLUDE,
  AIMODEL_INCLUDE,
  slugify,
  resolveTierCategoryId,
  resolveTierDbId,
  toTierCategoryJSON,
  toResourceComponentJSON,
  toTierJSON,
  toAIModelJSON,
  toUseCaseTagDoc,
  createTierCategory,
  updateTierCategory,
  deleteTierCategory,
  createResourceComponent,
  updateResourceComponent,
  toggleResourceComponent,
  deleteResourceComponent,
  componentUsage,
  createTier,
  updateTier,
  toggleTier,
  deleteTier,
  repriceTier,
  repriceTiersUsingComponent,
  adjustTierAllocation,
  createAIModel,
  updateAIModel,
  toggleAIModel,
  deleteAIModel,
  reorderAIModels,
  findModelByIdentifier,
  listActiveTierCategories,
  listActiveModels,
  findActiveModelBySlug,
  listActiveTiers,
  listModelsByTier,
  listActiveUseCaseTags,
  rateForTier,
  stoppedRateForTier,
  availableUnits,
  isBookable,
  findTierByIdentifier,
  findTierCategoryById,
};
