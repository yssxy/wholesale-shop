'use strict';

const config = require('../config');
const { run } = require('../db');

let transporter = null;
if (config.smtp.host) {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
}

/**
 * Notify the admin team: always records an in-dashboard notification,
 * and sends an email as well when SMTP is configured.
 */
function notifyAdmin({ type, title, link, text }) {
  run('INSERT INTO notifications (type, title, link) VALUES (?, ?, ?)', type, title, link || null);
  if (transporter) {
    transporter.sendMail({
      from: config.smtp.from,
      to: config.admin.notifyEmail,
      subject: `[WholesaleHub] ${title}`,
      text: `${text || title}\n\n${link ? config.siteUrl + link : ''}`,
    }).catch((err) => console.error('Admin email failed:', err.message));
  }
}

/** Email a buyer (best-effort; silently skipped without SMTP). */
function emailBuyer(to, subject, text) {
  if (!transporter || !to) return;
  transporter.sendMail({ from: config.smtp.from, to, subject: `[WholesaleHub] ${subject}`, text })
    .catch((err) => console.error('Buyer email failed:', err.message));
}

module.exports = { notifyAdmin, emailBuyer };
