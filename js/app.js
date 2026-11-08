/* ============================================================
   XBOX 360 SYSTEM DASHBOARD · APP
   ---------------------------------------------------------
   Точка входа: boot-последовательность, темы, лента лезвий,
   Guide Blade / Media Blade (в т.ч. bottom-sheet на смартфонах),
   тосты ачивок, адаптивный блик (мышь + гироскоп).
   ============================================================ */
(function (global) {
  'use strict';

  const X360 = global.X360 || (global.X360 = {});
  const utils = X360.utils;
  const Audio = X360.Audio;
  const Player = X360.Player;
  const Carousel = X360.Carousel;
  const Gamepad = X360.Gamepad;
  const Boot = X360.Boot;

  const THEMES = ['theme-fat', 'theme-elite', 'theme-gears', 'theme-halo'];
  const THEME_LABELS = {
    'theme-fat': 'XBOX 360 FAT // 2005',
    'theme-elite': 'XBOX 360 ELITE // 2007',
    'theme-gears': 'GEARS OF WAR LIMITED EDITION',
    'theme-halo': 'HALO 3 SPARTAN EDITION'
  };

  const BOOT_LOG = [
    'MEMORY CHECK ... OK',
    'HDD DETECTED ... 20 GB',
    'MOUNTING WISHLIST VAULT ...',
    'LOADING BLADES ... OK',
    'SYSTEM READY // PRESS START'
  ];

  const app = {
    boot: {
      phase: 'idle',        // idle → launching → sphere → done
      shocks: [],
      stopped: false,
      progressTimer: null,
      autoTimer: null,
      progress: 0
    },
    blades: {
      pointerDown: false,
      dragged: false,
      startX: 0,
      startScroll: 0
    },
    sheet: {
      dragId: null,
      startY: 0,
      offset: 0,
      panel: null,
      moved: false
    },
    guideOpen: false,
    mediaOpen: false,
    themeToastTimer: null,
    achievementTimer: null,
    gyroGranted: false,
    pointerRaf: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  /* =========================================================
     ТЕМЫ
     ========================================================= */
  function applyCrtPref() {
    const enabled = X360.prefs.crt !== false;
    document.body.classList.toggle('crt-on', enabled);
    const btn = el('crtToggleBtn');
    if (btn) btn.textContent = enabled ? 'CRT: ВКЛ' : 'CRT: ВЫКЛ';
  }

  function applyTheme(theme) {
    const next = THEMES.indexOf(theme) >= 0 ? theme : 'theme-fat';
    document.body.classList.remove.apply(document.body.classList, THEMES);
    document.body.classList.add(next);
    applyCrtPref();
    X360.prefs.theme = next;
    X360.state.theme = next;
    const select = el('themeSelect');
    if (select) select.value = next;
    return next;
  }

  function showThemeToast(theme) {
    const toast = el('themeToast');
    if (!toast) return;
    toast.textContent = 'КОРПУС: ' + (THEME_LABELS[theme] || theme);
    toast.classList.add('show');
    clearTimeout(app.themeToastTimer);
    app.themeToastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function cycleTheme() {
    const idx = THEMES.indexOf(X360.prefs.theme);
    const next = THEMES[(idx + 1) % THEMES.length];
    applyTheme(next);
    X360.savePrefs();
    Audio.playBladeSwoosh();
    showThemeToast(next);
  }

  /* =========================================================
     ПРОФИЛЬ ИГРОКА
     ========================================================= */
  function renderGamerProfile() {
    const p = X360.config.profile || {};
    const callsign = String(p.callsign || 'DANTE // 2003');
    const tagEl = el('gamertagText');

    if (tagEl) {
      tagEl.textContent = callsign;
      tagEl.title = p.vibeNote || '';
    }
    const initial = el('avatarInitial');
    if (initial) initial.textContent = callsign.trim().charAt(0).toUpperCase() || 'D';
    const status = el('statusMessageText');
    if (status) status.textContent = p.statusMessage || '// WISHLIST VAULT';

    const items = X360.config.items || [];
    const totalGoal = items.reduce((a, b) => a + (Number(b.price) || 0), 0);
    const totalSaved = items.reduce((a, b) => a + (Number(b.collected) || 0), 0);
    const unlockedCount = items.filter((x) => x.status === 'busted').length;
    const progressPct = totalGoal ? Math.round((totalSaved / totalGoal) * 100) : 0;
    const clampedPct = utils.clamp(progressPct, 0, 100);

    const goal = el('totalGoalVal');
    if (goal) goal.textContent = utils.formatMoney(totalGoal);
    const saved = el('totalSavedVal');
    if (saved) saved.textContent = utils.formatMoney(totalSaved);
    const score = el('totalGamerscoreVal');
    if (score) score.textContent = unlockedCount * 1000 + ' G';
    const headerPct = el('headerProgressText');
    if (headerPct) headerPct.textContent = clampedPct + '% COLLECTED';
    const headerFill = el('headerProgressFill');
    if (headerFill) headerFill.style.setProperty('--p', (clampedPct / 100).toFixed(4));
  }

  /* =========================================================
     ЛЕНТА ЛЕЗВИЙ (BLADES RIBBON)
     ========================================================= */
  function getFilteredItems() {
    const cats = X360.getCategories();
    const showAll = X360.state.activeCategory === X360.ALL_CATEGORY || !cats.includes(X360.state.activeCategory);
    return (X360.config.items || []).filter((item) => showAll || item.category === X360.state.activeCategory);
  }

  function renderBlades(direction) {
    const box = el('bladesContainer');
    if (!box) return;
    const cats = X360.getCategories();

    if (!cats.includes(X360.state.activeCategory)) {
      X360.state.activeCategory = X360.ALL_CATEGORY;
    }

    box.innerHTML = '';

    cats.forEach((cat, idx) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      const isActive = cat === X360.state.activeCategory;
      tab.className = 'blade-tab' + (isActive ? ' active' : '');
      tab.dataset.category = cat;
      tab.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      tab.textContent = cat;
      // Акриловая глянцевая шапка активного лезвия (Blades Gloss).
      if (isActive) {
        const gloss = document.createElement('span');
        gloss.className = 'blade-gloss';
        gloss.setAttribute('aria-hidden', 'true');
        tab.appendChild(gloss);
      }
      tab.addEventListener('click', () => {
        if (X360.state.activeCategory === cat) return;
        selectCategory(cat, 1);
      });
      box.appendChild(tab);
    });

    // Анимация «глубины» при смене лезвия.
    if (direction) {
      box.classList.remove('is-swapping');
      box.style.setProperty('--swap-from', direction > 0 ? '-18px' : '18px');
      void box.offsetWidth;
      box.classList.add('is-swapping');
      setTimeout(() => box.classList.remove('is-swapping'), 460);

      const activeTab = box.querySelector('.blade-tab.active');
      if (activeTab) {
        activeTab.classList.add('just-activated');
        setTimeout(() => activeTab.classList.remove('just-activated'), 520);
      }
    }

    requestAnimationFrame(() => {
      updateBladeOverflow();
      scrollActiveBlade();
    });
  }

  function selectCategory(cat, direction) {
    X360.state.activeCategory = cat;
    X360.state.activeIndex = 0;
    X360.state.isFlipped = false;
    closeGuide();
    Audio.playBladeSwoosh();
    renderBlades(direction);
    Carousel.setItems(getFilteredItems());
  }

  function switchCategoryBy(delta) {
    const cats = X360.getCategories();
    if (!cats.length) return;
    let idx = cats.indexOf(X360.state.activeCategory);
    if (idx < 0) idx = 0;
    idx = (idx + delta + cats.length) % cats.length;
    selectCategory(cats[idx], delta);
  }

  function updateBladeOverflow() {
    const box = el('bladesContainer');
    const wrap = el('bladesRibbonWrap');
    if (!box || !wrap) return;
    const overflow = box.scrollWidth > box.clientWidth + 6;
    box.classList.toggle('has-overflow', overflow);
    wrap.classList.toggle('no-overflow', !overflow);
  }

  function scrollActiveBlade() {
    const box = el('bladesContainer');
    if (!box || !box.classList.contains('has-overflow')) return;
    const activeTab = box.querySelector('.blade-tab.active');
    if (!activeTab) return;

    // Скроллим вручную, а не через scrollIntoView: тот уводит ленту
    // за пределы контейнера (отрицательный scrollLeft) и вкладки
    // вылетают влево под кнопку LB.
    const target = activeTab.offsetLeft - (box.clientWidth - activeTab.offsetWidth) / 2;
    const max = Math.max(0, box.scrollWidth - box.clientWidth);
    const clamped = utils.clamp(target, 0, max);

    try {
      box.scrollTo({ left: clamped, behavior: 'smooth' });
    } catch (err) {
      box.scrollLeft = clamped;
    }

    // Страховка: после smooth-скролла браузер иногда оставляет
    // отрицательное смещение — гасим его.
    setTimeout(() => {
      if (box.scrollLeft < 0) box.scrollLeft = 0;
    }, 420);
  }

  function initBladeDrag() {
    const box = el('bladesContainer');
    if (!box) return;

    // Колесо мыши над лентой = горизонтальный скролл.
    box.addEventListener('wheel', (e) => {
      const canScroll = box.scrollWidth > box.clientWidth + 6;
      if (!canScroll) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!delta) return;
      box.scrollLeft += delta;
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });

    box.addEventListener('pointerdown', (e) => {
      if (typeof e.button === 'number' && e.button !== 0) return;
      app.blades.pointerDown = true;
      app.blades.dragged = false;
      app.blades.startX = e.clientX;
      app.blades.startScroll = box.scrollLeft;
    });

    box.addEventListener('pointermove', (e) => {
      if (!app.blades.pointerDown) return;
      const dx = e.clientX - app.blades.startX;
      if (!app.blades.dragged && Math.abs(dx) > 6) {
        app.blades.dragged = true;
        box.classList.add('dragging');
        try { box.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      }
      if (app.blades.dragged) {
        box.scrollLeft = app.blades.startScroll - dx;
        e.preventDefault();
      }
    });

    const endDrag = (e) => {
      if (!app.blades.pointerDown) return;
      app.blades.pointerDown = false;
      box.classList.remove('dragging');
      if (app.blades.dragged) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => { app.blades.dragged = false; }, 60);
      }
    };
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);
    box.addEventListener('click', (e) => {
      if (!app.blades.dragged) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    box.addEventListener('dragstart', (e) => e.preventDefault());

    global.addEventListener('resize', updateBladeOverflow);
    if (global.ResizeObserver) {
      try { new ResizeObserver(updateBladeOverflow).observe(box); } catch (err) { /* ignore */ }
    }
  }

  /* =========================================================
     GUIDE BLADE (ДОСЬЕ) / MEDIA BLADE (ПЛЕЕР)
     ========================================================= */

  function openGuide(item) {
    if (!item) return;
    const tag = el('guideTag');
    if (tag) tag.textContent = `${item.category || 'БЕЗ КАТЕГОРИИ'} // ${item.bountyTag || 'TARGET'}`;
    const title = el('guideTitle');
    if (title) title.textContent = item.title || 'БЕЗ НАЗВАНИЯ';
    const quote = el('guideQuote');
    if (quote) quote.textContent = `«${item.slogan || 'Кусок бунта в личную коллекцию.'}»`;

    const price = Math.max(1, Number(item.price) || 1);
    const saved = Math.min(price, Math.max(0, Number(item.collected) || 0));
    const pct = item.status === 'busted' ? 100 : Math.round((saved / price) * 100);
    const remain = Math.max(0, price - saved);

    const pctText = el('guidePercentText');
    if (pctText) pctText.textContent = pct + '%';
    const fill = el('guideFillBar');
    if (fill) fill.style.setProperty('--p', (pct / 100).toFixed(4));
    const savedText = el('guideSavedText');
    if (savedText) savedText.textContent = 'Отложено: ' + utils.formatMoney(saved);
    const priceText = el('guidePriceText');
    if (priceText) priceText.textContent = utils.formatMoney(price);
    const remainText = el('guideRemainText');
    if (remainText) {
      remainText.textContent = item.status === 'busted'
        ? 'Цель закрыта — трофей в коллекции'
        : 'Осталось: ' + utils.formatMoney(remain);
    }
    const statusText = el('guideStatusText');
    if (statusText) {
      statusText.textContent = item.status === 'busted' ? 'ACQUIRED // 1000G' : 'WANTED';
    }

    const storeLink = el('guideStoreLink');
    if (storeLink) {
      const storeUrl = utils.safeLinkUrl(item.shopUrl);
      storeLink.href = storeUrl || '#';
      storeLink.classList.toggle('is-disabled', !storeUrl);
      storeLink.setAttribute('aria-disabled', storeUrl ? 'false' : 'true');
    }

    setPanelOpen('guide', true);

    if (item.status === 'busted') {
      triggerAchievement(item.title || 'ТРОФЕЙ');
    } else {
      Audio.playBladeSwoosh();
    }
  }

  function closeGuide() {
    setPanelOpen('guide', false);
  }

  function toggleMedia() {
    const willOpen = !app.mediaOpen;
    setPanelOpen('media', willOpen);
    Audio.playBladeSwoosh();
  }

  /**
   * Единая система открытия/закрытия панелей.
   * Класс `open` на панели + зеркальный класс на body (для карусели и CSS).
   * Одновременно открыта может быть только одна панель.
   */
  function setPanelOpen(which, open) {
    const isGuide = which === 'guide';
    const panel = el(isGuide ? 'guideBlade' : 'mediaBlade');
    if (!panel) return;

    if (open) {
      // Закрываем «соседнюю» панель, чтобы лезвия не перекрывали друг друга.
      const other = el(isGuide ? 'mediaBlade' : 'guideBlade');
      if (other) {
        other.classList.remove('open');
        other.setAttribute('aria-hidden', 'true');
        other.style.setProperty('--sheet-y', '0px');
      }
      document.body.classList.remove(isGuide ? 'media-open' : 'guide-open');

      panel.classList.add('open');
      panel.setAttribute('aria-hidden', 'false');
      panel.style.setProperty('--sheet-y', '0px');
      document.body.classList.add(isGuide ? 'guide-open' : 'media-open');
    } else {
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      panel.style.setProperty('--sheet-y', '0px');
      document.body.classList.remove(isGuide ? 'guide-open' : 'media-open');
    }

    if (isGuide) app.guideOpen = open;
    else app.mediaOpen = open;

    updateBackdrop();

    /* PERF: визуализатор спектра живёт только пока шторка открыта.
       Раньше rAF-цикл крутился постоянно и съедал батарею на телефоне. */
    if (Player && Player.setVisualizerActive) {
      Player.setVisualizerActive(isGuide ? false : open);
    }
  }

  function updateBackdrop() {
    const backdrop = el('sheetBackdrop');
    if (!backdrop) return;
    const anyOpen = app.guideOpen || app.mediaOpen;
    backdrop.classList.toggle('show', anyOpen);
  }

  function closeAnyPanel() {
    if (app.guideOpen) {
      setPanelOpen('guide', false);
      Audio.playBladeSwoosh();
      return true;
    }
    if (app.mediaOpen) {
      setPanelOpen('media', false);
      Audio.playBladeSwoosh();
      return true;
    }
    return false;
  }

  /**
   * Закрывает все открытые панели разом.
   * Используется кликом по оверлею, клавишей Escape и кнопкой B.
   */
  function closeAllBlades() {
    const wasOpen = app.guideOpen || app.mediaOpen;
    if (app.guideOpen) setPanelOpen('guide', false);
    if (app.mediaOpen) setPanelOpen('media', false);
    if (wasOpen) {
      Audio.playBladeSwoosh();
      // Возвращаем фокус карусели — управление не теряется.
      const stage = el('carouselStage');
      if (stage) {
        stage.classList.add('is-interactive');
        setTimeout(() => stage.classList.remove('is-interactive'), 260);
      }
    }
    return wasOpen;
  }

  /* ---------------------------------------------------------
     BOTTOM SHEET — свайп вниз для закрытия (мобильные)
     --------------------------------------------------------- */
  function initSheetDrag() {
    const panels = [el('guideBlade'), el('mediaBlade')].filter(Boolean);

    panels.forEach((panel) => {
      const handle = panel.querySelector('.blade-sheet-handle');
      if (!handle) return;

      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        app.sheet.dragId = e.pointerId;
        app.sheet.startY = e.clientY;
        app.sheet.offset = 0;
        app.sheet.panel = panel;
        app.sheet.moved = false;
        panel.classList.add('is-dragging');
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });

      handle.addEventListener('pointermove', (e) => {
        if (app.sheet.dragId !== e.pointerId || !app.sheet.panel) return;
        const dy = e.clientY - app.sheet.startY;
        if (dy > 0) {
          app.sheet.offset = dy;
          app.sheet.moved = true;
          panel.style.setProperty('--sheet-y', dy + 'px');
          e.preventDefault();
        }
      });

      const endSheet = (e) => {
        if (app.sheet.dragId !== e.pointerId) return;
        app.sheet.dragId = null;
        panel.classList.remove('is-dragging');

        const height = panel.getBoundingClientRect().height || 1;
        const threshold = Math.max(70, height * 0.28);

        if (app.sheet.offset > threshold) {
          const isGuide = panel.id === 'guideBlade';
          setPanelOpen(isGuide ? 'guide' : 'media', false);
        } else {
          panel.style.setProperty('--sheet-y', '0px');
        }
        app.sheet.offset = 0;
        app.sheet.panel = null;
      };

      handle.addEventListener('pointerup', endSheet);
      handle.addEventListener('pointercancel', endSheet);
    });

    // Клик по фону закрывает панель.
    const backdrop = el('sheetBackdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeAllBlades();
      });
    }
  }

  /* =========================================================
     ТОСТ АЧИВКИ
     ========================================================= */
  function triggerAchievement(title) {
    Audio.playAchievement();
    const toast = el('achievementToast');
    const titleEl = el('achieveTitle');
    if (titleEl) titleEl.textContent = '1000G — ' + title;
    if (!toast) return;
    toast.classList.add('show');
    clearTimeout(app.achievementTimer);
    app.achievementTimer = setTimeout(() => toast.classList.remove('show'), 3800);
  }

  /* =========================================================
     БЛИК И ПАРАЛЛАКС (мышь + гироскоп)
     ========================================================= */
  function initPointerEffects() {
    const dashboard = el('dashboard');
    if (!dashboard) return;

    const spotlight = el('bgSpotlight');

    dashboard.addEventListener('pointermove', (e) => {
      if (app.pointerRaf) return;
      app.pointerRaf = requestAnimationFrame(() => {
        app.pointerRaf = null;
        const rect = dashboard.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        /* PERF: прожектор двигается ТРАНСФОРМОМ маленького блока,
           а не перерисовкой полноэкранного радиального градиента.
           Раньше каждый pointermove пересобирал background-position
           у слоя на весь экран — это главный источник микрофризов. */
        if (spotlight) {
          const dx = ((x - 50) / 100) * rect.width;
          const dy = ((y - 40) / 100) * rect.height;
          spotlight.style.transform = 'translate3d(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px, 0)';
        }

        // Голографический sheen + parallax только у активной коробки.
        const activeCase = dashboard.querySelector('.xbox-case-anchor.is-active');
        if (!activeCase) return;
        const ar = activeCase.getBoundingClientRect();
        if (!ar.width || !ar.height) return;
        const nx = (e.clientX - ar.left) / ar.width;
        const ny = (e.clientY - ar.top) / ar.height;
        applySheen(activeCase, nx, ny);
      });
    }, { passive: true });

    dashboard.addEventListener('pointerleave', () => {
      const anchors = carouselAnchors();
      anchors.forEach((anchor) => {
        anchor.style.setProperty('--tilt-x', '0px');
        anchor.style.setProperty('--tilt-y', '0px');
        anchor.style.setProperty('--hang', '0');
      });
    });
  }

  /** Кеш последних значений — не пишем в DOM, если ничего не изменилось. */
  const sheenCache = new WeakMap();

  /** Прописывает CSS-переменные блика на карточку. */
  function applySheen(anchor, nx, ny) {
    const hx = utils.clamp(nx, -0.4, 1.4) * 100;
    const hy = utils.clamp(ny, -0.4, 1.4) * 100;
    const gx = utils.clamp(nx, 0, 1) * 100;
    const gy = utils.clamp(ny, 0, 1) * 100;
    const hang = (nx - 0.5) * 54;
    const tx = (nx - 0.5) * 12;
    const ty = (ny - 0.5) * 9;

    /* PERF: 7 custom-property на каждый pointermove = 7 style-recalc
       поддерева карточки. Пишем только реально изменившиеся значения
       (округление до 0.1%) — обычно это 1–2 записи за кадр. */
    let prev = sheenCache.get(anchor);
    if (!prev) {
      prev = { hx: -1, hy: -1, gx: -1, gy: -1, hang: -1, tx: -1, ty: -1 };
      sheenCache.set(anchor, prev);
    }

    if (Math.abs(hx - prev.hx) > 0.1) {
      anchor.style.setProperty('--hx', hx.toFixed(1) + '%');
      prev.hx = hx;
    }
    if (Math.abs(hy - prev.hy) > 0.1) {
      anchor.style.setProperty('--hy', hy.toFixed(1) + '%');
      prev.hy = hy;
    }
    if (Math.abs(gx - prev.gx) > 0.1) {
      anchor.style.setProperty('--gx', gx.toFixed(1) + '%');
      prev.gx = gx;
    }
    if (Math.abs(gy - prev.gy) > 0.1) {
      anchor.style.setProperty('--gy', gy.toFixed(1) + '%');
      prev.gy = gy;
    }
    if (Math.abs(hang - prev.hang) > 0.1) {
      anchor.style.setProperty('--hang', hang.toFixed(1));
      prev.hang = hang;
    }
    if (Math.abs(tx - prev.tx) > 0.05) {
      anchor.style.setProperty('--tilt-x', tx.toFixed(2) + 'px');
      prev.tx = tx;
    }
    if (Math.abs(ty - prev.ty) > 0.05) {
      anchor.style.setProperty('--tilt-y', ty.toFixed(2) + 'px');
      prev.ty = ty;
    }
  }

  /** Список карточек карусели (через публичный API Carousel). */
  function carouselAnchors() {
    const stage = el('carouselStage');
    if (!stage) return [];
    return Array.prototype.slice.call(stage.querySelectorAll('.xbox-case-anchor'));
  }

  /** Гироскоп смартфона — наклон двигает блик. */
  function initGyro() {
    if (!('DeviceOrientationEvent' in global)) return;

    const handle = (e) => {
      if (e.beta == null && e.gamma == null) return;
      const beta = Number(e.beta) || 0;   // наклон вперёд-назад
      const gamma = Number(e.gamma) || 0; // наклон влево-вправо
      const activeCase = document.querySelector('.xbox-case-anchor.is-active');
      if (!activeCase) return;
      // -45..45 градусов → 0..1
      const nx = utils.clamp((gamma + 45) / 90, 0, 1);
      const ny = utils.clamp((beta + 45) / 90, 0, 1);
      applySheen(activeCase, nx, ny);
    };

    global.addEventListener('deviceorientation', handle, { passive: true });

    // iOS требует явного разрешения.
    const requestPermission = () => {
      const D = global.DeviceOrientationEvent;
      if (!D || typeof D.requestPermission !== 'function') return;
      D.requestPermission().then((state) => {
        app.gyroGranted = state === 'granted';
      }).catch(() => { /* ignore */ });
    };
    global.addEventListener('click', requestPermission, { once: true });
    global.addEventListener('touchstart', requestPermission, { once: true });
  }

  /* =========================================================
     BOOT SEQUENCE — Nexus Orb 2005
     ========================================================= */
  /* ---------------------------------------------------------
     BOOT — Kinect 2010: ленты → спираль → сфера Nexus → старт
     ---------------------------------------------------------
     Фазы:
       idle      — ленты свободно парят, ждём жеста (или автозапуск)
       launching — ленты ускоряются и закручиваются в спираль
       sphere    — сфера собрана, вспышка, показан логотип и призыв
       done      — дашборд открыт
     --------------------------------------------------------- */
  function initBootRibbons() {
    const canvas = el('bootCanvas');
    if (!canvas || !Boot) return;

    Boot.init(canvas, {
      onCollapsed: () => {
        // Ленты схлопнулись в сферу Nexus — Bloom Shockwave + саб-бас.
        const screen = el('bootScreen');
        if (screen) screen.classList.add('boot-bloom');
        try { Audio.playStartup(); } catch (e) { /* ignore */ }
        app.boot.phase = 'sphere';
        // Показываем логотип и призыв — гость жмёт ещё раз.
        setTimeout(() => {
          const s = el('bootScreen');
          if (s) s.classList.add('boot-sphere');
          const status = el('bootStatusText');
          if (status) status.textContent = BOOT_LOG[BOOT_LOG.length - 1];
        }, 520);
      }
    });

    // Canvas активен — CSS-запасная сфера не нужна.
    const screen0 = el('bootScreen');
    if (screen0) screen0.classList.add('boot-canvas-ready');

    Boot.start();

    // Автозапуск: если гость не тронет экран, интро играет само.
    clearTimeout(app.boot.autoTimer);
    app.boot.autoTimer = setTimeout(() => {
      if (app.boot.phase === 'idle') triggerBoot();
    }, 2400);
  }

  function resizeBootCanvas() {
    if (Boot) Boot.resize();
  }

  function startBootLoop() {
    if (Boot) Boot.start();
  }

  function startBootProgress() {
    clearInterval(app.boot.progressTimer);
    app.boot.progress = 0;
    const fill = el('bootProgressFill');
    const pct = el('bootProgressPct');
    const status = el('bootStatusText');
    const screen = el('bootScreen');

    if (fill) fill.style.setProperty('--p', '0');
    if (pct) pct.textContent = '0%';
    if (status) status.textContent = BOOT_LOG[0];
    if (screen) screen.classList.remove('ready');

    app.boot.progressTimer = setInterval(() => {
      app.boot.progress = Math.min(100, app.boot.progress + 2 + Math.random() * 8);
      const rounded = Math.round(app.boot.progress);
      if (fill) fill.style.setProperty('--p', (app.boot.progress / 100).toFixed(4));
      if (pct) pct.textContent = rounded + '%';
      const lineIndex = Math.min(BOOT_LOG.length - 1, Math.floor((app.boot.progress / 100) * BOOT_LOG.length));
      if (status) status.textContent = BOOT_LOG[lineIndex];

      if (app.boot.progress >= 100) {
        clearInterval(app.boot.progressTimer);
        if (status) status.textContent = BOOT_LOG[BOOT_LOG.length - 1];
        if (screen) screen.classList.add('ready');
      }
    }, 95);
  }

  /**
   * Единая точка переворота активной коробки.
   * Используется кнопкой Y на карточке, клавишей Y/F, кнопкой Y геймпада
   * и нижней подсказкой — поведение у всех одинаковое и надёжное.
   */
  function flipActiveCase(force) {
    if (!Carousel.getItems().length) return;
    Carousel.toggleFlip(force);
    Audio.playPlasticClick();
  }

  /**
   * Переход в дашборд: гасим заставку, запускаем звук и музыку.
   * Вынесено отдельно, чтобы вызываться и из onCollapsed лент,
   * и из таймера запуска (fallback).
   */
  function revealDashboard() {
    const screen = el('bootScreen');
    const db = el('dashboard');
    if (screen) screen.classList.add('boot-done');
    if (db) db.classList.add('active');
    document.body.classList.add('dashboard-active');
    X360.state.booted = true;

    // Останавливаем рендер лент — освобождаем CPU для карусели.
    if (Boot) Boot.stop();

    // Гасим заставку полностью: после перехода в дашборд она не должна
    // перехватывать ни одного клика.
    setTimeout(() => {
      if (screen) screen.style.display = 'none';
    }, 800);

    try { Audio.playBladeSwoosh(); } catch (e) { /* ignore */ }

    /* PERF/AUTOPOLICY: музыку здесь НЕ запускаем.
       До первого жеста браузер всё равно заблокирует play(), а файл
       при этом успевает скачаться впустую. Старт происходит в
       Audio.onReady() — строго после жеста гостя. */
  }

  /**
   * Обработка жеста на заставке.
   *
   * Первое касание (или автозапуск) — ленты ускоряются и закручиваются
   * в спираль, собирается сфера Nexus с буквой «X».
   * Второе касание — вспышка и мгновенный вход в дашборд.
   */
  function triggerBoot() {
    const phase = app.boot.phase;

    // Фаза «сфера собрана» — гость подтверждает старт.
    if (phase === 'sphere' || phase === 'launching') {
      if (phase === 'launching') return;   // ждём сборки сферы
      app.boot.phase = 'done';
      clearTimeout(app.boot.autoTimer);
      revealDashboard();
      return;
    }

    if (phase === 'done') return;

    // Фаза «покой» — запускаем сборку сферы.
    app.boot.phase = 'launching';
    clearTimeout(app.boot.autoTimer);
    clearInterval(app.boot.progressTimer);

    // Звук запускаем только после жеста — контекст уже разблокирован.
    try { Audio.startFanHum(); } catch (e) { /* ignore */ }

    // Ленты: ускорение -> гиперпространственная спираль -> сфера.
    if (Boot) Boot.launch();

    const screen = el('bootScreen');
    if (screen) {
      screen.classList.add('boot-launch');
      screen.classList.remove('boot-sphere');
    }

    // Fallback: если рендер лент недоступен — всё равно открываем дашборд.
    setTimeout(() => {
      if (!X360.state.booted && app.boot.phase === 'launching') {
        app.boot.phase = 'done';
        revealDashboard();
      }
    }, 2600);
  }

  /**
   * Перезапуск заставки (кнопка «⟲ ЗАСТАВКА»).
   *
   * Раньше здесь стоял guard `phase === 'done' → return`, из-за чего
   * кнопка была полностью «мёртвой»: после прохождения интро фаза
   * всегда равна 'done'. Прерываем только сборку сферы.
   */
  function replayBoot() {
    if (app.boot.phase === 'launching') return;

    app.boot.phase = 'idle';
    app.boot.stopped = false;
    X360.state.booted = false;
    clearInterval(app.boot.progressTimer);
    clearTimeout(app.boot.autoTimer);

    Player.stop();
    Player.pause(false);

    const screen = el('bootScreen');
    const dashboard = el('dashboard');
    if (screen) {
      screen.classList.remove('boot-done', 'ready', 'boot-live', 'boot-launch', 'boot-bloom', 'boot-sphere');
      screen.style.display = '';
    }
    if (dashboard) dashboard.classList.remove('active');
    document.body.classList.remove('dashboard-active');
    setPanelOpen('guide', false);
    setPanelOpen('media', false);

    const fill = el('bootProgressFill');
    const pct = el('bootProgressPct');
    const status = el('bootStatusText');
    if (fill) fill.style.setProperty('--p', '0');
    if (pct) pct.textContent = '0%';
    if (status) status.textContent = BOOT_LOG[0];

    if (Boot) Boot.reset();
    if (screen) {
      screen.style.display = '';
      void screen.offsetWidth;
      screen.classList.add('boot-live');
    }
    startBootLoop();
    startBootProgress();
    Audio.playBladeSwoosh();
  }

  /* =========================================================
     КЛАВИАТУРА
     ========================================================= */
  function initKeyboard() {
    global.addEventListener('keydown', (e) => {
      if (app.boot.phase !== 'done') {
        // На заставке любая клавиша (Enter/Space/Esc) ведёт по сценарию.
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape' || e.code === 'Space') {
          e.preventDefault();
          triggerBoot();
        }
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable)) return;

      let handled = true;

      if (e.code === 'BracketLeft') {
        switchCategoryBy(-1);
      } else if (e.code === 'BracketRight') {
        switchCategoryBy(1);
      } else if (e.code === 'KeyY' || e.code === 'KeyF') {
        flipActiveCase();
      } else if (e.code === 'KeyX' || e.code === 'KeyM') {
        toggleMedia();
      } else if (e.code === 'KeyB') {
        // Кнопка «B» на клавиатуре — мгновенно закрыть панель.
        if (!closeAllBlades() && Carousel.isFlipped()) {
          flipActiveCase(false);
        }
      } else if (e.code === 'Enter' || e.code === 'KeyE') {
        const item = Carousel.getActiveItem();
        if (item) openGuide(item);
      } else if (e.key === 'Escape' || e.key === 'Backspace') {
        if (!closeAllBlades() && Carousel.isFlipped()) {
          flipActiveCase(false);
        }
      } else {
        handled = false;
      }

      if (handled) e.preventDefault();
    });
  }

  /* =========================================================
     ПРИВЯЗКА ЭЛЕМЕНТОВ
     ========================================================= */
  function bindControls() {
    const themeSelect = el('themeSelect');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        applyTheme(e.target.value);
        X360.savePrefs();
        Audio.playBladeSwoosh();
      });
    }

    // На телефонах селект тем скрыт — клик по аватару листает корпуса.
    const gamerpic = document.querySelector('.gamerpic-box');
    if (gamerpic) {
      gamerpic.style.cursor = 'pointer';
      gamerpic.title = 'Сменить корпус консоли';
      gamerpic.setAttribute('role', 'button');
      gamerpic.setAttribute('tabindex', '0');
      gamerpic.addEventListener('click', cycleTheme);
      gamerpic.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cycleTheme();
        }
      });
    }

    // Кнопка CRT. Используем onclick (вместо addEventListener), чтобы
    // обработчик нельзя было потерять или задвоить, и гасим
    // распространение события — клик не должен «проваливаться» в сцену.
    const crtBtn = el('crtToggleBtn');
    if (crtBtn) {
      crtBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = !document.body.classList.contains('crt-on');
        X360.prefs.crt = next;
        document.body.classList.toggle('crt-on', next);
        crtBtn.textContent = next ? 'CRT: ВКЛ' : 'CRT: ВЫКЛ';
        X360.savePrefs();
        Audio.playBladeSwoosh();
      };
    }

    const fanBtn = el('fanHumBtn');
    if (fanBtn) {
      fanBtn.addEventListener('click', () => {
        const next = !X360.state.fanHumEnabled;
        X360.state.fanHumEnabled = next;
        X360.prefs.fan = next;
        X360.savePrefs();
        Audio.setFanHum(next);
        const text = el('fanHumText');
        if (text) text.textContent = next ? 'КУЛЕР: ВКЛ' : 'КУЛЕР: ВЫКЛ';
        fanBtn.classList.toggle('active', next);
        Audio.playBladeSwoosh();
      });
    }

    const sfxBtn = el('sfxToggleBtn');
    if (sfxBtn) {
      sfxBtn.addEventListener('click', () => {
        const next = !X360.state.sfxEnabled;
        X360.state.sfxEnabled = next;
        X360.prefs.sfx = next;
        X360.savePrefs();
        Audio.setSfx(next);
        const text = el('sfxText');
        if (text) text.textContent = next ? 'SFX: ВКЛ' : 'SFX: ВЫКЛ';
        sfxBtn.classList.toggle('active', next);
        if (next) Audio.playBladeSwoosh();
      });
    }

    // Кнопка перезапуска заставки.
    const replayBtn = el('replayBootBtn');
    if (replayBtn) {
      replayBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        replayBoot();
      };
    }

    // Лента лезвий: LB / RB.
    const prevBtn = el('bladesPrevBtn');
    const nextBtn = el('bladesNextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => switchCategoryBy(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => switchCategoryBy(1));

    // Guide Blade.
    const guideClose = el('guideCloseBtn');
    if (guideClose) guideClose.addEventListener('click', () => {
      closeGuide();
      Audio.playBladeSwoosh();
    });

    // Media Blade.
    const mediaOpen = el('mediaOpenBtn');
    if (mediaOpen) mediaOpen.addEventListener('click', toggleMedia);
    const mediaClose = el('mediaCloseBtn');
    if (mediaClose) {
      mediaClose.addEventListener('click', () => {
        setPanelOpen('media', false);
        Audio.playBladeSwoosh();
      });
    }

    // Нижние подсказки (A / B / X / Y).
    const hintSelect = el('hintSelect');
    if (hintSelect) {
      hintSelect.addEventListener('click', () => {
        const item = Carousel.getActiveItem();
        if (item) openGuide(item);
      });
    }
    const hintFlip = el('hintFlip');
    if (hintFlip) {
      hintFlip.addEventListener('click', () => {
        flipActiveCase();
      });
    }
    const hintMedia = el('hintMedia');
    if (hintMedia) hintMedia.addEventListener('click', toggleMedia);
    const hintBack = el('hintBack');
    if (hintBack) {
      hintBack.addEventListener('click', () => {
        if (!closeAllBlades() && Carousel.isFlipped()) {
          flipActiveCase(false);
        }
      });
    }

    // Boot screen.
    const nexus = el('nexusWrap');
    const bootStart = el('bootStartBtn');
    const bootSkip = el('bootSkipBtn');
    const screen = el('bootScreen');

    if (nexus) {
      nexus.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerBoot();
      });
      nexus.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerBoot();
        }
      });
    }
    if (bootStart) {
      bootStart.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerBoot();
      });
    }
    if (bootSkip) {
      bootSkip.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerBoot();
      });
    }
    if (screen) {
      screen.addEventListener('click', triggerBoot);
    }
  }

  /* =========================================================
     INIT
     ========================================================= */
  function init() {
    // --- Audio ---
    Audio.init();
    Audio.setSfx(X360.state.sfxEnabled);
    X360.state.sfxEnabled = Audio.isSfxEnabled();

    /* Звук появляется только после первого жеста гостя (autoplay-policy).
       Музыка стартует в тот же момент — иначе плеер молчал бы
       до первого клика, а preload="none" не даёт ничего скачать заранее. */
    Audio.onReady(() => {
      try {
        if (X360.prefs.music && Player.getTracks().length && !Player.isPlaying()) {
          Player.start(true);
        }
      } catch (err) {
        /* ignore */
      }
    });

    // --- Темы / CRT ---
    applyTheme(X360.prefs.theme);

    // --- Профиль ---
    renderGamerProfile();

    // --- Карусель ---
    Carousel.init({
      stage: el('carouselStage'),
      prevBtn: el('carouselPrevBtn'),
      nextBtn: el('carouselNextBtn'),
      pipsBox: el('carouselPipsBar'),
      onOpenGuide: openGuide,
      onToggleFlip: () => { /* звук обрабатывается отдельно */ },
      onSfx: (kind) => {
        if (kind === 'nav') Audio.playBladeSwoosh();
        else if (kind === 'flip') Audio.playPlasticClick();
      }
    });


    Carousel.setItems(getFilteredItems());

    // --- Лента лезвий ---
    renderBlades();
    initBladeDrag();

    // --- Плеер ---
    Player.init({
      onStateChange: () => {
        const chip = el('mediaOpenBtn');
        if (chip) chip.classList.toggle('active', Player.isPlaying());
      }
    });

    // --- Панели ---
    initSheetDrag();

    // --- Управление ---
    bindControls();
    initKeyboard();
    initPointerEffects();
    initGyro();

    // --- Gamepad ---
    Gamepad.init({
      start: triggerBoot,
      openGuide: () => {
        const item = Carousel.getActiveItem();
        if (item) openGuide(item);
      },
      confirm: () => {
        const link = el('guideStoreLink');
        if (link && !link.classList.contains('is-disabled')) link.click();
      },
      close: () => closeAllBlades(),
      back: () => {
        if (Carousel.isFlipped()) flipActiveCase(false);
      },
      media: toggleMedia,
      flip: () => {
        flipActiveCase();
      },
      prevItem: () => Carousel.stepClamped(-1),
      nextItem: () => Carousel.stepClamped(1),
      prevCategory: () => switchCategoryBy(-1),
      nextCategory: () => switchCategoryBy(1)
    });

    // --- Синхронизация начального состояния ---
    const fanBtn = el('fanHumBtn');
    const fanText = el('fanHumText');
    if (fanBtn) fanBtn.classList.toggle('active', X360.state.fanHumEnabled);
    if (fanText) fanText.textContent = X360.state.fanHumEnabled ? 'КУЛЕР: ВКЛ' : 'КУЛЕР: ВЫКЛ';

    const sfxBtn = el('sfxToggleBtn');
    const sfxText = el('sfxText');
    if (sfxBtn) sfxBtn.classList.toggle('active', X360.state.sfxEnabled);
    if (sfxText) sfxText.textContent = X360.state.sfxEnabled ? 'SFX: ВКЛ' : 'SFX: ВЫКЛ';

    // --- Boot screen (Ribbons 2005) ---
    initBootRibbons();
    startBootProgress();

    global.addEventListener('resize', () => {
      resizeBootCanvas();
      Carousel.layout();
    });

    // Отложенный старт музыки, если она была включена в прошлой сессии.
    if (X360.prefs.music && X360.prefs.musicUserSet) {
      // Ждём первого жеста — autoplay-политика всё равно требует его.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Небольшой публичный API для отладки.
  X360.App = {
    triggerBoot,
    replayBoot,
    applyTheme,
    openGuide,
    closeGuide,
    toggleMedia,
    switchCategoryBy,
    selectCategory,
    getFilteredItems
  };
})(window);
