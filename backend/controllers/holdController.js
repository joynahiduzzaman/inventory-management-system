/**
 * Parked sales — hold and recall.
 *
 * A customer walks off to fetch their wallet while four people wait. The
 * cashier parks that cart, serves the queue, and brings it back.
 *
 * ── Three decisions worth knowing before reading the code ──────────────────
 *
 * 1. A held cart NEVER reserves stock. Reserving would let an abandoned cart
 *    make goods unsellable, which is worse than the problem it solves. So a
 *    recall rebuilds the cart from live products and reports what changed —
 *    the cashier finds out at recall, not at Complete Sale.
 *
 * 2. Recall is a compare-and-set, not a read. Two terminals can hit the same
 *    parked cart; exactly one wins, and the other is told who took it and
 *    when. That is the difference between a bug and an explanation.
 *
 * 3. A recalled cart is restorable. The common mistake is not a crashed tab,
 *    it is recalling the wrong cart with a queue waiting — and without a way
 *    back, the parked sale is simply gone. Only a cart that became a sale is
 *    beyond restoring, because restoring it would duplicate the sale.
 */
const { HeldSale, HeldSaleItem, Product, Customer, User, sequelize } = require('../models');
const { Op } = require('sequelize');
const V = require('../utils/validate');
const { round2 } = require('../utils/money');
const { holdExpiresAt, staleBefore, HOLD_EXPIRY_HOUR } = require('../config/holds');

const generateHoldNo = () => {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `HOLD-${y}${m}${day}-${Math.floor(1000 + Math.random() * 9000)}`;
};

/**
 * Expire stale carts, lazily, on read.
 *
 * There is no scheduler on a serverless host, so a cron would simply not run.
 * Doing it on read costs one indexed UPDATE and cannot drift from the rule in
 * config/holds.js, because it uses that rule.
 */
async function sweepExpired() {
  const cutoff = staleBefore();
  await sequelize.query(
    `UPDATE held_sales SET status = 'expired'
      WHERE status IN ('held', 'recalled') AND createdAt <= :cutoff`,
    { replacements: { cutoff } }
  );
}

const shape = (h) => ({
  id: h.id,
  holdNo: h.holdNo,
  status: h.status,
  note: h.note,
  itemCount: h.itemCount,
  total: round2(parseFloat(h.total || 0)),
  customerId: h.customerId,
  customerName: h.customer ? h.customer.name : null,
  heldBy: h.user ? h.user.name : null,
  recalledByName: h.recaller ? h.recaller.name : null,
  recalledAt: h.recalledAt,
  createdAt: h.createdAt,
  // Sent, never recomputed on the client: the lifetime is expressed once.
  expiresAt: holdExpiresAt(h.createdAt),
});

// ── POST /holds ──────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { items, customerId, note, discount, discountMode, discountRate } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Nothing to hold — the cart is empty' });
    }

    // Snapshot names and prices for the "changed since" comparison only. The
    // sale is priced from live products when it is recalled.
    const ids = items.map((i) => V.reqId(i.productId, 'Product'));
    const products = await Product.findAll({ where: { id: { [Op.in]: ids } }, transaction: t });
    const byId = new Map(products.map((p) => [p.id, p]));

    let itemCount = 0;
    let total = 0;
    const lines = [];
    for (const i of items) {
      const pid = V.reqId(i.productId, 'Product');
      const qty = V.count(i.quantity, 'Quantity', { required: true, min: 1 });
      const p = byId.get(pid);
      if (!p) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `Product ${pid} not found` });
      }
      itemCount += qty;
      total += parseFloat(p.price) * qty;
      lines.push({ productId: pid, quantity: qty, heldPrice: parseFloat(p.price), heldName: p.name });
    }

    const mode = discountMode === 'percent' ? 'percent' : 'flat';
    const rate = mode === 'percent' ? V.money(discountRate, 'Discount rate', { max: 100 }) : null;
    const disc = mode === 'percent'
      ? round2(total * (rate || 0) / 100)
      : V.money(discount, 'Discount');

    const hold = await HeldSale.create({
      holdNo: generateHoldNo(),
      userId: req.user.id,
      customerId: customerId || null,
      note: note || null,
      discount: disc, discountMode: mode, discountRate: rate,
      itemCount,
      total: round2(Math.max(0, total - disc)),
      status: 'held',
    }, { transaction: t });

    for (const l of lines) {
      await HeldSaleItem.create({ ...l, heldSaleId: hold.id }, { transaction: t });
    }
    await t.commit();

    const full = await HeldSale.findByPk(hold.id, {
      include: [{ model: Customer, as: 'customer', attributes: ['id', 'name'] },
                { model: User, as: 'user', attributes: ['id', 'name'] }],
    });
    res.status(201).json({ success: true, data: shape(full) });
  } catch (err) {
    await t.rollback();
    V.handle(res, err, 'Could not hold this sale');
  }
};

// ── GET /holds ───────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    await sweepExpired();
    const rows = await HeldSale.findAll({
      where: { status: { [Op.in]: ['held', 'recalled', 'expired'] } },
      include: [
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: User, as: 'user', attributes: ['id', 'name'] },
        { model: User, as: 'recaller', attributes: ['id', 'name'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: 100,
    });

    const all = rows.map(shape);
    res.json({
      success: true,
      data: {
        // Split rather than mixed: an expired cart in the same list as a live
        // one is how somebody recalls the wrong thing in a hurry.
        held: all.filter((h) => h.status === 'held'),
        recalled: all.filter((h) => h.status === 'recalled'),
        expired: all.filter((h) => h.status === 'expired'),
        expiryHour: HOLD_EXPIRY_HOUR,
      },
    });
  } catch (err) {
    V.handle(res, err, 'Could not load held sales');
  }
};

// ── POST /holds/:id/recall ───────────────────────────────────────────────────
exports.recall = async (req, res) => {
  try {
    await sweepExpired();
    const id = V.reqId(req.params.id, 'Hold');

    // Compare-and-set. Whoever flips 'held' to 'recalled' owns the cart; a
    // second terminal changes zero rows and gets told who was first.
    const [, meta] = await sequelize.query(
      `UPDATE held_sales SET status = 'recalled', recalledBy = :me, recalledAt = NOW()
        WHERE id = :id AND status = 'held'`,
      { replacements: { id, me: req.user.id } }
    );
    const claimed = (meta && (meta.affectedRows ?? meta.changedRows)) || 0;

    const hold = await HeldSale.findByPk(id, {
      include: [
        { model: HeldSaleItem, as: 'items' },
        { model: Customer, as: 'customer', attributes: ['id', 'name'] },
        { model: User, as: 'user', attributes: ['id', 'name'] },
        { model: User, as: 'recaller', attributes: ['id', 'name'] },
      ],
    });
    if (!hold) return res.status(404).json({ success: false, message: 'That held sale no longer exists' });

    if (!claimed) {
      const who = hold.recaller ? hold.recaller.name : 'another terminal';
      const when = hold.recalledAt ? new Date(hold.recalledAt).toISOString() : null;
      return res.status(409).json({
        success: false,
        code: hold.status === 'expired' ? 'HOLD_EXPIRED'
            : hold.status === 'completed' ? 'HOLD_COMPLETED' : 'HOLD_TAKEN',
        message: hold.status === 'expired'
          ? 'That held sale expired'
          : hold.status === 'completed'
            ? 'That held sale has already been completed'
            : `${who} recalled that sale first`,
        data: { status: hold.status, recalledBy: who, recalledAt: when },
      });
    }

    // ── Rebuild from live products ──────────────────────────────────────────
    // Not from the snapshot: the shop's price is the shop's price, and stock
    // has moved since. Everything that changed is reported rather than fixed
    // silently, because the cashier is the one who has to explain it.
    const ids = hold.items.map((i) => i.productId);
    const products = await Product.findAll({ where: { id: { [Op.in]: ids } } });
    const byId = new Map(products.map((p) => [p.id, p]));

    const cart = [];
    const issues = [];
    for (const line of hold.items) {
      const p = byId.get(line.productId);
      if (!p || p.isActive === false) {
        issues.push({ kind: 'gone', productId: line.productId, name: line.heldName, wanted: line.quantity });
        continue;
      }
      if (p.stock < line.quantity) {
        issues.push({
          kind: p.stock <= 0 ? 'outOfStock' : 'insufficient',
          productId: p.id, name: p.name, wanted: line.quantity, available: p.stock,
        });
      }
      const livePrice = parseFloat(p.price);
      if (round2(livePrice) !== round2(parseFloat(line.heldPrice))) {
        issues.push({
          kind: 'priceChanged', productId: p.id, name: p.name,
          was: round2(parseFloat(line.heldPrice)), now: round2(livePrice),
        });
      }
      cart.push({
        productId: p.id, name: p.name, price: livePrice,
        cost: parseFloat(p.cost || 0), quantity: line.quantity,
        stock: p.stock, unit: p.unit, image: p.image,
        total: round2(livePrice * line.quantity),
      });
    }

    res.json({
      success: true,
      data: {
        hold: shape(hold),
        cart,
        issues,
        customerId: hold.customerId,
        note: hold.note,
        discount: round2(parseFloat(hold.discount || 0)),
        discountMode: hold.discountMode,
        discountRate: hold.discountRate == null ? null : round2(parseFloat(hold.discountRate)),
      },
    });
  } catch (err) {
    V.handle(res, err, 'Could not recall that sale');
  }
};

// ── POST /holds/:id/restore ──────────────────────────────────────────────────
// Puts a recalled cart back on the shelf. The usual reason is recalling the
// wrong one with people waiting; the other is a terminal that died holding it.
exports.restore = async (req, res) => {
  try {
    const id = V.reqId(req.params.id, 'Hold');
    const [, meta] = await sequelize.query(
      `UPDATE held_sales SET status = 'held', recalledBy = NULL, recalledAt = NULL
        WHERE id = :id AND status = 'recalled'`,
      { replacements: { id } }
    );
    const ok = (meta && (meta.affectedRows ?? meta.changedRows)) || 0;
    if (!ok) {
      const hold = await HeldSale.findByPk(id);
      return res.status(409).json({
        success: false,
        message: !hold ? 'That held sale no longer exists'
          : hold.status === 'completed'
            ? 'That sale was completed and cannot be put back'
            : `Nothing to restore — it is ${hold.status}`,
      });
    }
    res.json({ success: true, data: { id, status: 'held' } });
  } catch (err) {
    V.handle(res, err, 'Could not restore that held sale');
  }
};

// ── POST /holds/:id/complete ─────────────────────────────────────────────────
// Called once the recalled cart has actually become a sale, so it can never be
// restored into a duplicate.
exports.complete = async (req, res) => {
  try {
    const id = V.reqId(req.params.id, 'Hold');
    await sequelize.query(
      `UPDATE held_sales SET status = 'completed', saleId = :saleId
        WHERE id = :id AND status IN ('held', 'recalled')`,
      { replacements: { id, saleId: req.body.saleId || null } }
    );
    res.json({ success: true, data: { id, status: 'completed' } });
  } catch (err) {
    V.handle(res, err, 'Could not close that held sale');
  }
};

// ── DELETE /holds/:id ────────────────────────────────────────────────────────
exports.discard = async (req, res) => {
  try {
    const id = V.reqId(req.params.id, 'Hold');
    await sequelize.query(
      "UPDATE held_sales SET status = 'cancelled' WHERE id = :id AND status IN ('held', 'recalled')",
      { replacements: { id } }
    );
    res.json({ success: true, data: { id, status: 'cancelled' } });
  } catch (err) {
    V.handle(res, err, 'Could not discard that held sale');
  }
};
