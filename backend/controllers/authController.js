const jwt = require('jsonwebtoken');
const { User } = require('../models');
const V = require('../utils/validate');

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const MIN_PASSWORD = 8;
const checkPassword = (pw) => {
  const s = V.reqString(pw, 'Password', { max: 200, min: 1 });
  if (s.length < MIN_PASSWORD) {
    throw new V.ValidationError(`Password must be at least ${MIN_PASSWORD} characters`, 'password');
  }
  return s;
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({ where: { email: String(email).trim().toLowerCase() } });

    // Identical response whether the account is missing, disabled, or the
    // password is wrong — otherwise the endpoint enumerates valid accounts.
    if (!user || !user.isActive || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Incorrect email or password' });
    }

    res.json({
      success: true,
      token: signToken(user.id),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    V.handle(res, err, 'Login failed');
  }
};

exports.getMe = async (req, res) => {
  res.json({ success: true, user: req.user });
};

exports.getUsers = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      order: [['name', 'ASC']],
    });
    res.json({ success: true, data: users });
  } catch (err) {
    V.handle(res, err, 'Could not load users');
  }
};

exports.createUser = async (req, res) => {
  try {
    const user = await User.create({
      name:     V.reqString(req.body.name, 'Name', { max: 100 }),
      email:    V.reqEmail(req.body.email),
      password: checkPassword(req.body.password),
      role:     V.oneOf(req.body.role, ['admin', 'staff'], 'Role', 'staff'),
      isActive: req.body.isActive !== undefined ? !!req.body.isActive : true,
    });
    const data = user.toJSON();
    delete data.password;
    res.status(201).json({ success: true, data });
  } catch (err) {
    V.handle(res, err, 'Could not create user');
  }
};

exports.updateUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { name, email, password, role, isActive } = req.body;
    const isSelf = user.id === req.user.id;

    // Guard against an admin locking themselves — and possibly everyone — out.
    if (isSelf && isActive === false) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account' });
    }
    if (isSelf && role !== undefined && role !== user.role) {
      return res.status(400).json({ success: false, message: 'You cannot change your own role' });
    }
    if ((isActive === false || (role !== undefined && role !== 'admin')) && user.role === 'admin') {
      const activeAdmins = await User.count({ where: { role: 'admin', isActive: true } });
      if (activeAdmins <= 1) {
        return res.status(400).json({
          success: false,
          message: 'This is the last active admin — promote another admin first',
        });
      }
    }

    const updates = {};
    if (name     !== undefined) updates.name     = V.reqString(name, 'Name', { max: 100 });
    if (email    !== undefined) updates.email    = V.reqEmail(email);
    if (password !== undefined && password !== '') updates.password = checkPassword(password);
    if (role     !== undefined) updates.role     = V.oneOf(role, ['admin', 'staff'], 'Role');
    if (isActive !== undefined) updates.isActive = !!isActive;

    await user.update(updates);
    const data = user.toJSON();
    delete data.password;
    res.json({ success: true, data, message: 'User updated' });
  } catch (err) {
    V.handle(res, err, 'Could not update user');
  }
};

/** Lets any signed-in user rotate their own password. */
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findByPk(req.user.id);
    if (!user || !(await user.comparePassword(currentPassword || ''))) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    const next = checkPassword(newPassword);
    if (await user.comparePassword(next)) {
      return res.status(400).json({ success: false, message: 'New password must be different from the current one' });
    }
    await user.update({ password: next });
    res.json({ success: true, message: 'Password changed' });
  } catch (err) {
    V.handle(res, err, 'Could not change password');
  }
};
