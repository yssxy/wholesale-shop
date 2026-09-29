'use strict';

const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));

module.exports = {
  root,
  port: Number(process.env.PORT) || 3000,
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  siteUrl: (process.env.SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  dataDir,
  dbFile: process.env.DB_FILE || 'wholesalehub.db',
  uploadDir: path.join(dataDir, 'uploads'),

  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@wholesalehub.co.uk',
    password: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
    notifyEmail: process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_EMAIL || 'admin@wholesalehub.co.uk',
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || 'WholesaleHub <no-reply@wholesalehub.co.uk>',
  },

  business: {
    name: 'WholesaleHub Ltd',
    tagline: 'Trade supplies for UK retailers',
    phone: '0121 000 0000',
    phoneHref: '+441210000000',
    whatsapp: '07700 900000',
    whatsappHref: '447700900000',
    email: 'sales@wholesalehub.co.uk',
    address: ['Unit 4, Hub Trade Park', 'Kingsway Industrial Estate', 'Birmingham', 'B00 0AA'],
    hours: [
      ['Monday – Friday', '7:00am – 6:00pm'],
      ['Saturday', '8:00am – 4:00pm'],
      ['Sunday', '9:00am – 1:00pm'],
    ],
  },
};
