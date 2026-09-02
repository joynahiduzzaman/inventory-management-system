const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/customerController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.delete);

// Credit is tracked per person here, so a payment is taken against the
// customer and allocated across their invoices oldest-first. The per-invoice
// endpoint (PATCH /api/sales/:id/collect-due) still works and is unchanged.
router.get('/:id/due', ctrl.getDue);
router.get('/:id/history', ctrl.getHistory);
router.post('/:id/collect-due', ctrl.collectDue);

module.exports = router;
