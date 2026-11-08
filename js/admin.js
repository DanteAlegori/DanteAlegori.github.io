/* ============================================================
   XBOX 360 SYSTEM DASHBOARD · МАСТЕРСКАЯ NERO (ADMIN)
   ---------------------------------------------------------
   Полноценный GUI-редактор вишлиста:
     • Живое управление карточками (превью, цена, прогресс)
     • Форма цели с авто-расчётом процента и превью обложки
     • Шкала важности (Heat Level 1..5)
     • Менеджер категорий: добавить / переименовать / порядок / удалить
     • Редактор профиля игрока
     • Менеджер плейлиста саундтрека
     • Импорт / экспорт config.js и playlist.js
     • Синхронизация с витриной через LocalStorage (работает по file://)
   ============================================================ */
(function (global) {
  'use strict';

  const DEFAULT_CATEGORY = 'ВСЕ ДИСКИ';
  const DRAFT_KEY = 'x360-admin-draft-v1';
  const LIVE_KEY = 'x360-wishlist-config';
  const SYNC_KEY = 'x360-admin-sync';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  const base = global.WISHLIST_CONFIG || {};
  const fileStamp = Number((global.WISHLIST_CONFIG_META && global.WISHLIST_CONFIG_META.generated) || 0);

  /**
   * Источник данных для редактора.
   *
   * Если в браузере есть более свежая правка из мастерской (LocalStorage),
   * берём её — иначе админка правила бы устаревший файл и затерла бы
   * правку, которую уже видит витрина. Файл на диске побеждает, только
   * если он новее сохранённой правки.
   */
  function readLiveConfig() {
    try {
      const raw = global.localStorage.getItem(LIVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.config) return null;
      const liveStamp = Number(parsed.savedAt) || 0;
      if (fileStamp && fileStamp >= liveStamp) return null;
      return parsed.config;
    } catch (err) { return null; }
  }

  const liveConfig = readLiveConfig();
  const source = liveConfig || base;

  const state = {
    profile: (source.profile && typeof source.profile === 'object')
      ? clone(source.profile)
      : { callsign: 'DANTE // 2003', statusMessage: '', currency: '₽', vibeNote: '', gamerscore: 0 },
    categories: Array.isArray(source.categories) && source.categories.length
      ? source.categories.slice()
      : [DEFAULT_CATEGORY],
    items: Array.isArray(source.items) ? clone(source.items) : []
  };

  const ui = {
    dirty: false,
    editingIndex: null,
    saveTimer: null,
    pendingDraft: null,
    toastTimer: null,
    heat: 4,
    syncEnabled: true
  };

  /* =========================================================
     ПРЕДПОЧТЕНИЯ И СИНХРОНИЗАЦИЯ
     ========================================================= */
  function loadSyncPref() {
    try {
      const raw = global.localStorage.getItem(SYNC_KEY);
      if (raw !== null) ui.syncEnabled = raw === '1';
    } catch (err) { /* ignore */ }
  }

  /**
   * Сохраняет правку в LocalStorage, чтобы витрина (index.html)
   * увидела её мгновенно — без перезаписи файла на диске.
   */
  function publishLive() {
    if (!ui.syncEnabled) return;
    try {
      global.localStorage.setItem(LIVE_KEY, JSON.stringify({
        savedAt: Date.now(),
        config: {
          profile: state.profile,
          categories: state.categories,
          items: state.items
        }
      }));
    } catch (err) {
      log('LocalStorage недоступен: ' + err.message);
    }
  }

  function clearLive() {
    try { global.localStorage.removeItem(LIVE_KEY); } catch (err) { /* ignore */ }
  }

  /* =========================================================
     ЛОГ / ТОСТ / СТАТУС
     ========================================================= */
  const logEl = () => $('#log');

  function log(msg) {
    const el = logEl();
    if (!el) return;
    const t = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.textContent += '\n[' + t + '] > ' + msg;
    el.scrollTop = el.scrollHeight;
  }

  function setStatus(text) {
    const el = $('#status');
    if (el) el.textContent = text;
  }

  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function money(n) {
    return Number(n || 0).toLocaleString('ru-RU') + ' ' + (state.profile.currency || '₽');
  }

  /* =========================================================
     НОРМАЛИЗАЦИЯ СОСТОЯНИЯ
     ========================================================= */
  function normalizeState() {
    if (!Array.isArray(state.categories) || !state.categories.length) {
      state.categories = [DEFAULT_CATEGORY];
    }
    state.categories = state.categories.map((c) => String(c || '').trim()).filter(Boolean);
    if (!state.categories.length) state.categories = [DEFAULT_CATEGORY];

    if (!state.profile || typeof state.profile !== 'object') {
      state.profile = { callsign: 'DANTE // 2003', statusMessage: '', currency: '₽', vibeNote: '', gamerscore: 0 };
    }
    if (!Array.isArray(state.items)) state.items = [];

    state.items.forEach((it) => {
      it.heatLevel = Math.min(5, Math.max(1, Number(it.heatLevel) || 1));
      it.price = Math.max(0, Number(it.price) || 0);
      it.collected = Math.min(it.price, Math.max(0, Number(it.collected) || 0));
      it.status = it.status === 'busted' ? 'busted' : 'wanted';
      it.title = String(it.title || 'БЕЗ НАЗВАНИЯ');
      it.category = String(it.category || '');
    });
  }

  function saveDraft() {
    try {
      global.localStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), state }));
    } catch (err) { /* storage unavailable */ }
  }

  function markDirty() {
    ui.dirty = true;
    setStatus('CHANGED // UNSAVED');
    document.title = '● XBOX 360 // STASH WORKSHOP';
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(() => {
      saveDraft();
      publishLive();
    }, 250);
    updateSyncBanner();
  }

  /* =========================================================
     СТАТИСТИКА
     ========================================================= */
  function renderStats() {
    const items = state.items;
    const goal = items.reduce((a, b) => a + (Number(b.price) || 0), 0);
    const saved = items.reduce((a, b) => a + Math.min(Number(b.price) || 0, Number(b.collected) || 0), 0);
    const pct = goal ? Math.round((saved / goal) * 100) : 0;
    const acquired = items.filter((i) => i.status === 'busted').length;

    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('#statTargets', items.length);
    set('#statGoal', money(goal));
    set('#statSaved', money(saved));
    set('#statAcquired', acquired);
    set('#statPct', pct + '%');
    set('#statScore', (Number(state.profile.gamerscore) || 0) + ' G');
    const bar = $('#statBar');
    if (bar) bar.style.setProperty('--p', (Math.min(100, Math.max(0, pct)) / 100).toFixed(4));
    const badge = $('#countBadge');
    if (badge) badge.textContent = items.length;
  }

  /* =========================================================
     СПИСОК ЦЕЛЕЙ
     ========================================================= */
  function renderItems() {
    const box = $('#items');
    if (!box) return;
    const q = ($('#search').value || '').trim().toLowerCase();
    const statusFilter = $('#filterStatus').value;

    box.innerHTML = '';

    if (!state.items.length) {
      box.innerHTML = '<div class="empty">Пока пусто. Добавь первую цель в редакторе справа.</div>';
      return;
    }

    const rows = state.items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => {
        if (statusFilter !== 'all' && it.status !== statusFilter) return false;
        if (!q) return true;
        const haystack = [it.title, it.category, it.slogan, it.bountyTag].join(' ').toLowerCase();
        return haystack.includes(q);
      });

    if (!rows.length) {
      box.innerHTML = '<div class="empty">Ничего не найдено по фильтру.</div>';
      return;
    }

    rows.forEach(({ it, i }) => {
      const price = Math.max(0, Number(it.price) || 0);
      const saved = Math.min(price, Math.max(0, Number(it.collected) || 0));
      const pct = price ? Math.round((saved / price) * 100) : (it.status === 'busted' ? 100 : 0);
      const heat = Math.min(5, Math.max(1, Number(it.heatLevel) || 1));
      const busted = it.status === 'busted';

      const card = document.createElement('article');
      card.className = 'item-card' + (busted ? ' is-busted' : '');
      card.dataset.i = i;
      card.innerHTML =
        '<div class="thumb-wrap ' + (it.photoUrl ? '' : 'no-art') + '">' +
          (it.photoUrl
            ? '<img class="thumb" src="' + esc(it.photoUrl) + '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'no-art\');this.remove()">'
            : '') +
          '<span class="heat-badge">H' + heat + '</span>' +
        '</div>' +
        '<div class="item-body">' +
          '<div class="item-top">' +
            '<div class="item-titles">' +
              '<h3>' + esc(it.title || 'БЕЗ НАЗВАНИЯ') + '</h3>' +
              '<div class="item-meta">' +
                '<span>' + esc(it.category || 'БЕЗ КАТЕГОРИИ') + '</span>' +
                '<span class="pill ' + (busted ? 'busted' : 'wanted') + '">' + (busted ? 'ACQUIRED' : 'WANTED') + '</span>' +
                (it.bountyTag ? '<span class="tag">' + esc(it.bountyTag) + '</span>' : '') +
              '</div>' +
            '</div>' +
            '<div class="item-money">' +
              '<strong>' + esc(money(saved)) + '</strong>' +
              '<span>из ' + esc(money(price)) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="progress-track"><div class="progress-fill ' + (busted ? 'busted' : '') + '" style="--p:' + (Math.min(100, Math.max(0, pct)) / 100).toFixed(4) + '"></div></div>' +
          '<div class="item-progress-meta"><span data-saved-label>Накоплено ' + esc(money(saved)) + '</span><span class="pct" data-pct>' + pct + '%</span></div>' +
          '<input class="slider" type="range" min="0" max="' + Math.max(1, price) + '" value="' + saved + '" data-slider="' + i + '" aria-label="Накоплено для ' + esc(it.title || '') + '">' +
          '<div class="item-actions">' +
            '<button type="button" class="btn sm" data-edit="' + i + '">✎ ИЗМЕНИТЬ</button>' +
            '<button type="button" class="btn sm ' + (busted ? '' : 'primary') + '" data-toggle="' + i + '">' + (busted ? '↩ В РОЗЫСК' : '✓ КУПЛЕНО') + '</button>' +
            '<button type="button" class="btn sm ghost icon" data-up="' + i + '" ' + (i === 0 ? 'disabled' : '') + ' title="Выше">↑</button>' +
            '<button type="button" class="btn sm ghost icon" data-down="' + i + '" ' + (i === state.items.length - 1 ? 'disabled' : '') + ' title="Ниже">↓</button>' +
            (it.shopUrl ? '<a class="btn sm ghost" href="' + esc(it.shopUrl) + '" target="_blank" rel="noopener noreferrer">↗ МАГАЗИН</a>' : '') +
            '<button type="button" class="btn sm danger" data-delete="' + i + '">DROP</button>' +
          '</div>' +
        '</div>';

      box.appendChild(card);
    });

    bindItems(box);
  }

  function bindItems(box) {
    box.querySelectorAll('[data-slider]').forEach((input) => {
      input.addEventListener('input', () => {
        const i = Number(input.dataset.slider);
        const it = state.items[i];
        const price = Math.max(0, Number(it.price) || 0);
        it.collected = Math.min(price, Math.max(0, Number(input.value) || 0));
        const card = input.closest('.item-card');
        card.querySelector('[data-saved-label]').textContent = 'Накоплено ' + money(it.collected);
        const pct = price ? Math.round((it.collected / price) * 100) : 0;
        card.querySelector('[data-pct]').textContent = pct + '%';
        const fill = card.querySelector('.progress-fill');
        if (fill) fill.style.setProperty('--p', (Math.min(100, Math.max(0, pct)) / 100).toFixed(4));
        markDirty();
      });
      input.addEventListener('change', () => {
        renderStats();
        log('Накопления обновлены');
      });
    });

    box.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const it = state.items[Number(btn.dataset.toggle)];
        it.status = it.status === 'busted' ? 'wanted' : 'busted';
        renderItems();
        renderStats();
        markDirty();
        log((it.title || 'Цель') + ' // статус: ' + (it.status === 'busted' ? 'ACQUIRED' : 'WANTED'));
      });
    });

    box.querySelectorAll('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => fillForm(Number(btn.dataset.edit)));
    });

    box.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.delete);
        const it = state.items[i];
        if (!confirm('Удалить цель «' + (it.title || '') + '»?')) return;
        state.items.splice(i, 1);
        if (ui.editingIndex !== null) {
          if (ui.editingIndex === i) resetForm();
          else if (ui.editingIndex > i) ui.editingIndex--;
        }
        renderAll();
        markDirty();
        log((it.title || 'Цель') + ' // удалено');
        toast('Цель удалена');
      });
    });

    box.querySelectorAll('[data-up]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.up);
        if (i <= 0) return;
        const tmp = state.items[i - 1];
        state.items[i - 1] = state.items[i];
        state.items[i] = tmp;
        if (ui.editingIndex === i) ui.editingIndex = i - 1;
        else if (ui.editingIndex === i - 1) ui.editingIndex = i;
        renderItems();
        markDirty();
      });
    });

    box.querySelectorAll('[data-down]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.down);
        if (i >= state.items.length - 1) return;
        const tmp = state.items[i + 1];
        state.items[i + 1] = state.items[i];
        state.items[i] = tmp;
        if (ui.editingIndex === i) ui.editingIndex = i + 1;
        else if (ui.editingIndex === i + 1) ui.editingIndex = i;
        renderItems();
        markDirty();
      });
    });
  }

  /* =========================================================
     КАТЕГОРИИ
     ========================================================= */
  function renderCategorySelects() {
    const sel = $('#f-category');
    if (!sel) return;
    const prev = sel.value;
    const cats = state.categories.filter((c, i) => i > 0 && c);
    sel.innerHTML = cats.length
      ? cats.map((c) => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('')
      : '<option value="">БЕЗ КАТЕГОРИИ</option>';
    if (cats.includes(prev)) sel.value = prev;
  }

  function renderCatList() {
    const box = $('#catList');
    if (!box) return;
    box.innerHTML = '';

    state.categories.forEach((cat, i) => {
      const locked = i === 0;
      const count = state.items.filter((it) => it.category === cat).length;

      const row = document.createElement('div');
      row.className = 'cat-row';
      row.draggable = !locked;
      row.dataset.catRow = i;
      row.innerHTML =
        '<span class="cat-index">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<input type="text" value="' + esc(cat) + '" ' + (locked ? 'readonly' : '') +
          ' data-cat-input="' + i + '" aria-label="Категория ' + (i + 1) + '">' +
        '<span class="cat-count">' + count + ' шт.</span>' +
        (locked
          ? '<span class="cat-lock">СЛУЖЕБНАЯ</span>'
          : '<button type="button" class="btn ghost sm icon" data-cat-up="' + i + '" ' + (i <= 1 ? 'disabled' : '') + ' title="Выше">↑</button>' +
            '<button type="button" class="btn ghost sm icon" data-cat-down="' + i + '" ' + (i === state.categories.length - 1 ? 'disabled' : '') + ' title="Ниже">↓</button>' +
            '<button type="button" class="btn danger sm icon" data-cat-del="' + i + '" title="Удалить">✕</button>');

      box.appendChild(row);
    });

    box.querySelectorAll('[data-cat-input]').forEach((inp) => {
      if (inp.readOnly) return;
      inp.addEventListener('change', () => {
        const i = Number(inp.dataset.catInput);
        const next = inp.value.trim();
        if (!next) { inp.value = state.categories[i]; return; }
        if (state.categories.some((c, ci) => ci !== i && c === next)) {
          toast('Такая категория уже есть');
          inp.value = state.categories[i];
          return;
        }
        const old = state.categories[i];
        state.categories[i] = next;
        state.items.forEach((it) => { if (it.category === old) it.category = next; });
        renderAll();
        markDirty();
        log('Категория переименована: ' + old + ' → ' + next);
      });
    });

    box.querySelectorAll('[data-cat-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.catDel);
        const cat = state.categories[i];
        if (!confirm('Удалить категорию «' + cat + '»? Цели перейдут в другую категорию.')) return;
        state.categories.splice(i, 1);
        const fallback = state.categories[1] || state.categories[0] || DEFAULT_CATEGORY;
        state.items.forEach((it) => { if (it.category === cat) it.category = fallback; });
        renderAll();
        markDirty();
        log('Категория удалена: ' + cat);
        toast('Категория удалена');
      });
    });

    // Переупорядочивание стрелками
    box.querySelectorAll('[data-cat-up]').forEach((btn) => {
      btn.addEventListener('click', () => moveCategory(Number(btn.dataset.catUp), -1));
    });
    box.querySelectorAll('[data-cat-down]').forEach((btn) => {
      btn.addEventListener('click', () => moveCategory(Number(btn.dataset.catDown), 1));
    });

    // Drag-and-drop переупорядочивание
    bindCatDnd(box);
  }

  function moveCategory(i, delta) {
    const j = i + delta;
    if (i <= 0 || j <= 0 || j >= state.categories.length) return;
    const tmp = state.categories[i];
    state.categories[i] = state.categories[j];
    state.categories[j] = tmp;
    renderAll();
    markDirty();
    log('Порядок категорий изменён');
  }

  function bindCatDnd(box) {
    let dragIndex = null;

    box.querySelectorAll('[data-cat-row]').forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        const idx = Number(row.dataset.catRow);
        if (idx === 0) { e.preventDefault(); return; }
        dragIndex = idx;
        row.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch (err) { /* ignore */ }
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        box.querySelectorAll('.cat-row').forEach((r) => r.classList.remove('drag-over'));
        dragIndex = null;
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dragIndex === null) return;
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (dragIndex === null) return;
        const target = Number(row.dataset.catRow);
        if (target === 0 || target === dragIndex) return;
        const moved = state.categories.splice(dragIndex, 1)[0];
        state.categories.splice(target, 0, moved);
        renderAll();
        markDirty();
        log('Категория «' + moved + '» перемещена');
      });
    });
  }

  /* =========================================================
     ФОРМА ЦЕЛИ
     ========================================================= */
  function fillForm(i) {
    const it = state.items[i];
    if (!it) return;
    ui.editingIndex = i;
    const f = $('#form');

    renderCategorySelects();
    f.title.value = it.title || '';
    f.category.value = it.category || '';
    if (f.category.value !== (it.category || '')) {
      f.category.value = state.categories[1] || '';
    }
    f.price.value = Number(it.price) || 0;
    f.collected.value = Number(it.collected) || 0;
    f.status.value = it.status === 'busted' ? 'busted' : 'wanted';
    f.photoUrl.value = it.photoUrl || '';
    f.shopUrl.value = it.shopUrl || '';
    f.bountyTag.value = it.bountyTag || '';
    f.slogan.value = it.slogan || '';
    ui.heat = Math.min(5, Math.max(1, Number(it.heatLevel) || 1));
    renderHeat();

    $('#formTitle').textContent = 'РЕДАКТИРОВАНИЕ ЦЕЛИ';
    $('#submitBtn').textContent = '💾 СОХРАНИТЬ ИЗМЕНЕНИЯ';
    $('#resetForm').hidden = false;

    switchTab('target');
    updateCalc();
    updatePreview();
    const side = document.querySelector('.col-side');
    if (side) side.scrollIntoView({ behavior: 'smooth', block: 'start' });
    f.title.focus();
  }

  function resetForm() {
    ui.editingIndex = null;
    const f = $('#form');
    if (!f) return;
    f.reset();
    renderCategorySelects();
    f.heatLevel && (f.heatLevel.value = 4);
    f.price.value = 0;
    f.collected.value = 0;
    f.status.value = 'wanted';
    f.bountyTag.value = 'NEW TARGET';
    ui.heat = 4;
    renderHeat();
    $('#formTitle').textContent = 'НОВАЯ ЦЕЛЬ // REC';
    $('#submitBtn').textContent = '+ ДОБАВИТЬ В ТРЕКЛИСТ';
    $('#resetForm').hidden = true;
    updateCalc();
    updatePreview();
  }

  /** Шкала важности 1..5 (звёзды). */
  function renderHeat() {
    const box = $('#heatScale');
    if (!box) return;
    const labels = ['100% ХОТЕЛКА', 'HEAT 2/5', 'HEAT 3/5', 'HEAT 4/5', 'РОК 18+'];
    box.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'star' + (i <= ui.heat ? ' on' : '');
      b.textContent = '🔥';
      b.setAttribute('aria-label', 'Уровень важности ' + i);
      b.title = labels[i - 1];
      b.addEventListener('click', () => {
        ui.heat = i;
        renderHeat();
      });
      box.appendChild(b);
    }
    const lbl = document.createElement('span');
    lbl.className = 'heat-label';
    lbl.textContent = labels[ui.heat - 1];
    box.appendChild(lbl);
  }

  /** Авто-расчёт процента и остатка в форме. */
  function updateCalc() {
    const f = $('#form');
    if (!f) return;
    const price = Math.max(0, Number(f.price.value) || 0);
    const collected = Math.min(price, Math.max(0, Number(f.collected.value) || 0));
    const pct = price ? Math.round((collected / price) * 100) : 0;
    const remain = Math.max(0, price - collected);

    const box = $('#calcReadout');
    if (!box) return;
    box.innerHTML =
      '<span>ПРОГРЕСС <b>' + pct + '%</b></span>' +
      '<span>ОСТАЛОСЬ <b>' + esc(money(remain)) + '</b></span>';
  }

  /** Предпросмотр обложки «как она сядет на бокс». */
  function updatePreview() {
    const f = $('#form');
    const frame = $('#previewFrame');
    if (!f || !frame) return;
    const url = f.photoUrl.value.trim();
    const bounty = f.bountyTag.value.trim();

    let inner = '<span class="no-art">NO SIGNAL</span>';
    if (url) {
      inner = '<img id="previewImg" src="' + esc(url) + '" alt="Превью обложки" onerror="this.style.display=\'none\';this.parentNode.innerHTML=\'<span class=&quot;no-art&quot;>NO SIGNAL</span>\'">';
    }
    if (bounty) inner += '<span class="bounty">' + esc(bounty) + '</span>';
    inner += '<span class="heat">HEAT ' + ui.heat + '</span>';
    frame.innerHTML = inner;
  }

  function renderProfileForm() {
    const p = state.profile || {};
    const f = $('#profileForm');
    if (!f) return;
    f.callsign.value = p.callsign || '';
    f.statusMessage.value = p.statusMessage || '';
    f.currency.value = p.currency || '₽';
    f.vibeNote.value = p.vibeNote || '';
    f.gamerscore.value = Number(p.gamerscore) || 0;
  }

  /* =========================================================
     ПЛЕЙЛИСТ САУНДТРЕКА
     ========================================================= */
  function currentPlaylist() {
    const list = Array.isArray(global.BRADYYCARDIA_PLAYLIST) ? global.BRADYYCARDIA_PLAYLIST : [];
    return list.map((x) => String(x || '').trim()).filter(Boolean);
  }

  function renderPlaylist() {
    const ta = $('#playlistText');
    if (!ta) return;
    const tracks = currentPlaylist();
    ta.value = tracks.join('\n');

    const status = $('#playlistStatus');
    const list = $('#trackList');
    if (list) {
      list.innerHTML = '';
      tracks.forEach((name, i) => {
        const ext = (name.split('.').pop() || '').toLowerCase();
        const row = document.createElement('div');
        row.className = 'tr';
        row.innerHTML =
          '<span class="n">' + String(i + 1).padStart(2, '0') + '</span>' +
          '<span class="nm" title="' + esc(name) + '">' + esc(name) + '</span>' +
          '<span class="ext">' + esc(ext) + '</span>';
        list.appendChild(row);
      });
    }
    if (status) {
      status.innerHTML = 'В плейлисте <b>' + tracks.length + '</b> трек(ов). ' +
        'Плеер подхватит их автоматически, как только файл playlist.js будет обновлён на диске.';
    }
  }

  function playlistCode() {
    const tracks = ($('#playlistText').value || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return '/* ============================================================\n' +
      '   BRADYYCARDIA RADIO — ПЛЕЙЛИСТ САУНДТРЕКА\n' +
      '   ---------------------------------------------------------\n' +
      '   Плоский список названий файлов из папки music/.\n' +
      '   Сгенерировано мастерской NERO: ' + new Date().toISOString() + '\n' +
      '   ============================================================ */\n' +
      'window.BRADYYCARDIA_PLAYLIST = [\n' +
      tracks.map((t) => "  '" + t.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "',").join('\n') +
      '\n];\n';
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  /* =========================================================
     ЭКСПОРТ / ИМПОРТ КОНФИГА
     ========================================================= */
  /**
   * Формирует готовый config.js.
   *
   * Важно: данные ВСТРАИВАЮТСЯ в файл литералом, а не читаются из
   * window.WISHLIST_CONFIG — иначе свежий файл на диске оказался бы
   * пустым (глобаль ещё не существует при первой загрузке).
   * Обёртка при этом сохраняет защиту: любые отсутствующие или
   * некорректные поля заполняются дефолтами.
   */
  function configCode() {
    const stamp = Date.now();
    const payload = {
      profile: state.profile,
      categories: state.categories,
      items: state.items
    };

    const dataLiteral = JSON.stringify(payload, null, 2)
      // Разбиваем литерал по строкам, чтобы файл оставался читаемым.
      .split('\n').map((line) => '    ' + line).join('\n');

    return {
      stamp: stamp,
      code:
        '/* ============================================================\n' +
        '   XBOX 360 SYSTEM DASHBOARD — КОНФИГУРАЦИЯ ВИШЛИСТА\n' +
        '   ---------------------------------------------------------\n' +
        '   Сгенерировано мастерской NERO: ' + new Date(stamp).toISOString() + '\n' +
        '   Замените этот файл в папке проекта рядом с index.html.\n' +
        '   Файл самодостаточен: данные встроены ниже, а отсутствующие\n' +
        '   поля автоматически заполняются значениями по умолчанию.\n' +
        '   ============================================================ */\n' +
        '(function (global) {\n' +
        '  \'use strict\';\n' +
        '  var DEFAULTS = {\n' +
        '    profile: {\n' +
        '      callsign: \'DANTE // 2003\',\n' +
        '      statusMessage: \'STATUS: MOST WANTED #1 // CHIPPED XBOX FAT\',\n' +
        '      currency: \'₽\',\n' +
        '      vibeNote: \'\'\n' +
        '    },\n' +
        '    categories: [\'ВСЕ ДИСКИ\'],\n' +
        '    items: []\n' +
        '  };\n' +
        '\n' +
        '  /* ---- ДАННЫЕ ВИШЛИСТА ---- */\n' +
        '  var DATA = ' + dataLiteral + ';\n' +
        '\n' +
        '  var profile = (DATA.profile && typeof DATA.profile === \'object\') ? DATA.profile : {};\n' +
        '  var categories = (Array.isArray(DATA.categories) && DATA.categories.length)\n' +
        '    ? DATA.categories.slice() : DEFAULTS.categories.slice();\n' +
        '  var rawItems = Array.isArray(DATA.items) ? DATA.items : [];\n' +
        '\n' +
        '  global.WISHLIST_CONFIG = {\n' +
        '    profile: {\n' +
        '      callsign: String(profile.callsign || DEFAULTS.profile.callsign),\n' +
        '      statusMessage: String(profile.statusMessage || DEFAULTS.profile.statusMessage),\n' +
        '      currency: String(profile.currency || DEFAULTS.profile.currency),\n' +
        '      vibeNote: String(profile.vibeNote || DEFAULTS.profile.vibeNote),\n' +
        '      gamerscore: Number(profile.gamerscore) || 0\n' +
        '    },\n' +
        '    categories: categories,\n' +
        '    items: rawItems.map(function (src, i) {\n' +
        '      var it = (src && typeof src === \'object\') ? src : {};\n' +
        '      var price = Math.max(0, Number(it.price) || 0);\n' +
        '      return {\n' +
        '        id: String(it.id || \'target-\' + (i + 1)),\n' +
        '        title: String(it.title || \'БЕЗ НАЗВАНИЯ\'),\n' +
        '        category: String(it.category || categories[1] || \'БЕЗ КАТЕГОРИИ\'),\n' +
        '        price: price,\n' +
        '        collected: Math.min(price, Math.max(0, Number(it.collected) || 0)),\n' +
        '        heatLevel: Math.min(5, Math.max(1, Number(it.heatLevel) || 4)),\n' +
        '        status: it.status === \'busted\' ? \'busted\' : \'wanted\',\n' +
        '        photoUrl: String(it.photoUrl || \'\'),\n' +
        '        shopUrl: String(it.shopUrl || \'\'),\n' +
        '        slogan: String(it.slogan || \'\'),\n' +
        '        bountyTag: String(it.bountyTag || \'\')\n' +
        '      };\n' +
        '    })\n' +
        '  };\n' +
        '\n' +
        '  /* Метка времени: витрина сравнивает её с сохранённой в\n' +
        '     LocalStorage правкой из мастерской. */\n' +
        '  global.WISHLIST_CONFIG_META = { generated: ' + stamp + ' };\n' +
        '})(window);\n',
      payload: payload
    };
  }

  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') throw new Error('WISHLIST_CONFIG не найден');
    state.profile = (cfg.profile && typeof cfg.profile === 'object')
      ? Object.assign(
        { callsign: 'DANTE // 2003', statusMessage: '', currency: '₽', vibeNote: '', gamerscore: 0 },
        clone(cfg.profile)
      )
      : { callsign: 'DANTE // 2003', statusMessage: '', currency: '₽', vibeNote: '', gamerscore: 0 };
    state.categories = Array.isArray(cfg.categories) ? cfg.categories.filter(Boolean).slice() : [];
    if (!state.categories.length) state.categories = [DEFAULT_CATEGORY];
    state.items = Array.isArray(cfg.items) ? clone(cfg.items) : [];
    normalizeState();
  }

  /* =========================================================
     СИНХРОНИЗАЦИЯ
     ========================================================= */
  function updateSyncBanner() {
    const banner = $('#syncBanner');
    if (!banner) return;
    const live = readLive();
    const hasLive = !!(live && live.savedAt > fileStamp);
    banner.hidden = !ui.syncEnabled;
    const txt = $('#syncText');
    if (txt) {
      txt.innerHTML = hasLive
        ? 'Редактируется <b>живая правка</b> из браузера — витрина <b>index.html</b> её уже видит. Скачайте <b>config.js</b>, чтобы закрепить правку на диске.'
        : 'Изменения сохраняются в браузере и сразу видны на витрине <b>index.html</b>. Скачайте <b>config.js</b>, чтобы закрепить правку на диске.';
    }
  }

  function readLive() {
    try {
      const raw = global.localStorage.getItem(LIVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && parsed.config ? parsed : null;
    } catch (err) { return null; }
  }

  /* =========================================================
     ОБЩИЙ РЕНДЕР
     ========================================================= */
  function renderAll() {
    normalizeState();
    renderStats();
    renderCategorySelects();
    renderCatList();
    renderItems();
    updateSyncBanner();
  }

  function switchTab(name) {
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    $$('.tab-pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  }

  /* =========================================================
     ИНИЦИАЛИЗАЦИЯ
     ========================================================= */
  function init() {
    loadSyncPref();
    normalizeState();
    renderAll();
    renderProfileForm();
    renderHeat();
    updateCalc();
    updatePreview();
    renderPlaylist();

    /* ---------- Вкладки ---------- */
    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    /* ---------- Форма цели ---------- */
    const form = $('#form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = form.title.value.trim();
        if (!title) {
          toast('Введи название цели');
          form.title.focus();
          return;
        }

        const data = {
          title: title,
          category: String(form.category.value || '').trim(),
          price: Math.max(0, Number(form.price.value) || 0),
          collected: Math.max(0, Number(form.collected.value) || 0),
          heatLevel: ui.heat,
          status: form.status.value === 'busted' ? 'busted' : 'wanted',
          photoUrl: form.photoUrl.value.trim(),
          shopUrl: form.shopUrl.value.trim(),
          slogan: form.slogan.value.trim(),
          bountyTag: form.bountyTag.value.trim()
        };
        data.collected = Math.min(data.price, data.collected);

        if (ui.editingIndex !== null && state.items[ui.editingIndex]) {
          state.items[ui.editingIndex] = Object.assign({}, state.items[ui.editingIndex], data);
          log(data.title + ' // обновлено');
          toast('Цель обновлена');
        } else {
          data.id = 'target-' + Date.now();
          state.items.push(data);
          log(data.title + ' // добавлено');
          toast('Цель добавлена');
        }

        resetForm();
        renderAll();
        markDirty();
      });

      form.addEventListener('input', () => {
        updateCalc();
        updatePreview();
      });
      form.addEventListener('change', () => {
        updateCalc();
        updatePreview();
      });
    }

    const resetBtn = $('#resetForm');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        resetForm();
        toast('Редактирование отменено');
      });
    }

    /* ---------- Новая категория прямо из формы цели ---------- */
    const newCatInput = $('#f-newCategory');
    if (newCatInput) {
      newCatInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const name = newCatInput.value.trim();
        if (!name) return;
        if (state.categories.includes(name)) {
          toast('Такая категория уже есть');
          newCatInput.value = '';
          return;
        }
        state.categories.push(name);
        newCatInput.value = '';
        renderAll();
        const sel = $('#f-category');
        if (sel) sel.value = name;
        markDirty();
        log('Категория добавлена из формы: ' + name);
        toast('Категория «' + name + '» добавлена');
      });
    }

    /* ---------- Профиль ---------- */
    const profileForm = $('#profileForm');
    if (profileForm) {
      profileForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target;
        state.profile = {
          callsign: f.callsign.value.trim() || 'DANTE // 2003',
          statusMessage: f.statusMessage.value.trim(),
          currency: f.currency.value.trim() || '₽',
          vibeNote: f.vibeNote.value.trim(),
          gamerscore: Math.max(0, Number(f.gamerscore.value) || 0)
        };
        renderStats();
        markDirty();
        log('Профиль обновлён');
        toast('Профиль сохранён');
      });
    }

    /* ---------- Категории ---------- */
    const catForm = $('#catForm');
    if (catForm) {
      catForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = e.target.newCategory;
        const name = input.value.trim();
        if (!name) return;
        if (state.categories.includes(name)) {
          toast('Такая категория уже есть');
          return;
        }
        state.categories.push(name);
        input.value = '';
        renderAll();
        markDirty();
        log('Категория добавлена: ' + name);
        toast('Категория добавлена');
      });
    }

    /* ---------- Экспорт ---------- */
    const dl = $('#download');
    if (dl) {
      dl.addEventListener('click', () => {
        const built = configCode();
        downloadText('config.js', built.code, 'text/javascript;charset=utf-8');

        // Метка времени в файле должна совпадать с сохранённой правкой,
        // иначе витрина продолжит читать старую версию с диска.
        try {
          global.localStorage.setItem(LIVE_KEY, JSON.stringify({
            savedAt: built.stamp - 1,
            config: built.payload
          }));
        } catch (err) { /* ignore */ }

        clearTimeout(ui.saveTimer);
        try { global.localStorage.removeItem(DRAFT_KEY); } catch (err) { /* ignore */ }
        ui.dirty = false;
        document.title = 'XBOX 360 // STASH WORKSHOP';
        setStatus('EXPORTED // READY');
        log('config.js экспортирован');
        toast('config.js сохранён');
        updateSyncBanner();
      });
    }

    const copy = $('#copy');
    if (copy) {
      copy.addEventListener('click', async () => {
        const code = configCode().code;
        try {
          await global.navigator.clipboard.writeText(code);
          log('Код config.js скопирован в буфер обмена');
          toast('Код скопирован в буфер');
        } catch (err) {
          // Fallback для file:// и старых браузеров
          const ta = document.createElement('textarea');
          ta.value = code;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          let ok = false;
          try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
          ta.remove();
          if (ok) {
            toast('Код скопирован в буфер');
            log('Код config.js скопирован (fallback execCommand)');
          } else {
            $('#copyFallback').hidden = false;
            toast('Не удалось скопировать — используйте поле ниже');
          }
        }
      });
    }

    const copyFallback = $('#copyFallback');
    if (copyFallback) {
      copyFallback.addEventListener('click', () => {
        const ta = $('#codeOutput');
        ta.hidden = false;
        ta.value = configCode().code;
        ta.select();
        toast('Код готов — скопируйте из поля');
      });
    }

    /* ---------- Плейлист ---------- */
    const dlPlaylist = $('#downloadPlaylist');
    if (dlPlaylist) {
      dlPlaylist.addEventListener('click', () => {
        downloadText('playlist.js', playlistCode(), 'text/javascript;charset=utf-8');
        log('playlist.js экспортирован');
        toast('playlist.js сохранён');
      });
    }

    const copyPlaylist = $('#copyPlaylist');
    if (copyPlaylist) {
      copyPlaylist.addEventListener('click', async () => {
        const code = playlistCode();
        try {
          await global.navigator.clipboard.writeText(code);
          toast('Плейлист скопирован');
        } catch (err) {
          const ta = document.createElement('textarea');
          ta.value = code;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); } catch (e) { /* ignore */ }
          ta.remove();
          toast('Плейлист скопирован');
        }
      });
    }

    const scanPlaylist = $('#scanPlaylist');
    if (scanPlaylist) {
      scanPlaylist.addEventListener('click', () => {
        const ta = $('#playlistText');
        const lines = (ta.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
        const seen = new Set();
        const uniq = [];
        let dupes = 0;
        lines.forEach((l) => {
          if (seen.has(l)) { dupes++; return; }
          seen.add(l);
          uniq.push(l);
        });
        ta.value = uniq.join('\n');
        toast(dupes ? 'Удалено дубликатов: ' + dupes : 'Дубликатов нет');
        log('Плейлист проверен: ' + uniq.length + ' уникальных треков');
      });
    }

    /* ---------- Импорт ---------- */
    const importBtn = $('#importBtn');
    if (importBtn) importBtn.addEventListener('click', () => $('#fileInput').click());

    const fileInput = $('#fileInput');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            // config.js — это JS с комментариями, поэтому выполняем его
            // в песочнице, а не парсим как JSON.
            const sandbox = {};
            new Function('window', String(reader.result))(sandbox);
            applyConfig(sandbox.WISHLIST_CONFIG);
            resetForm();
            renderAll();
            renderProfileForm();
            markDirty();
            log('config.js импортирован');
            toast('Конфиг импортирован');
          } catch (err) {
            alert('Не удалось прочитать config.js: ' + err.message);
          }
          e.target.value = '';
        };
        reader.readAsText(file);
      });
    }

    /* ---------- Импорт из JSON-поля ---------- */
    const jsonImport = $('#jsonImport');
    if (jsonImport) {
      jsonImport.addEventListener('click', () => {
        const raw = ($('#jsonInput').value || '').trim();
        if (!raw) {
          toast('Вставьте JSON в поле');
          return;
        }
        try {
          const parsed = JSON.parse(raw);
          const cfg = parsed && parsed.WISHLIST_CONFIG ? parsed.WISHLIST_CONFIG : parsed;
          applyConfig(cfg);
          resetForm();
          renderAll();
          renderProfileForm();
          markDirty();
          log('Конфиг импортирован из JSON');
          toast('JSON импортирован');
        } catch (err) {
          alert('Некорректный JSON: ' + err.message);
        }
      });
    }

    /* ---------- Переключатель синхронизации ---------- */
    const syncToggle = $('#syncToggle');
    if (syncToggle) {
      syncToggle.checked = ui.syncEnabled;
      syncToggle.addEventListener('change', () => {
        ui.syncEnabled = syncToggle.checked;
        try { global.localStorage.setItem(SYNC_KEY, ui.syncEnabled ? '1' : '0'); } catch (err) { /* ignore */ }
        if (ui.syncEnabled) {
          publishLive();
          toast('Синхронизация с витриной включена');
          log('Синхронизация с витриной: ВКЛ');
        } else {
          clearLive();
          toast('Синхронизация с витриной выключена');
          log('Синхронизация с витриной: ВЫКЛ');
        }
        updateSyncBanner();
      });
    }

    /* ---------- Фильтры и журнал ---------- */
    const search = $('#search');
    if (search) search.addEventListener('input', renderItems);
    const filter = $('#filterStatus');
    if (filter) filter.addEventListener('change', renderItems);

    const clearLog = $('#clearLog');
    if (clearLog) {
      clearLog.addEventListener('click', () => {
        const el = logEl();
        if (el) el.textContent = 'SYSTEM LOG CLEARED.';
      });
    }

    /* ---------- Черновик ---------- */
    initDraft();

    /* ---------- Клавиатура ---------- */
    global.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dl) dl.click();
      }
    });

    log('Система готова. Загружено целей: ' + state.items.length + '.');
    updateSyncBanner();
  }

  /* =========================================================
     ВОССТАНОВЛЕНИЕ ЧЕРНОВИКА
     ========================================================= */
  function initDraft() {
    let raw = null;
    try { raw = global.localStorage.getItem(DRAFT_KEY); } catch (err) { return; }
    if (!raw) return;

    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (err) { return; }
    if (!parsed || !parsed.state) return;

    const current = JSON.stringify({ profile: state.profile, categories: state.categories, items: state.items });
    if (JSON.stringify(parsed.state) === current) {
      try { global.localStorage.removeItem(DRAFT_KEY); } catch (err) { /* ignore */ }
      return;
    }

    ui.pendingDraft = parsed;
    const time = parsed.savedAt ? new Date(parsed.savedAt).toLocaleString('ru-RU') : 'неизвестно';
    const el = $('#draftTime');
    if (el) el.textContent = time;
    const banner = $('#draftBanner');
    if (banner) banner.hidden = false;
    setStatus('DRAFT FOUND // RESTORE?');
  }

  function bindDraftButtons() {
    const restore = $('#restoreDraft');
    if (restore) {
      restore.addEventListener('click', () => {
        if (!ui.pendingDraft) return;
        const draft = ui.pendingDraft.state;
        state.profile = clone(draft.profile || {});
        state.categories = Array.isArray(draft.categories) ? draft.categories.slice() : [DEFAULT_CATEGORY];
        state.items = Array.isArray(draft.items) ? clone(draft.items) : [];
        normalizeState();

        ui.pendingDraft = null;
        const banner = $('#draftBanner');
        if (banner) banner.hidden = true;
        resetForm();
        renderAll();
        renderProfileForm();
        markDirty();
        log('Черновик восстановлен');
        toast('Черновик восстановлен');
      });
    }

    const discard = $('#discardDraft');
    if (discard) {
      discard.addEventListener('click', () => {
        ui.pendingDraft = null;
        try { global.localStorage.removeItem(DRAFT_KEY); } catch (err) { /* ignore */ }
        const banner = $('#draftBanner');
        if (banner) banner.hidden = true;
        setStatus('READY // SLOT 01');
        log('Черновик удалён');
      });
    }
  }

  /* =========================================================
     СТАРТ
     ========================================================= */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindDraftButtons();
      init();
    });
  } else {
    bindDraftButtons();
    init();
  }

  global.NERO = {
    state: state,
    save: function () { saveDraft(); publishLive(); },
    toast: toast,
    log: log
  };
})(window);
