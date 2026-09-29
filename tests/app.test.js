'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Isolated database per test run.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-test-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_EMAIL = 'admin@test.local';
process.env.ADMIN_PASSWORD = 'AdminPass123!';

const { seedIfEmpty } = require('../src/seed');
const { createApp } = require('../src/server');
const { get } = require('../src/db');

let server, base;

test.before(async () => {
  seedIfEmpty();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

/** Minimal cookie-jar client. */
function client() {
  let cookie = '';
  const c = {
    async req(url, opts = {}) {
      const res = await fetch(base + url, {
        redirect: 'manual', ...opts,
        headers: { ...(opts.headers || {}), ...(cookie ? { cookie } : {}) },
      });
      const set = res.headers.getSetCookie();
      if (set.length) cookie = set.map((s) => s.split(';')[0]).join('; ');
      res.text_ = await res.text();
      return res;
    },
    async csrf(url = '/login') {
      const res = await c.req(url);
      const m = res.text_.match(/name="_csrf" value="([^"]+)"/);
      return m && m[1];
    },
    async post(url, data, from) {
      const token = await c.csrf(from || url);
      return c.req(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ _csrf: token, ...data }).toString(),
      });
    },
    async login(email, password, url = '/login') {
      const res = await c.post(url, { email, password });
      assert.equal(res.status, 302, `login failed for ${email}`);
      return res;
    },
  };
  return c;
}

test('public catalogue pages render with SEO tags', async () => {
  const c = client();
  const home = await c.req('/');
  assert.equal(home.status, 200);
  assert.match(home.text_, /<title>WholesaleHub/);
  assert.match(home.text_, /og:title/);
  assert.match(home.text_, /Browse Our Products/);
  assert.match(home.text_, /Make an Offer/);

  const cat = await c.req('/category/batteries');
  assert.equal(cat.status, 200);
  assert.match(cat.text_, /AA Alkaline Batteries/);

  const product = await c.req('/products/voltiq-aa-alkaline-batteries-4-pack');
  assert.equal(product.status, 200);
  assert.match(product.text_, /application\/ld\+json/);
  assert.match(product.text_, /WH-BAT-1001/);
});

test('visitors never see trade price, supplier cost or internal fields', async () => {
  const c = client();
  const p = get("SELECT wholesale_price, cost_price, slug FROM products WHERE sku = 'WH-BAT-1001'");
  const page = await c.req(`/products/${p.slug}`);
  assert.doesNotMatch(page.text_, new RegExp(`£${p.wholesale_price.toFixed(2)}`));
  assert.doesNotMatch(page.text_, new RegExp(`£${p.cost_price.toFixed(2)}`));
  assert.match(page.text_, /Log in or register to see trade prices/);

  const api = await c.req('/api/search?q=battery');
  const json = JSON.parse(api.text_);
  assert.ok(json.results.length > 0);
  for (const r of json.results) {
    assert.equal(r.cost_price, undefined);
    assert.equal(r.wholesale_price, undefined);
  }
});

test('search matches name, brand, SKU and category with filters', async () => {
  const c = client();
  const bySku = await c.req('/products?q=WH-BAT-1001');
  assert.match(bySku.text_, /AA Alkaline Batteries \(4 Pack\)/);
  const byBrand = await c.req('/products?q=Fizzbolt');
  assert.match(byBrand.text_, /Cola Cans 330ml/);
  const inStock = await c.req('/products?availability=out');
  assert.match(inStock.text_, /Dark Chocolate Bars/);
  assert.doesNotMatch(inStock.text_, /Milk Chocolate Bars/);
});

test('POST without CSRF token is rejected', async () => {
  const c = client();
  const res = await c.req('/contact', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=x&email=a@b.co&message=hi' });
  assert.equal(res.status, 403);
});

test('guest can submit an offer, gets a tracking link, and admin is notified', async () => {
  const c = client();
  const product = get("SELECT id, name, minimum_order FROM products WHERE sku = 'WH-DRI-1031'");
  const before = get('SELECT COUNT(*) AS n FROM notifications').n;
  const res = await c.post('/offer', {
    buyer_name: 'Test Guest', business_name: 'Guest Stores', email: 'guest@example.com', phone: '07700 900999',
    product_id: String(product.id), quantity: String(product.minimum_order * 2), offer_price: '6.50', message: 'Test', contact_method: 'whatsapp',
  }, '/offer');
  assert.equal(res.status, 302);
  const loc = res.headers.get('location');
  assert.match(loc, /^\/offers\/track\/[\w-]+\?submitted=1$/);
  const status = await c.req(loc);
  assert.match(status.text_, /Offer submitted/);
  assert.match(status.text_, /OFR-/);
  assert.ok(get('SELECT COUNT(*) AS n FROM notifications').n > before);
  const offer = get("SELECT * FROM offers WHERE email = 'guest@example.com'");
  assert.equal(offer.status, 'new');
  assert.equal(offer.buyer_id, null);
});

test('offer validation enforces minimum order', async () => {
  const c = client();
  const product = get("SELECT id, minimum_order FROM products WHERE minimum_order > 1 LIMIT 1");
  const res = await c.post('/offer', {
    buyer_name: 'A', email: 'a@example.com', product_id: String(product.id), quantity: '1', offer_price: '5', contact_method: 'email',
  }, '/offer');
  assert.equal(res.status, 422);
  assert.match(res.text_, /Minimum order/);
});

test('buyer can register, sees trade prices, saves products and tracks own offers', async () => {
  const c = client();
  const reg = await c.post('/register', {
    name: 'New Buyer', business_name: 'New Biz Ltd', email: 'newbuyer@example.com', phone: '07700 900123',
    password: 'Password1!', password_confirm: 'Password1!', terms: '1',
  });
  assert.equal(reg.status, 302);
  const dash = await c.req('/account');
  assert.equal(dash.status, 200);
  assert.match(dash.text_, /New Biz Ltd/);

  const p = get("SELECT id, slug, wholesale_price FROM products WHERE sku = 'WH-BAT-1001'");
  const page = await c.req(`/products/${p.slug}`);
  assert.match(page.text_, new RegExp(`£${p.wholesale_price.toFixed(2)}`));

  const token = await c.csrf('/account');
  const save = await c.req(`/account/saved/${p.id}`, { method: 'POST', headers: { accept: 'application/json', 'x-csrf-token': token } });
  assert.deepEqual(JSON.parse(save.text_), { saved: true });

  await c.post('/offer', { buyer_name: 'New Buyer', email: 'newbuyer@example.com', product_id: String(p.id), quantity: '10', offer_price: '15', contact_method: 'email' }, '/offer');
  const offers = await c.req('/account/offers');
  assert.match(offers.text_, /AA Alkaline Batteries/);
});

test('buyers cannot access admin or other buyers\' offers', async () => {
  const c = client();
  await c.login('buyer@example.com', 'Buyer123!');
  const admin = await c.req('/admin');
  assert.equal(admin.status, 403);
  const adminOffers = await c.req('/admin/offers');
  assert.equal(adminOffers.status, 403);

  const buyer = get("SELECT id FROM users WHERE email = 'buyer@example.com'");
  const other = get('SELECT id FROM offers WHERE buyer_id IS NOT NULL AND buyer_id != ? LIMIT 1', buyer.id);
  const res = await c.req(`/account/offers/${other.id}`);
  assert.equal(res.status, 404);

  const mine = get('SELECT id, admin_notes FROM offers WHERE buyer_id = ? AND admin_notes IS NOT NULL LIMIT 1', buyer.id);
  if (mine) {
    const page = await c.req(`/account/offers/${mine.id}`);
    assert.equal(page.status, 200);
    assert.ok(!page.text_.includes(mine.admin_notes), 'internal notes must not be shown to buyers');
  }

  // Buyer login cannot be used on the admin login form
  const c2 = client();
  const res2 = await c2.post('/admin/login', { email: 'buyer@example.com', password: 'Buyer123!' });
  assert.equal(res2.status, 401);
});

test('visitors are redirected from admin and account', async () => {
  const c = client();
  assert.equal((await c.req('/admin')).headers.get('location'), '/admin/login');
  assert.equal((await c.req('/account')).headers.get('location'), '/login');
});

test('admin can view dashboard, manage products and respond to offers', async () => {
  const c = client();
  await c.login('admin@test.local', 'AdminPass123!', '/admin/login');

  for (const url of ['/admin', '/admin/products', '/admin/products/new', '/admin/categories', '/admin/offers', '/admin/enquiries', '/admin/messages', '/admin/buyers', '/admin/notifications']) {
    const res = await c.req(url);
    assert.equal(res.status, 200, url);
  }
  const dash = await c.req('/admin');
  assert.match(dash.text_, /Total potential sales value/);
  assert.match(dash.text_, /<svg class="chart"/);

  // Add a product via multipart (CSRF token in query string)
  const token = await c.csrf('/admin/products/new');
  const cat = get("SELECT id FROM categories WHERE slug = 'general'");
  const fd = new FormData();
  for (const [k, v] of Object.entries({ _csrf: token, name: 'Test Widget', brand: 'Acme', sku: 'TEST-001', category_id: String(cat.id), pack_size: '10 x 1', minimum_order: '2', stock_quantity: '50', wholesale_price: '9.99', cost_price: '5.00', active: '1', new_product: '1' })) fd.append(k, v);
  fd.append('image', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'x.png');
  const created = await c.req(`/admin/products?_csrf=${encodeURIComponent(token)}`, { method: 'POST', body: fd });
  assert.equal(created.status, 302);
  const product = get("SELECT * FROM products WHERE sku = 'TEST-001'");
  assert.equal(product.slug, 'acme-test-widget');
  assert.match(product.image, /^\/uploads\/products\/.+\.png$/);

  const pub = client();
  assert.equal((await pub.req('/products/acme-test-widget')).status, 200);

  // Toggle inactive -> disappears from catalogue
  await c.post(`/admin/products/${product.id}/toggle`, { field: 'active' }, '/admin/products');
  assert.equal((await pub.req('/products/acme-test-widget')).status, 404);

  // Counter-offer then buyer accepts via tracking link
  const offer = get("SELECT id, access_token FROM offers WHERE status = 'new' LIMIT 1");
  await c.post(`/admin/offers/${offer.id}`, { action: 'counter', counter_price: '12.34', buyer_message: 'Best we can do' }, `/admin/offers/${offer.id}`);
  assert.equal(get('SELECT status FROM offers WHERE id = ?', offer.id).status, 'counter_offer');
  const tracker = client();
  const page = await tracker.req(`/offers/track/${offer.access_token}`);
  assert.match(page.text_, /£12\.34/);
  await tracker.post(`/offers/track/${offer.access_token}/respond`, { action: 'accept_counter' }, `/offers/track/${offer.access_token}`);
  const after = get('SELECT status, agreed_price FROM offers WHERE id = ?', offer.id);
  assert.equal(after.status, 'accepted');
  assert.equal(after.agreed_price, 12.34);
});

test('contact form stores message for admin', async () => {
  const c = client();
  const res = await c.post('/contact', { name: 'Contact Tester', email: 'ct@example.com', message: 'Hello there' });
  assert.equal(res.status, 302);
  assert.ok(get("SELECT id FROM contact_messages WHERE email = 'ct@example.com'"));
});
