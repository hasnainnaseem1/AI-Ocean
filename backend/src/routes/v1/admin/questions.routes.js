/**
 * Admin Questionnaire Builder Routes
 *
 * The questions asked in the deployment wizard live in the database so the
 * admin can add, edit and reorder them without a code change — new questions
 * were always expected to be added over time.
 */
const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const router = express.Router();
const questionTemplateService = require('../../../services/admin/questionTemplateService');
const activityLogService = require('../../../services/admin/activityLogService');
const { checkPermission } = require('../../../middleware/security');
const { getClientIP } = require('../../../utils/helpers/ipHelper');

const logChange = async (req, action, question, description) => {
  await activityLogService.logActivity({
    userId: req.userId,
    userName: req.user.name,
    userEmail: req.user.email,
    userRole: req.user.role,
    action,
    actionType: action.endsWith('_created') ? 'create' : action.endsWith('_deleted') ? 'delete' : 'update',
    targetModel: 'QuestionTemplate',
    targetId: question?.id,
    targetName: question?.key,
    description,
    ipAddress: getClientIP(req),
    userAgent: req.get('user-agent'),
    status: 'success',
  });
};

// @route   GET /api/v1/admin/questions
router.get('/', checkPermission('models.view'), async (req, res) => {
  try {
    const questions = await questionTemplateService.list();
    res.json({ success: true, questions, total: questions.length });
  } catch (error) {
    console.error('List questions error:', error);
    res.status(500).json({ success: false, message: 'Error fetching questions' });
  }
});

// @route   POST /api/v1/admin/questions
router.post('/', checkPermission('models.create'), async (req, res) => {
  try {
    const question = await questionTemplateService.create({ ...req.body, createdBy: req.userId });

    await logChange(req, 'question_created', question, `Added deployment question "${question.question}"`);

    res.status(201).json({ success: true, message: 'Question created', question });
  } catch (error) {
    failure(res, error, 'Error creating question', { log: 'Create question error' });
  }
});

// @route   PUT /api/v1/admin/questions/:id
router.put('/:id', checkPermission('models.edit'), async (req, res) => {
  try {
    const updates = { ...req.body };
    delete updates.id;
    delete updates.createdBy;

    // The key is referenced by every answer already stored on deployments, so
    // renaming it would orphan that history.
    if (updates.key !== undefined) {
      const existing = await questionTemplateService.findById(req.params.id);
      if (existing && updates.key !== existing.key) {
        return res.status(400).json({
          success: false,
          message:
            'A question key cannot be changed once answers reference it. '
            + 'Deactivate this question and create a new one instead.',
        });
      }
    }
    delete updates.key;

    const question = await questionTemplateService.update(req.params.id, updates, req.userId);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    await logChange(req, 'question_updated', question, `Updated deployment question "${question.question}"`);

    res.json({ success: true, message: 'Question updated', question });
  } catch (error) {
    failure(res, error, 'Error updating question', { log: 'Update question error' });
  }
});

// @route   PUT /api/v1/admin/questions/order/bulk
router.put('/order/bulk', checkPermission('models.edit'), async (req, res) => {
  try {
    const { order } = req.body; // [{ id, displayOrder }]
    if (!Array.isArray(order)) {
      return res.status(400).json({ success: false, message: 'order must be an array' });
    }

    await questionTemplateService.reorder(order);

    res.json({ success: true, message: 'Order updated' });
  } catch (error) {
    console.error('Reorder questions error:', error);
    res.status(500).json({ success: false, message: 'Error reordering questions' });
  }
});

// @route   DELETE /api/v1/admin/questions/:id
router.delete('/:id', checkPermission('models.delete'), async (req, res) => {
  try {
    const question = await questionTemplateService.deleteOne(req.params.id);
    if (!question) {
      return res.status(404).json({ success: false, message: 'Question not found' });
    }

    await logChange(req, 'question_deleted', question, `Deleted deployment question "${question.question}"`);

    res.json({
      success: true,
      message: 'Question deleted. Answers already recorded on existing deployments are kept.',
    });
  } catch (error) {
    console.error('Delete question error:', error);
    res.status(500).json({ success: false, message: 'Error deleting question' });
  }
});

module.exports = router;
