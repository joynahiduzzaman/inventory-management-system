/**
 * List pagination, added opt-in so nothing that already works stops working.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * Of five list endpoints, only /sales paginated. products, customers, returns
 * and expenses returned every row, every time. At 25 products that is 11KB and
 * invisible; at 2,000 products it is roughly 900KB on every load of the POS
 * screen, which is the one screen that must never feel slow.
 *
 * ── The shape ──────────────────────────────────────────────────────────────
 *
 * Callers that pass `?page` get `{ data, pagination }`. Callers that pass
 * nothing get a bare array exactly as before, so the POS — which loads the
 * catalogue once and filters it in the browser — keeps working unchanged.
 *
 * But "no page means everything" is how the problem got here, so an unpaged
 * request is still capped. Past the cap the response carries `truncated: true`
 * and the real total, because a list that quietly stops at 500 is worse than
 * one that says it did.
 */

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 50;

/** Hard ceiling on an unpaged request. Generous for a shop, finite for a server. */
const UNPAGED_CAP = 500;

/** Read paging intent from the query string. */
function pageParams(query = {}) {
  const wants = query.page !== undefined || query.limit !== undefined;
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );
  return { wants, page, limit, offset: (page - 1) * limit };
}

/**
 * Run a findAndCountAll and shape the response.
 *
 * @param {object} Model      Sequelize model
 * @param {object} findOpts   where / include / order / attributes
 * @param {object} query      req.query
 */
async function paginate(Model, findOpts, query = {}) {
  const { wants, page, limit, offset } = pageParams(query);

  if (!wants) {
    // Unpaged, but never unbounded. Count first so the caller can be told the
    // truth about what it is not seeing.
    const total = await Model.count({ where: findOpts.where, include: findOpts.countInclude });
    const rows = await Model.findAll({ ...findOpts, limit: UNPAGED_CAP });
    return total > UNPAGED_CAP
      ? { data: rows, truncated: true, total, returned: rows.length, cap: UNPAGED_CAP }
      : { data: rows };
  }

  const { rows, count } = await Model.findAndCountAll({
    ...findOpts,
    limit,
    offset,
    distinct: true,
  });
  return {
    data: rows,
    pagination: {
      page,
      limit,
      total: count,
      pages: Math.max(1, Math.ceil(count / limit)),
    },
  };
}

module.exports = { paginate, pageParams, UNPAGED_CAP, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE };
