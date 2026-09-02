const { Expense, sequelize } = require('../models');
const { Op } = require('sequelize');
const V = require('../utils/validate');
const { paginate } = require('../utils/paginate');

const parseExpense = (body) => ({
  title:    V.reqString(body.title, 'Title', { max: 200 }),
  category: V.reqString(body.category, 'Category', { max: 100 }),
  amount:   V.money(body.amount, 'Amount', { required: true }),
  date:     V.dateOnly(body.date, 'Date'),
  note:     V.optString(body.note, 'Note', { max: 1000 }),
});

exports.getAll = async (req, res) => {
  try {
    const { from, to, category, search } = req.query;
    const where = {};
    if (from && to) {
      where.date = { [Op.between]: [V.dateOnly(from, 'From date'), V.dateOnly(to, 'To date')] };
    }
    if (category) where.category = category;
    if (search) where.title = { [Op.like]: `%${String(search).trim()}%` };

    const result = await paginate(Expense, { where, order: [['date', 'DESC'], ['id', 'DESC']] }, req.query);
    res.json({ success: true, ...result });
  } catch (err) {
    V.handle(res, err, 'Could not load expenses');
  }
};

exports.create = async (req, res) => {
  try {
    const data = parseExpense(req.body);
    if (data.amount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
    }
    const expense = await Expense.create({ ...data, userId: req.user.id });
    res.status(201).json({ success: true, data: expense });
  } catch (err) {
    V.handle(res, err, 'Could not record the expense');
  }
};

exports.update = async (req, res) => {
  try {
    const expense = await Expense.findByPk(req.params.id);
    if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });
    const data = parseExpense(req.body);
    if (data.amount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
    }
    await expense.update(data);
    res.json({ success: true, data: expense });
  } catch (err) {
    V.handle(res, err, 'Could not update the expense');
  }
};

exports.delete = async (req, res) => {
  try {
    const expense = await Expense.findByPk(req.params.id);
    if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' });
    await expense.destroy();
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err) {
    V.handle(res, err, 'Could not delete the expense');
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = {};
    if (from && to) {
      where.date = { [Op.between]: [V.dateOnly(from, 'From date'), V.dateOnly(to, 'To date')] };
    }

    const summary = await Expense.findAll({
      where,
      attributes: [
        'category',
        [sequelize.fn('SUM', sequelize.col('amount')), 'total'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
      ],
      group: ['category'],
      order: [[sequelize.fn('SUM', sequelize.col('amount')), 'DESC']],
    });
    res.json({ success: true, data: summary });
  } catch (err) {
    V.handle(res, err, 'Could not summarise expenses');
  }
};
