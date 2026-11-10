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
      phase: 'idle',
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

    const target = activeTab.offsetLeft - (box.clientWidth - activeTab.offsetWidth) / 2;
    const max = Math.max(0, box.scrollWidth - box.clientWidth);
    const clamped = utils.clamp(target, 0, max);

    try {
      box.scrollTo({ left: clamped, behavior: 'smooth' });
    } catch (err) {
      box.scrollLeft = clamped;
    }

    setTimeout(() => {
      if (box.scrollLeft < 0) box.scrollLeft = 0;
    }, 420);
  }

  function initBladeDrag() {
    const box = el('bladesContainer');
    if (!box) return;

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
        try { box.setPointerCapture(e.pointerId); } catch (err) {   }
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
      try { new ResizeObserver(updateBladeOverflow).observe(box); } catch (err) {   }
    }
  }


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

  function setPanelOpen(which, open) {
    const isGuide = which === 'guide';
    const panel = el(isGuide ? 'guideBlade' : 'mediaBlade');
    if (!panel) return;

    if (open) {
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

  function closeAllBlades() {
    const wasOpen = app.guideOpen || app.mediaOpen;
    if (app.guideOpen) setPanelOpen('guide', false);
    if (app.mediaOpen) setPanelOpen('media', false);
    if (wasOpen) {
      Audio.playBladeSwoosh();
      const stage = el('carouselStage');
      if (stage) {
        stage.classList.add('is-interactive');
        setTimeout(() => stage.classList.remove('is-interactive'), 260);
      }
    }
    return wasOpen;
  }

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
        try { handle.setPointerCapture(e.pointerId); } catch (err) {   }
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

    const backdrop = el('sheetBackdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeAllBlades();
      });
    }
  }

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

        if (spotlight) {
          const dx = ((x - 50) / 100) * rect.width;
          const dy = ((y - 40) / 100) * rect.height;
          spotlight.style.transform = 'translate3d(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px, 0)';
        }

        const activeCase = dashboard.querySelector('.card-item.is-active');
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

  const sheenCache = new WeakMap();

  function applySheen(anchor, nx, ny) {
    const hx = utils.clamp(nx, -0.4, 1.4) * 100;
    const hy = utils.clamp(ny, -0.4, 1.4) * 100;
    const gx = utils.clamp(nx, 0, 1) * 100;
    const gy = utils.clamp(ny, 0, 1) * 100;
    const hang = (nx - 0.5) * 54;
    const tx = (nx - 0.5) * 12;
    const ty = (ny - 0.5) * 9;

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

  function carouselAnchors() {
    const stage = el('carouselStage');
    if (!stage) return [];
    return Array.prototype.slice.call(stage.querySelectorAll('.card-item'));
  }

  function initGyro() {
    if (!('DeviceOrientationEvent' in global)) return;

    const handle = (e) => {
      if (e.beta == null && e.gamma == null) return;
      const beta = Number(e.beta) || 0;
      const gamma = Number(e.gamma) || 0;
      const activeCase = document.querySelector('.card-item.is-active');
      if (!activeCase) return;
      const nx = utils.clamp((gamma + 45) / 90, 0, 1);
      const ny = utils.clamp((beta + 45) / 90, 0, 1);
      applySheen(activeCase, nx, ny);
    };

    global.addEventListener('deviceorientation', handle, { passive: true });

    const requestPermission = () => {
      const D = global.DeviceOrientationEvent;
      if (!D || typeof D.requestPermission !== 'function') return;
      D.requestPermission().then((state) => {
        app.gyroGranted = state === 'granted';
      }).catch(() => {   });
    };
    global.addEventListener('click', requestPermission, { once: true });
    global.addEventListener('touchstart', requestPermission, { once: true });
  }

  function initBootRibbons() {
    const canvas = el('bootCanvas');
    if (!canvas || !Boot) return;

    Boot.init(canvas, {
      onCollapsed: () => {
        const screen = el('bootScreen');
        if (screen) screen.classList.add('boot-bloom');
        try { Audio.playStartup(); } catch (e) {   }
        app.boot.phase = 'sphere';
        setTimeout(() => {
          const s = el('bootScreen');
          if (s) s.classList.add('boot-sphere');
          const status = el('bootStatusText');
          if (status) status.textContent = BOOT_LOG[BOOT_LOG.length - 1];
        }, 520);
      }
    });

    const screen0 = el('bootScreen');
    if (screen0) screen0.classList.add('boot-canvas-ready');

    Boot.start();

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

  function flipActiveCase(force) {
    if (!Carousel.getItems().length) return;
    Carousel.toggleFlip(force);
    Audio.playPlasticClick();
  }

  function revealDashboard() {
    const screen = el('bootScreen');
    const db = el('dashboard');
    if (screen) screen.classList.add('boot-done');
    if (db) db.classList.add('active');
    document.body.classList.add('dashboard-active');
    X360.state.booted = true;

    if (Boot) Boot.stop();

    setTimeout(() => {
      if (screen) screen.style.display = 'none';
    }, 800);

    try { Audio.playBladeSwoosh(); } catch (e) {   }

    try { Audio.playStartupChime(); } catch (e) {   }

  }

  function triggerBoot() {
    const phase = app.boot.phase;

    if (phase === 'sphere' || phase === 'launching') {
      if (phase === 'launching') return;
      app.boot.phase = 'done';
      clearTimeout(app.boot.autoTimer);
      revealDashboard();
      return;
    }

    if (phase === 'done') return;

    app.boot.phase = 'launching';
    clearTimeout(app.boot.autoTimer);
    clearInterval(app.boot.progressTimer);

    try { Audio.startFanHum(); } catch (e) {   }

    try { Audio.playSpinUp(); } catch (e) {   }

    if (Boot) Boot.launch();

    const screen = el('bootScreen');
    if (screen) {
      screen.classList.add('boot-launch');
      screen.classList.remove('boot-sphere');
    }

    setTimeout(() => {
      if (!X360.state.booted && app.boot.phase !== 'done') {
        app.boot.phase = 'done';
        revealDashboard();
      }
    }, 2600);
  }

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

  function initKeyboard() {
    global.addEventListener('keydown', (e) => {
      if (app.boot.phase !== 'done') {
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

  function bindControls() {
    const themeSelect = el('themeSelect');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => {
        applyTheme(e.target.value);
        X360.savePrefs();
        Audio.playBladeSwoosh();
      });
    }

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

    const replayBtn = el('replayBootBtn');
    if (replayBtn) {
      replayBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        replayBoot();
      };
    }

    const prevBtn = el('bladesPrevBtn');
    const nextBtn = el('bladesNextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => switchCategoryBy(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => switchCategoryBy(1));

    const guideClose = el('guideCloseBtn');
    if (guideClose) guideClose.addEventListener('click', () => {
      closeGuide();
      Audio.playBladeSwoosh();
    });

    const mediaOpen = el('mediaOpenBtn');
    if (mediaOpen) mediaOpen.addEventListener('click', toggleMedia);
    const mediaClose = el('mediaCloseBtn');
    if (mediaClose) {
      mediaClose.addEventListener('click', () => {
        setPanelOpen('media', false);
        Audio.playBladeSwoosh();
      });
    }

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

  function init() {
    Audio.init();
    Audio.setSfx(X360.state.sfxEnabled);
    X360.state.sfxEnabled = Audio.isSfxEnabled();

    Audio.onReady(() => {
      try {
        if (X360.prefs.music && Player.getTracks().length && !Player.isPlaying()) {
          Player.start(true);
        }
      } catch (err) {
      }
    });

    applyTheme(X360.prefs.theme);

    renderGamerProfile();

    Carousel.init({
      stage: el('carouselStage'),
      track: el('carouselTrack'),
      prevBtn: el('carouselPrevBtn'),
      nextBtn: el('carouselNextBtn'),
      pipsBox: el('carouselPipsBar'),
      onOpenGuide: openGuide,
      onToggleFlip: () => {   },
      onSfx: (kind) => {
        if (kind === 'nav') Audio.playBladeSwoosh();
        else if (kind === 'flip') Audio.playPlasticClick();
      }
    });


    Carousel.setItems(getFilteredItems());

    renderBlades();
    initBladeDrag();

    Player.init({
      onStateChange: () => {
        const chip = el('mediaOpenBtn');
        if (chip) chip.classList.toggle('active', Player.isPlaying());
      }
    });

    initSheetDrag();

    document.addEventListener('visibilitychange', () => {
      document.documentElement.classList.toggle('tab-hidden', document.hidden);
    });

    bindControls();
    initKeyboard();
    initPointerEffects();
    initGyro();

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

    const fanBtn = el('fanHumBtn');
    const fanText = el('fanHumText');
    if (fanBtn) fanBtn.classList.toggle('active', X360.state.fanHumEnabled);
    if (fanText) fanText.textContent = X360.state.fanHumEnabled ? 'КУЛЕР: ВКЛ' : 'КУЛЕР: ВЫКЛ';

    const sfxBtn = el('sfxToggleBtn');
    const sfxText = el('sfxText');
    if (sfxBtn) sfxBtn.classList.toggle('active', X360.state.sfxEnabled);
    if (sfxText) sfxText.textContent = X360.state.sfxEnabled ? 'SFX: ВКЛ' : 'SFX: ВЫКЛ';

    initBootRibbons();
    startBootProgress();

    global.addEventListener('resize', () => {
      resizeBootCanvas();
      Carousel.layout();
    });

    if (X360.prefs.music && X360.prefs.musicUserSet) {
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

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
