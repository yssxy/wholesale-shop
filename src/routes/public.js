'use strict';

const express = require('express');
const config = require('../config');
const catalog = require('../lib/catalog');
const { get, all, run } = require('../db');
const { notifyAdmin } = require('../lib/notify');
const { hashPassword, verifyPassword, logIn, rateLimit } = require('../lib/auth');
const { clean, isEmail, toInt, toMoney, token, reference, money, truncate, CONTACT_METHODS } = require('../lib/util');

const router = express.Router();
const formLimiter = rateLimit({ windowMs: 10 * 60e3, max: 20, message: 'Too many submissions from your connection. Please wait a few minutes.' });
const loginLimiter = rateLimit({ windowMs: 15 * 60e3, max: 10, message: 'Too many login attempts. Please wait 15 minutes and try again.' });

/* ---------------- Home ---------------- */

router.get('/', (req, res) => {
  res.render('pages/home', {
    meta: {
      title: 'WholesaleHub | UK Trade Wholesale Catalogue – Make an Offer',
      description: 'Browse wholesale carrier bags, batteries, drinks, catering disposables, phone accessories and more. UK trade supplier — make an offer on any product.',
    },
    featured: catalog.forViewerAll(catalog.featured(10), req.user),
    recent: catalog.forViewerAll(catalog.recent(10), req.user),
  });
});

/* ---------------- Catalogue & search ---------------- */

function listingOptions(req, extra = {}) {
  return {
    q: req.query.q,
    category: req.query.category,
    brand: req.query.brand,
    pack: req.query.pack,
    availability: req.query.availability,
    isNew: req.query.new === '1',
    featured: req.query.featured === '1',
    sort: req.query.sort,
    page: req.query.page,
    ...extra,
  };
}

function renderListing(req, res, { heading, intro, meta, fixed = {}, category = null }) {
  const opts = listingOptions(req, fixed);
  const result = catalog.search(opts);
  res.render('pages/products', {
    meta,
    heading,
    intro,
    category,
    opts,
    fixed,
    result,
    products: catalog.forViewerAll(result.rows, req.user),
    brands: catalog.brands(),
    packSizes: catalog.packSizes(),
  });
}

router.get('/products', (req, res) => {
  const q = String(req.query.q || '').trim();
  renderListing(req, res, {
    heading: q ? `Search results for “${truncate(q, 40)}”` : 'All Products',
    meta: {
      title: q ? `Search: ${truncate(q, 40)} | WholesaleHub` : 'All Wholesale Products | WholesaleHub',
      description: 'Search the full WholesaleHub trade catalogue by product name, brand, SKU or category.',
      noindex: Boolean(q),
    },
  });
});

router.get('/search', (req, res) => res.redirect(301, '/products' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '')));

router.get('/new-products', (req, res) => {
  renderListing(req, res, {
    heading: 'New Products',
    intro: 'The latest lines added to our wholesale catalogue.',
    fixed: { isNew: true },
    meta: { title: 'New Wholesale Products | WholesaleHub', description: 'The newest trade lines added to the WholesaleHub catalogue.' },
  });
});

router.get('/categories', (req, res) => {
  res.render('pages/categories', {
    meta: { title: 'Product Categories | WholesaleHub', description: 'Browse wholesale product categories: bags, batteries, drinks, catering, confectionery and more.' },
  });
});

router.get('/category/:slug', (req, res, next) => {
  const category = catalog.categoryBySlug(req.params.slug);
  if (!category) return next();
  renderListing(req, res, {
    heading: category.name,
    intro: category.description,
    category,
    fixed: { category: category.slug },
    meta: {
      title: `Wholesale ${category.name} | WholesaleHub`,
      description: `${category.description || `Wholesale ${category.name}`} Trade prices for UK retailers — make an offer today.`.slice(0, 160),
      image: category.image,
    },
  });
});

// Instant search suggestions (public fields only)
router.get('/api/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const { rows, total } = catalog.search({ q, perPage: 8 });
  res.set('Cache-Control', 'no-store');
  res.json({
    total,
    results: rows.map((p) => ({
      name: p.name, brand: p.brand, sku: p.sku, category: p.category_name, pack: p.pack_size,
      url: `/products/${p.slug}`, image: p.image,
    })),
  });
});

/* ---------------- Product ---------------- */

router.get('/products/:slug', (req, res, next) => {
  const raw = catalog.productBySlug(req.params.slug);
  if (!raw) return next();
  // Count views from visitors and buyers only.
  if (req.user?.role !== 'admin') run('UPDATE products SET views = views + 1 WHERE id = ?', raw.id);
  const product = catalog.forViewer(raw, req.user);
  const u = req.user?.role === 'buyer' ? get('SELECT name, business_name, email, phone FROM users WHERE id = ?', req.user.id) : {};
  const enquiry = { name: u.name || '', business_name: u.business_name || '', email: u.email || '', phone: u.phone || '', message: '', ...(req.session.enquiryDraft || {}) };
  delete req.session.enquiryDraft;
  res.render('pages/product', {
    enquiry,
    meta: {
      title: `${product.brand ? product.brand + ' ' : ''}${product.name} – Wholesale | WholesaleHub`,
      description: truncate(`${product.name}${product.pack_size ? ` (${product.pack_size})` : ''}. ${product.description || ''}`, 158),
      image: product.image,
      type: 'product',
    },
    product,
    related: catalog.forViewerAll(catalog.related(raw, 5), req.user),
  });
});

/* ---------------- Make an offer ---------------- */

function offerDefaults(req, product) {
  const u = req.user && req.user.role === 'buyer'
    ? get('SELECT name, business_name, email, phone FROM users WHERE id = ?', req.user.id) : {};
  return {
    buyer_name: u.name || '', business_name: u.business_name || '', email: u.email || '', phone: u.phone || '',
    product_id: product ? product.id : '', quantity: product ? product.minimum_order : '', offer_price: '',
    message: '', contact_method: 'email',
  };
}

function offerProducts() {
  return all(`SELECT p.id, p.name, p.brand, p.pack_size, p.minimum_order FROM products p
    LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1 AND (c.id IS NULL OR c.active = 1) ORDER BY p.name`);
}

router.get('/offer', (req, res) => {
  const product = req.query.product ? catalog.productBySlug(String(req.query.product)) : null;
  res.render('pages/offer', {
    meta: { title: 'Make an Offer | WholesaleHub', description: 'Tell us what you want to pay. Submit a wholesale offer on any product and our trade team will respond quickly.' },
    product: catalog.forViewer(product, req.user),
    products: offerProducts(),
    form: offerDefaults(req, product),
    errors: {},
  });
});

router.post('/offer', formLimiter, (req, res) => {
  const b = req.body;
  const form = {
    buyer_name: clean(b.buyer_name, 120), business_name: clean(b.business_name, 160), email: clean(b.email, 200).toLowerCase(),
    phone: clean(b.phone, 40), product_id: toInt(b.product_id), quantity: toInt(b.quantity),
    offer_price: clean(b.offer_price, 20), message: clean(b.message, 2000),
    contact_method: CONTACT_METHODS.some(([k]) => k === b.contact_method) ? b.contact_method : 'email',
  };
  const product = form.product_id ? catalog.productById(form.product_id) : null;
  const price = toMoney(form.offer_price);
  const errors = {};
  if (!form.buyer_name) errors.buyer_name = 'Please enter your name.';
  if (!isEmail(form.email)) errors.email = 'Please enter a valid email address.';
  if (!product) errors.product_id = 'Please choose a product.';
  if (!form.quantity || form.quantity < 1 || form.quantity > 1e6) errors.quantity = 'Please enter the quantity you need.';
  else if (product && form.quantity < product.minimum_order) errors.quantity = `Minimum order for this product is ${product.minimum_order}.`;
  if (price === null || price <= 0) errors.offer_price = 'Please enter your offer price per pack (e.g. 12.50).';
  if (['phone', 'whatsapp', 'sms'].includes(form.contact_method) && !form.phone) errors.phone = 'Please add a phone number for your preferred contact method.';
  if (b.website) errors.form = 'Submission rejected.'; // honeypot

  if (Object.keys(errors).length) {
    return res.status(422).render('pages/offer', {
      meta: { title: 'Make an Offer | WholesaleHub', noindex: true },
      product: catalog.forViewer(product, req.user), products: offerProducts(), form, errors,
    });
  }

  const ref = reference('OFR');
  const accessToken = token();
  const buyerId = req.user?.role === 'buyer' ? req.user.id : null;
  const r = run(`INSERT INTO offers (reference, access_token, buyer_id, product_id, product_name, buyer_name, business_name, email, phone,
      contact_method, quantity, offer_price, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ref, accessToken, buyerId, product.id, product.name, form.buyer_name, form.business_name, form.email, form.phone,
  form.contact_method, form.quantity, price, form.message);

  notifyAdmin({
    type: 'offer',
    title: `New offer ${ref}: ${form.quantity} × ${product.name} @ ${money(price)}`,
    link: `/admin/offers/${r.lastInsertRowid}`,
    text: `${form.buyer_name}${form.business_name ? ` (${form.business_name})` : ''} offered ${money(price)} per pack for ${form.quantity} × ${product.name}.\nContact: ${form.email} ${form.phone}\n\n${form.message}`,
  });

  req.session.lastOffer = accessToken;
  res.redirect(`/offers/track/${accessToken}?submitted=1`);
});

// Offer status via private link (works for guest offers; buyers also see these in their dashboard)
router.get('/offers/track/:token', (req, res, next) => {
  const offer = get(`SELECT id, reference, access_token, buyer_id, product_id, product_name, buyer_name, business_name, email, phone, contact_method,
      quantity, offer_price, counter_price, agreed_price, message, status, created_at, updated_at FROM offers WHERE access_token = ?`, req.params.token);
  if (!offer) return next();
  const messages = all('SELECT sender_role, message, created_at FROM offer_messages WHERE offer_id = ? ORDER BY created_at, id', offer.id);
  const product = offer.product_id ? catalog.productById(offer.product_id) : null;
  res.set('X-Robots-Tag', 'noindex');
  res.render('pages/offer-status', {
    meta: { title: `Offer ${offer.reference} | WholesaleHub`, noindex: true },
    offer, messages, product: catalog.forViewer(product, req.user),
    submitted: req.query.submitted === '1',
    actionBase: `/offers/track/${offer.access_token}`,
  });
});

router.post('/offers/track/:token/respond', formLimiter, (req, res, next) => {
  const offer = get('SELECT id, reference, status, counter_price, buyer_id FROM offers WHERE access_token = ?', req.params.token);
  if (!offer) return next();
  respondToOffer(req, offer);
  res.redirect(`/offers/track/${req.params.token}`);
});

/**
 * Buyer-side actions on an offer: reply, accept counter-offer, decline counter-offer.
 * Shared by the tracking link and the buyer dashboard.
 */
function respondToOffer(req, offer) {
  const action = req.body.action;
  const message = clean(req.body.message, 2000);
  if (action === 'accept_counter' && offer.status === 'counter_offer' && offer.counter_price) {
    run("UPDATE offers SET status = 'accepted', agreed_price = counter_price, updated_at = datetime('now') WHERE id = ?", offer.id);
    run("INSERT INTO offer_messages (offer_id, sender_role, message) VALUES (?, 'buyer', ?)", offer.id, `Counter-offer of ${money(offer.counter_price)} accepted.${message ? ' ' + message : ''}`);
    notifyAdmin({ type: 'offer', title: `Counter-offer accepted on ${offer.reference}`, link: `/admin/offers/${offer.id}` });
    req.flash('success', 'Counter-offer accepted. Our team will be in touch to arrange your order.');
  } else if (action === 'decline_counter' && offer.status === 'counter_offer') {
    run("UPDATE offers SET status = 'reviewing', updated_at = datetime('now') WHERE id = ?", offer.id);
    run("INSERT INTO offer_messages (offer_id, sender_role, message) VALUES (?, 'buyer', ?)", offer.id, `Counter-offer declined.${message ? ' ' + message : ''}`);
    notifyAdmin({ type: 'offer', title: `Counter-offer declined on ${offer.reference}`, link: `/admin/offers/${offer.id}` });
    req.flash('info', 'Thanks — we have let the team know.');
  } else if (action === 'message' && message) {
    if (['rejected', 'completed'].includes(offer.status)) {
      req.flash('error', 'This offer is closed. Please submit a new offer or contact us.');
      return;
    }
    run("INSERT INTO offer_messages (offer_id, sender_role, message) VALUES (?, 'buyer', ?)", offer.id, message);
    run("UPDATE offers SET updated_at = datetime('now') WHERE id = ?", offer.id);
    notifyAdmin({ type: 'message', title: `New message on offer ${offer.reference}`, link: `/admin/offers/${offer.id}`, text: message });
    req.flash('success', 'Message sent.');
  } else {
    req.flash('error', 'Nothing to send.');
  }
}

/* ---------------- Product enquiry ---------------- */

router.post('/enquiry', formLimiter, (req, res) => {
  const b = req.body;
  const product = toInt(b.product_id) ? catalog.productById(toInt(b.product_id)) : null;
  const back = product ? `/products/${product.slug}#enquiry` : '/contact';
  const form = {
    name: clean(b.name, 120), business_name: clean(b.business_name, 160), email: clean(b.email, 200).toLowerCase(),
    phone: clean(b.phone, 40), message: clean(b.message, 2000),
  };
  if (b.website) return res.redirect(back);
  if (!form.name || !isEmail(form.email) || !form.message) {
    req.flash('error', 'Please add your name, a valid email and your message.');
    req.session.enquiryDraft = form;
    return res.redirect(back);
  }
  const ref = reference('ENQ');
  const r = run(`INSERT INTO enquiries (reference, buyer_id, product_id, name, business_name, email, phone, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ref, req.user?.role === 'buyer' ? req.user.id : null, product?.id || null,
  form.name, form.business_name, form.email, form.phone, form.message);
  notifyAdmin({
    type: 'enquiry', title: `New enquiry ${ref}${product ? ` – ${product.name}` : ''}`,
    link: `/admin/enquiries/${r.lastInsertRowid}`, text: `${form.name} (${form.email}): ${form.message}`,
  });
  req.flash('success', `Thanks ${form.name.split(' ')[0]} — your enquiry (${ref}) has been sent. We usually reply within 2 working hours.`);
  res.redirect(back);
});

/* ---------------- Contact & about ---------------- */

router.get('/contact', (req, res) => {
  const draft = req.session.enquiryDraft || {};
  delete req.session.enquiryDraft;
  const u = req.user?.role === 'buyer' ? get('SELECT name, business_name, email, phone FROM users WHERE id = ?', req.user.id) : {};
  res.render('pages/contact', {
    meta: { title: 'Contact Us | WholesaleHub', description: `Call ${config.business.phone}, WhatsApp or email our UK trade team. Opening hours, address and enquiry form.` },
    form: { name: u.name || '', business_name: u.business_name || '', email: u.email || '', phone: u.phone || '', message: '', ...draft },
    errors: {},
  });
});

router.post('/contact', formLimiter, (req, res) => {
  const b = req.body;
  const form = {
    name: clean(b.name, 120), business_name: clean(b.business_name, 160), email: clean(b.email, 200).toLowerCase(),
    phone: clean(b.phone, 40), message: clean(b.message, 3000),
  };
  const errors = {};
  if (!form.name) errors.name = 'Please enter your name.';
  if (!isEmail(form.email)) errors.email = 'Please enter a valid email address.';
  if (!form.message) errors.message = 'Please enter a message.';
  if (b.website) errors.form = 'Rejected';
  if (Object.keys(errors).length) {
    return res.status(422).render('pages/contact', { meta: { title: 'Contact Us | WholesaleHub' }, form, errors });
  }
  const r = run('INSERT INTO contact_messages (name, business_name, email, phone, message) VALUES (?, ?, ?, ?, ?)',
    form.name, form.business_name, form.email, form.phone, form.message);
  notifyAdmin({ type: 'contact', title: `Contact form: ${form.name}${form.business_name ? ` (${form.business_name})` : ''}`, link: `/admin/messages#m${r.lastInsertRowid}`, text: form.message });
  req.flash('success', 'Thanks — your message has been sent. Our trade team will be in touch shortly.');
  res.redirect('/contact');
});

router.get('/about', (req, res) => {
  res.render('pages/about', {
    meta: { title: 'About Us | WholesaleHub', description: 'WholesaleHub is a UK trade supplier for convenience stores, newsagents, off-licences and caterers.' },
  });
});

/* ---------------- Auth ---------------- */

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/account');
  res.render('pages/login', { meta: { title: 'Buyer Login | WholesaleHub', noindex: true }, email: '', error: null, admin: false });
});

router.post('/login', loginLimiter, (req, res, next) => {
  const email = clean(req.body.email, 200).toLowerCase();
  const user = get('SELECT id, password_hash, role FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(req.body.password || '', user.password_hash)) {
    return res.status(401).render('pages/login', { meta: { title: 'Buyer Login | WholesaleHub', noindex: true }, email, error: 'Incorrect email or password.', admin: false });
  }
  logIn(req, user, (err, returnTo) => {
    if (err) return next(err);
    const safe = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null;
    res.redirect(safe && (user.role === 'admin' || !safe.startsWith('/admin')) ? safe : (user.role === 'admin' ? '/admin' : '/account'));
  });
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/account');
  res.render('pages/register', { meta: { title: 'Open a Trade Account | WholesaleHub', description: 'Register a free WholesaleHub trade account to see trade prices, save products and track your offers.' }, form: {}, errors: {} });
});

router.post('/register', formLimiter, (req, res, next) => {
  const b = req.body;
  const form = {
    name: clean(b.name, 120), business_name: clean(b.business_name, 160), business_type: clean(b.business_type, 80),
    email: clean(b.email, 200).toLowerCase(), phone: clean(b.phone, 40), postcode: clean(b.postcode, 12).toUpperCase(),
  };
  const errors = {};
  if (!form.name) errors.name = 'Please enter your name.';
  if (!form.business_name) errors.business_name = 'Please enter your business name.';
  if (!isEmail(form.email)) errors.email = 'Please enter a valid email address.';
  else if (get('SELECT id FROM users WHERE email = ?', form.email)) errors.email = 'An account with this email already exists. Try logging in.';
  if (!form.phone) errors.phone = 'Please enter a contact phone number.';
  const pw = String(b.password || '');
  if (pw.length < 8) errors.password = 'Password must be at least 8 characters.';
  else if (pw !== String(b.password_confirm || '')) errors.password_confirm = 'Passwords do not match.';
  if (!b.terms) errors.terms = 'Please confirm you are buying for a business.';
  if (b.website) errors.form = 'Rejected';
  if (Object.keys(errors).length) {
    return res.status(422).render('pages/register', { meta: { title: 'Open a Trade Account | WholesaleHub', noindex: true }, form, errors });
  }
  const r = run(`INSERT INTO users (name, email, phone, business_name, business_type, postcode, password_hash, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'buyer')`, form.name, form.email, form.phone, form.business_name, form.business_type, form.postcode, hashPassword(pw));
  notifyAdmin({ type: 'buyer', title: `New buyer registered: ${form.business_name}`, link: `/admin/buyers/${r.lastInsertRowid}` });
  logIn(req, { id: Number(r.lastInsertRowid) }, (err) => {
    if (err) return next(err);
    req.flash('success', `Welcome to WholesaleHub, ${form.name.split(' ')[0]}! Trade prices are now visible across the catalogue.`);
    res.redirect('/account');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('wh.sid');
    res.redirect('/');
  });
});

/* ---------------- SEO ---------------- */

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /account\nDisallow: /offers/track\nDisallow: /api/\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const urls = ['/', '/products', '/new-products', '/categories', '/about', '/contact', '/offer'];
  for (const c of catalog.activeCategories()) urls.push(`/category/${c.slug}`);
  const prods = all(`SELECT p.slug, p.updated_at FROM products p LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 AND (c.id IS NULL OR c.active = 1)`);
  const body = urls.map((u) => `<url><loc>${config.siteUrl}${u}</loc></url>`).join('')
    + prods.map((p) => `<url><loc>${config.siteUrl}/products/${p.slug}</loc><lastmod>${p.updated_at.slice(0, 10)}</lastmod></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
});

module.exports = router;
module.exports.respondToOffer = respondToOffer;
