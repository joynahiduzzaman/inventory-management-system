const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/productController');
const { protect, adminOnly } = require('../middleware/auth');
const uploadMiddleware = require('../middleware/upload');

router.use(protect);

router.get('/',            ctrl.getAll);
router.get('/low-stock',   ctrl.getLowStock);
router.get('/valuation',   ctrl.getValuation);
router.get('/scan/:code',  ctrl.scanProduct);
router.get('/:id',         ctrl.getOne);
router.get('/:id/movements', ctrl.getMovements);

router.post('/', uploadMiddleware('image'), ctrl.create);
router.put('/:id', uploadMiddleware('image'), ctrl.update);
router.post('/:id/adjust-stock', ctrl.adjustStock);

// Archiving and restoring affect reporting, so keep them admin-only.
router.delete('/:id',      adminOnly, ctrl.delete);
router.patch('/:id/restore', adminOnly, ctrl.restore);

module.exports = router;
