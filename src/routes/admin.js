'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { get, all, run, transaction } = require('../db');
const { requireAdmin, verifyPassword, logIn, rateLimit } = require('../lib/auth');
const { emailBuyer } = require('../lib/notify');
const charts = require('../lib/charts');
const {
  clean, toInt, toMoney, slugify, money, OFFER_STATUSES, ENQUIRY_STATUSES, statusLabel,
} = require('../lib/util');

const router = express.Router();
router.use((req, res, next) => { res.locals.adminArea = true; res.set('X-Robots-Tag', 'noindex'); next(); });

/* ---------------- Uploads ---------------- */

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(config.uploadDir, 'products');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 40 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    const err = new Error('Please upload a JPG, PNG, WebP or GIF image.');
    err.status = 400; err.expose = true;
    cb(err);
  },
});

const withImage = (field) => [upload.single(field)];

function removeUpload(url) {
  if (!url || !url.startsWith('/uploads/products/')) return; // never delete demo/seed images
  const file = path.join(config.uploadDir, 'products', path.basename(url));
  fs.rm(file, { force: true }, () => {});
}

/* ---------------- Auth ---------------- */

const loginLimiter = rateLimit({ windowMs: 15 * 60e3, max: 8, message: 'Too many login attempts. Please wait 15 minutes.' });

router.get('/login', (req, res) => {
  if (req.user?.role === 'admin') return res.redirect('/admin');
  res.render('pages/login', { meta: { title: 'Admin Login | WholesaleHub', noindex: true }, email: '', error: null, admin: true });
});

router.post('/login', loginLimiter, (req, res, next) => {
  const email = clean(req.body.email, 200).toLowerCase();
  const user = get("SELECT id, password_hash, role FROM users WHERE email = ? AND role = 'admin'", email);
  if (!user || !verifyPassword(req.body.password || '', user.password_hash)) {
    return res.status(401).render('pages/login', { meta: { title: 'Admin Login | WholesaleHub', noindex: true }, email, error: 'Incorrect admin email or password.', admin: true });
  }
  logIn(req, user, (err, returnTo) => {
    if (err) return next(err);
    res.redirect(returnTo && returnTo.startsWith('/admin') ? returnTo : '/admin');
  });
});

router.use(requireAdmin);

/* ---------------- Dashboard & statistics ---------------- */

const POTENTIAL = "quantity * COALESCE(agreed_price, counter_price, offer_price)";

router.get('/', (req, res) => {
  const s = get(`SELECT
    (SELECT COUNT(*) FROM products) AS products,
    (SELECT COUNT(*) FROM products WHERE active = 1) AS active_products,
    (SELECT COUNT(*) FROM products WHERE stock_quantity <= 0) AS out_of_stock,
    (SELECT COUNT(*) FROM users WHERE role = 'buyer') AS buyers,
    (SELECT COUNT(*) FROM users WHERE role = 'buyer' AND created_at >= datetime('now','-30 days')) AS new_buyers,
    (SELECT COUNT(*) FROM enquiries) AS enquiries,
    (SELECT COUNT(*) FROM enquiries WHERE status = 'new') AS new_enquiries,
    (SELECT COUNT(*) FROM offers) AS offers,
    (SELECT COUNT(*) FROM offers WHERE status = 'new') AS new_offers,
    (SELECT COUNT(*) FROM offers WHERE created_at >= datetime('now','-7 days')) AS offers_week,
    (SELECT COUNT(*) FROM offers WHERE created_at >= datetime('now','start of month')) AS offers_month,
    (SELECT COUNT(*) FROM offers WHERE status IN ('accepted','completed')) AS accepted,
    (SELECT COALESCE(SUM(${POTENTIAL}),0) FROM offers WHERE status NOT IN ('rejected')) AS potential_value,
    (SELECT COALESCE(SUM(${POTENTIAL}),0) FROM offers WHERE status IN ('accepted','completed')) AS won_value,
    (SELECT COUNT(*) FROM contact_messages WHERE is_read = 0) AS unread_messages`);

  // Offers per week, last 12 weeks (weeks starting Monday)
  const weeks = [];
  const now = new Date();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
  for (let i = 11; i >= 0; i--) {
    const start = new Date(monday.getTime() - i * 7 * 86400e3);
    const end = new Date(start.getTime() + 7 * 86400e3);
    const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
    const n = get('SELECT COUNT(*) AS n FROM offers WHERE created_at >= ? AND created_at < ?', iso(start), iso(end)).n;
    weeks.push({ label: start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }), value: n });
  }

  const byStatus = OFFER_STATUSES.map(([k, label]) => ({ label, key: k, value: get('SELECT COUNT(*) AS n FROM offers WHERE status = ?', k).n }));
  const mostViewed = all('SELECT name AS label, views AS value, id FROM products ORDER BY views DESC LIMIT 8');
  const mostOffered = all(`SELECT o.product_name AS label, COUNT(*) AS value FROM offers o GROUP BY o.product_id, o.product_name ORDER BY value DESC LIMIT 8`);
  const popularCats = all(`SELECT c.name AS label,
      (SELECT COUNT(*) FROM offers o JOIN products p ON p.id = o.product_id WHERE p.category_id = c.id) AS offers,
      (SELECT COALESCE(SUM(p.views),0) FROM products p WHERE p.category_id = c.id) AS views
    FROM categories c`).map((r) => ({ label: r.label, value: r.offers, views: r.views }))
    .sort((a, b) => b.value - a.value || b.views - a.views).slice(0, 8);

  const recentOffers = all(`SELECT id, reference, buyer_name, business_name, product_name, quantity, offer_price, status, created_at
    FROM offers ORDER BY created_at DESC LIMIT 6`);
  const lowStock = all('SELECT id, name, sku, stock_quantity FROM products WHERE active = 1 AND stock_quantity < 60 ORDER BY stock_quantity LIMIT 6');

  res.render('admin/dashboard', {
    meta: { title: 'Dashboard | WholesaleHub Admin' },
    s, weeks, byStatus, mostViewed, mostOffered, popularCats, recentOffers, lowStock,
    charts: {
      weeks: charts.columnChart(weeks, { title: 'Offers per week, last 12 weeks' }),
      status: charts.barList(byStatus, { title: 'Offers by status' }),
      viewed: charts.barList(mostViewed, { title: 'Most viewed products', format: (v) => v.toLocaleString('en-GB') }),
      offered: charts.barList(mostOffered, { title: 'Most offered products' }),
      cats: charts.barList(popularCats, { title: 'Most popular categories by offers' }),
    },
    section: 'dashboard',
  });
});

/* ---------------- Notifications ---------------- */

router.get('/notifications', (req, res) => {
  const notifications = all('SELECT * FROM notifications ORDER BY created_at DESC, id DESC LIMIT 100');
  res.render('admin/notifications', { meta: { title: 'Notifications | WholesaleHub Admin' }, notifications, section: 'notifications' });
});
router.post('/notifications/read', (req, res) => {
  run('UPDATE notifications SET is_read = 1');
  res.redirect('/admin/notifications');
});
router.get('/notifications/:id/go', (req, res) => {
  const n = get('SELECT link FROM notifications WHERE id = ?', toInt(req.params.id));
  run('UPDATE notifications SET is_read = 1 WHERE id = ?', toInt(req.params.id));
  res.redirect(n?.link && n.link.startsWith('/') ? n.link : '/admin/notifications');
});

/* ---------------- Products ---------------- */

router.get('/products', (req, res) => {
  const q = clean(req.query.q, 100);
  const cat = toInt(req.query.category);
  const status = String(req.query.status || '');
  const where = ['1=1'];
  const params = [];
  if (q) { where.push('(p.name LIKE ? OR p.brand LIKE ? OR p.sku LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (cat) { where.push('p.category_id = ?'); params.push(cat); }
  if (status === 'active') where.push('p.active = 1');
  if (status === 'inactive') where.push('p.active = 0');
  if (status === 'featured') where.push('p.featured = 1');
  if (status === 'new') where.push('p.new_product = 1');
  if (status === 'out') where.push('p.stock_quantity <= 0');
  const products = all(`SELECT p.*, c.name AS category_name,
      (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id) AS offer_count
    FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}
    ORDER BY p.updated_at DESC, p.id DESC`, ...params);
  res.render('admin/products', {
    meta: { title: 'Products | WholesaleHub Admin' }, products, q, cat, status,
    categories: all('SELECT id, name FROM categories ORDER BY display_order, name'), section: 'products',
  });
});

const EMPTY_PRODUCT = {
  name: '', brand: '', sku: '', category_id: '', description: '', image: '', pack_size: '', minimum_order: 1,
  stock_quantity: 0, wholesale_price: '', suggested_price: '', cost_price: '', active: 1, featured: 0, new_product: 1, age_restricted: 0, slug: '',
};

function productForm(res, { product, errors = {}, status = 200 }) {
  res.status(status).render('admin/product-form', {
    meta: { title: `${product.id ? 'Edit' : 'Add'} Product | WholesaleHub Admin` },
    product, errors, categories: all('SELECT id, name FROM categories ORDER BY display_order, name'), section: 'products',
  });
}

function nextSku() {
  const row = get("SELECT MAX(id) AS m FROM products");
  return `WH-${String(1001 + (row.m || 0))}`;
}

router.get('/products/new', (req, res) => productForm(res, { product: { ...EMPTY_PRODUCT, sku: nextSku(), category_id: toInt(req.query.category) || '' } }));

router.get('/products/:id/edit', (req, res, next) => {
  const product = get('SELECT * FROM products WHERE id = ?', toInt(req.params.id));
  if (!product) return next();
  productForm(res, { product });
});

function readProduct(req, existing) {
  const b = req.body;
  const p = {
    name: clean(b.name, 160), brand: clean(b.brand, 80), sku: clean(b.sku, 40).toUpperCase(),
    category_id: toInt(b.category_id), description: clean(b.description, 5000), pack_size: clean(b.pack_size, 60),
    minimum_order: Math.max(1, toInt(b.minimum_order, 1)), stock_quantity: Math.max(0, toInt(b.stock_quantity, 0)),
    wholesale_price: toMoney(b.wholesale_price), suggested_price: toMoney(b.suggested_price), cost_price: toMoney(b.cost_price),
    active: b.active ? 1 : 0, featured: b.featured ? 1 : 0, new_product: b.new_product ? 1 : 0, age_restricted: b.age_restricted ? 1 : 0,
    slug: slugify(clean(b.slug, 90) || `${clean(b.brand, 80)} ${clean(b.name, 160)}`),
    image: existing?.image || '',
  };
  const errors = {};
  if (!p.name) errors.name = 'Product name is required.';
  if (!p.sku) errors.sku = 'SKU is required.';
  else if (get('SELECT id FROM products WHERE sku = ? AND id != ?', p.sku, existing?.id || 0)) errors.sku = 'Another product already uses this SKU.';
  if (!p.category_id || !get('SELECT id FROM categories WHERE id = ?', p.category_id)) errors.category_id = 'Please choose a category.';
  // Keep slugs unique by suffixing.
  let slug = p.slug, n = 2;
  while (get('SELECT id FROM products WHERE slug = ? AND id != ?', slug, existing?.id || 0)) slug = `${p.slug}-${n++}`;
  p.slug = slug;
  if (req.file) p.image = `/uploads/products/${req.file.filename}`;
  else if (b.remove_image && existing?.image) p.image = '';
  return { p, errors };
}

router.post('/products', ...withImage('image'), (req, res) => {
  const { p, errors } = readProduct(req, null);
  if (Object.keys(errors).length) {
    if (req.file) removeUpload(p.image);
    return productForm(res, { product: { ...p, image: '' }, errors, status: 422 });
  }
  const r = run(`INSERT INTO products (name, slug, brand, sku, category_id, description, image, pack_size, minimum_order, stock_quantity,
      wholesale_price, suggested_price, cost_price, active, featured, new_product, age_restricted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  p.name, p.slug, p.brand, p.sku, p.category_id, p.description, p.image, p.pack_size, p.minimum_order, p.stock_quantity,
  p.wholesale_price, p.suggested_price, p.cost_price, p.active, p.featured, p.new_product, p.age_restricted);
  req.flash('success', `Product “${p.name}” saved${p.active ? ' and is now live in the catalogue' : ' (inactive — hidden from the catalogue)'}.`);
  res.redirect(req.body.save_and_new ? '/admin/products/new' : `/admin/products/${r.lastInsertRowid}/edit`);
});

router.post('/products/:id', ...withImage('image'), (req, res, next) => {
  const existing = get('SELECT * FROM products WHERE id = ?', toInt(req.params.id));
  if (!existing) return next();
  const { p, errors } = readProduct(req, existing);
  if (Object.keys(errors).length) {
    if (req.file) removeUpload(p.image);
    return productForm(res, { product: { ...existing, ...p, id: existing.id, image: existing.image }, errors, status: 422 });
  }
  run(`UPDATE products SET name = ?, slug = ?, brand = ?, sku = ?, category_id = ?, description = ?, image = ?, pack_size = ?, minimum_order = ?,
      stock_quantity = ?, wholesale_price = ?, suggested_price = ?, cost_price = ?, active = ?, featured = ?, new_product = ?, age_restricted = ?,
      updated_at = datetime('now') WHERE id = ?`,
  p.name, p.slug, p.brand, p.sku, p.category_id, p.description, p.image, p.pack_size, p.minimum_order, p.stock_quantity,
  p.wholesale_price, p.suggested_price, p.cost_price, p.active, p.featured, p.new_product, p.age_restricted, existing.id);
  if (existing.image !== p.image) removeUpload(existing.image);
  req.flash('success', `Product “${p.name}” updated.`);
  res.redirect(req.body.save_and_new ? '/admin/products/new' : `/admin/products/${existing.id}/edit`);
});

router.post('/products/:id/toggle', (req, res, next) => {
  const field = { active: 'active', featured: 'featured', new_product: 'new_product' }[req.body.field];
  const product = get('SELECT id FROM products WHERE id = ?', toInt(req.params.id));
  if (!field || !product) return next();
  run(`UPDATE products SET ${field} = 1 - ${field}, updated_at = datetime('now') WHERE id = ?`, product.id);
  if (req.get('accept')?.includes('application/json')) return res.json({ ok: true, value: get(`SELECT ${field} AS v FROM products WHERE id = ?`, product.id).v });
  res.redirect(req.get('referer')?.includes('/admin/products') ? req.get('referer') : '/admin/products');
});

router.post('/products/:id/delete', (req, res, next) => {
  const product = get('SELECT id, name, image FROM products WHERE id = ?', toInt(req.params.id));
  if (!product) return next();
  run('DELETE FROM products WHERE id = ?', product.id);
  removeUpload(product.image);
  req.flash('success', `Deleted “${product.name}”. Existing offers keep the product name for your records.`);
  res.redirect('/admin/products');
});

/* ---------------- Categories ---------------- */

router.get('/categories', (req, res) => {
  const categories = all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
    FROM categories c ORDER BY c.display_order, c.name`);
  res.render('admin/categories', { meta: { title: 'Categories | WholesaleHub Admin' }, categories, edit: toInt(req.query.edit), section: 'categories' });
});

function readCategory(req, existing) {
  const name = clean(req.body.name, 80);
  let slug = slugify(clean(req.body.slug, 80) || name);
  let n = 2;
  const base = slug;
  while (get('SELECT id FROM categories WHERE slug = ? AND id != ?', slug, existing?.id || 0)) slug = `${base}-${n++}`;
  let image = existing?.image || '';
  if (req.file) image = `/uploads/products/${req.file.filename}`;
  return { name, slug, description: clean(req.body.description, 500), active: req.body.active ? 1 : 0, image };
}

router.post('/categories', ...withImage('image'), (req, res) => {
  const c = readCategory(req, null);
  if (!c.name) { req.flash('error', 'Category name is required.'); return res.redirect('/admin/categories'); }
  const order = (get('SELECT MAX(display_order) AS m FROM categories').m || 0) + 1;
  run('INSERT INTO categories (name, slug, description, image, display_order, active) VALUES (?, ?, ?, ?, ?, ?)', c.name, c.slug, c.description, c.image, order, c.active);
  req.flash('success', `Category “${c.name}” added.`);
  res.redirect('/admin/categories');
});

// Full reorder from drag-and-drop (JSON: {order: [id, id, ...]})
router.post('/categories/reorder', (req, res) => {
  const order = Array.isArray(req.body.order) ? req.body.order.map((v) => toInt(v)).filter(Boolean) : [];
  transaction(() => order.forEach((id, i) => run('UPDATE categories SET display_order = ? WHERE id = ?', i + 1, id)));
  res.json({ ok: true });
});

router.post('/categories/:id', ...withImage('image'), (req, res, next) => {
  const existing = get('SELECT * FROM categories WHERE id = ?', toInt(req.params.id));
  if (!existing) return next();
  const c = readCategory(req, existing);
  if (!c.name) { req.flash('error', 'Category name is required.'); return res.redirect(`/admin/categories?edit=${existing.id}`); }
  run('UPDATE categories SET name = ?, slug = ?, description = ?, image = ?, active = ? WHERE id = ?', c.name, c.slug, c.description, c.image, c.active, existing.id);
  if (existing.image !== c.image) removeUpload(existing.image);
  req.flash('success', `Category “${c.name}” updated.`);
  res.redirect('/admin/categories');
});

router.post('/categories/:id/move', (req, res, next) => {
  const cats = all('SELECT id FROM categories ORDER BY display_order, name');
  const idx = cats.findIndex((c) => c.id === toInt(req.params.id));
  if (idx < 0) return next();
  const dir = req.body.dir === 'up' ? -1 : 1;
  const swap = idx + dir;
  if (swap >= 0 && swap < cats.length) {
    [cats[idx], cats[swap]] = [cats[swap], cats[idx]];
    transaction(() => cats.forEach((c, i) => run('UPDATE categories SET display_order = ? WHERE id = ?', i + 1, c.id)));
  }
  res.redirect('/admin/categories#c' + req.params.id);
});

router.post('/categories/:id/delete', (req, res, next) => {
  const c = get('SELECT id, name, image FROM categories WHERE id = ?', toInt(req.params.id));
  if (!c) return next();
  const count = get('SELECT COUNT(*) AS n FROM products WHERE category_id = ?', c.id).n;
  if (count > 0 && !req.body.force) {
    req.flash('error', `“${c.name}” still has ${count} product(s). Move them to another category first, or confirm deletion to leave them uncategorised.`);
    return res.redirect(`/admin/categories?edit=${c.id}`);
  }
  run('DELETE FROM categories WHERE id = ?', c.id);
  removeUpload(c.image);
  req.flash('success', `Category “${c.name}” deleted.`);
  res.redirect('/admin/categories');
});

/* ---------------- Offers ---------------- */

router.get('/offers', (req, res) => {
  const status = String(req.query.status || '');
  const q = clean(req.query.q, 100);
  const where = ['1=1'];
  const params = [];
  if (status) { where.push('o.status = ?'); params.push(status); }
  if (q) { where.push('(o.reference LIKE ? OR o.buyer_name LIKE ? OR o.business_name LIKE ? OR o.product_name LIKE ? OR o.email LIKE ?)'); params.push(...Array(5).fill(`%${q}%`)); }
  const offers = all(`SELECT o.*, p.wholesale_price, p.cost_price, p.slug AS product_slug FROM offers o LEFT JOIN products p ON p.id = o.product_id
    WHERE ${where.join(' AND ')} ORDER BY CASE o.status WHEN 'new' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'counter_offer' THEN 2 ELSE 3 END, o.created_at DESC`, ...params);
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM offers GROUP BY status').map((r) => [r.status, r.n]));
  res.render('admin/offers', { meta: { title: 'Offers | WholesaleHub Admin' }, offers, status, q, counts, section: 'offers' });
});

router.get('/offers/:id', (req, res, next) => {
  const offer = get(`SELECT o.*, p.slug AS product_slug, p.sku, p.wholesale_price, p.suggested_price, p.cost_price, p.stock_quantity, p.minimum_order, p.pack_size, p.image AS product_image,
      u.created_at AS buyer_since FROM offers o LEFT JOIN products p ON p.id = o.product_id LEFT JOIN users u ON u.id = o.buyer_id WHERE o.id = ?`, toInt(req.params.id));
  if (!offer) return next();
  const messages = all('SELECT * FROM offer_messages WHERE offer_id = ? ORDER BY created_at, id', offer.id);
  const history = all('SELECT id, reference, product_name, quantity, offer_price, status, created_at FROM offers WHERE email = ? AND id != ? ORDER BY created_at DESC LIMIT 10', offer.email, offer.id);
  run("UPDATE notifications SET is_read = 1 WHERE link = ?", `/admin/offers/${offer.id}`);
  res.render('admin/offer', { meta: { title: `Offer ${offer.reference} | WholesaleHub Admin` }, offer, messages, history, section: 'offers' });
});

router.post('/offers/:id', (req, res, next) => {
  const offer = get('SELECT * FROM offers WHERE id = ?', toInt(req.params.id));
  if (!offer) return next();
  const b = req.body;
  const action = String(b.action || 'save');
  let status = OFFER_STATUSES.some(([k]) => k === b.status) ? b.status : offer.status;
  let counter = offer.counter_price;
  let agreed = offer.agreed_price;
  const msg = clean(b.buyer_message, 2000);
  let autoMsg = '';

  if (action === 'accept') { status = 'accepted'; agreed = offer.counter_price && offer.status === 'counter_offer' ? offer.counter_price : offer.offer_price; autoMsg = `Good news — your offer has been accepted at ${money(agreed)} per pack. We will contact you to arrange the order.`; }
  if (action === 'reject') { status = 'rejected'; autoMsg = 'Thank you for your offer. Unfortunately we are unable to accept it on this occasion.'; }
  if (action === 'counter') {
    const cp = toMoney(b.counter_price);
    if (!cp) { req.flash('error', 'Enter a counter-offer price.'); return res.redirect(`/admin/offers/${offer.id}`); }
    status = 'counter_offer'; counter = cp;
    autoMsg = `We can offer ${money(cp)} per pack for ${offer.quantity} × ${offer.product_name}. You can accept this counter-offer from your offer page.`;
  }
  if (action === 'complete') { status = 'completed'; agreed = agreed || counter || offer.offer_price; }
  if (action === 'save' && ['accepted', 'completed'].includes(status) && !agreed) agreed = counter || offer.offer_price;

  const notes = b.admin_notes !== undefined ? clean(b.admin_notes, 5000) : offer.admin_notes;
  run("UPDATE offers SET status = ?, counter_price = ?, agreed_price = ?, admin_notes = ?, updated_at = datetime('now') WHERE id = ?",
    status, counter, agreed, notes, offer.id);

  const buyerMessage = [autoMsg, msg].filter(Boolean).join('\n\n');
  if (buyerMessage) run("INSERT INTO offer_messages (offer_id, sender_role, message) VALUES (?, 'admin', ?)", offer.id, buyerMessage);
  if (status !== offer.status || buyerMessage) {
    emailBuyer(offer.email, `Update on your offer ${offer.reference}: ${statusLabel(OFFER_STATUSES, status)}`,
      `${buyerMessage || `Your offer status is now: ${statusLabel(OFFER_STATUSES, status)}`}\n\nView your offer: ${config.siteUrl}/offers/track/${offer.access_token}`);
  }
  req.flash('success', `Offer ${offer.reference} updated — status: ${statusLabel(OFFER_STATUSES, status)}.`);
  res.redirect(`/admin/offers/${offer.id}`);
});

router.post('/offers/:id/delete', (req, res, next) => {
  const offer = get('SELECT id, reference FROM offers WHERE id = ?', toInt(req.params.id));
  if (!offer) return next();
  run('DELETE FROM offers WHERE id = ?', offer.id);
  req.flash('success', `Offer ${offer.reference} deleted.`);
  res.redirect('/admin/offers');
});

/* ---------------- Enquiries ---------------- */

router.get('/enquiries', (req, res) => {
  const status = String(req.query.status || '');
  const enquiries = all(`SELECT e.*, p.name AS product_name FROM enquiries e LEFT JOIN products p ON p.id = e.product_id
    ${status ? 'WHERE e.status = ?' : ''} ORDER BY e.created_at DESC`, ...(status ? [status] : []));
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status').map((r) => [r.status, r.n]));
  res.render('admin/enquiries', { meta: { title: 'Enquiries | WholesaleHub Admin' }, enquiries, status, counts, section: 'enquiries' });
});

router.get('/enquiries/:id', (req, res, next) => {
  const enquiry = get(`SELECT e.*, p.name AS product_name, p.slug AS product_slug, p.sku FROM enquiries e
    LEFT JOIN products p ON p.id = e.product_id WHERE e.id = ?`, toInt(req.params.id));
  if (!enquiry) return next();
  run("UPDATE notifications SET is_read = 1 WHERE link = ?", `/admin/enquiries/${enquiry.id}`);
  res.render('admin/enquiry', { meta: { title: `Enquiry ${enquiry.reference} | WholesaleHub Admin` }, enquiry, section: 'enquiries' });
});

router.post('/enquiries/:id', (req, res, next) => {
  const e = get('SELECT * FROM enquiries WHERE id = ?', toInt(req.params.id));
  if (!e) return next();
  const reply = clean(req.body.reply, 5000);
  let status = ENQUIRY_STATUSES.some(([k]) => k === req.body.status) ? req.body.status : e.status;
  if (reply && reply !== e.reply && status === 'new') status = 'replied';
  run('UPDATE enquiries SET status = ?, reply = ?, admin_notes = ? WHERE id = ?', status, reply || null, clean(req.body.admin_notes, 5000) || null, e.id);
  if (reply && reply !== e.reply) emailBuyer(e.email, `Re: your enquiry ${e.reference}`, reply);
  req.flash('success', `Enquiry ${e.reference} updated.`);
  res.redirect(`/admin/enquiries/${e.id}`);
});

router.post('/enquiries/:id/delete', (req, res) => {
  run('DELETE FROM enquiries WHERE id = ?', toInt(req.params.id));
  req.flash('success', 'Enquiry deleted.');
  res.redirect('/admin/enquiries');
});

/* ---------------- Contact messages ---------------- */

router.get('/messages', (req, res) => {
  const messages = all('SELECT * FROM contact_messages ORDER BY created_at DESC');
  res.render('admin/messages', { meta: { title: 'Contact Messages | WholesaleHub Admin' }, messages, section: 'messages' });
});
router.post('/messages/:id/read', (req, res) => {
  run('UPDATE contact_messages SET is_read = 1 - is_read WHERE id = ?', toInt(req.params.id));
  res.redirect('/admin/messages#m' + toInt(req.params.id));
});
router.post('/messages/:id/delete', (req, res) => {
  run('DELETE FROM contact_messages WHERE id = ?', toInt(req.params.id));
  req.flash('success', 'Message deleted.');
  res.redirect('/admin/messages');
});

/* ---------------- Buyers ---------------- */

const BUYER_STATS = `
  (SELECT COUNT(*) FROM enquiries e WHERE e.buyer_id = u.id) AS enquiry_count,
  (SELECT COUNT(*) FROM offers o WHERE o.buyer_id = u.id) AS offer_count,
  (SELECT COUNT(*) FROM offers o WHERE o.buyer_id = u.id AND o.status IN ('accepted','completed')) AS accepted_count,
  (SELECT COALESCE(SUM(${POTENTIAL}),0) FROM offers o WHERE o.buyer_id = u.id AND o.status != 'rejected') AS potential_value`;

router.get('/buyers', (req, res) => {
  const q = clean(req.query.q, 100);
  const buyers = all(`SELECT u.id, u.name, u.email, u.phone, u.business_name, u.business_type, u.postcode, u.created_at, ${BUYER_STATS}
    FROM users u WHERE u.role = 'buyer' ${q ? 'AND (u.name LIKE ? OR u.business_name LIKE ? OR u.email LIKE ?)' : ''}
    ORDER BY u.created_at DESC`, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []));
  res.render('admin/buyers', { meta: { title: 'Buyers | WholesaleHub Admin' }, buyers, q, section: 'buyers' });
});

router.get('/buyers/:id', (req, res, next) => {
  const buyer = get(`SELECT u.id, u.name, u.email, u.phone, u.business_name, u.business_type, u.address, u.postcode, u.vat_number, u.created_at, ${BUYER_STATS}
    FROM users u WHERE u.id = ? AND u.role = 'buyer'`, toInt(req.params.id));
  if (!buyer) return next();
  const offers = all('SELECT id, reference, product_name, quantity, offer_price, counter_price, agreed_price, status, created_at FROM offers WHERE buyer_id = ? ORDER BY created_at DESC', buyer.id);
  const enquiries = all('SELECT e.id, e.reference, e.message, e.status, e.created_at, p.name AS product_name FROM enquiries e LEFT JOIN products p ON p.id = e.product_id WHERE e.buyer_id = ? ORDER BY e.created_at DESC', buyer.id);
  const saved = all('SELECT p.id, p.name, p.sku FROM saved_products s JOIN products p ON p.id = s.product_id WHERE s.buyer_id = ? ORDER BY s.created_at DESC', buyer.id);
  res.render('admin/buyer', { meta: { title: `${buyer.business_name || buyer.name} | WholesaleHub Admin` }, buyer, offers, enquiries, saved, section: 'buyers' });
});

router.post('/buyers/:id/delete', (req, res, next) => {
  const buyer = get("SELECT id, name FROM users WHERE id = ? AND role = 'buyer'", toInt(req.params.id));
  if (!buyer) return next();
  run('DELETE FROM users WHERE id = ?', buyer.id);
  run("DELETE FROM sessions WHERE json_extract(data, '$.userId') = ?", buyer.id);
  req.flash('success', `Buyer account for ${buyer.name} deleted. Their offers are kept for your records.`);
  res.redirect('/admin/buyers');
});

module.exports = router;
