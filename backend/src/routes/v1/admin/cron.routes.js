/**
 * Admin Cron Jobs Routes
 * 
 * Endpoints for managing scheduled cron jobs:
 * - GET    /api/v1/admin/cron               — list all jobs with status
 * - POST   /api/v1/admin/cron               — create a new custom job
 * - PUT    /api/v1/admin/cron/:key           — update a custom job
 * - DELETE /api/v1/admin/cron/:key           — delete a custom job
 * - PUT    /api/v1/admin/cron/:key/toggle    — enable/disable a job
 * - POST   /api/v1/admin/cron/:key/trigger   — manually run a job
 */
const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const router = express.Router();
const cronLib = require('node-cron');
const { checkPermission } = require('../../../middleware/security');
const {
  getJobStatuses,
  toggleJob,
  triggerJob,
  createCustomJob,
  updateCustomJob,
  deleteCustomJob,
} = require('../../../jobs');
const cronJobService = require('../../../services/admin/cronJobService');

// @route   GET /api/v1/admin/cron
// @desc    Get status of all cron jobs
// @access  Private (Admin with settings.view)
router.get('/', checkPermission('settings.view'), async (req, res) => {
  try {
    const jobs = getJobStatuses();
    res.json({ success: true, jobs });
  } catch (error) {
    console.error('Get cron jobs error:', error);
    res.status(500).json({ success: false, message: 'Failed to get cron job statuses' });
  }
});

// @route   POST /api/v1/admin/cron
// @desc    Create a new custom cron job
// @access  Private (Super Admin)
router.post('/', checkPermission('settings.edit'), async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can create cron jobs' });
    }
    const { key, name, description, schedule, scheduleLabel, actionType,
            httpConfig, logMessage, emailConfig, cleanupConfig,
            notificationConfig, backupConfig, enabled } = req.body;

    if (!key || !name || !schedule) {
      return res.status(400).json({ success: false, message: 'key, name, and schedule are required' });
    }
    if (!cronLib.validate(schedule)) {
      return res.status(400).json({ success: false, message: 'Invalid cron expression' });
    }
    // Check if key is already taken (system or custom)
    const existing = getJobStatuses().find((j) => j.key === key);
    if (existing) {
      return res.status(409).json({ success: false, message: `Job key "${key}" already exists` });
    }

    const doc = await cronJobService.create({
      key, name, description, schedule, scheduleLabel,
      actionType: actionType || 'log',
      httpConfig, logMessage,
      emailConfig, cleanupConfig, notificationConfig, backupConfig,
      enabled: enabled !== false,
      createdBy: req.user.id,
    });

    createCustomJob(doc);
    res.status(201).json({ success: true, message: 'Custom cron job created', job: doc });
  } catch (error) {
    failure(res, error, 'Failed to create cron job', { log: 'Create cron job error' });
  }
});

// @route   PUT /api/v1/admin/cron/:key
// @desc    Update a custom cron job
// @access  Private (Super Admin)
router.put('/:key', checkPermission('settings.edit'), async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can edit cron jobs' });
    }
    // Prevent editing system jobs
    const allJobs = getJobStatuses();
    const target = allJobs.find((j) => j.key === req.params.key);
    if (!target) return res.status(404).json({ success: false, message: 'Cron job not found' });
    if (target.system) return res.status(403).json({ success: false, message: 'System jobs cannot be edited' });

    const { name, description, schedule, scheduleLabel, actionType,
            httpConfig, logMessage, emailConfig, cleanupConfig,
            notificationConfig, backupConfig, enabled } = req.body;
    if (schedule && !cronLib.validate(schedule)) {
      return res.status(400).json({ success: false, message: 'Invalid cron expression' });
    }

    const doc = await cronJobService.update(req.params.key, {
      name, description, schedule, scheduleLabel, actionType,
      httpConfig, logMessage, emailConfig, cleanupConfig,
      notificationConfig, backupConfig, enabled,
    });
    if (!doc) return res.status(404).json({ success: false, message: 'Custom job not found in DB' });

    updateCustomJob(doc);
    res.json({ success: true, message: 'Custom cron job updated', job: doc });
  } catch (error) {
    console.error('Update cron job error:', error);
    res.status(500).json({ success: false, message: 'Failed to update cron job' });
  }
});

// @route   DELETE /api/v1/admin/cron/:key
// @desc    Delete a custom cron job
// @access  Private (Super Admin)
router.delete('/:key', checkPermission('settings.edit'), async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can delete cron jobs' });
    }
    const allJobs = getJobStatuses();
    const target = allJobs.find((j) => j.key === req.params.key);
    if (!target) return res.status(404).json({ success: false, message: 'Cron job not found' });
    if (target.system) return res.status(403).json({ success: false, message: 'System jobs cannot be deleted' });

    await cronJobService.deleteByKey(req.params.key);
    deleteCustomJob(req.params.key);

    res.json({ success: true, message: 'Custom cron job deleted' });
  } catch (error) {
    console.error('Delete cron job error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete cron job' });
  }
});

// @route   PUT /api/v1/admin/cron/:key/toggle
// @desc    Toggle a cron job on/off
// @access  Private (Super Admin)
router.put('/:key/toggle', checkPermission('settings.edit'), async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can toggle cron jobs' });
    }
    const result = toggleJob(req.params.key);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Cron job not found' });
    }
    res.json({ success: true, message: `Job ${result.enabled ? 'enabled' : 'disabled'}`, ...result });
  } catch (error) {
    console.error('Toggle cron job error:', error);
    res.status(500).json({ success: false, message: 'Failed to toggle cron job' });
  }
});

// @route   POST /api/v1/admin/cron/:key/trigger
// @desc    Manually trigger a cron job
// @access  Private (Super Admin)
router.post('/:key/trigger', checkPermission('settings.edit'), async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admins can trigger cron jobs' });
    }
    const result = await triggerJob(req.params.key);
    res.json({ success: true, message: 'Job executed successfully', ...result });
  } catch (error) {
    console.error('Trigger cron job error:', error);
    failure(res, error, 'Failed to trigger cron job');
  }
});

module.exports = router;
