/**
 * Question Templates — the deployment-wizard questionnaire, editable from the
 * admin center. Ported to Prisma as part of the Admin domain.
 *
 * The read side (`QuestionTemplate.getForModel`/`.scopeToModel`, used by
 * `journeyService.js`, the recommendation engine, and
 * `deploymentController.js`) reads through this file
 * only owns the write side, `routes/v1/admin/questions.routes.js`.
 *
 * `affectsSizing` must stay DERIVED, never trusted from the client — the old
 * save hook recomputed it from whatever signals were
 * actually present on `options[]`/`signalRules[]`; reproduced here as a pure
 * function applied on every write.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicId, byPublicIds } = require('../../utils/helpers/publicId');



/** Does this signal set actually say anything? `note` alone doesn't count. */
const hasAnySignal = (signals) => {
  if (!signals) return false;
  return Object.entries(signals).some(([key, value]) => {
    if (key === 'note') return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== '';
  });
};

const deriveAffectsSizing = (options = [], signalRules = []) =>
  (options || []).some((o) => hasAnySignal(o.signals))
  || (signalRules || []).some((r) => hasAnySignal(r.signals));

const toDoc = (row, ctx) => ({
  id: row.id,
  key: row.key,
  question: row.question,
  helpText: row.helpText,
  placeholder: row.placeholder,
  type: row.type,
  options: row.options || [],
  signalRules: row.signalRules || [],
  affectsSizing: row.affectsSizing,
  required: row.required,
  defaultValue: row.defaultValue,
  appliesTo: {
    allModels: row.appliesToAllModels,
    modelIds: row.appliesToModelIds || [],
    modalities: row.appliesToModalities || [],
  },
  dependsOn: {
    questionKey: row.dependsOnQuestionKey,
    equals: row.dependsOnEquals,
  },
  displayOrder: row.displayOrder,
  isActive: row.isActive,
  createdBy: ctx?.createdById ?? null,
  updatedBy: ctx?.updatedById ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const INCLUDE = { createdBy: { select: { id: true } }, updatedBy: { select: { id: true } } };
const wrap = (row) => toDoc(row, {
  createdById: row.createdBy?.id || null,
  updatedById: row.updatedBy?.id || null,
});

/** Admin list — includes the "populate appliesTo.modelIds" display info the old route attached. */
const list = async () => {
  const rows = await prisma.questionTemplate.findMany({ orderBy: { displayOrder: 'asc' }, include: INCLUDE });
  const allModelIds = [...new Set(rows.flatMap((r) => r.appliesToModelIds || []))];
  const models = allModelIds.length
    ? await prisma.aIModel.findMany({ where: byPublicIds(allModelIds), select: { id: true, name: true, slug: true } })
    : [];
  const modelById = new Map(models.map((m) => [m.id, { id: m.id, name: m.name, slug: m.slug }]));

  return rows.map((row) => {
    const doc = wrap(row);
    doc.appliesTo.modelIds = doc.appliesTo.modelIds.map((id) => modelById.get(id) || id);
    return doc;
  });
};

const findById = async (id) => {
  const row = await prisma.questionTemplate.findUnique({ where: byPublicId(id), include: INCLUDE });
  return row ? wrap(row) : null;
};

const create = async (fields) => {
  const {
    key, question, helpText, placeholder, type, options, signalRules, required, defaultValue,
    appliesTo, dependsOn, displayOrder, isActive, createdBy,
  } = fields;

  if (!key || !/^[a-z][a-z0-9_]*$/.test(key)) {
    const err = new Error('Key must start with a letter and contain only lowercase letters, numbers and underscores');
    err.status = 400;
    throw err;
  }

  const existing = await prisma.questionTemplate.findUnique({ where: { key } });
  if (existing) {
    const err = new Error('A question with that key already exists');
    err.status = 400;
    throw err;
  }

  const createdByPg = createdBy ? await prisma.user.findUnique({ where: byPublicId(createdBy), select: { id: true } }) : null;
  const row = await prisma.questionTemplate.create({
    data: {

      key,
      question,
      helpText: helpText || '',
      placeholder: placeholder || '',
      type: type || 'select',
      options: options || [],
      signalRules: signalRules || [],
      affectsSizing: deriveAffectsSizing(options, signalRules),
      required: !!required,
      defaultValue: defaultValue ?? null,
      appliesToAllModels: appliesTo?.allModels !== false,
      appliesToModelIds: appliesTo?.modelIds || [],
      appliesToModalities: appliesTo?.modalities || [],
      dependsOnQuestionKey: dependsOn?.questionKey || '',
      dependsOnEquals: dependsOn?.equals ?? null,
      displayOrder: displayOrder || 0,
      isActive: isActive !== false,
      createdById: createdByPg?.id || null,
      updatedById: createdByPg?.id || null,
    },
    include: INCLUDE,
  });

  const doc = wrap(row);
  return doc;
};

/**
 * The key can never change once answers reference it (same guard the old
 * route enforced) — `updates.key` is simply never applied.
 */
const update = async (id, updates, updatedBy) => {
  const existing = await prisma.questionTemplate.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  const {
    question, helpText, placeholder, type, options, signalRules, required, defaultValue,
    appliesTo, dependsOn, displayOrder, isActive,
  } = updates;

  const nextOptions = options !== undefined ? options : existing.options;
  const nextSignalRules = signalRules !== undefined ? signalRules : existing.signalRules;

  const data = {};
  if (question !== undefined) data.question = question;
  if (helpText !== undefined) data.helpText = helpText;
  if (placeholder !== undefined) data.placeholder = placeholder;
  if (type !== undefined) data.type = type;
  if (options !== undefined) data.options = options;
  if (signalRules !== undefined) data.signalRules = signalRules;
  if (required !== undefined) data.required = required;
  if (defaultValue !== undefined) data.defaultValue = defaultValue;
  if (appliesTo !== undefined) {
    if (appliesTo.allModels !== undefined) data.appliesToAllModels = appliesTo.allModels;
    if (appliesTo.modelIds !== undefined) data.appliesToModelIds = appliesTo.modelIds;
    if (appliesTo.modalities !== undefined) data.appliesToModalities = appliesTo.modalities;
  }
  if (dependsOn !== undefined) {
    if (dependsOn.questionKey !== undefined) data.dependsOnQuestionKey = dependsOn.questionKey;
    if (dependsOn.equals !== undefined) data.dependsOnEquals = dependsOn.equals;
  }
  if (displayOrder !== undefined) data.displayOrder = displayOrder;
  if (isActive !== undefined) data.isActive = isActive;
  data.affectsSizing = deriveAffectsSizing(nextOptions, nextSignalRules);

  if (updatedBy) {
    const updatedByPg = await prisma.user.findUnique({ where: byPublicId(updatedBy), select: { id: true } });
    data.updatedById = updatedByPg?.id || null;
  }

  const row = await prisma.questionTemplate.update({ where: { id: existing.id }, data, include: INCLUDE });
  const doc = wrap(row);
  return doc;
};

/** `order`: [{ id (legacy), displayOrder }] */
const reorder = async (order) => {
  await Promise.all(order.map((item) => prisma.questionTemplate.updateMany({
    where: byPublicId(item.id),
    data: { displayOrder: item.displayOrder },
  })));
};

const deleteOne = async (id) => {
  const existing = await prisma.questionTemplate.findUnique({ where: byPublicId(id) });
  if (!existing) return null;

  await prisma.questionTemplate.delete({ where: { id: existing.id } });
  return existing;
};

/**
 * Filter an already-loaded question list down to those that apply to a model
 * — global ones plus any scoped to this model's id or one of its modalities.
 * Pure, so callers holding a cached question list (the recommendation engine)
 * can scope without a second query. Ported from the original
 * static of the same name.
 */
const scopeToModel = (questions, model) => {
  if (!model) return questions.filter((q) => q.appliesTo?.allModels !== false);

  const modelId = String(model.id);
  const modalities = model.modalities || [];

  return questions.filter((q) => {
    const scope = q.appliesTo || {};
    if (scope.allModels !== false) return true;
    if ((scope.modelIds || []).some((id) => String(id) === modelId)) return true;
    if ((scope.modalities || []).some((m) => modalities.includes(m))) return true;
    return false;
  });
};

/** Every active question, unscoped — catalogCache's raw pool for the recommendation engine. */
const listActive = async () => {
  const rows = await prisma.questionTemplate.findMany({ where: { isActive: true }, orderBy: { displayOrder: 'asc' }, include: INCLUDE });
  return rows.map(wrap);
};

/** Questions that apply to a given model, read fresh from the database. */
const getForModel = async (model) => {
  const rows = await prisma.questionTemplate.findMany({
    where: { isActive: true }, orderBy: { displayOrder: 'asc' }, include: INCLUDE,
  });
  return scopeToModel(rows.map(wrap), model);
};

module.exports = {
  list, findById, create, update, reorder, deleteOne, scopeToModel, getForModel, listActive,
};
