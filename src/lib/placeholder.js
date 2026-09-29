'use strict';

/*
 * Original, generated product illustrations used for the demo catalogue.
 * Each category gets a simple flat-style packshot drawn as SVG so the site
 * looks populated without using any third-party product photography.
 */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt), g = clamp(((n >> 8) & 255) + amt), b = clamp((n & 255) + amt);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function battery(x, y, w, h, c, label) {
  const cap = Math.max(6, w * 0.28);
  return `
  <rect x="${x + w / 2 - cap / 2}" y="${y - 10}" width="${cap}" height="14" rx="3" fill="#b8bec7"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w * 0.18}" fill="${c}"/>
  <rect x="${x}" y="${y + h * 0.62}" width="${w}" height="${h * 0.38}" rx="${w * 0.18}" fill="#20252c"/>
  <rect x="${x}" y="${y + h * 0.62}" width="${w}" height="${h * 0.1}" fill="#20252c"/>
  <rect x="${x + w * 0.12}" y="${y + 8}" width="${w * 0.14}" height="${h - 16}" rx="4" fill="#fff" opacity=".25"/>
  <text x="${x + w / 2}" y="${y + h * 0.4}" text-anchor="middle" font-size="${Math.min(34, w * 0.36)}" font-weight="800" fill="#fff">${esc(label)}</text>`;
}

const DRAW = {
  batteries({ c, variant }) {
    const v = (variant || 'AA').toUpperCase();
    if (v === '9V') {
      return `<rect x="215" y="170" width="170" height="270" rx="18" fill="${c}"/>
        <rect x="215" y="340" width="170" height="100" rx="18" fill="#20252c"/><rect x="215" y="340" width="170" height="20" fill="#20252c"/>
        <rect x="240" y="140" width="40" height="34" rx="6" fill="#b8bec7"/><polygon points="320,140 360,140 370,174 310,174" fill="#b8bec7"/>
        <text x="300" y="285" text-anchor="middle" font-size="64" font-weight="800" fill="#fff">9V</text>`;
    }
    const dims = { AAA: [62, 270, 4], AA: [80, 280, 4], C: [120, 230, 2], D: [150, 250, 2] }[v] || [80, 280, 4];
    const [w, h, n] = dims;
    const gap = 22;
    const total = n * w + (n - 1) * gap;
    let out = '';
    for (let i = 0; i < n; i++) out += battery(300 - total / 2 + i * (w + gap), 300 - h / 2 + 20, w, h, c, v);
    return out;
  },
  'carrier-bags'({ c, variant }) {
    const s = { small: 0.75, medium: 0.9, large: 1.05 }[variant] || 0.9;
    const w = 260 * s, h = 300 * s, x = 300 - w / 2, y = 330 - h / 2;
    return `<path d="M${x + w * 0.28} ${y + 8} C ${x + w * 0.28} ${y - 90 * s}, ${x + w * 0.72} ${y - 90 * s}, ${x + w * 0.72} ${y + 8}" fill="none" stroke="${shade(c, -40)}" stroke-width="16" stroke-linecap="round"/>
      <path d="M${x} ${y} L${x + w} ${y} L${x + w - 12} ${y + h} L${x + 12} ${y + h} Z" fill="${c}"/>
      <path d="M${x} ${y} L${x + w} ${y} L${x + w - 2} ${y + 26} L${x + 2} ${y + 26} Z" fill="${shade(c, -25)}"/>
      <circle cx="${300}" cy="${y + h * 0.55}" r="${46 * s}" fill="#fff" opacity=".9"/>
      <text x="300" y="${y + h * 0.55 + 12 * s}" text-anchor="middle" font-size="${34 * s}" font-weight="800" fill="${shade(c, -40)}">${esc((variant || 'bag').slice(0, 1).toUpperCase())}</text>`;
  },
  'bin-bags'({ c }) {
    return `<path d="M300 140 C 270 140, 262 170, 285 188 L 250 200 C 170 240, 150 330, 170 420 C 185 470, 415 470, 430 420 C 450 330, 430 240, 350 200 L 315 188 C 338 170, 330 140, 300 140 Z" fill="${c}"/>
      <path d="M285 188 Q 300 200 315 188" stroke="${shade(c, 60)}" stroke-width="6" fill="none"/>
      <path d="M205 280 Q 230 360 215 430" stroke="${shade(c, 45)}" stroke-width="10" fill="none" opacity=".6" stroke-linecap="round"/>
      <path d="M390 280 Q 380 350 395 420" stroke="${shade(c, -30)}" stroke-width="8" fill="none" opacity=".5" stroke-linecap="round"/>`;
  },
  'butcher-supplies'({ c, variant }) {
    if (variant === 'tray') {
      return `<path d="M150 300 L450 300 L420 400 L180 400 Z" fill="${c}"/><path d="M150 300 L450 300 L440 322 L160 322 Z" fill="${shade(c, 30)}"/>
        <ellipse cx="300" cy="298" rx="120" ry="30" fill="${shade(c, -20)}" opacity=".4"/>`;
    }
    if (variant === 'gloves') {
      return `<path d="M230 440 L230 300 C230 280 250 280 250 300 L250 210 C250 190 272 190 272 210 L272 190 C272 170 294 170 294 190 L294 200 C294 180 316 180 316 200 L316 240 C 330 220 355 230 345 255 L 320 330 L 320 440 Z" fill="${c}"/>
        <rect x="222" y="420" width="106" height="30" rx="8" fill="${shade(c, -35)}"/>
        <path d="M330 440 L330 300 C330 280 350 280 350 300 L350 210 C350 190 372 190 372 210 L372 190 C372 170 394 170 394 190 L394 200 C394 180 416 180 416 200 L416 330 L 400 440 Z" fill="${shade(c, 25)}" opacity=".85"/>`;
    }
    return `<ellipse cx="300" cy="190" rx="150" ry="40" fill="${shade(c, 20)}"/>
      <rect x="150" y="190" width="300" height="220" fill="${c}"/>
      <ellipse cx="300" cy="410" rx="150" ry="40" fill="${shade(c, -15)}"/>
      <ellipse cx="300" cy="190" rx="44" ry="12" fill="#8a7a66"/>
      <path d="M450 250 L520 280 L520 330 L450 300 Z" fill="${shade(c, 10)}"/>`;
  },
  'filter-tips'({ c, variant }) {
    return pack(c, variant || 'TIPS', `
      <g transform="translate(300 380)">${[-60, -20, 20, 60].map((dx) => `<rect x="${dx - 14}" y="-30" width="28" height="70" rx="12" fill="#f6efe2" stroke="#d9cdb6" stroke-width="3"/>`).join('')}</g>`);
  },
  'rolling-papers'({ c, variant }) {
    return `<rect x="170" y="180" width="260" height="250" rx="10" fill="${c}"/>
      <rect x="170" y="180" width="260" height="70" rx="10" fill="${shade(c, -30)}"/>
      <path d="M200 170 L400 170 L410 190 L190 190 Z" fill="#fbf8f1"/>
      <rect x="200" y="290" width="200" height="54" rx="6" fill="#fff" opacity=".92"/>
      <text x="300" y="327" text-anchor="middle" font-size="30" font-weight="800" fill="${shade(c, -45)}">${esc(variant || 'PAPERS')}</text>`;
  },
  lighters({ c }) {
    let out = '';
    [[-110, c], [0, shade(c, 40)], [110, shade(c, -30)]].forEach(([dx, col]) => {
      const x = 300 + dx - 38;
      out += `<rect x="${x + 6}" y="170" width="64" height="70" rx="8" fill="#c3c8cf"/><rect x="${x + 18}" y="182" width="40" height="46" rx="6" fill="#8f96a0"/>
        <circle cx="${x + 38}" cy="205" r="14" fill="#6b727c"/>
        <rect x="${x}" y="236" width="76" height="210" rx="18" fill="${col}"/>
        <rect x="${x + 10}" y="250" width="12" height="180" rx="6" fill="#fff" opacity=".3"/>`;
    });
    return out;
  },
  'drink-bottles'({ c, variant }) {
    const liquid = variant === 'water' ? '#cfe7f7' : c;
    return `<rect x="270" y="110" width="60" height="36" rx="6" fill="${shade(c, -40)}"/>
      <path d="M272 146 L328 146 L328 180 C 380 210 390 240 390 280 L390 440 C 390 470 370 480 350 480 L250 480 C 230 480 210 470 210 440 L210 280 C 210 240 220 210 272 180 Z" fill="${liquid}" opacity=".95"/>
      <rect x="210" y="300" width="180" height="90" fill="${shade(c, -25)}"/>
      <text x="300" y="357" text-anchor="middle" font-size="30" font-weight="800" fill="#fff">${esc((variant || 'DRINK').toUpperCase())}</text>
      <rect x="228" y="200" width="14" height="250" rx="7" fill="#fff" opacity=".35"/>`;
  },
  'drink-cans'({ c, variant }) {
    return `<ellipse cx="300" cy="160" rx="90" ry="22" fill="#c3c8cf"/>
      <rect x="210" y="160" width="180" height="290" fill="${c}"/>
      <ellipse cx="300" cy="450" rx="90" ry="22" fill="${shade(c, -30)}"/>
      <ellipse cx="300" cy="160" rx="74" ry="15" fill="#a9b0b9"/>
      <rect x="236" y="260" width="128" height="80" rx="8" fill="#fff" opacity=".92"/>
      <text x="300" y="310" text-anchor="middle" font-size="26" font-weight="800" fill="${shade(c, -40)}">${esc((variant || 'COLA').toUpperCase())}</text>
      <rect x="226" y="180" width="14" height="250" rx="7" fill="#fff" opacity=".28"/>`;
  },
  'health-beauty'({ c, variant }) {
    if (variant === 'tube') {
      return `<path d="M230 150 L370 150 L350 420 L250 420 Z" fill="${c}"/><rect x="262" y="420" width="76" height="56" rx="8" fill="${shade(c, -40)}"/>
        <rect x="230" y="140" width="140" height="18" rx="3" fill="${shade(c, -20)}"/>
        <rect x="258" y="250" width="84" height="60" rx="6" fill="#fff" opacity=".9"/>`;
    }
    return `<rect x="286" y="110" width="28" height="60" fill="#d6dae0"/><path d="M286 118 L240 118 L240 132 L286 132 Z" fill="#d6dae0"/>
      <rect x="270" y="160" width="60" height="40" rx="6" fill="${shade(c, -35)}"/>
      <rect x="220" y="200" width="160" height="260" rx="36" fill="${c}"/>
      <rect x="244" y="270" width="112" height="110" rx="10" fill="#fff" opacity=".92"/>
      <circle cx="300" cy="325" r="26" fill="${shade(c, -10)}" opacity=".6"/>`;
  },
  'phone-accessories'({ c, variant }) {
    if (variant === 'charger' || variant === 'car') {
      if (variant === 'car') {
        return `<rect x="255" y="130" width="90" height="90" rx="14" fill="${shade(c, -30)}"/>
          <path d="M240 220 L360 220 L345 420 C345 440 330 450 300 450 C270 450 255 440 255 420 Z" fill="${c}"/>
          <rect x="278" y="160" width="44" height="14" rx="3" fill="#20252c"/><rect x="278" y="186" width="44" height="14" rx="3" fill="#20252c"/>
          <rect x="285" y="450" width="30" height="40" rx="6" fill="#c3c8cf"/>`;
      }
      return `<rect x="200" y="200" width="200" height="200" rx="34" fill="${c}"/>
        <rect x="245" y="400" width="22" height="70" rx="4" fill="#c3c8cf"/><rect x="333" y="400" width="22" height="70" rx="4" fill="#c3c8cf"/>
        <rect x="300" y="200" width="22" height="70" rx="4" fill="#c3c8cf" transform="translate(-11 -60)"/>
        <rect x="262" y="290" width="76" height="22" rx="6" fill="#20252c"/>`;
    }
    return `<path d="M170 420 C 120 330, 480 330, 430 240 C 400 180, 220 200, 250 150" fill="none" stroke="${c}" stroke-width="16" stroke-linecap="round"/>
      <rect x="140" y="400" width="60" height="90" rx="12" fill="${shade(c, -25)}"/><rect x="156" y="488" width="28" height="30" rx="4" fill="#c3c8cf"/>
      <rect x="220" y="80" width="60" height="90" rx="12" fill="${shade(c, -25)}"/><rect x="237" y="54" width="26" height="30" rx="${variant === 'lightning' ? 3 : 10}" fill="#c3c8cf"/>
      <text x="300" y="560" text-anchor="middle" font-size="30" font-weight="800" fill="#2b3340">${esc((variant || 'USB-C').toUpperCase())}</text>`;
  },
  general({ c, variant }) {
    if (variant === 'tape') {
      return `<circle cx="300" cy="310" r="140" fill="${c}"/><circle cx="300" cy="310" r="70" fill="#f3f4f6"/><circle cx="300" cy="310" r="80" fill="none" stroke="${shade(c, -30)}" stroke-width="12"/>
        <path d="M430 360 L520 400 L515 430 L420 390 Z" fill="${shade(c, 20)}"/>`;
    }
    return `<path d="M300 150 L460 220 L460 400 L300 470 L140 400 L140 220 Z" fill="${c}"/>
      <path d="M300 150 L460 220 L300 290 L140 220 Z" fill="${shade(c, 30)}"/><path d="M300 290 L300 470 L140 400 L140 220 Z" fill="${shade(c, -20)}"/>
      <path d="M220 185 L380 255 L380 300 L360 310 L360 264 L200 194 Z" fill="#e8d9b5" opacity=".9"/>`;
  },
  'catering-disposables'({ c, variant }) {
    if (variant === 'plates') {
      return `<ellipse cx="300" cy="360" rx="200" ry="60" fill="${shade(c, -20)}"/><ellipse cx="300" cy="340" rx="200" ry="60" fill="${c}"/>
        <ellipse cx="300" cy="340" rx="130" ry="36" fill="${shade(c, 15)}"/><ellipse cx="300" cy="320" rx="200" ry="60" fill="${c}" opacity=".6"/>`;
    }
    if (variant === 'containers') {
      return `<path d="M170 300 L430 300 L410 440 L190 440 Z" fill="${c}"/><path d="M160 260 L440 260 L440 300 L160 300 Z" fill="${shade(c, -25)}"/>
        <path d="M180 220 L420 220 L440 260 L160 260 Z" fill="${shade(c, 20)}"/>`;
    }
    let out = '';
    [[-90, 0], [0, -30], [90, 0]].forEach(([dx, dy]) => {
      out += `<path d="M${300 + dx - 65} ${230 + dy} L${300 + dx + 65} ${230 + dy} L${300 + dx + 48} ${440 + dy} L${300 + dx - 48} ${440 + dy} Z" fill="${c}"/>
        <rect x="${300 + dx - 70}" y="${218 + dy}" width="140" height="18" rx="6" fill="${shade(c, -30)}"/>
        <rect x="${300 + dx - 50}" y="${300 + dy}" width="100" height="40" fill="#fff" opacity=".85"/>`;
    });
    return out;
  },
  confectionery({ c, variant }) {
    if (variant === 'sweets') {
      return `<path d="M200 160 L400 160 L420 450 L180 450 Z" fill="${c}"/><path d="M200 160 L400 160 L395 190 L205 190 Z" fill="${shade(c, -30)}"/>
        <ellipse cx="300" cy="330" rx="80" ry="80" fill="#fff" opacity=".9"/>
        ${[[270, 310, '#e0475b'], [320, 300, '#f2b134'], [300, 350, '#3aa76d'], [335, 345, '#4c7de0'], [265, 355, '#9b59b6']].map(([x, y, col]) => `<circle cx="${x}" cy="${y}" r="18" fill="${col}"/>`).join('')}`;
    }
    if (variant === 'gum') {
      return `<rect x="170" y="230" width="260" height="140" rx="16" fill="${c}"/><rect x="170" y="230" width="260" height="40" rx="16" fill="${shade(c, -25)}"/>
        <rect x="200" y="290" width="200" height="50" rx="8" fill="#fff" opacity=".9"/>
        <text x="300" y="325" text-anchor="middle" font-size="28" font-weight="800" fill="${shade(c, -40)}">GUM</text>`;
    }
    return `<g transform="rotate(-12 300 310)"><path d="M130 260 L150 250 L150 370 L130 360 Z" fill="${shade(c, -30)}"/><path d="M470 260 L450 250 L450 370 L470 360 Z" fill="${shade(c, -30)}"/>
      <rect x="150" y="250" width="300" height="120" rx="6" fill="${c}"/>
      <rect x="220" y="275" width="160" height="70" rx="8" fill="#fff" opacity=".9"/>
      <rect x="240" y="292" width="120" height="36" rx="4" fill="#5a3825"/></g>`;
  },
};

function pack(c, label, extra) {
  return `<rect x="190" y="150" width="220" height="200" rx="10" fill="${c}"/>
    <rect x="190" y="150" width="220" height="50" rx="10" fill="${shade(c, -30)}"/>
    <rect x="215" y="235" width="170" height="56" rx="6" fill="#fff" opacity=".92"/>
    <text x="300" y="273" text-anchor="middle" font-size="30" font-weight="800" fill="${shade(c, -45)}">${esc(label)}</text>${extra}`;
}

/**
 * @param {object} o
 * @param {string} o.category  category slug (drives the illustration)
 * @param {string} o.color     main hex colour
 * @param {string} [o.variant] illustration variant (e.g. AA, large, plates)
 * @param {string} [o.brand]   small brand wordmark printed at the top
 */
function productSvg({ category, color = '#2b3a55', variant, brand }) {
  const draw = DRAW[category] || DRAW.general;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" font-family="Helvetica, Arial, sans-serif">
  <defs><radialGradient id="bg" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef0f3"/></radialGradient></defs>
  <rect width="600" height="600" fill="url(#bg)"/>
  <ellipse cx="300" cy="510" rx="190" ry="22" fill="#000" opacity=".07"/>
  ${draw({ c: color, variant })}
  ${brand ? `<text x="300" y="560" text-anchor="middle" font-size="22" font-weight="700" letter-spacing="3" fill="#8a93a0">${esc(brand.toUpperCase())}</text>` : ''}
</svg>`;
}

/** Simple category tile icon (used on the homepage category grid). */
function categorySvg(slug, color) {
  return productSvg({ category: slug, color, variant: CATEGORY_DEFAULT_VARIANT[slug] });
}
const CATEGORY_DEFAULT_VARIANT = {
  batteries: 'AA', 'carrier-bags': 'medium', 'drink-bottles': 'water', 'drink-cans': 'cola',
  'phone-accessories': 'charger', 'catering-disposables': 'cups', confectionery: 'bar',
  'filter-tips': 'TIPS', 'rolling-papers': 'PAPERS',
};

module.exports = { productSvg, categorySvg };
