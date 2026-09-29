'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { db, get, run, transaction } = require('./db');
const { hashPassword } = require('./lib/auth');
const { productSvg, categorySvg } = require('./lib/placeholder');
const { slugify, token, reference } = require('./lib/util');

// Deterministic PRNG so demo data is stable between resets.
let seedState = 42;
const rand = () => ((seedState = (seedState * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

function sqlDate(daysAgo, hour = 10) {
  const d = new Date(Date.now() - daysAgo * 86400e3);
  d.setUTCHours(hour, Math.floor(rand() * 60), 0, 0);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

const CATEGORIES = [
  ['Carrier Bags', 'carrier-bags', 'Vest carriers, bags for life and printed carriers for every counter.', '#2f7d5b'],
  ['Bin Bags', 'bin-bags', 'Refuse sacks, heavy-duty and compactor bags in bulk cases.', '#2a2f36'],
  ['Butcher Supplies', 'butcher-supplies', 'Butcher paper, meat trays, gloves and counter essentials.', '#b3413b'],
  ['Filter Tips', 'filter-tips', 'Slim and extra-slim filter tips in retail display boxes.', '#c98a2b'],
  ['Rolling Papers', 'rolling-papers', 'Regular and king-size rolling papers in counter display boxes.', '#8a5a2b'],
  ['Lighters', 'lighters', 'Electronic, flint and refillable lighters in display trays.', '#d0452f'],
  ['Drink Bottles', 'drink-bottles', 'Still and sparkling water, juices and soft drinks in bottles.', '#2f6fb3'],
  ['Drink Cans', 'drink-cans', 'Cola, lemonade and energy drinks in 330ml and 250ml cans.', '#c0392b'],
  ['Batteries', 'batteries', 'AA, AAA, 9V, C and D batteries in retail and bulk packs.', '#1f3b73'],
  ['Health & Beauty', 'health-beauty', 'Toiletries, hand wash, dental care and personal care lines.', '#8e5ba8'],
  ['Phone Accessories', 'phone-accessories', 'Charging cables, wall plugs and car chargers.', '#2c3e50'],
  ['General', 'general', 'Everyday general merchandise, tape, boxes and sundries.', '#b08a4a'],
  ['Catering & Disposables', 'catering-disposables', 'Cups, plates, food containers and takeaway packaging.', '#3b8c8c'],
  ['Confectionery', 'confectionery', 'Chocolate, sweets and gum in outer cases.', '#7b3f2a'],
];

// [name, brand, category slug, variant, colour, pack, moq, stock, wholesale, rrp, cost, featured, new, desc]
const PRODUCTS = [
  ['AA Alkaline Batteries (4 Pack)', 'Voltiq', 'batteries', 'AA', '#1f3b73', '12 x 4 pack', 5, 420, 16.8, 3.49, 11.2, 1, 0, 'Long-lasting AA alkaline batteries in hang-sell 4 packs. Ideal for toys, remotes and everyday devices. Supplied in a 12-pack counter display.'],
  ['AAA Alkaline Batteries (4 Pack)', 'Voltiq', 'batteries', 'AAA', '#1f3b73', '12 x 4 pack', 5, 380, 16.2, 3.29, 10.8, 1, 0, 'Reliable AAA alkaline batteries in retail 4 packs. Popular impulse line for convenience stores.'],
  ['9V Alkaline Battery (Single)', 'Voltiq', 'batteries', '9V', '#1f3b73', '10 x 1', 5, 160, 13.5, 2.99, 9.0, 0, 0, 'Single 9V alkaline battery suitable for smoke alarms, guitar pedals and test equipment.'],
  ['C Alkaline Batteries (2 Pack)', 'Voltiq', 'batteries', 'C', '#1f3b73', '12 x 2 pack', 3, 95, 18.0, 3.99, 12.4, 0, 1, 'Heavy-drain C size batteries for torches and radios. 12 x twin packs per outer.'],
  ['D Alkaline Batteries (2 Pack)', 'Voltiq', 'batteries', 'D', '#1f3b73', '12 x 2 pack', 3, 72, 19.2, 4.29, 13.1, 0, 1, 'Heavy-duty D size batteries for lanterns and large appliances. 12 x twin packs per outer.'],
  ['AA Batteries Bulk Box (40)', 'PowerMax Pro', 'batteries', 'AA', '#c0392b', '40 x AA', 2, 240, 9.6, 0.5, 6.1, 1, 0, 'Industrial bulk box of 40 AA batteries. Great value for trade, schools and offices.'],
  ['AAA Batteries Bulk Box (40)', 'PowerMax Pro', 'batteries', 'AAA', '#c0392b', '40 x AAA', 2, 210, 9.2, 0.5, 5.9, 0, 0, 'Industrial bulk box of 40 AAA batteries in shrink-wrapped 4s.'],

  ['Small Vest Carrier Bags', 'BagCo', 'carrier-bags', 'small', '#2f7d5b', '2000 bags', 2, 150, 18.5, null, 12.0, 0, 0, 'Small white vest carriers, 10" x 15" x 18". Strong 14 micron film, packed in boxes of 2000.'],
  ['Medium Vest Carrier Bags', 'BagCo', 'carrier-bags', 'medium', '#2f7d5b', '1000 bags', 2, 210, 16.9, null, 11.1, 1, 0, 'Medium white vest carriers, 11" x 17" x 21". Our best-selling carrier for convenience and off-licence.'],
  ['Large Vest Carrier Bags', 'BagCo', 'carrier-bags', 'large', '#2f7d5b', '1000 bags', 2, 130, 21.5, null, 14.2, 0, 0, 'Large heavy vest carriers, 13" x 19" x 23". Suitable for supermarkets and takeaways.'],
  ['Reusable Bag for Life', 'EcoCarry', 'carrier-bags', 'large', '#1e6f8f', '100 bags', 1, 60, 24.0, 0.5, 15.8, 0, 1, 'Durable, reusable bag for life made with recycled content. 100 per case.'],

  ['Black Bin Bags (Standard)', 'Tuffsac', 'bin-bags', null, '#2a2f36', '200 bags', 2, 180, 12.4, null, 8.1, 1, 0, '18" x 29" x 39" black refuse sacks. Medium duty, 200 per box.'],
  ['Heavy Duty Bin Bags', 'Tuffsac', 'bin-bags', null, '#1b1f24', '200 bags', 2, 140, 17.9, null, 11.6, 0, 0, 'Extra-strong heavy duty refuse sacks for commercial waste. 160 gauge, 200 per box.'],
  ['Compactor Sacks', 'Tuffsac', 'bin-bags', null, '#39414b', '100 bags', 1, 55, 22.5, null, 15.0, 0, 1, 'Very heavy duty compactor sacks, 20" x 34" x 46". Suitable for compactor machines.'],
  ['White Pedal Bin Liners', 'Tuffsac', 'bin-bags', null, '#dfe3e8', '1000 liners', 1, 90, 8.6, null, 5.4, 0, 0, 'White pedal bin liners, 10" x 18" x 18". 1000 per box.'],

  ['White Butcher Paper Roll', 'PrimeCut', 'butcher-supplies', 'roll', '#f3efe6', '1 roll (450mm)', 2, 45, 21.0, null, 13.5, 0, 0, 'Food-safe white butcher wrapping paper roll, 450mm x 200m.'],
  ['Black Meat Trays (Size 8)', 'PrimeCut', 'butcher-supplies', 'tray', '#2a2f36', '500 trays', 1, 40, 29.5, null, 19.4, 0, 1, 'Black polystyrene-free meat trays, size 8. Ideal for counter display and pre-packing.'],
  ['Blue Nitrile Gloves (Large)', 'PrimeCut', 'butcher-supplies', 'gloves', '#2f6fb3', '10 x 100', 1, 70, 32.0, null, 21.0, 1, 0, 'Powder-free blue nitrile food-handling gloves, size large. 10 boxes of 100.'],

  ['Slim Filter Tips (Display Box)', 'Filtra', 'filter-tips', 'SLIM', '#c98a2b', '20 x 120 tips', 2, 110, 17.5, 1.25, 11.9, 0, 0, 'Slim 6mm filter tips in 120-tip bags. Counter display of 20.', 1],
  ['Extra Slim Filter Tips (Display Box)', 'Filtra', 'filter-tips', 'X-SLIM', '#a26b17', '20 x 120 tips', 2, 95, 17.5, 1.25, 11.9, 0, 1, 'Extra slim 5.7mm filter tips in 120-tip bags. Counter display of 20.', 1],

  ['King Size Slim Rolling Papers', 'Leafline', 'rolling-papers', 'KING', '#8a5a2b', '50 booklets', 2, 130, 22.0, 0.89, 14.5, 1, 0, 'Ultra-thin king size slim papers, 32 leaves per booklet. 50 booklets per display box.', 1],
  ['Regular Rolling Papers', 'Leafline', 'rolling-papers', 'REGULAR', '#6b4423', '100 booklets', 2, 115, 16.0, 0.35, 10.2, 0, 0, 'Classic regular size rolling papers, 50 leaves per booklet. 100 per box.', 1],

  ['Electronic Lighters (Tray of 50)', 'Flintro', 'lighters', null, '#d0452f', '50 lighters', 2, 200, 13.5, 0.6, 8.8, 1, 0, 'Assorted colour electronic piezo lighters with child-resistant mechanism. Tray of 50.', 1],
  ['Flint Lighters (Tray of 50)', 'Flintro', 'lighters', null, '#2f6fb3', '50 lighters', 2, 160, 15.0, 0.75, 9.6, 0, 0, 'Assorted colour flint wheel lighters, EN ISO 9994 compliant. Tray of 50.', 1],
  ['Refillable Jet Lighters', 'Flintro', 'lighters', null, '#2c3e50', '20 lighters', 1, 40, 24.0, 2.99, 15.5, 0, 1, 'Windproof refillable jet flame lighters in a counter display of 20.', 1],

  ['Still Spring Water 500ml', 'Brookmere', 'drink-bottles', 'water', '#2f6fb3', '24 x 500ml', 5, 600, 4.2, 0.79, 2.6, 1, 0, 'Naturally sourced British still spring water in 500ml sports-cap bottles.'],
  ['Sparkling Spring Water 500ml', 'Brookmere', 'drink-bottles', 'water', '#1f5f99', '24 x 500ml', 5, 300, 4.6, 0.85, 2.9, 0, 0, 'Lightly sparkling British spring water in 500ml bottles.'],
  ['Orange Juice Drink 500ml', 'Zestra', 'drink-bottles', 'orange', '#e67e22', '12 x 500ml', 5, 180, 6.9, 1.29, 4.4, 0, 1, 'Refreshing orange juice drink with no added sugar. 12 x 500ml bottles.'],
  ['Cola 1.5L Bottles', 'Fizzbolt', 'drink-bottles', 'cola', '#8b1a1a', '6 x 1.5L', 5, 150, 6.2, 1.79, 3.9, 0, 0, 'Classic cola in 1.5 litre sharing bottles. 6 per shrink-wrap.'],

  ['Cola Cans 330ml', 'Fizzbolt', 'drink-cans', 'cola', '#b0211f', '24 x 330ml', 5, 520, 7.8, 0.75, 5.1, 1, 0, 'Classic cola in 330ml cans. 24 per tray, price-marked options available.'],
  ['Lemonade Cans 330ml', 'Fizzbolt', 'drink-cans', 'lemon', '#d4b21c', '24 x 330ml', 5, 310, 6.9, 0.69, 4.5, 0, 0, 'Sparkling cloudy lemonade in 330ml cans. 24 per tray.'],
  ['Energy Drink 250ml', 'Voltage', 'drink-cans', 'energy', '#1e8449', '24 x 250ml', 5, 400, 11.5, 1.19, 7.4, 1, 1, 'Caffeinated energy drink with B-vitamins. 24 x 250ml slim cans. Not recommended for children.'],
  ['Sugar Free Energy Drink 250ml', 'Voltage', 'drink-cans', 'zero', '#34495e', '24 x 250ml', 5, 260, 11.5, 1.19, 7.4, 0, 1, 'Zero sugar energy drink. 24 x 250ml slim cans.'],

  ['Antibacterial Hand Wash 500ml', 'Purecare', 'health-beauty', 'pump', '#8e5ba8', '6 x 500ml', 3, 140, 7.2, 1.99, 4.3, 0, 0, 'Antibacterial liquid hand wash with pump dispenser. Kills 99.9% of bacteria.'],
  ['Fresh Mint Toothpaste 100ml', 'Purecare', 'health-beauty', 'tube', '#2e86c1', '12 x 100ml', 3, 160, 9.6, 1.49, 6.0, 0, 0, 'Fluoride toothpaste with fresh mint flavour. 12 x 100ml tubes.'],
  ['Nourishing Shampoo 400ml', 'Silkia', 'health-beauty', 'pump', '#c0587e', '6 x 400ml', 3, 90, 8.4, 2.49, 5.2, 0, 1, 'Nourishing everyday shampoo for all hair types. 6 x 400ml bottles.'],

  ['USB-C to USB-C Cable 1m', 'ChargeLink', 'phone-accessories', 'usb-c', '#2c3e50', '10 cables', 2, 260, 18.0, 4.99, 9.5, 1, 0, 'Braided 60W USB-C to USB-C fast-charge cable, 1 metre. Retail blister packed.'],
  ['Lightning to USB-A Cable 1m', 'ChargeLink', 'phone-accessories', 'lightning', '#7f8c8d', '10 cables', 2, 190, 19.0, 5.49, 10.2, 0, 0, 'Lightning to USB-A charge and sync cable, 1 metre. Retail blister packed.'],
  ['20W USB-C Wall Charger', 'ChargeLink', 'phone-accessories', 'charger', '#ecf0f1', '10 chargers', 2, 150, 39.0, 9.99, 24.0, 1, 1, 'UK 3-pin 20W USB-C PD fast wall charger. UKCA marked.'],
  ['Dual USB Car Charger', 'ChargeLink', 'phone-accessories', 'car', '#2c3e50', '10 chargers', 2, 120, 22.0, 5.99, 12.8, 0, 0, '12/24V dual USB-A car charger, 2.4A total output.'],

  ['Brown Packing Tape 48mm', 'Stickwell', 'general', 'tape', '#b08a4a', '36 rolls', 1, 80, 19.5, null, 12.6, 0, 0, 'Low-noise brown polypropylene packing tape, 48mm x 66m. 36 rolls per case.'],
  ['Clear Packing Tape 48mm', 'Stickwell', 'general', 'tape', '#c9d6df', '36 rolls', 1, 75, 19.5, null, 12.6, 0, 0, 'Crystal clear packing tape, 48mm x 66m. 36 rolls per case.'],
  ['Double Wall Cardboard Boxes', 'Hubline', 'general', 'box', '#c9a46a', '15 boxes', 1, 60, 17.0, null, 10.5, 0, 1, 'Strong double-wall cardboard boxes, 457 x 457 x 457mm. 15 per bundle.'],

  ['Paper Hot Cups 8oz', 'ServeWell', 'catering-disposables', 'cups', '#3b8c8c', '1000 cups', 1, 110, 29.0, null, 18.8, 1, 0, 'Single-wall white paper hot cups, 8oz. Compatible with standard 80mm lids.'],
  ['Paper Plates 9"', 'ServeWell', 'catering-disposables', 'plates', '#f3efe6', '500 plates', 1, 70, 19.0, null, 12.0, 0, 0, 'Strong white paper plates, 9 inch. Plastic-free and compostable.'],
  ['Hinged Food Containers', 'ServeWell', 'catering-disposables', 'containers', '#e6dccb', '500 boxes', 1, 95, 34.0, null, 22.5, 1, 1, 'Bagasse hinged burger boxes, 6". Compostable and grease resistant.'],
  ['Takeaway Containers with Lids', 'ServeWell', 'catering-disposables', 'containers', '#d9e2ea', '250 sets', 1, 65, 26.5, null, 17.0, 0, 0, '650ml rectangular microwave-safe containers with lids. 250 sets.'],

  ['Milk Chocolate Bars 45g', 'Choco Delight', 'confectionery', 'bar', '#7b3f2a', '48 bars', 2, 180, 21.6, 0.85, 14.0, 1, 0, 'Smooth milk chocolate bars, 45g. Counter display outer of 48.'],
  ['Fruit Chew Sweets Bags 150g', 'Fruity Chews', 'confectionery', 'sweets', '#e0475b', '12 bags', 2, 150, 9.6, 1.25, 6.1, 0, 1, 'Assorted fruit flavour chewy sweets in 150g sharing bags. 12 per outer.'],
  ['Peppermint Sugar Free Gum', 'Minty Fresh', 'confectionery', 'gum', '#1f9e89', '30 packs', 2, 200, 10.5, 0.65, 6.6, 0, 0, 'Sugar-free peppermint chewing gum, 10 pieces per pack. 30 packs per display.'],
  ['Dark Chocolate Bars 45g', 'Choco Delight', 'confectionery', 'bar', '#3e2016', '48 bars', 2, 0, 22.8, 0.9, 14.8, 0, 0, 'Rich 55% dark chocolate bars, 45g. Counter display outer of 48. Currently awaiting restock.'],
];

const BUYERS = [
  ['Amir Patel', 'buyer@example.com', '07700 900111', 'Corner Stop Convenience', 'Convenience store', '12 High Street, Leicester', 'LE1 1AA', 70],
  ['Sarah Collins', 'sarah@collins-news.example', '07700 900222', 'Collins Newsagents', 'Newsagent', '4 Market Place, Derby', 'DE1 2BB', 45],
  ['Daniel Okafor', 'daniel@okaforfoodandwine.example', '07700 900333', 'Okafor Food & Wine', 'Off-licence', '88 London Road, Croydon', 'CR0 3CC', 30],
  ['Priya Sharma', 'priya@sharmaminimart.example', '07700 900444', "Sharma's Mini Mart", 'Convenience store', '21 Station Road, Bradford', 'BD1 4DD', 12],
  ['Tom Richards', 'tom@richardscatering.example', '07700 900555', 'Richards Catering Supplies', 'Catering', 'Unit 9, Mill Lane, Bristol', 'BS1 5EE', 4],
];

const OFFER_MESSAGES = [
  'Regular order if the price is right — can collect from your depot.',
  'Looking to stock this across two shops. Can you do a better price on volume?',
  'Please confirm lead time, need it before the weekend.',
  'Happy to pay on collection. Is price-marked stock available?',
  'We would take this monthly if you can match this price.',
  '',
];

function writeImage(dir, name, svg) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), svg);
}

function reset() {
  db.exec(`DELETE FROM offer_messages; DELETE FROM offers; DELETE FROM enquiries; DELETE FROM saved_products;
    DELETE FROM contact_messages; DELETE FROM notifications; DELETE FROM products; DELETE FROM categories;
    DELETE FROM users; DELETE FROM sessions; DELETE FROM sqlite_sequence;`);
}

function seed() {
  const demoDir = path.join(config.uploadDir, 'demo');

  transaction(() => {
    // Users
    run(`INSERT INTO users (name, email, phone, business_name, business_type, password_hash, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'admin', ?)`,
    'Admin', config.admin.email, config.business.phone, config.business.name, 'Wholesaler',
    hashPassword(config.admin.password), sqlDate(120));

    const buyerIds = [];
    const buyerHash = hashPassword('Buyer123!');
    for (const [name, email, phone, biz, type, address, postcode, days] of BUYERS) {
      const r = run(`INSERT INTO users (name, email, phone, business_name, business_type, address, postcode, password_hash, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'buyer', ?)`, name, email, phone, biz, type, address, postcode, buyerHash, sqlDate(days));
      buyerIds.push(Number(r.lastInsertRowid));
    }

    // Categories
    const catIds = {};
    CATEGORIES.forEach(([name, slug, desc, color], i) => {
      writeImage(path.join(demoDir, 'categories'), `${slug}.svg`, categorySvg(slug, color));
      const r = run('INSERT INTO categories (name, slug, description, image, display_order, active) VALUES (?, ?, ?, ?, ?, 1)',
        name, slug, desc, `/uploads/demo/categories/${slug}.svg`, i + 1);
      catIds[slug] = Number(r.lastInsertRowid);
    });

    // Products
    const productRows = [];
    PRODUCTS.forEach((p, i) => {
      const [name, brand, cat, variant, color, pack, moq, stock, wholesale, rrp, cost, featured, isNew, desc, age = 0] = p;
      const slug = slugify(`${brand} ${name}`);
      const sku = `WH-${cat.slice(0, 3).toUpperCase()}-${String(1001 + i)}`;
      writeImage(demoDir, `${slug}.svg`, productSvg({ category: cat, color, variant, brand }));
      const created = isNew ? sqlDate(Math.floor(rand() * 10) + 1) : sqlDate(30 + Math.floor(rand() * 80));
      const views = Math.floor(rand() * 400) + (featured ? 250 : 20);
      const r = run(`INSERT INTO products (name, slug, brand, sku, category_id, description, image, pack_size, minimum_order,
          stock_quantity, wholesale_price, suggested_price, cost_price, active, featured, new_product, age_restricted, views, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      name, slug, brand, sku, catIds[cat], desc, `/uploads/demo/${slug}.svg`, pack, moq, stock,
      wholesale, rrp, cost, featured, isNew, age, views, created, created);
      productRows.push({ id: Number(r.lastInsertRowid), name, wholesale, moq });
    });

    // Offers across the last ~8 weeks with a realistic status mix
    const statuses = ['new', 'new', 'new', 'reviewing', 'reviewing', 'counter_offer', 'accepted', 'accepted', 'rejected', 'completed', 'completed'];
    const popular = productRows.filter((_, i) => [0, 1, 8, 11, 22, 25, 29, 31, 36, 38, 44, 47].includes(i));
    for (let i = 0; i < 38; i++) {
      const bIdx = Math.floor(rand() * BUYERS.length);
      const [bName, bEmail, bPhone, bBiz] = BUYERS[bIdx];
      const prod = rand() < 0.7 ? pick(popular) : pick(productRows);
      const days = Math.floor(Math.pow(rand(), 1.6) * 56);
      const status = days < 3 ? pick(['new', 'new', 'reviewing']) : pick(statuses);
      const qty = prod.moq * (Math.floor(rand() * 8) + 1) * (rand() < 0.3 ? 5 : 1);
      const price = Math.round(prod.wholesale * (0.82 + rand() * 0.14) * 100) / 100;
      const counter = status === 'counter_offer' || (status !== 'new' && status !== 'reviewing' && rand() < 0.4)
        ? Math.round(((price + prod.wholesale) / 2) * 100) / 100 : null;
      const agreed = ['accepted', 'completed'].includes(status) ? (counter || price) : null;
      const created = sqlDate(days, 8 + Math.floor(rand() * 9));
      const r = run(`INSERT INTO offers (reference, access_token, buyer_id, product_id, product_name, buyer_name, business_name, email, phone,
          contact_method, quantity, offer_price, counter_price, agreed_price, message, status, admin_notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reference('OFR'), token(), buyerIds[bIdx], prod.id, prod.name, bName, bBiz, bEmail, bPhone,
      pick(['email', 'phone', 'whatsapp']), qty, price, counter, agreed, pick(OFFER_MESSAGES), status,
      status === 'rejected' ? 'Below cost after delivery — declined.' : (rand() < 0.3 ? 'Good regular customer. Pays on time.' : null),
      created, created);
      const offerId = Number(r.lastInsertRowid);
      if (counter) {
        run("INSERT INTO offer_messages (offer_id, sender_role, message, created_at) VALUES (?, 'admin', ?, ?)",
          offerId, `Thanks for your offer. We can do £${counter.toFixed(2)} per case at this quantity.`, created);
      }
      if (status === 'accepted' || status === 'completed') {
        run("INSERT INTO offer_messages (offer_id, sender_role, message, created_at) VALUES (?, 'admin', ?, ?)",
          offerId, 'Offer accepted — we will be in touch to arrange collection or delivery.', created);
      }
    }

    // Enquiries
    const enquiryTexts = [
      'Do you have price-marked packs of this available?',
      'What is the lead time for 20 cases delivered to Leicester?',
      'Can you send me a spec sheet and pallet quantity?',
      'Is this available in other sizes?',
      'Do you deliver to the South West and is there a minimum drop value?',
    ];
    for (let i = 0; i < 14; i++) {
      const guest = rand() < 0.3;
      const bIdx = Math.floor(rand() * BUYERS.length);
      const [bName, bEmail, bPhone, bBiz] = BUYERS[bIdx];
      const prod = pick(productRows);
      const status = pick(['new', 'new', 'in_progress', 'replied', 'closed']);
      run(`INSERT INTO enquiries (reference, buyer_id, product_id, name, business_name, email, phone, message, reply, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      reference('ENQ'), guest ? null : buyerIds[bIdx], prod.id,
      guest ? 'Jordan Blake' : bName, guest ? 'Blake Stores' : bBiz, guest ? 'jordan@blakestores.example' : bEmail,
      guest ? '07700 900666' : bPhone, pick(enquiryTexts),
      status === 'replied' || status === 'closed' ? 'Thanks for your enquiry — yes, we have stock and can deliver within 2 working days.' : null,
      status, sqlDate(Math.floor(rand() * 40)));
    }

    // Saved products for the demo buyer
    for (const idx of [0, 8, 22, 29, 36, 44]) {
      run('INSERT OR IGNORE INTO saved_products (buyer_id, product_id, created_at) VALUES (?, ?, ?)', buyerIds[0], productRows[idx].id, sqlDate(5));
    }

    // Contact messages
    const contacts = [
      ['Hannah Ward', 'Ward Convenience', 'hannah@wardconvenience.example', '07700 900777', 'Hi, could you send your full trade price list? We are opening a second shop next month.'],
      ['Mo Hussain', 'Hussain Cash & Carry', 'mo@hussaincc.example', '07700 900888', 'Interested in pallet deals on drinks. Please call me.'],
      ['Lucy Grant', '', 'lucy.grant@example.com', '', 'Do you deliver to Wales? What is the minimum order?'],
    ];
    contacts.forEach(([n, b, e, p, m], i) => run('INSERT INTO contact_messages (name, business_name, email, phone, message, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      n, b, e, p, m, i === 2 ? 1 : 0, sqlDate(i * 3 + 1)));

    run("INSERT INTO notifications (type, title, link, created_at) VALUES ('system', 'Demo catalogue loaded — welcome to WholesaleHub', '/admin', ?)", sqlDate(0));
  });
}

function seedIfEmpty() {
  const n = get('SELECT COUNT(*) AS n FROM users').n;
  if (n === 0) {
    seed();
    console.log(`Seeded demo data. Admin login: ${config.admin.email} / ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD)' : config.admin.password}`);
    return true;
  }
  return false;
}

if (require.main === module) {
  if (process.argv.includes('--reset')) reset();
  if (!seedIfEmpty()) console.log('Database already contains data. Use `npm run seed` to reset it.');
}

module.exports = { seed, seedIfEmpty, reset };
