'use strict';

const crypto = require('node:crypto');
const session = require('express-session');
const { get, run } = require('../db');

/* ---------- Password hashing (scrypt, no native deps) ---------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ---------- SQLite session store ---------- */

class SqliteStore extends session.Store {
  constructor() {
    super();
    // Sweep expired sessions hourly.
    this.timer = setInterval(() => run('DELETE FROM sessions WHERE expires < ?', Date.now()), 3600e3);
    this.timer.unref();
  }
  get(sid, cb) {
    try {
      const row = get('SELECT data, expires FROM sessions WHERE sid = ?', sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const expires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400e3;
      run('INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires',
        sid, JSON.stringify(sess), expires);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { run('DELETE FROM sessions WHERE sid = ?', sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

/* ---------- Middleware ---------- */

// Public-safe user fields only. Never put password_hash on req/res.
function loadUser(req, res, next) {
  req.user = null;
  if (req.session?.userId) {
    req.user = get('SELECT id, name, email, phone, business_name, role FROM users WHERE id = ?', req.session.userId) || null;
    if (!req.user) delete req.session.userId;
  }
  res.locals.user = req.user;
  res.locals.isAdmin = req.user?.role === 'admin';
  res.locals.isBuyer = req.user?.role === 'buyer';
  next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  req.session.returnTo = req.originalUrl;
  req.flash('info', 'Please log in to continue.');
  res.redirect('/login');
}

function requireBuyer(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (req.user.role !== 'buyer') {
    req.flash('info', 'Buyer accounts only — you are signed in as an administrator.');
    return res.redirect('/admin');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  if (req.user) return res.status(403).render('pages/error', { title: 'Access denied', status: 403, message: 'You do not have permission to view this page.' });
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin/login');
}

/** Regenerates the session on login to prevent fixation. */
function logIn(req, user, cb) {
  const returnTo = req.session.returnTo;
  req.session.regenerate((err) => {
    if (err) return cb(err);
    req.session.userId = user.id;
    req.session.csrf = crypto.randomBytes(24).toString('base64url');
    cb(null, returnTo);
  });
}

/* ---------- CSRF (synchroniser token) ---------- */

function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  res.locals.csrfToken = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.body?._csrf || req.get('x-csrf-token') || (req.is('multipart/form-data') ? req.query._csrf : '') || '';
  const a = Buffer.from(String(sent));
  const b = Buffer.from(req.session.csrf);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.status(403).render('pages/error', {
    title: 'Session expired', status: 403,
    message: 'Your form session has expired. Please go back, refresh the page and try again.',
  });
}

/* ---------- Simple in-memory rate limiter ---------- */

function rateLimit({ windowMs, max, key = (req) => req.ip, message = 'Too many attempts. Please wait a few minutes and try again.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    if (req.method !== 'POST') return next();
    const k = key(req);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.reset < now) { entry = { count: 0, reset: now + windowMs }; hits.set(k, entry); }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).render('pages/error', { title: 'Slow down', status: 429, message });
    }
    next();
  };
}

module.exports = {
  hashPassword, verifyPassword, SqliteStore,
  loadUser, requireLogin, requireBuyer, requireAdmin, logIn, csrf, rateLimit,
};
