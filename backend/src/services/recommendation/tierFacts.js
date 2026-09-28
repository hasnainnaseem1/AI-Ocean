/**
 * Lean-safe copies of the Tier instance methods.
 *
 * Tiers are read with `.lean()` everywhere in this codebase, so
 * `tier.isBookable()` and `tier.availableUnits()` do not exist on the objects
 * the engine actually receives. Hydrating full records in a path
 * that runs on every keystroke of the deploy journey would be the wrong trade,
 * so the logic is mirrored here instead.
 *
 * These MUST stay in step with `models/catalog/Tier.js`.
 */

/** Remaining units, or null when capacity is untracked (total === 0 = unlimited). */
const availableUnits = (tier) => {
  if (!tier || !tier.capacity || !tier.capacity.total) return null;
  return Math.max(0, tier.capacity.total - (tier.capacity.allocated || 0));
};

const isBookable = (tier) => {
  if (!tier || !tier.isActive || tier.status === 'out_of_stock') return false;
  const available = availableUnits(tier);
  return available === null || available > 0;
};

/**
 * Total VRAM across the whole tier. Not a stored field — `vramGb` is per
 * accelerator, and the existing catalog controller computes this the same way.
 *
 * A machine with no accelerators (a CPU- or memory-optimised tier) reports
 * zero. `gpuCount == null` is treated as one rather than none so a tier saved
 * before the field existed still sizes correctly.
 */
const totalVram = (tier) => {
  if (!tier) return 0;
  const count = tier.gpuCount == null ? 1 : tier.gpuCount;
  return (tier.vramGb || 0) * count;
};

module.exports = { availableUnits, isBookable, totalVram };
