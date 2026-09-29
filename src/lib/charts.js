'use strict';

/*
 * Tiny server-rendered SVG charts for the admin dashboard.
 * Single-series, one hue, rounded data-ends, recessive grid and native
 * hover tooltips; the dashboard view adds a table fallback.
 */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Bar with only the top corners rounded (anchored flat on the baseline). */
function topRoundedBar(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.min(r, w / 2, h);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}

/**
 * Vertical column chart (change over time).
 * @param {{label:string, value:number}[]} data
 */
function columnChart(data, { title, format = (v) => String(v), highlightLast = true } = {}) {
  const W = 900, H = 280, padL = 36, padR = 8, padT = 16, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const step = plotW / Math.max(data.length, 1);
  const bw = Math.min(28, step * 0.62);
  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i;
    const y = padT + plotH - (v / max) * plotH;
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="ch-grid${i === 0 ? ' ch-base' : ''}"/>`
      + `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" class="ch-tick">${esc(format(v))}</text>`;
  }
  let bars = '';
  data.forEach((d, i) => {
    const h = (d.value / max) * plotH;
    const x = padL + i * step + (step - bw) / 2;
    const y = padT + plotH - h;
    const last = highlightLast && i === data.length - 1;
    bars += `<g class="ch-hit"><rect x="${padL + i * step}" y="${padT}" width="${step}" height="${plotH}" fill="transparent"/>`
      + `<path d="${topRoundedBar(x, y, bw, h, 4)}" class="ch-bar${last ? ' ch-bar-accent' : ''}"/>`
      + `<title>${esc(d.label)}: ${esc(format(d.value))}</title></g>`;
    if (i % Math.ceil(data.length / 8) === 0 || i === data.length - 1) {
      bars += `<text x="${x + bw / 2}" y="${H - 12}" text-anchor="middle" class="ch-tick">${esc(d.label)}</text>`;
    }
    if (last) bars += `<text x="${x + bw / 2}" y="${y - 6}" text-anchor="middle" class="ch-value">${esc(format(d.value))}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title || 'Chart')}" preserveAspectRatio="xMidYMid meet">${grid}${bars}</svg>`;
}

/**
 * Horizontal ranked bar list, rendered as HTML so labels stay a fixed,
 * readable size at any width. Labels sit above the bars for long names.
 */
function barList(data, { title, format = (v) => String(v) } = {}) {
  if (!data.length) return '<p class="muted small">No data yet</p>';
  const max = Math.max(...data.map((d) => d.value), 1);
  const rows = data.map((d) => `<li class="bl-row" title="${esc(d.label)}: ${esc(format(d.value))}">
    <span class="bl-label">${esc(d.label)}</span><span class="bl-value">${esc(format(d.value))}</span>
    <span class="bl-track"><span class="bl-bar" style="width:${Math.max(0.5, (d.value / max) * 100).toFixed(1)}%"></span></span></li>`).join('');
  return `<ol class="bar-list" aria-label="${esc(title || 'Chart')}">${rows}</ol>`;
}

module.exports = { columnChart, barList };
