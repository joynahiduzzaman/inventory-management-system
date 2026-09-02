const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/holdController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.post('/:id/recall', ctrl.recall);
router.post('/:id/restore', ctrl.restore);
router.post('/:id/complete', ctrl.complete);
router.delete('/:id', ctrl.discard);

module.exports = router;
