/* WholesaleHub — progressive enhancement. Every feature works without JS. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const csrf = () => ($('input[name="_csrf"]') || {}).value || '';

  /* ---------- Slide-out panels (menu drawer, filters, admin nav) ---------- */
  function panel({ panelEl, backdrop, openers, closers, toggle }) {
    if (!panelEl) return;
    let lastFocus = null;
    const open = () => {
      lastFocus = document.activeElement;
      if (backdrop) { backdrop.hidden = false; requestAnimationFrame(() => backdrop.classList.add('is-visible')); }
      panelEl.classList.add('is-open');
      panelEl.setAttribute('aria-hidden', 'false');
      openers.forEach((b) => b.setAttribute('aria-expanded', 'true'));
      document.body.classList.add('no-scroll');
      const focusable = panelEl.querySelector('button, a, input, select');
      if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 50);
    };
    const close = () => {
      panelEl.classList.remove('is-open');
      panelEl.setAttribute('aria-hidden', 'true');
      openers.forEach((b) => b.setAttribute('aria-expanded', 'false'));
      document.body.classList.remove('no-scroll');
      if (backdrop) { backdrop.classList.remove('is-visible'); setTimeout(() => { backdrop.hidden = true; }, 250); }
      if (lastFocus) lastFocus.focus({ preventScroll: true });
    };
    openers.forEach((b) => b.addEventListener('click', () => (toggle && panelEl.classList.contains('is-open') ? close() : open())));
    closers.forEach((b) => b.addEventListener('click', close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panelEl.classList.contains('is-open')) close(); });
    // Swipe to close on touch devices
    let startX = null;
    panelEl.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    panelEl.addEventListener('touchend', (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const fromRight = panelEl.classList.contains('filters');
      if ((!fromRight && dx < -70) || (fromRight && dx > 70)) close();
      startX = null;
    });
  }

  panel({ panelEl: $('#drawer'), backdrop: $('.drawer-backdrop'), openers: $$('[data-drawer-open]'), closers: $$('[data-drawer-close]') });
  panel({ panelEl: $('#filters'), backdrop: $('.filters-backdrop'), openers: $$('[data-filters-open]'), closers: $$('[data-filters-close]') });
  panel({ panelEl: $('#admin-nav'), backdrop: $('.admin-backdrop'), openers: $$('[data-admin-nav-toggle]'), closers: $$('[data-admin-nav-close]'), toggle: true });

  /* ---------- Header search: mobile toggle + instant suggestions ---------- */
  const searchForm = $('[data-search]');
  const searchToggle = $('[data-search-toggle]');
  if (searchForm && searchToggle) {
    searchToggle.addEventListener('click', () => {
      searchForm.classList.toggle('is-open');
      if (searchForm.classList.contains('is-open')) $('input', searchForm).focus();
    });
  }
  if (searchForm) {
    const input = $('[data-search-input]', searchForm);
    const box = $('[data-search-results]', searchForm);
    let timer = null;
    let controller = null;
    let active = -1;
    const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const hide = () => { box.hidden = true; active = -1; };
    const render = (q, data) => {
      if (!data.results.length) {
        box.innerHTML = `<div class="s-empty">No products match “${esc(q)}”.</div>`;
      } else {
        box.innerHTML = data.results.map((r) => `<a href="${esc(r.url)}">${r.image ? `<img src="${esc(r.image)}" alt="" width="44" height="44">` : ''}<span><span class="s-name">${esc(r.name)}</span><br><span class="s-meta">${esc([r.brand, r.pack, r.sku].filter(Boolean).join(' · '))}</span></span></a>`).join('')
          + `<a class="s-all" href="/products?q=${encodeURIComponent(q)}">See all ${data.total} result${data.total === 1 ? '' : 's'}</a>`;
      }
      box.hidden = false;
      active = -1;
    };
    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 2) return hide();
      timer = setTimeout(async () => {
        try {
          if (controller) controller.abort();
          controller = new AbortController();
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
          if (res.ok && input.value.trim() === q) render(q, await res.json());
        } catch (e) { /* aborted or offline */ }
      }, 160);
    });
    input.addEventListener('keydown', (e) => {
      const links = $$('a', box);
      if (box.hidden || !links.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
        links.forEach((l, i) => l.classList.toggle('is-active', i === active));
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        links[active].click();
      } else if (e.key === 'Escape') hide();
    });
    document.addEventListener('click', (e) => { if (!searchForm.contains(e.target)) hide(); });
  }

  /* ---------- Auto-submitting selects (sort, admin filters) ---------- */
  $$('[data-autosubmit-select]').forEach((sel) => sel.addEventListener('change', () => sel.form.submit()));

  /* ---------- Save / unsave product (heart) ---------- */
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.matches('[data-save]')) {
      e.preventDefault();
      try {
        const res = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json', 'X-CSRF-Token': csrf() }, body: new URLSearchParams(new FormData(form)) });
        if (res.redirected || !res.ok) { form.submit(); return; }
        const { saved } = await res.json();
        const btn = $('button', form);
        btn.classList.toggle('is-saved', saved);
        btn.setAttribute('aria-pressed', String(saved));
        const label = $('[data-save-label]', form);
        if (label) label.textContent = saved ? 'Saved' : 'Save product';
      } catch (err) { form.submit(); }
    } else if (form.matches('[data-toggle]')) {
      e.preventDefault();
      try {
        const res = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body: new URLSearchParams(new FormData(form)) });
        if (!res.ok) { form.submit(); return; }
        const { value } = await res.json();
        const btn = $('button', form);
        btn.classList.toggle('flag-on', !!value);
        btn.setAttribute('aria-pressed', String(!!value));
        if ($('input[name=field]', form).value === 'active') btn.closest('tr').classList.toggle('is-inactive', !value);
      } catch (err) { form.submit(); }
    } else if (form.matches('[data-confirm]')) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    }
  });

  /* ---------- Make-offer form helpers ---------- */
  const qtyInput = $('[data-qty-input]');
  const productSel = $('[data-offer-product]');
  const priceInput = $('[data-offer-price]');
  const totalOut = $('[data-offer-total]');
  const moqHint = $('[data-moq-hint]');
  const currentMoq = () => {
    const opt = productSel && productSel.selectedOptions[0];
    return opt && opt.dataset.moq ? parseInt(opt.dataset.moq, 10) : 1;
  };
  const updateTotal = () => {
    if (!totalOut || !qtyInput || !priceInput) return;
    const q = parseInt(qtyInput.value, 10);
    const p = parseFloat(String(priceInput.value).replace(/[£,\s]/g, ''));
    totalOut.textContent = q > 0 && p > 0 ? `Offer total: ${new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(q * p)} ex VAT` : '';
  };
  $$('[data-qty]').forEach((b) => b.addEventListener('click', () => {
    const step = parseInt(b.dataset.qty, 10);
    const min = currentMoq();
    const v = parseInt(qtyInput.value, 10) || 0;
    qtyInput.value = Math.max(min, v + step);
    updateTotal();
  }));
  if (productSel) productSel.addEventListener('change', () => {
    const moq = currentMoq();
    if (moqHint) moqHint.textContent = productSel.value ? `Minimum order: ${moq} pack${moq === 1 ? '' : 's'}` : '';
    if (qtyInput && (parseInt(qtyInput.value, 10) || 0) < moq) qtyInput.value = moq;
    updateTotal();
  });
  [qtyInput, priceInput].forEach((el) => el && el.addEventListener('input', updateTotal));
  updateTotal();

  /* ---------- Admin: image preview ---------- */
  const imgInput = $('[data-image-input]');
  if (imgInput) {
    const drop = $('[data-image-drop]');
    const preview = $('[data-image-preview]');
    const empty = $('.image-drop-empty', drop);
    imgInput.addEventListener('change', () => {
      const file = imgInput.files && imgInput.files[0];
      if (!file) return;
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
      if (empty) empty.hidden = true;
    });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.add('is-drag')));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-drag')));
  }

  /* ---------- Admin: live margin ---------- */
  const sell = $('[data-margin-sell]');
  const cost = $('[data-margin-cost]');
  const marginOut = $('[data-margin-out]');
  const updateMargin = () => {
    const s = parseFloat(sell.value), c = parseFloat(cost.value);
    marginOut.textContent = s > 0 && c >= 0 && !Number.isNaN(c) ? `Margin ${(((s - c) / s) * 100).toFixed(1)}% · £${(s - c).toFixed(2)} per pack · never shown to buyers` : 'Never shown to buyers';
  };
  if (sell && cost && marginOut) { sell.addEventListener('input', updateMargin); cost.addEventListener('input', updateMargin); updateMargin(); }

  /* ---------- Admin: drag-and-drop category ordering ---------- */
  const list = $('[data-reorder]');
  if (list) {
    let dragging = null;
    list.addEventListener('dragstart', (e) => { dragging = e.target.closest('.cat-item'); if (dragging) dragging.classList.add('is-dragging'); });
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const over = e.target.closest('.cat-item');
      $$('.drop-target', list).forEach((el) => el.classList.remove('drop-target'));
      if (over && over !== dragging) over.classList.add('drop-target');
    });
    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      const over = e.target.closest('.cat-item');
      $$('.drop-target', list).forEach((el) => el.classList.remove('drop-target'));
      if (!dragging || !over || over === dragging) return;
      const items = $$('.cat-item', list);
      if (items.indexOf(dragging) < items.indexOf(over)) over.after(dragging); else over.before(dragging);
      const order = $$('.cat-item', list).map((el) => el.dataset.id);
      await fetch(list.dataset.reorder, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() }, body: JSON.stringify({ order }) });
      location.reload();
    });
    list.addEventListener('dragend', () => { if (dragging) dragging.classList.remove('is-dragging'); dragging = null; });
  }

  /* ---------- Flash messages ---------- */
  $$('.flash').forEach((f) => {
    const close = () => { f.style.opacity = '0'; setTimeout(() => f.remove(), 200); };
    $('[data-dismiss]', f).addEventListener('click', close);
    setTimeout(close, 6000);
  });
})();
