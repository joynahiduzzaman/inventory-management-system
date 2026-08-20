const { Customer, Sale, SaleItem } = require('../models');
const { Op } = require('sequelize');
const V = require('../utils/validate');

const parseCustomer = (body) => ({
  name:    V.reqString(body.name, 'Customer name', { max: 150 }),
  phone:   V.optPhone(body.phone),
  email:   V.optEmail(body.email),
  address: V.optString(body.address, 'Address', { max: 1000 }),
});

exports.getAll = async (req, res) => {
  try {
    const { search, dueOnly } = req.query;
    const where = {};
    if (search) {
      const term = `%${String(search).trim()}%`;
      where[Op.or] = [
        { name:  { [Op.like]: term } },
        { phone: { [Op.like]: term } },
        { email: { [Op.like]: term } },
      ];
    }
    if (dueOnly === 'true') where.dueAmount = { [Op.gt]: 0 };

    const customers = await Customer.findAll({ where, order: [['name', 'ASC']] });
    res.json({ success: true, data: customers });
  } catch (err) {
    V.handle(res, err, 'Could not load customers');
  }
};

exports.getOne = async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    // Fetched separately: a limit inside an include applies to the joined rows,
    // not per parent, so it silently truncated purchase history.
    const sales = await Sale.findAll({
      where: { customerId: customer.id },
      include: [{ model: SaleItem, as: 'items' }],
      order: [['createdAt', 'DESC']],
      limit: 50,
    });

    res.json({ success: true, data: { ...customer.toJSON(), sales } });
  } catch (err) {
    V.handle(res, err, 'Could not load customer');
  }
};

exports.create = async (req, res) => {
  try {
    const customer = await Customer.create(parseCustomer(req.body));
    res.status(201).json({ success: true, data: customer });
  } catch (err) {
    V.handle(res, err, 'Could not create customer');
  }
};

exports.update = async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    // totalPurchase / dueAmount are ledger-derived and must not be user-editable.
    await customer.update(parseCustomer(req.body));
    res.json({ success: true, data: customer });
  } catch (err) {
    V.handle(res, err, 'Could not update customer');
  }
};

/**
 * Deleting a customer sets customerId to NULL on their sales (FK is SET NULL),
 * which quietly detaches invoice history. Block it when they have any, and
 * always block while money is outstanding.
 */
exports.delete = async (req, res) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });

    const due = parseFloat(customer.dueAmount) || 0;
    if (due > 0) {
      return res.status(409).json({
        success: false,
        message: `${customer.name} still owes ৳${due.toFixed(2)}. Settle the balance before deleting.`,
      });
    }

    const saleCount = await Sale.count({ where: { customerId: customer.id } });
    if (saleCount > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        success: false,
        message: `${customer.name} has ${saleCount} sale${saleCount === 1 ? '' : 's'} on record. Deleting will detach those invoices from the customer.`,
        saleCount,
        requiresConfirmation: true,
      });
    }

    await customer.destroy();
    res.json({ success: true, message: `Customer "${customer.name}" deleted` });
  } catch (err) {
    V.handle(res, err, 'Could not delete customer');
  }
};
