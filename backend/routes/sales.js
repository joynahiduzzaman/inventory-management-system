const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/saleController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/', ctrl.getAll);
router.get('/daily', ctrl.getDailySales);
router.get('/by-invoice/:invoiceNo', ctrl.getByInvoiceNo);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.createSale);
router.patch('/:id/collect-due', ctrl.collectDue);

module.exports = router;