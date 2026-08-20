const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { protect, adminOnly } = require('../middleware/auth');

router.post('/login', ctrl.login);
router.get('/me', protect, ctrl.getMe);
router.post('/change-password', protect, ctrl.changePassword);
router.get('/users', protect, adminOnly, ctrl.getUsers);
router.post('/users', protect, adminOnly, ctrl.createUser);
router.put('/users/:id', protect, adminOnly, ctrl.updateUser);

module.exports = router;
