# WholesaleHub

A mobile-first B2B wholesale catalogue and **make-an-offer** platform for UK trade buyers. Buyers browse products, view details and submit offers or enquiries. There is no checkout. The admin team reviews each offer, then accepts it, rejects it or sends a counter-offer.

Built with Node.js 22, Express, EJS server-rendered pages and SQLite (Node's built-in `node:sqlite`, so there are no native modules to compile). The front end is plain CSS plus one small progressive-enhancement script. Every page works without JavaScript.

## Quick start

```bash
npm install
npm start            # http://localhost:3000
```

On first start the database is created in `./data` and filled with demo data: 14 categories, 51 products, 5 buyers, offers, enquiries and contact messages.

| Role  | Login                                                      |
|-------|------------------------------------------------------------|
| Admin | `admin@wholesalehub.co.uk` / `ChangeMe123!` (at `/admin/login`) |
| Buyer | `buyer@example.com` / `Buyer123!` (at `/login`)            |

Other commands:

```bash
npm run dev    # auto-restart on changes
npm run seed   # wipe the database and reload demo data
npm test       # integration tests (catalogue, offers, permissions, admin)
```

## Configuration

Copy `.env.example` to `.env`. It is loaded automatically. In production, set these:

- `NODE_ENV=production`, `SESSION_SECRET` (required: the app refuses to start without it) and `SITE_URL` (used for canonical and Open Graph URLs and the sitemap)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`: the first admin account, created when the database is empty
- `DATA_DIR`: where the SQLite database and uploaded images are stored. Put this on persistent storage.
- `SMTP_*` (optional): new offers, enquiries and contact messages always show up in the admin dashboard. With SMTP set, the admin is also emailed, and buyers get emails when their offer status changes.

Business details (phone, WhatsApp, email, address, opening hours) are in `src/config.js`.

### Docker

```bash
docker build -t wholesalehub .
docker run -p 3000:3000 -v wholesalehub-data:/data \
  -e SESSION_SECRET=... -e SITE_URL=https://example.co.uk -e ADMIN_PASSWORD=... wholesalehub
```

## Features

**Public site**
- Homepage: hero search, category grid, featured products, recently added, "how it works" offer CTA, contact strip
- Sticky navy header. Desktop has a search bar, links and a category bar. Mobile has the logo, a search toggle and a hamburger menu that slides in from the side.
- Catalogue at `/products` with instant search suggestions. Search covers name, brand, SKU, category and description. Filters: category, brand, pack size, availability, new, featured. Sorting and pagination included.
- Category pages at `/category/:slug`, the new-products page at `/new-products` and product pages at `/products/:slug`
- Product pages show a large image, SKU, pack size, MOQ, stock, guide price, RRP, Make an Offer and Send Enquiry buttons, related products, and a sticky offer bar on phones
- **Trade prices are shown only to logged-in accounts.** Visitors see "Log in for trade price".
- Make an Offer form with a quantity stepper, MOQ checks and a live total. After submitting, the buyer gets a confirmation page with a private tracking link where they can follow the status, accept or decline a counter-offer and message the team.
- Contact page with business details, opening hours and a form. Submissions are stored and appear in the admin dashboard.
- SEO: page titles, meta descriptions, canonical URLs, Open Graph and Twitter tags, Product JSON-LD, `sitemap.xml` and `robots.txt`

**Buyer account** (`/account`): overview, profile and business details, password change, saved products, submitted offers with their status and message thread, and previous enquiries with the admin's replies.

**Admin** (`/admin`)
- Statistics: potential and won sales value, offer counts (total, this week, this month, accepted), products, buyers, enquiries, a chart of offers per week, offers by status, most viewed products, most offered products and most popular categories
- Products: list, search and filter. Quick toggles for Active, Featured and New. **+ Add Product** takes you to a single form with image upload, a live margin calculator, "Save & add another" and delete.
- Categories: add, edit (including an image) and delete. Reorder with drag-and-drop or the up/down arrows.
- Offers: filter by status and search. The detail page shows buyer contact shortcuts (call, WhatsApp, email), margin at the offered price, one-click accept or reject, counter-offers, a status change, messages to the buyer and internal notes.
- Enquiries (reply and status), contact messages, buyers (with enquiry and offer counts, accepted offers and potential value) and notifications

## Security and roles

| | Visitor | Buyer | Admin |
|---|---|---|---|
| Browse, search and view products | ✓ | ✓ | ✓ |
| Submit offers and enquiries | ✓ | ✓ | ✓ |
| See trade (wholesale) prices | | ✓ | ✓ |
| Own account, offers, enquiries and saved products | | ✓ | |
| Supplier cost, margins, internal notes, other buyers, statistics | | | ✓ |

- Every buyer query is filtered by the logged-in buyer's ID. Public queries select an explicit list of columns, so `cost_price` and `admin_notes` never reach public pages or the JSON API. Tests cover this.
- Passwords are hashed with scrypt. Sessions are stored in SQLite, the session is regenerated at login, and cookies are httpOnly and SameSite.
- Every form has a CSRF token. There is rate limiting on login and public forms, honeypot fields, and a strict Content-Security-Policy.
- Uploads are limited to JPG, PNG, WebP and GIF up to 5MB, saved under random filenames.

## Database

Tables are created automatically (see `src/db.js`): `users`, `products`, `categories`, `offers`, `enquiries`, `saved_products`, plus `offer_messages` (the conversation with the buyer), `contact_messages`, `notifications` and `sessions`. Beyond the columns in the original spec, `products` also has `slug`, `cost_price` (internal), `age_restricted` and `views`. `offers` stores a snapshot of the buyer's contact details, along with `counter_price` and `agreed_price`, so guest offers work too.

## Demo content

All brands, product names and product images are fictional. The images are original SVG illustrations generated by `src/lib/placeholder.js`. Replace them by uploading real photos in the admin area.
