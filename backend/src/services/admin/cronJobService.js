/**
 * Custom Cron Jobs — admin-created scheduled tasks (system/built-in jobs are
 * never stored here, only in the in-memory job registry — see jobs/index.js).
 * Each per-action-type config sub-object
 * (`httpConfig`, `emailConfig`, `cleanupConfig`, `notificationConfig`,
 * `backupConfig`) flattens onto its own columns per the schema's design.
 */
const prisma = require('../../lib/prismaClient');
const { byPublicId } = require('../../utils/helpers/publicId');



const toDoc = (row, createdById) => ({
  id: row.id,
  key: row.key,
  name: row.name,
  description: row.description,
  schedule: row.schedule,
  scheduleLabel: row.scheduleLabel,
  actionType: row.actionType,
  httpConfig: {
    url: row.httpConfigUrl, method: row.httpConfigMethod, headers: row.httpConfigHeaders || {}, body: row.httpConfigBody,
  },
  logMessage: row.logMessage,
  emailConfig: { to: row.emailConfigTo, subject: row.emailConfigSubject, body: row.emailConfigBody },
  cleanupConfig: { target: row.cleanupConfigTarget, olderThanDays: row.cleanupConfigOlderThanDays },
  notificationConfig: {
    title: row.notificationConfigTitle, message: row.notificationConfigMessage, notificationType: row.notificationConfigType,
  },
  backupConfig: { collections: row.backupConfigCollections || [], outputDir: row.backupConfigOutputDir },
  enabled: row.enabled,
  lastRun: row.lastRun,
  lastStatus: row.lastStatus,
  lastError: row.lastError,
  runCount: row.runCount,
  createdBy: createdById || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const INCLUDE = { createdBy: { select: { id: true } } };
const wrap = (row) => toDoc(row, row.createdBy?.id);

/** Only the config columns for the fields the caller actually supplied — used by both create and update. */
const configColumns = ({
  httpConfig, emailConfig, cleanupConfig, notificationConfig, backupConfig,
}) => {
  const data = {};
  if (httpConfig?.url !== undefined) data.httpConfigUrl = httpConfig.url;
  if (httpConfig?.method !== undefined) data.httpConfigMethod = httpConfig.method;
  if (httpConfig?.headers !== undefined) data.httpConfigHeaders = httpConfig.headers;
  if (httpConfig?.body !== undefined) data.httpConfigBody = httpConfig.body;
  if (emailConfig?.to !== undefined) data.emailConfigTo = emailConfig.to;
  if (emailConfig?.subject !== undefined) data.emailConfigSubject = emailConfig.subject;
  if (emailConfig?.body !== undefined) data.emailConfigBody = emailConfig.body;
  if (cleanupConfig?.target !== undefined) data.cleanupConfigTarget = cleanupConfig.target;
  if (cleanupConfig?.olderThanDays !== undefined) data.cleanupConfigOlderThanDays = cleanupConfig.olderThanDays;
  if (notificationConfig?.title !== undefined) data.notificationConfigTitle = notificationConfig.title;
  if (notificationConfig?.message !== undefined) data.notificationConfigMessage = notificationConfig.message;
  if (notificationConfig?.notificationType !== undefined) data.notificationConfigType = notificationConfig.notificationType;
  if (backupConfig?.collections !== undefined) data.backupConfigCollections = backupConfig.collections;
  if (backupConfig?.outputDir !== undefined) data.backupConfigOutputDir = backupConfig.outputDir;
  return data;
};

const list = async () => {
  const rows = await prisma.cronJob.findMany({ include: INCLUDE });
  return rows.map(wrap);
};

const findByKey = async (key) => {
  const row = await prisma.cronJob.findUnique({ where: { key }, include: INCLUDE });
  return row ? wrap(row) : null;
};

const create = async ({
  key, name, description, schedule, scheduleLabel, actionType,
  httpConfig, logMessage, emailConfig, cleanupConfig, notificationConfig, backupConfig, enabled, createdBy,
}) => {
  const existing = await prisma.cronJob.findUnique({ where: { key } });
  if (existing) {
    const err = new Error('A job with this key already exists');
    err.status = 409;
    throw err;
  }

  const createdByPg = createdBy ? await prisma.user.findUnique({ where: byPublicId(createdBy), select: { id: true } }) : null;
  const row = await prisma.cronJob.create({
    data: {

      key,
      name,
      description: description || '',
      schedule,
      scheduleLabel: scheduleLabel || '',
      actionType: actionType || 'log',
      logMessage: logMessage || 'Custom cron job executed',
      enabled: enabled !== false,
      createdById: createdByPg?.id || null,
      ...configColumns({
        httpConfig, emailConfig, cleanupConfig, notificationConfig, backupConfig,
      }),
    },
    include: INCLUDE,
  });

  const doc = wrap(row);
  return doc;
};

const update = async (key, fields) => {
  const existing = await prisma.cronJob.findUnique({ where: { key } });
  if (!existing) return null;

  const {
    name, description, schedule, scheduleLabel, actionType,
    httpConfig, logMessage, emailConfig, cleanupConfig, notificationConfig, backupConfig, enabled,
  } = fields;

  const data = { ...configColumns({
    httpConfig, emailConfig, cleanupConfig, notificationConfig, backupConfig,
  }) };
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (schedule !== undefined) data.schedule = schedule;
  if (scheduleLabel !== undefined) data.scheduleLabel = scheduleLabel;
  if (actionType !== undefined) data.actionType = actionType;
  if (logMessage !== undefined) data.logMessage = logMessage;
  if (enabled !== undefined) data.enabled = enabled;

  const row = await prisma.cronJob.update({ where: { id: existing.id }, data, include: INCLUDE });
  const doc = wrap(row);
  return doc;
};

/** jobs/index.js's toggleJob persistence. */
const setEnabled = async (key, enabled) => {
  const existing = await prisma.cronJob.findUnique({ where: { key } });
  if (!existing) return null;
  const row = await prisma.cronJob.update({ where: { id: existing.id }, data: { enabled }, include: INCLUDE });
  return wrap(row);
};

/** jobs/index.js's persistStats — recorded after every run, success or failure. */
const recordRun = async (key, { lastRun, lastStatus, lastError, runCount }) => {
  const existing = await prisma.cronJob.findUnique({ where: { key } });
  if (!existing) return null;
  const row = await prisma.cronJob.update({
    where: { id: existing.id }, data: { lastRun, lastStatus, lastError, runCount }, include: INCLUDE,
  });
  return wrap(row);
};

/** jobs/index.js's custom "database cleanup" cron action, target 'failedJobs'. */
const clearFailedStatus = async () => {
  const rows = await prisma.cronJob.findMany({ where: { lastStatus: 'error' } });
  if (!rows.length) return 0;

  await prisma.cronJob.updateMany({ where: { lastStatus: 'error' }, data: { lastError: null, lastStatus: null } });
  return rows.length;
};

const deleteByKey = async (key) => {
  const existing = await prisma.cronJob.findUnique({ where: { key } });
  if (!existing) return null;
  await prisma.cronJob.delete({ where: { id: existing.id } });
  return existing;
};

module.exports = {
  list, findByKey, create, update, setEnabled, recordRun, clearFailedStatus, deleteByKey,
};
