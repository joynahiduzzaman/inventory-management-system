const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/pdfController');
const { protectQuery } = require('../middleware/auth');

// Use protectQuery so links opened in new tab (with ?token=) work
router.use(protectQuery);

router.get('/invoice/:id',   ctrl.generateInvoicePDF);
router.get('/sales-report',  ctrl.generateSalesReportPDF);
router.get('/product-sales', ctrl.generateProductSalesPDF);
router.get('/voucher/:id',   ctrl.generateVoucherPDF);
router.get('/return/:id',    ctrl.generateReturnPDF);

module.exports = router;