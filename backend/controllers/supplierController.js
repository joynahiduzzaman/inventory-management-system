const { Supplier, Product } = require('../models');
const { Op, fn, col } = require('sequelize');
const V = require('../utils/validate');

const parseSupplier = (body) => ({
  name:    V.reqString(body.name, 'Supplier name', { max: 150 }),
  phone:   V.optPhone(body.phone),
  email:   V.optEmail(body.email),
  company: V.optString(body.company, 'Company', { max: 150 }),
  address: V.optString(body.address, 'Address', { max: 1000 }),
});

exports.getAll = async (req, res) => {
  try {
    const { search } = req.query;
    const where = {};
    if (search) {
      const term = `%${String(search).trim()}%`;
      where[Op.or] = [
        { name:    { [Op.like]: term } },
        { company: { [Op.like]: term } },
        { phone:   { [Op.like]: term } },
      ];
    }

    const suppliers = await Supplier.findAll({
      where,
      attributes: { include: [[fn('COUNT', col('products.id')), 'productCount']] },
      include: [{ model: Product, as: 'products', attributes: [], required: false, where: { isActive: true } }],
      group: ['Supplier.id'],
      order: [['name', 'ASC']],
      subQuery: false,
    });
    res.json({ success: true, data: suppliers });
  } catch (err) {
    V.handle(res, err, 'Could not load suppliers');
  }
};

exports.getOne = async (req, res) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id, {
      include: [{ model: Product, as: 'products', where: { isActive: true }, required: false }],
    });
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
    res.json({ success: true, data: supplier });
  } catch (err) {
    V.handle(res, err, 'Could not load supplier');
  }
};

exports.create = async (req, res) => {
  try {
    const supplier = await Supplier.create(parseSupplier(req.body));
    res.status(201).json({ success: true, data: supplier });
  } catch (err) {
    V.handle(res, err, 'Could not create supplier');
  }
};

exports.update = async (req, res) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });
    await supplier.update(parseSupplier(req.body));
    res.json({ success: true, data: supplier });
  } catch (err) {
    V.handle(res, err, 'Could not update supplier');
  }
};

// Same protection as categories: deleting silently unlinked every product.
exports.delete = async (req, res) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id);
    if (!supplier) return res.status(404).json({ success: false, message: 'Supplier not found' });

    const inUse = await Product.count({ where: { supplierId: supplier.id } });
    if (inUse > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        success: false,
        message: `"${supplier.name}" supplies ${inUse} product${inUse === 1 ? '' : 's'}. Confirm to delete and leave those products without a supplier.`,
        productCount: inUse,
        requiresConfirmation: true,
      });
    }

    await supplier.destroy();
    res.json({ success: true, message: `Supplier "${supplier.name}" deleted` });
  } catch (err) {
    V.handle(res, err, 'Could not delete supplier');
  }
};
