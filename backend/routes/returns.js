const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/returnController');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/',              ctrl.getAll);
router.get('/sale/:saleId',  ctrl.getReturnableItems);
router.get('/:id',           ctrl.getOne);
router.post('/',             ctrl.createReturn);

module.exports = router;