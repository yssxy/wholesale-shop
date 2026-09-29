'use strict';

const express = require('express');
const catalog = require('../lib/catalog');
const { get, all, run } = require('../db');
const { requireBuyer, hashPassword, verifyPassword } = require('../lib/auth');
const { clean, isEmail, toInt } = require('../lib/util');
const { respondToOffer } = require('./public');

const router = express.Router();

/*
 * Buyer area. Every query is scoped with `buyer_id = req.user.id` so buyers
 * can only ever read or change their own records. Offer rows are selected
 * without admin_notes; internal fields never reach these views.
 */
const OFFER_COLS = `o.id, o.reference, o.access_token, o.product_id, o.product_name, o.quantity, o.offer_price, o.counter_price,
  o.agreed_price, o.message, o.status, o.contact_method, o.buyer_name, o.business_name, o.email, o.phone, o.created_at, o.updated_at,
  p.slug AS product_slug, p.image AS product_image, p.active AS product_active`;

router.use('/account', requireBuyer);

router.get('/account', (req, res) => {
  const uid = req.user.id;
  const counts = get(`SELECT
      (SELECT COUNT(*) FROM offers WHERE buyer_id = ?) AS offers,
      (SELECT COUNT(*) FROM offers WHERE buyer_id = ? AND status IN ('new','reviewing','counter_offer')) AS open_offers,
      (SELECT COUNT(*) FROM offers WHERE buyer_id = ? AND status = 'counter_offer') AS counters,
      (SELECT COUNT(*) FROM offers WHERE buyer_id = ? AND status IN ('accepted','completed')) AS accepted,
      (SELECT COUNT(*) FROM enquiries WHERE buyer_id = ?) AS enquiries,
      (SELECT COUNT(*) FROM saved_products WHERE buyer_id = ?) AS saved`, uid, uid, uid, uid, uid, uid);
  const offers = all(`SELECT ${OFFER_COLS} FROM offers o LEFT JOIN products p ON p.id = o.product_id
    WHERE o.buyer_id = ? ORDER BY o.updated_at DESC LIMIT 5`, uid);
  const saved = savedProducts(req, 5);
  res.render('account/dashboard', { meta: { title: 'My Account | WholesaleHub', noindex: true }, counts, offers, saved, tab: 'overview' });
});

/* ---------- Profile ---------- */

function profile(uid) {
  return get('SELECT id, name, email, phone, business_name, business_type, address, postcode, vat_number, created_at FROM users WHERE id = ?', uid);
}

router.get('/account/profile', (req, res) => {
  res.render('account/profile', { meta: { title: 'My Profile | WholesaleHub', noindex: true }, form: profile(req.user.id), errors: {}, tab: 'profile' });
});

router.post('/account/profile', (req, res) => {
  const b = req.body;
  const form = {
    name: clean(b.name, 120), email: clean(b.email, 200).toLowerCase(), phone: clean(b.phone, 40),
    business_name: clean(b.business_name, 160), business_type: clean(b.business_type, 80),
    address: clean(b.address, 300), postcode: clean(b.postcode, 12).toUpperCase(), vat_number: clean(b.vat_number, 20),
  };
  const errors = {};
  if (!form.name) errors.name = 'Please enter your name.';
  if (!form.business_name) errors.business_name = 'Please enter your business name.';
  if (!isEmail(form.email)) errors.email = 'Please enter a valid email address.';
  else if (get('SELECT id FROM users WHERE email = ? AND id != ?', form.email, req.user.id)) errors.email = 'That email is already used by another account.';
  if (Object.keys(errors).length) {
    return res.status(422).render('account/profile', { meta: { title: 'My Profile | WholesaleHub', noindex: true }, form: { ...profile(req.user.id), ...form }, errors, tab: 'profile' });
  }
  run(`UPDATE users SET name = ?, email = ?, phone = ?, business_name = ?, business_type = ?, address = ?, postcode = ?, vat_number = ?
    WHERE id = ? AND role = 'buyer'`, form.name, form.email, form.phone, form.business_name, form.business_type, form.address,
  form.postcode, form.vat_number, req.user.id);
  req.flash('success', 'Your details have been updated.');
  res.redirect('/account/profile');
});

router.post('/account/password', (req, res) => {
  const row = get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
  const next = String(req.body.new_password || '');
  if (!verifyPassword(req.body.current_password || '', row.password_hash)) req.flash('error', 'Your current password is incorrect.');
  else if (next.length < 8) req.flash('error', 'New password must be at least 8 characters.');
  else if (next !== String(req.body.new_password_confirm || '')) req.flash('error', 'New passwords do not match.');
  else {
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
    // Sign out other sessions for this user.
    run("DELETE FROM sessions WHERE sid != ? AND json_extract(data, '$.userId') = ?", req.sessionID, req.user.id);
    req.flash('success', 'Password changed.');
  }
  res.redirect('/account/profile#password');
});

/* ---------- Offers ---------- */

router.get('/account/offers', (req, res) => {
  const status = String(req.query.status || '');
  const params = [req.user.id];
  let where = 'o.buyer_id = ?';
  if (status) { where += ' AND o.status = ?'; params.push(status); }
  const offers = all(`SELECT ${OFFER_COLS} FROM offers o LEFT JOIN products p ON p.id = o.product_id WHERE ${where} ORDER BY o.created_at DESC`, ...params);
  res.render('account/offers', { meta: { title: 'My Offers | WholesaleHub', noindex: true }, offers, status, tab: 'offers' });
});

function ownOffer(req) {
  return get(`SELECT ${OFFER_COLS} FROM offers o LEFT JOIN products p ON p.id = o.product_id WHERE o.id = ? AND o.buyer_id = ?`,
    toInt(req.params.id), req.user.id);
}

router.get('/account/offers/:id', (req, res, next) => {
  const offer = ownOffer(req);
  if (!offer) return next();
  const messages = all('SELECT sender_role, message, created_at FROM offer_messages WHERE offer_id = ? ORDER BY created_at, id', offer.id);
  const product = offer.product_id ? catalog.productById(offer.product_id) : null;
  res.render('pages/offer-status', {
    meta: { title: `Offer ${offer.reference} | WholesaleHub`, noindex: true },
    offer, messages, product: catalog.forViewer(product, req.user), submitted: false,
    actionBase: `/account/offers/${offer.id}`, inAccount: true,
  });
});

router.post('/account/offers/:id/respond', (req, res, next) => {
  const offer = ownOffer(req);
  if (!offer) return next();
  respondToOffer(req, offer);
  res.redirect(`/account/offers/${offer.id}`);
});

/* ---------- Enquiries ---------- */

router.get('/account/enquiries', (req, res) => {
  const enquiries = all(`SELECT e.id, e.reference, e.message, e.reply, e.status, e.created_at, p.name AS product_name, p.slug AS product_slug
    FROM enquiries e LEFT JOIN products p ON p.id = e.product_id WHERE e.buyer_id = ? ORDER BY e.created_at DESC`, req.user.id);
  res.render('account/enquiries', { meta: { title: 'My Enquiries | WholesaleHub', noindex: true }, enquiries, tab: 'enquiries' });
});

/* ---------- Saved products ---------- */

function savedProducts(req, limit = 500) {
  const ids = all('SELECT product_id FROM saved_products WHERE buyer_id = ? ORDER BY created_at DESC LIMIT ?', req.user.id, limit);
  return catalog.forViewerAll(ids.map((r) => catalog.productById(r.product_id)).filter(Boolean), req.user);
}

router.get('/account/saved', (req, res) => {
  res.render('account/saved', { meta: { title: 'Saved Products | WholesaleHub', noindex: true }, products: savedProducts(req), tab: 'saved' });
});

// Toggle saved state. Visitors are sent to login by requireBuyer on /account.
router.post('/account/saved/:productId', (req, res) => {
  const pid = toInt(req.params.productId);
  const product = pid ? catalog.productById(pid) : null;
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const exists = get('SELECT id FROM saved_products WHERE buyer_id = ? AND product_id = ?', req.user.id, pid);
  if (exists) run('DELETE FROM saved_products WHERE id = ?', exists.id);
  else run('INSERT INTO saved_products (buyer_id, product_id) VALUES (?, ?)', req.user.id, pid);
  if (req.get('accept')?.includes('application/json')) return res.json({ saved: !exists });
  req.flash('success', exists ? 'Removed from saved products.' : 'Saved to your account.');
  const back = String(req.body.back || '');
  res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : `/products/${product.slug}`);
});

module.exports = router;
