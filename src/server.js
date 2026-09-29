'use strict';

const path = require('node:path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
require('./db');
const { seedIfEmpty } = require('./seed');
const { SqliteStore, loadUser, csrf } = require('./lib/auth');
const catalog = require('./lib/catalog');
const util = require('./lib/util');
const { get } = require('./db');

function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.root, 'views'));
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Security headers
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https://wa.me; frame-ancestors 'none'",
    });
    if (config.isProd) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  });

  app.use('/static', express.static(path.join(config.root, 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  app.use('/uploads', express.static(config.uploadDir, {
    maxAge: '30d',
    setHeaders: (res) => res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'"),
  }));
  app.get('/favicon.ico', (req, res) => res.redirect(301, '/static/img/favicon.svg'));

  app.use(express.urlencoded({ extended: false, limit: '200kb' }));
  app.use(express.json({ limit: '50kb' }));

  app.use(session({
    name: 'wh.sid',
    store: new SqliteStore(),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 14 * 86400e3 },
  }));

  // Flash messages
  app.use((req, res, next) => {
    req.flash = (type, msg) => {
      req.session.flash = req.session.flash || [];
      req.session.flash.push({ type, msg });
    };
    res.locals.flash = req.session?.flash || [];
    if (req.session) delete req.session.flash;
    next();
  });

  app.use(loadUser);

  // Shared view locals
  app.use((req, res, next) => {
    Object.assign(res.locals, {
      site: config.business,
      siteUrl: config.siteUrl,
      path: req.path,
      query: req.query,
      money: util.money,
      formatDate: util.formatDate,
      truncate: util.truncate,
      statusLabel: util.statusLabel,
      OFFER_STATUSES: util.OFFER_STATUSES,
      ENQUIRY_STATUSES: util.ENQUIRY_STATUSES,
      CONTACT_METHODS: util.CONTACT_METHODS,
      navCategories: catalog.activeCategories(),
      savedIds: new Set(),
      adminUnread: 0,
      adminArea: false,
      tab: null,
      section: null,
      meta: {},
    });
    if (req.user?.role === 'buyer') {
      const rows = require('./db').all('SELECT product_id FROM saved_products WHERE buyer_id = ?', req.user.id);
      res.locals.savedIds = new Set(rows.map((r) => r.product_id));
    }
    if (req.user?.role === 'admin') {
      res.locals.adminUnread = get('SELECT COUNT(*) AS n FROM notifications WHERE is_read = 0').n;
    }
    next();
  });

  // CSRF on every state-changing request. Multipart forms (image uploads) carry
  // the token in the action URL because their body is parsed later by multer.
  app.use(csrf);

  app.use(require('./routes/public'));
  app.use(require('./routes/account'));
  app.use('/admin', require('./routes/admin'));

  app.use((req, res) => {
    res.status(404).render('pages/error', { title: 'Page not found', status: 404, message: 'Sorry, we could not find that page. It may have moved or the product may no longer be listed.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    const message = err.expose || status < 500 ? err.message : 'Something went wrong on our side. Please try again.';
    // Errors raised before view locals are ready (e.g. malformed request bodies) get a plain response.
    if (!res.locals.site) return res.status(status).type('text/plain').send(message);
    res.status(status).render('pages/error', { title: 'Error', status, message });
  });

  return app;
}

if (require.main === module) {
  seedIfEmpty();
  if (config.isProd && config.sessionSecret === 'dev-only-secret-change-me') {
    console.error('SESSION_SECRET must be set in production.');
    process.exit(1);
  }
  createApp().listen(config.port, () => console.log(`WholesaleHub running at http://localhost:${config.port}`));
}

module.exports = { createApp };
