'use strict';

const crypto = require('node:crypto');

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'item';
}

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
function money(v) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '—';
  return gbp.format(Number(v));
}

/** SQLite datetime('now') strings are UTC without a zone marker. */
function parseDate(s) {
  if (!s) return null;
  return new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z'));
}

function formatDate(s, withTime = false) {
  const d = parseDate(s);
  if (!d || Number.isNaN(d.getTime())) return '';
  const opts = { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('en-GB', opts);
}

function token(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function reference(prefix) {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `${prefix}-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function toInt(v, fallback = null) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toMoney(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function clean(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isEmail = (v) => EMAIL_RE.test(String(v || ''));

const OFFER_STATUSES = [
  ['new', 'New'],
  ['reviewing', 'Reviewing'],
  ['counter_offer', 'Counter Offer'],
  ['accepted', 'Accepted'],
  ['rejected', 'Rejected'],
  ['completed', 'Completed'],
];
const ENQUIRY_STATUSES = [
  ['new', 'New'],
  ['in_progress', 'In progress'],
  ['replied', 'Replied'],
  ['closed', 'Closed'],
];
const statusLabel = (list, key) => (list.find(([k]) => k === key) || [key, key])[1];

const CONTACT_METHODS = [
  ['email', 'Email'],
  ['phone', 'Phone call'],
  ['whatsapp', 'WhatsApp'],
  ['sms', 'Text message'],
];

module.exports = {
  slugify, money, parseDate, formatDate, token, reference, truncate, toInt, toMoney, clean, isEmail,
  OFFER_STATUSES, ENQUIRY_STATUSES, CONTACT_METHODS, statusLabel,
};
