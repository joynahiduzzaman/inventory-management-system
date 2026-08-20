const { Category, Product } = require('../models');
const { fn, col } = require('sequelize');
const V = require('../utils/validate');

exports.getAll = async (req, res) => {
  try {
    // Product counts let the UI warn before a destructive delete.
    const categories = await Category.findAll({
      attributes: {
        include: [[fn('COUNT', col('products.id')), 'productCount']],
      },
      include: [{ model: Product, as: 'products', attributes: [], required: false, where: { isActive: true } }],
      group: ['Category.id'],
      order: [['name', 'ASC']],
      subQuery: false,
    });
    res.json({ success: true, data: categories });
  } catch (err) {
    V.handle(res, err, 'Could not load categories');
  }
};

exports.create = async (req, res) => {
  try {
    const category = await Category.create({
      name:        V.reqString(req.body.name, 'Category name', { max: 100 }),
      description: V.optString(req.body.description, 'Description', { max: 1000 }),
    });
    res.status(201).json({ success: true, data: category });
  } catch (err) {
    V.handle(res, err, 'Could not create category');
  }
};

exports.update = async (req, res) => {
  try {
    const category = await Category.findByPk(req.params.id);
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });
    await category.update({
      name:        V.reqString(req.body.name, 'Category name', { max: 100 }),
      description: V.optString(req.body.description, 'Description', { max: 1000 }),
    });
    res.json({ success: true, data: category });
  } catch (err) {
    V.handle(res, err, 'Could not update category');
  }
};

/**
 * Refuse to delete a category that products still use.
 *
 * The FK is ON DELETE SET NULL, so deleting silently stripped the category from
 * every product that used it — irreversible, with no warning. Callers that
 * really mean it must pass ?reassignTo=<id> or ?force=true.
 */
exports.delete = async (req, res) => {
  try {
    const category = await Category.findByPk(req.params.id);
    if (!category) return res.status(404).json({ success: false, message: 'Category not found' });

    const inUse = await Product.count({ where: { categoryId: category.id } });

    if (inUse > 0) {
      const reassignTo = V.optId(req.query.reassignTo, 'Replacement category');
      if (reassignTo) {
        if (reassignTo === category.id) {
          return res.status(400).json({ success: false, message: 'Cannot reassign a category to itself' });
        }
        const target = await Category.findByPk(reassignTo);
        if (!target) return res.status(404).json({ success: false, message: 'Replacement category not found' });
        await Product.update({ categoryId: target.id }, { where: { categoryId: category.id } });
      } else if (req.query.force !== 'true') {
        return res.status(409).json({
          success: false,
          message: `"${category.name}" is used by ${inUse} product${inUse === 1 ? '' : 's'}. Move them to another category first, or confirm to leave them uncategorised.`,
          productCount: inUse,
          requiresConfirmation: true,
        });
      }
    }

    await category.destroy();
    res.json({ success: true, message: `Category "${category.name}" deleted` });
  } catch (err) {
    V.handle(res, err, 'Could not delete category');
  }
};
