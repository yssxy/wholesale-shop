'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new DatabaseSync(path.join(config.dataDir, config.dbFile));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone         TEXT,
  business_name TEXT,
  business_type TEXT,
  address       TEXT,
  postcode      TEXT,
  vat_number    TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('admin','buyer')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  description   TEXT,
  image         TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  brand           TEXT,
  sku             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category_id     INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description     TEXT,
  image           TEXT,
  pack_size       TEXT,
  minimum_order   INTEGER NOT NULL DEFAULT 1,
  stock_quantity  INTEGER NOT NULL DEFAULT 0,
  wholesale_price REAL,
  suggested_price REAL,
  cost_price      REAL,
  active          INTEGER NOT NULL DEFAULT 1,
  featured        INTEGER NOT NULL DEFAULT 0,
  new_product     INTEGER NOT NULL DEFAULT 0,
  age_restricted  INTEGER NOT NULL DEFAULT 0,
  views           INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);

CREATE TABLE IF NOT EXISTS offers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reference       TEXT NOT NULL UNIQUE,
  access_token    TEXT NOT NULL UNIQUE,
  buyer_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name    TEXT NOT NULL,
  buyer_name      TEXT NOT NULL,
  business_name   TEXT,
  email           TEXT NOT NULL,
  phone           TEXT,
  contact_method  TEXT NOT NULL DEFAULT 'email',
  quantity        INTEGER NOT NULL,
  offer_price     REAL NOT NULL,
  counter_price   REAL,
  agreed_price    REAL,
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','reviewing','counter_offer','accepted','rejected','completed')),
  admin_notes     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_offers_buyer ON offers(buyer_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);

-- Buyer-visible conversation on an offer (admin_notes stay internal).
CREATE TABLE IF NOT EXISTS offer_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id    INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('admin','buyer')),
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS enquiries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  reference     TEXT NOT NULL UNIQUE,
  buyer_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  business_name TEXT,
  email         TEXT NOT NULL,
  phone         TEXT,
  message       TEXT NOT NULL,
  reply         TEXT,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','replied','closed')),
  admin_notes   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_enquiries_buyer ON enquiries(buyer_id);

CREATE TABLE IF NOT EXISTS saved_products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (buyer_id, product_id)
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  business_name TEXT,
  email         TEXT NOT NULL,
  phone         TEXT,
  message       TEXT NOT NULL,
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  data    TEXT NOT NULL,
  expires INTEGER NOT NULL
);
`;

db.exec(SCHEMA);

/** Run fn inside a transaction; rolls back on throw. */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const all = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

module.exports = { db, all, get, run, transaction };
