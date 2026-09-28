/**
 * Tier Pricing
 *
 * Turns a list of `{ componentId, quantity }` picks into priced bill-of-material
 * lines, and holds the pure rollup math that derives a tier price
 * for us (Prisma has no such hook). Read-only against the database — the only
 * write path for prices lives in `catalogService.js`, which calls into this
 * file for the arithmetic and persists the result.
 *
 * `componentId` everywhere in this file's public surface (`resolveComponents`
 * picks, `quote()`'s returned lines) is the row's `id` — the same id every
 * API response uses for a
 * ResourceComponent. Each resolved line also carries an internal
 * `componentDbId` (the real Postgres uuid), needed only to build the nested
 * `TierComponent` writes in `catalogService.js` — callers that hand a `quote`
 * straight back to the API strip it first.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicIds, mapByPublicId } = require('../../utils/helpers/publicId');

const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/**
 * Resolve the admin's picks into priced lines.
 *
 * Unknown or inactive components are dropped rather than throwing: a tier
 * whose disk was deleted should still save and still be visible, just
 * missing that line, and the caller gets the list of what went missing so
 * the admin can be told.
 *
 * @param {Array<{componentId: string, quantity: number}>} picks
 * @returns {Promise<{lines: Array, dropped: Array<string>}>}
 */
const resolveComponents = async (picks = []) => {
  const wanted = (picks || []).filter((p) => p && p.componentId);
  if (!wanted.length) return { lines: [], dropped: [] };

  const ids = wanted.map((p) => String(p.componentId));
  const components = await prisma.resourceComponent.findMany({ where: byPublicIds(ids) });
  const byId = mapByPublicId(components);

  const lines = [];
  const dropped = [];

  wanted.forEach((pick) => {
    const component = byId.get(String(pick.componentId));
    if (!component) {
      dropped.push(String(pick.componentId));
      return;
    }

    const quantity = Math.max(0, Number(pick.quantity) || 0);
    const unitPricePerHour = Number(component.pricePerUnitPerHour) || 0;

    lines.push({
      componentId: component.id,
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
    });
  });

  return { lines, dropped };
};

/**
 * What a set of picks would cost, without saving anything.
 *
 * Powers the live total in the admin's tier builder and, later, the
 * customer's own custom-machine builder — both need the same arithmetic, and
 * neither should be reimplementing it in the browser where it could drift
 * from what we actually bill.
 */
const quote = async (picks = [], markupPercent = 0) => {
  const { lines, dropped } = await resolveComponents(picks);

  const subtotalPerHour = round4(lines.reduce((n, l) => n + l.lineTotalPerHour, 0));
  const stoppedSubtotalPerHour = round4(
    lines.filter((l) => l.billedWhileStopped).reduce((n, l) => n + l.lineTotalPerHour, 0)
  );

  const markup = 1 + (Number(markupPercent) || 0) / 100;

  return {
    lines: lines.map(({ componentDbId, ...rest }) => rest),
    dropped,
    subtotalPerHour,
    stoppedSubtotalPerHour,
    markupPercent: Number(markupPercent) || 0,
    pricePerHour: round4(subtotalPerHour * markup),
    stoppedPricePerHour: round4(stoppedSubtotalPerHour * markup),
  };
};

/**
 * Roll a resolved bill of materials up into subtotal figures and derived
 * hardware-spec overrides — the Postgres equivalent of `Tier.js`'s old
 * `applyComponents` pre-save hook.
 *
 * `specs` only carries a key for a kind that is actually present among
 * `lines`, so a caller merges it over the tier's existing/hand-typed values
 * rather than blindly overwriting them — exactly how a flat-priced tier used
 * to keep whatever the admin typed by hand.
 */
const rollupComponents = (lines = []) => {
  let subtotal = 0;
  let stoppedSubtotal = 0;
  const byKind = {};

  lines.forEach((line) => {
    subtotal += line.lineTotalPerHour;
    if (line.billedWhileStopped) stoppedSubtotal += line.lineTotalPerHour;
    (byKind[line.kind] = byKind[line.kind] || []).push(line);
  });

  const sum = (kind) => byKind[kind].reduce((n, l) => n + (l.quantity || 0), 0);
  const specs = {};

  if (byKind.gpu) {
    specs.gpuCount = sum('gpu');
    // Per-accelerator VRAM: the largest card in the machine.
    specs.vramGb = byKind.gpu.reduce((n, l) => Math.max(n, Number(l.specs?.vramGb) || 0), 0);
    specs.gpuModel = byKind.gpu[0].specs?.model || byKind.gpu[0].name || '';
  }
  if (byKind.cpu) specs.vcpu = sum('cpu');
  if (byKind.memory) specs.ramGb = sum('memory');
  if (byKind.storage) {
    specs.storageGb = sum('storage');
    specs.storageType = byKind.storage[0].name || '';
  }
  if (byKind.network) specs.networkGbps = sum('network');

  return {
    componentSubtotalPerHour: round4(subtotal),
    componentStoppedSubtotalPerHour: round4(stoppedSubtotal),
    specs,
  };
};

/** Final running/stopped rates for whichever pricing mode is in force. */
const derivePricing = ({
  mode, flatPricePerHour, flatStoppedPricePerHour, markupPercent,
  componentSubtotalPerHour, componentStoppedSubtotalPerHour,
}) => {
  if (mode === 'components') {
    const markup = 1 + (markupPercent || 0) / 100;
    return {
      pricePerHour: round4(componentSubtotalPerHour * markup),
      stoppedPricePerHour: round4(componentStoppedSubtotalPerHour * markup),
    };
  }
  return {
    pricePerHour: round4(flatPricePerHour || 0),
    stoppedPricePerHour: round4(flatStoppedPricePerHour || 0),
  };
};

/**
 * Warnings about a configuration that would give away compute or storage for
 * free — never blocks saving, but surfaced (both live in the price-preview
 * while an admin is still building the tier, and again on the saved result)
 * so it is seen and confirmed deliberately rather than discovered from a
 * customer's bill.
 */
const computeFreeComputeWarnings = ({ pricePerHour, stoppedPricePerHour, storageGb }) => {
  const warnings = [];

  if (pricePerHour <= 0) {
    warnings.push({
      code: 'FREE_COMPUTE',
      message:
        'This tier has no running price at all — a deployment on it would be completely free while it runs.',
    });
  }

  if (stoppedPricePerHour <= 0 && (storageGb || 0) > 0) {
    warnings.push({
      code: 'FREE_STORAGE_WHILE_STOPPED',
      message:
        `This tier holds ${storageGb} GB of storage but charges nothing while paused or stopped `
        + '— that disk would be held for free indefinitely once a customer pauses.',
    });
  }

  return warnings;
};

module.exports = {
  resolveComponents,
  quote,
  rollupComponents,
  derivePricing,
  computeFreeComputeWarnings,
};
