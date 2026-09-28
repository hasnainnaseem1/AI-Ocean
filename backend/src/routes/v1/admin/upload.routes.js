const express = require('express');
const { failure } = require('../../../utils/helpers/apiError');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { adminAuth } = require('../../../middleware/auth');
const { checkPermission } = require('../../../middleware/security');

// Ensure upload directories exist
const uploadDirs = ['logos', 'favicons', 'blog', 'og-images', 'general', 'social-icons'];
const uploadsRoot = path.join(__dirname, '..', '..', '..', '..', 'uploads');
uploadDirs.forEach(dir => {
  const fullPath = path.join(uploadsRoot, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.params.folder || 'general';
    const allowed = uploadDirs;
    if (!allowed.includes(folder)) {
      return cb(new Error('Invalid upload folder'));
    }
    const dest = path.join(uploadsRoot, folder);
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files (JPEG, PNG, GIF, WebP, SVG, ICO) are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ─── Upload single file ──────────────────────────────────────
// POST /api/v1/admin/upload/:folder
router.post(
  '/:folder',
  adminAuth,
  checkPermission('settings.edit'),
  upload.single('file'),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const fileUrl = `${baseUrl}/uploads/${req.params.folder}/${req.file.filename}`;

      res.json({
        success: true,
        message: 'File uploaded successfully',
        file: {
          url: fileUrl,
          filename: req.file.filename,
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
        },
      });
    } catch (err) {
      failure(res, err, 'Something went wrong. Please try again.');
    }
  }
);

// ─── Delete uploaded file ────────────────────────────────────
// DELETE /api/v1/admin/upload/:folder/:filename
router.delete(
  '/:folder/:filename',
  adminAuth,
  checkPermission('settings.edit'),
  (req, res) => {
    try {
      const { folder, filename } = req.params;
      if (!uploadDirs.includes(folder)) {
        return res.status(400).json({ success: false, message: 'Invalid folder' });
      }
      // Sanitize filename to prevent path traversal
      const safeName = path.basename(filename);
      const filePath = path.join(uploadsRoot, folder, safeName);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return res.json({ success: true, message: 'File deleted' });
      }
      res.status(404).json({ success: false, message: 'File not found' });
    } catch (err) {
      failure(res, err, 'Something went wrong. Please try again.');
    }
  }
);

// Error handler for multer errors
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large. Maximum 5MB allowed.' });
    }
    return failure(res, err, 'Something went wrong. Please try again.');
  }
  if (err) {
    return failure(res, err, 'Something went wrong. Please try again.');
  }
  next();
});

module.exports = router;
