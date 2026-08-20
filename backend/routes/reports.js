const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/reportController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/dashboard',        ctrl.getDashboard);
router.get('/sales-chart',      ctrl.getSalesChart);
router.get('/top-products',     ctrl.getTopProducts);
router.get('/profit',           ctrl.getProfitReport);
router.get('/sales-summary',    ctrl.getSalesSummary);
router.get('/product-sales',    ctrl.getProductSalesReport);
router.get('/stock-movements',  ctrl.getStockMovements);
router.get('/payment-methods',  ctrl.getPaymentBreakdown);
router.get('/inventory',        ctrl.getInventoryReport);

module.exports = router;
