/**
 * DeploymentJourney — read-only in the running app today (no admin write
 * route exists yet, only the one-time `seedDeploymentJourney.js` script), so
 * this file only owns what `journeyService.js` actually needs: resolving the
 * active journey for a mode. Ported to Prisma as part of Phase 6's final
 * journeys, which `journeyService.js` reads when building a deploy flow
 * away.
 */
const prisma = require('../../lib/prismaClient');

const STEP_INCLUDE = { steps: { orderBy: { order: 'asc' } } };

const toStepDoc = (s) => ({

  key: s.key,
  type: s.type,
  title: s.title,
  subtitle: s.subtitle,
  body: s.body,
  ctaLabel: s.ctaLabel,
  icon: s.icon,
  image: s.image,
  questionKeys: s.questionKeys || [],
  dependsOn: { questionKey: s.dependsOnQuestionKey, equals: s.dependsOnEquals },
  settings: s.settings || {},
  skippable: s.skippable,
  displayOrder: s.displayOrder,
  isActive: s.isActive,
});

const toJourneyDoc = (row) => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description,
  mode: row.mode,
  steps: (row.steps || []).map(toStepDoc),
  settings: {
    autoAdvance: row.settingsAutoAdvance,
    autoAdvanceDelayMs: row.settingsAutoAdvanceDelayMs,
    showLiveSizing: row.settingsShowLiveSizing,
    showProgressBar: row.settingsShowProgressBar,
    allowBack: row.settingsAllowBack,
    showEstimatedCost: row.settingsShowEstimatedCost,
    allowManualTierOverride: row.settingsAllowManualTierOverride,
    modelMatchLimit: row.settingsModelMatchLimit,
    requireAllRequired: row.settingsRequireAllRequired,
    completionMessage: row.settingsCompletionMessage,
  },
  isDefault: row.isDefault,
  isActive: row.isActive,
  displayOrder: row.displayOrder,
});

/** The journey to use for a mode: the default one, else the first active one. */
const getActive = async (mode) => {
  const where = { isActive: true, ...(mode ? { mode } : {}) };

  const preferred = await prisma.deploymentJourney.findFirst({ where: { ...where, isDefault: true }, include: STEP_INCLUDE });
  if (preferred) return toJourneyDoc(preferred);

  const row = await prisma.deploymentJourney.findFirst({ where, orderBy: { displayOrder: 'asc' }, include: STEP_INCLUDE });
  return row ? toJourneyDoc(row) : null;
};

module.exports = { getActive, toJourneyDoc };
