'use strict';

const { all, get } = require('../db');

/*
 * Public catalogue queries. Every query here selects an explicit column list
 * so internal fields (cost_price, views, admin data) can never leak into
 * public pages or the JSON search API.
 */
const PUBLIC_COLS = `
  p.id, p.name, p.slug, p.brand, p.sku, p.category_id, p.description, p.image,
  p.pack_size, p.minimum_order, p.stock_quantity, p.wholesale_price, p.suggested_price,
  p.featured, p.new_product, p.age_restricted, p.created_at,
  c.name AS category_name, c.slug AS category_slug`;

const FROM = `FROM products p LEFT JOIN categories c ON c.id = p.category_id`;
const VISIBLE = `p.active = 1 AND (c.id IS NULL OR c.active = 1)`;

/** Strip the trade price for visitors who are not logged in. */
function forViewer(product, user) {
  if (!product) return product;
  const out = { ...product };
  if (!user) out.wholesale_price = null;
  out.availability = availability(out);
  return out;
}
const forViewerAll = (rows, user) => rows.map((r) => forViewer(r, user));

function availability(p) {
  const qty = Number(p.stock_quantity) || 0;
  if (qty <= 0) return { key: 'out', label: 'Out of stock' };
  if (qty < Math.max(10, (Number(p.minimum_order) || 1) * 3)) return { key: 'low', label: 'Low stock' };
  return { key: 'in', label: 'In stock' };
}

function activeCategories() {
  return all(`
    SELECT c.id, c.name, c.slug, c.description, c.image, c.display_order,
      (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
    FROM categories c WHERE c.active = 1 ORDER BY c.display_order, c.name`);
}

function categoryBySlug(slug) {
  return get('SELECT id, name, slug, description, image FROM categories WHERE slug = ? AND active = 1', slug);
}

function productBySlug(slug) {
  return get(`SELECT ${PUBLIC_COLS} ${FROM} WHERE p.slug = ? AND ${VISIBLE}`, slug);
}

function productById(id) {
  return get(`SELECT ${PUBLIC_COLS} ${FROM} WHERE p.id = ? AND ${VISIBLE}`, id);
}

function featured(limit = 10) {
  return all(`SELECT ${PUBLIC_COLS} ${FROM} WHERE ${VISIBLE} AND p.featured = 1 ORDER BY p.updated_at DESC LIMIT ?`, limit);
}

function recent(limit = 10) {
  return all(`SELECT ${PUBLIC_COLS} ${FROM} WHERE ${VISIBLE} ORDER BY p.new_product DESC, p.created_at DESC, p.id DESC LIMIT ?`, limit);
}

function related(product, limit = 5) {
  return all(`SELECT ${PUBLIC_COLS} ${FROM} WHERE ${VISIBLE} AND p.id != ? AND (p.category_id = ? OR (p.brand = ? AND p.brand != ''))
    ORDER BY (p.category_id = ?) DESC, p.featured DESC, p.name LIMIT ?`,
  product.id, product.category_id, product.brand || '', product.category_id, limit);
}

function brands() {
  return all(`SELECT DISTINCT p.brand AS brand ${FROM} WHERE ${VISIBLE} AND p.brand IS NOT NULL AND p.brand != '' ORDER BY p.brand`).map((r) => r.brand);
}

function packSizes() {
  return all(`SELECT DISTINCT p.pack_size AS pack ${FROM} WHERE ${VISIBLE} AND p.pack_size IS NOT NULL AND p.pack_size != '' ORDER BY p.pack_size`).map((r) => r.pack);
}

const SORTS = {
  relevance: null,
  newest: 'p.created_at DESC, p.id DESC',
  name: 'p.name COLLATE NOCASE ASC',
  brand: 'p.brand COLLATE NOCASE ASC, p.name',
};

/**
 * Search/filter the visible catalogue.
 * Matches name, brand, SKU, category name and description; name/SKU hits rank first.
 */
function search(opts = {}) {
  const where = [VISIBLE];
  const params = [];
  const q = String(opts.q || '').trim().slice(0, 100);
  let rank = '0';
  const rankParams = [];

  if (q) {
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);
    for (const t of terms) {
      const like = `%${t.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      where.push(`(p.name LIKE ? ESCAPE '\\' OR p.brand LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')`);
      params.push(like, like, like, like, like);
    }
    rank = `(CASE WHEN p.sku = ? COLLATE NOCASE THEN 100 ELSE 0 END) + (CASE WHEN p.name LIKE ? THEN 20 ELSE 0 END) + (CASE WHEN p.brand LIKE ? THEN 10 ELSE 0 END) + p.featured`;
    rankParams.push(q, `%${q}%`, `%${q}%`);
  }
  if (opts.category) { where.push('c.slug = ?'); params.push(String(opts.category)); }
  if (opts.brand) { where.push('p.brand = ?'); params.push(String(opts.brand)); }
  if (opts.pack) { where.push('p.pack_size = ?'); params.push(String(opts.pack)); }
  if (opts.isNew) where.push('p.new_product = 1');
  if (opts.featured) where.push('p.featured = 1');
  if (opts.availability === 'in') where.push('p.stock_quantity > 0');
  if (opts.availability === 'out') where.push('p.stock_quantity <= 0');

  const whereSql = where.join(' AND ');
  const total = get(`SELECT COUNT(*) AS n ${FROM} WHERE ${whereSql}`, ...params).n;

  const perPage = Math.min(Math.max(Number(opts.perPage) || 24, 1), 100);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(Number(opts.page) || 1, 1), pages);

  const sortKey = SORTS[opts.sort] !== undefined ? opts.sort : 'relevance';
  const order = SORTS[sortKey] || (q ? 'rank DESC, p.name COLLATE NOCASE' : 'c.display_order, p.featured DESC, p.name COLLATE NOCASE');

  const rows = all(`SELECT ${PUBLIC_COLS}, ${rank} AS rank ${FROM} WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...rankParams, ...params, perPage, (page - 1) * perPage);

  return { rows, total, page, pages, perPage, sort: sortKey };
}

module.exports = {
  forViewer, forViewerAll, availability, activeCategories, categoryBySlug, productBySlug, productById,
  featured, recent, related, brands, packSizes, search,
};
