const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const router = express.Router();
const { adminAuth } = require('../../../middleware/auth');
const { checkPermission, checkRole } = require('../../../middleware/security');
const departmentService = require('../../../services/admin/departmentService');
const activityLogService = require('../../../services/admin/activityLogService');
const { getClientIP } = require('../../../utils/helpers/ipHelper');

// @route   GET /api/v1/admin/departments
// @desc    Get all departments
// @access  Private (Admin with settings.view permission)
router.get('/', adminAuth, checkPermission('settings.view'), async (req, res) => {
  try {
    const { active, search } = req.query;
    const departments = await departmentService.list({ active, search });

    res.json({ success: true, departments });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ success: false, message: 'Error fetching departments' });
  }
});

// @route   GET /api/v1/admin/departments/active
// @desc    Get active departments only
// @access  Private (All authenticated admin users)
router.get('/active', adminAuth, async (req, res) => {
  try {
    const departments = await departmentService.getActive();

    res.json({
      success: true,
      departments: departments.map((dept) => ({ value: dept.value, label: dept.name })),
    });
  } catch (error) {
    console.error('Get active departments error:', error);
    res.status(500).json({ success: false, message: 'Error fetching active departments' });
  }
});

// @route   GET /api/v1/admin/departments/:id
// @desc    Get department by ID
// @access  Private (Admin with settings.view permission)
router.get('/:id', adminAuth, checkPermission('settings.view'), async (req, res) => {
  try {
    const department = await departmentService.findById(req.params.id);
    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    res.json({ success: true, department });
  } catch (error) {
    console.error('Get department error:', error);
    res.status(500).json({ success: false, message: 'Error fetching department' });
  }
});

// @route   POST /api/v1/admin/departments
// @desc    Create new department
// @access  Private (Admin with settings.edit permission)
router.post('/', adminAuth, checkPermission('settings.edit'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const clientIP = getClientIP(req);

    if (!name) {
      return res.status(400).json({ success: false, message: 'Department name is required' });
    }

    const department = await departmentService.create({ name, description, createdBy: req.userId });

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'create',
      targetModel: 'Settings',
      targetId: department.id,
      targetName: department.name,
      description: `Created department: ${department.name}`,
      ipAddress: clientIP,
      userAgent: req.headers['user-agent'],
      status: 'success',
    });

    res.status(201).json({ success: true, message: 'Department created successfully', department });
  } catch (error) {
    failure(res, error, 'Error creating department', { log: 'Create department error' });
  }
});

// @route   PUT /api/v1/admin/departments/:id
// @desc    Update department
// @access  Private (Admin with settings.edit permission)
router.put('/:id', adminAuth, checkPermission('settings.edit'), async (req, res) => {
  try {
    const { name, description, isActive } = req.body;
    const clientIP = getClientIP(req);

    const department = await departmentService.update(req.params.id, {
      name, description, isActive, updatedBy: req.userId,
    });
    if (!department) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'update',
      targetModel: 'Settings',
      targetId: department.id,
      targetName: department.name,
      description: `Updated department: ${department.name}`,
      ipAddress: clientIP,
      userAgent: req.headers['user-agent'],
      status: 'success',
    });

    res.json({ success: true, message: 'Department updated successfully', department });
  } catch (error) {
    failure(res, error, 'Error updating department', { log: 'Update department error' });
  }
});

// @route   DELETE /api/v1/admin/departments/:id
// @desc    Delete department
// @access  Private (Admin with settings.edit permission)
router.delete('/:id', adminAuth, checkPermission('settings.edit'), async (req, res) => {
  try {
    const clientIP = getClientIP(req);

    const deleted = await departmentService.deleteOne(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Department not found' });
    }

    await activityLogService.logActivity({
      userId: req.userId,
      userName: req.user.name,
      userEmail: req.user.email,
      userRole: req.user.role,
      action: 'settings_updated',
      actionType: 'delete',
      targetModel: 'Settings',
      targetName: deleted.name,
      description: `Deleted department: ${deleted.name}`,
      ipAddress: clientIP,
      userAgent: req.headers['user-agent'],
      status: 'success',
    });

    res.json({ success: true, message: 'Department deleted successfully' });
  } catch (error) {
    failure(res, error, 'Error deleting department', { log: 'Delete department error' });
  }
});

// @route   POST /api/v1/admin/departments/seed/default
// @desc    Seed default departments (one-time setup)
// @access  Private (Super Admin only)
router.post('/seed/default', adminAuth, checkRole('super_admin'), async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Only super admin can seed default departments' });
    }

    const defaultDepartments = [
      { name: 'Customer Support', value: 'support', description: 'Customer service and support', isDefault: true },
      { name: 'Product Management', value: 'product', description: 'Product planning and management', isDefault: true },
      { name: 'Operations', value: 'operations', description: 'Business operations', isDefault: true },
      { name: 'Executive', value: 'executive', description: 'Executive leadership', isDefault: true },
    ];

    let created = 0;
    let skipped = 0;

    for (const dept of defaultDepartments) {
      const existing = await departmentService.findByValue(dept.value);
      if (!existing) {
        await departmentService.create({ ...dept, createdBy: req.userId });
        created++;
      } else {
        skipped++;
      }
    }

    res.json({
      success: true,
      message: `Seeding complete. Created: ${created}, Skipped: ${skipped}`,
      stats: { created, skipped, total: defaultDepartments.length },
    });
  } catch (error) {
    console.error('Seed departments error:', error);
    res.status(500).json({ success: false, message: 'Error seeding departments' });
  }
});

module.exports = router;
