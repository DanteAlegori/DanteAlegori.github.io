(function (global) {
  'use strict';

  const X360 = global.X360 || (global.X360 = {});
  const utils = X360.utils;

  const CLICK_SLOP = 6;
  const FLICK_VELOCITY = 0.35;
  const WHEEL_RATIO = 0.28;
  const FAN_RADIUS = 2;
  const PERSPECTIVE = 1000;
  const FAN_ROT = 28;
  const FAN_DEPTH = 110;
  const FAN_LIFT = 160;
  const FAN_SCALE = 1.15;

  const carousel = {
    stage: null,
    track: null,
    prevBtn: null,
    nextBtn: null,
    pipsBox: null,
    items: [],
    activeIndex: 0,
    isFlipped: false,
    sig: '',
    onActivate: null,
    onOpenGuide: null,
    onToggleFlip: null,
    onSfx: null,

    anchors: [],
    cardWidth: 240,
    caseStep: 268,

    scrollRaf: 0,
    syncing: false,
    syncTimer: 0,
    scrollEndTimer: 0,

    wheelAccum: 0,

    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    dragging: false,
    moved: false,
    startScroll: 0,

    downScroll: 0,
    scrolledSinceDown: false,

    pips: [],
    pipSig: ''
  };

  function fanFor(d) {
    const ad = Math.abs(d);
    const t = Math.min(1, ad / 0.55);
    const deep = ad > 1 ? (ad - 1) * FAN_DEPTH : 0;
    const z = FAN_LIFT * (1 - t) + (-FAN_DEPTH * ad) * t - deep;
    const scale = FAN_SCALE * (1 - t) + Math.max(0.72, 1 - ad * 0.05) * t;
    const ry = -FAN_ROT * Math.max(-2.4, Math.min(2.4, d));
    const zi = Math.max(1, 30 - Math.round(ad * 3));
    return { z: z, scale: scale, ry: ry, zi: zi };
  }

  function applyFan(frac) {
    const anchors = carousel.anchors;
    if (!anchors.length) return;

    const from = Math.max(0, Math.floor(frac) - FAN_RADIUS);
    const to = Math.min(anchors.length - 1, Math.ceil(frac) + FAN_RADIUS);

    const openPush = carousel.isFlipped
      ? (carousel.cardWidth || 240) * 0.34
      : 0;

    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];
      if (i < from || i > to) {
        if (anchor.classList.contains('is-near')) {
          anchor.classList.remove('is-near');
          anchor.style.transform = '';
          anchor.style.zIndex = '';
        }
        continue;
      }
      const f = fanFor(i - frac);
      const d = i - frac;
      const push = openPush && Math.abs(d) > 0.001
        ? Math.sign(d) * Math.min(1.6, Math.abs(d)) * openPush
        : 0;
      anchor.style.transform =
        'perspective(' + PERSPECTIVE + 'px) ' +
        'translate3d(' + push.toFixed(1) + 'px, 0, ' + f.z.toFixed(1) + 'px) ' +
        'rotateY(' + f.ry.toFixed(2) + 'deg) ' +
        'scale(' + f.scale.toFixed(3) + ')';
      anchor.style.zIndex = String(f.zi);
      if (!anchor.classList.contains('is-near')) anchor.classList.add('is-near');
    }
  }

  function measure() {
    const track = carousel.track;
    const anchors = carousel.anchors;
    if (!track || !anchors.length) return;

    const cs = getComputedStyle(anchors[0]);
    const width = parseFloat(cs.width) || anchors[0].offsetWidth || 230;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;

    carousel.cardWidth = width;
    carousel.caseStep = width + gap;
  }

  function fracAt(scrollLeft) {
    if (!carousel.caseStep) return 0;
    return scrollLeft / carousel.caseStep;
  }

  function indexAt(scrollLeft) {
    const raw = Math.round(fracAt(scrollLeft));
    return utils.clamp(raw, 0, Math.max(0, carousel.items.length - 1));
  }

  function offsetOf(index) {
    return index * carousel.caseStep;
  }

  function buildCard(item, idx) {
    const isBusted = item.status === 'busted';
    const photoRaw = utils.thumbUrl(item.photoUrl) || X360.FALLBACK_ART;
    const photoSrc = utils.escapeHtml(photoRaw);
    const title = utils.escapeHtml(item.title || 'БЕЗ НАЗВАНИЯ');
    const category = utils.escapeHtml(item.category || 'БЕЗ КАТЕГОРИИ');
    const slogan = utils.escapeHtml(item.slogan || 'Кусок бунта в личную коллекцию.');
    const bountyTag = utils.escapeHtml(item.bountyTag || '');

    let stickerHtml = '';
    if (isBusted) {
      stickerHtml = '<div class="market-sticker busted">КУПЛЕНО!</div>';
    } else if (bountyTag) {
      stickerHtml = `<div class="market-sticker discount">${bountyTag}</div>`;
    }

    const heat = utils.clamp(Number(item.heatLevel) || 4, 1, 5);
    const ratingLabels = ['100% ХОТЕЛКА', 'HEAT 2/5', 'HEAT 3/5', 'HEAT 4/5', 'РОК 18+'];
    const ratingText = ratingLabels[heat - 1];

    const max = Math.max(0, Number(item.price) || 0);
    const saved = Math.min(max, Math.max(0, Number(item.collected) || 0));
    const pct = max ? Math.round((saved / max) * 100) : (isBusted ? 100 : 0);

    const anchor = document.createElement('div');
    anchor.className = 'card-item';
    anchor.dataset.itemId = String(item.id || item.title || idx);
    anchor.setAttribute('role', 'group');
    anchor.setAttribute('aria-label', `Диск: ${item.title || 'без названия'}`);


    anchor.innerHTML = `
      <div class="case-card-inner">
        <div class="case-chassis-glow" aria-hidden="true"></div>

        



        <div class="case-flip-rotor">

          

          <div class="case-lid-inner" aria-hidden="true"></div>

        
        <div class="case-face front">
          <div class="case-x360-header">
            <div class="x360-logo-badge">
              <svg class="xbox-logo-svg" aria-hidden="true"><use href="#xboxLogo"></use></svg>
              <span>XBOX 360</span>
            </div>
            <div class="case-live-tag">LIVE</div>
          </div>

          <div class="case-artwork-wrap">
            <img src="${photoSrc}" alt="${title}" draggable="false" loading="lazy" decoding="async">
            <div class="case-sheen" aria-hidden="true"></div>
            <div class="case-holo-sheen" aria-hidden="true"></div>
            <div class="case-specular" aria-hidden="true"></div>
            <div class="case-emboss" aria-hidden="true">XBOX 360</div>
            ${stickerHtml}
            <div class="heat-rating-badge">
              <div class="hr-val">${heat}</div>
              <div class="hr-lbl">HEAT</div>
            </div>

            

            <div class="case-hover-quick-bar">
              <button class="ch-btn ch-inspect-btn" type="button">
                <span class="xbox-btn-dot btn-a">A</span> ДОСЬЕ / КУПИТЬ
              </button>
            </div>

            
            


            <button class="case-flip-fab ch-btn ch-flip-btn" type="button"
                    title="Перевернуть коробку на 360° (Y)" aria-label="Перевернуть коробку на 360 градусов">
              <span class="xbox-btn-dot btn-y">Y</span>
              <span class="fab-label">360°</span>
            </button>
          </div>

          <div class="case-footer-details">
            <div class="case-title">${title}</div>
            <div class="case-price-row">
              <span style="color:#8da491;">${ratingText}</span>
              <span class="price">${utils.formatMoney(item.price)}</span>
            </div>
            <div class="case-progress-track">
              

              <div class="case-progress-fill" style="--p:${(pct / 100).toFixed(4)}"></div>
            </div>
            <div class="case-progress-meta">
              <span>НАКОПЛЕНО ${utils.formatMoney(saved)}</span>
              <span class="pct">${pct}%</span>
            </div>
          </div>
        </div>
        </div>

      </div>
    `;

    anchor.dataset.discArt = photoRaw;
    bindImageFallbacks(anchor);

    anchor._refs = {
      cover: anchor.querySelector('.case-artwork-wrap img')
    };

    return anchor;
  }

  function applyDiscArt(anchor) {
    if (!anchor) return;
    const refs = anchor._refs;
    if (!refs) return;
    if (refs.cover && refs.cover.loading === 'lazy') refs.cover.loading = 'eager';
  }

  function bindImageFallbacks(root) {
    root.querySelectorAll('img').forEach((img) => {
      img.addEventListener('error', () => {
        if (img.dataset.fallbackApplied) return;
        img.dataset.fallbackApplied = '1';
        img.src = X360.FALLBACK_ART;
      });
    });
  }

  function signature(items) {
    return items.map((item) => String(item.id || item.title || '')).join('\u0001');
  }

  function build() {
    const track = carousel.track;
    if (!track) return;
    const items = carousel.items;
    track.innerHTML = '';
    carousel.sig = signature(items);

    if (!items.length) {
      track.innerHTML = `
        <div class="empty-stage">
          <div class="empty-disc">◌</div>
          <strong>В ЭТОМ РАЗДЕЛЕ ПОКА ПУСТО</strong>
          <span>Добавь цель в мастерской NERO — и она появится на полке.</span>
        </div>`;
      carousel.anchors = [];
      updateNavState();
      return;
    }

    carousel.activeIndex = utils.clamp(carousel.activeIndex, 0, items.length - 1);

    const frag = document.createDocumentFragment();
    const anchors = [];
    items.forEach((item, idx) => {
      const anchor = buildCard(item, idx);
      bindCardEvents(anchor, item, idx);
      anchors.push(anchor);
      frag.appendChild(anchor);
    });
    track.appendChild(frag);

    carousel.anchors = anchors;

    layout();
  }

  function layout() {
    const track = carousel.track;
    if (!track) return;
    const items = carousel.items;
    if (!items.length || !carousel.anchors.length) {
      updateNavState();
      return;
    }

    measure();

    const activeItem = items[carousel.activeIndex];
    const activeId = activeItem ? String(activeItem.id || activeItem.title || carousel.activeIndex) : '';
    if (activeId !== X360.state.lastActiveCaseId) {
      X360.state.lastActiveCaseId = activeId;
      carousel.isFlipped = false;
      X360.state.isFlipped = false;
      hideOpenCase();
    }

    syncActiveClass();

    const frac = fracAt(track.scrollLeft);
    applyFan(frac);

    const activeIdx = carousel.activeIndex;
    [activeIdx - 1, activeIdx, activeIdx + 1].forEach((i) => {
      if (i < 0 || i >= items.length) return;
      applyDiscArt(carousel.anchors[i]);
    });

    bindOpenCase();
    updateNavState();
  }

  function updateNavState() {
    const items = carousel.items;
    const count = items.length;

    if (carousel.prevBtn) carousel.prevBtn.classList.toggle('is-disabled', count <= 1);
    if (carousel.nextBtn) carousel.nextBtn.classList.toggle('is-disabled', count <= 1);

    if (!carousel.pipsBox) return;
    if (count <= 1) {
      carousel.pipsBox.style.display = 'none';
      carousel.pipsBox.innerHTML = '';
      carousel.pips = [];
      carousel.pipSig = '';
      return;
    }
    carousel.pipsBox.style.display = 'flex';

    const sig = String(count);
    if (carousel.pipSig !== sig) {
      carousel.pipSig = sig;
      carousel.pipsBox.innerHTML = '';
      carousel.pips = [];
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const pip = document.createElement('button');
        pip.type = 'button';
        pip.className = 'carousel-pip';
        pip.title = 'Диск ' + (i + 1);
        pip.setAttribute('aria-label', 'Перейти к диску ' + (i + 1));
        pip.addEventListener('click', (function (index) {
          return function () { setActive(index); };
        })(i));
        carousel.pips.push(pip);
        frag.appendChild(pip);
      }
      carousel.pipsBox.appendChild(frag);
    }

    for (let i = 0; i < carousel.pips.length; i++) {
      carousel.pips[i].classList.toggle('active', i === carousel.activeIndex);
    }
  }

  function onScroll() {
    if (carousel.scrollRaf) return;
    const trackEl = carousel.track;
    if (trackEl) trackEl.classList.add('is-scrolling');
    clearTimeout(carousel.scrollEndTimer);
    carousel.scrollEndTimer = setTimeout(function () {
      if (carousel.track) carousel.track.classList.remove('is-scrolling');
    }, 200);
    carousel.scrollRaf = requestAnimationFrame(function () {
      carousel.scrollRaf = 0;
      const track = carousel.track;
      if (!track) return;

      const frac = fracAt(track.scrollLeft);
      applyFan(frac);

      if (carousel.syncing) {
        if (Math.abs(track.scrollLeft - offsetOf(carousel.activeIndex)) < 1.5) {
          carousel.syncing = false;
        }
        return;
      }

      const idx = indexAt(track.scrollLeft);
      if (idx === carousel.activeIndex) return;

      carousel.activeIndex = idx;
      X360.state.activeIndex = idx;

      carousel.isFlipped = false;
      X360.state.isFlipped = false;
      hideOpenCase();
      syncActiveClass();

      if (carousel.onSfx) carousel.onSfx('nav');
      if (carousel.onActivate) carousel.onActivate(carousel.items[idx], idx);
    });
  }

  function syncActiveClass() {
    const anchors = carousel.anchors;
    for (let i = 0; i < anchors.length; i++) {
      const isActive = i === carousel.activeIndex;
      anchors[i].classList.toggle('is-active', isActive);
      anchors[i].classList.toggle('flipped', isActive && carousel.isFlipped);
    }
  }

  function scrollToIndex(index, behavior) {
    const track = carousel.track;
    if (!track) return;
    carousel.syncing = true;
    clearTimeout(carousel.syncTimer);
    carousel.syncTimer = setTimeout(function () {
      carousel.syncing = false;
    }, 1500);

    const instant = behavior === 'instant';
    if (instant) track.style.scrollBehavior = 'auto';
    try {
      track.scrollTo({ left: offsetOf(index), behavior: instant ? 'instant' : 'smooth' });
    } catch (err) {
      track.scrollLeft = offsetOf(index);
    }
    if (instant) {
      requestAnimationFrame(function () { track.style.scrollBehavior = ''; });
    }
  }

  function setActive(index, opts) {
    const options = opts || {};
    const count = carousel.items.length;
    if (!count) return;

    const next = utils.clamp(index, 0, count - 1);
    const changed = next !== carousel.activeIndex;

    carousel.activeIndex = next;
    X360.state.activeIndex = next;

    if (changed && !options.silent) {
      carousel.isFlipped = false;
      X360.state.isFlipped = false;
      hideOpenCase();
    }

    scrollToIndex(next, options.behavior || 'smooth');
    syncActiveClass();
    applyFan(next);

    if (changed && carousel.onActivate) carousel.onActivate(carousel.items[next], next);
  }

  function step(delta) {
    const count = carousel.items.length;
    if (!count) return;
    const next = ((carousel.activeIndex + delta) % count + count) % count;
    setActive(next, { behavior: (next === 0 || next === count - 1) ? 'instant' : 'smooth' });
  }

  function stepClamped(delta) {
    const count = carousel.items.length;
    if (!count) return;
    const next = carousel.activeIndex + delta;
    if (next < 0 || next > count - 1) {
      bounce();
      return;
    }
    setActive(next);
  }

  function bounce() {
    const stage = carousel.stage;
    if (!stage) return;
    stage.classList.add('is-bouncing');
    setTimeout(() => stage.classList.remove('is-bouncing'), 220);
  }

  function toggleFlip(force) {
    const count = carousel.items.length;
    if (!count) return;

    const next = typeof force === 'boolean' ? force : !carousel.isFlipped;
    carousel.isFlipped = next;
    X360.state.isFlipped = next;

    if (X360.Audio && X360.Audio.playDrive) {
      try { X360.Audio.playDrive(next); } catch (err) {   }
    }

    syncActiveClass();

    if (next) showOpenCase(carousel.items[carousel.activeIndex]);
    else hideOpenCase();

    if (carousel.track) {
      carousel.track.classList.toggle('has-open-case', next);
    }

    if (carousel.track) applyFan(fracAt(carousel.track.scrollLeft));

    if (carousel.onToggleFlip) carousel.onToggleFlip(next);
  }

  function unflipped() {
    if (!carousel.isFlipped) return;
    toggleFlip(false);
  }

  let openCaseEls = null;

  function getOpenCaseEls() {
    if (openCaseEls) return openCaseEls;
    const wrapper = document.getElementById('openCaseWrapper');
    if (!wrapper) return null;
    openCaseEls = {
      wrapper: wrapper,
      backdrop: document.getElementById('openCaseBackdrop'),
      category: document.getElementById('openCaseCategory'),
      title: document.getElementById('openCaseTitle'),
      quote: document.getElementById('openCaseQuote'),
      heat: document.getElementById('openCaseHeat'),
      status: document.getElementById('openCaseStatus'),
      discTitle: document.getElementById('openDiscTitle'),
      print: document.getElementById('openDiscPrint'),
      closeBtn: document.getElementById('openCaseClose')
    };
    return openCaseEls;
  }

  function showOpenCase(item) {
    const els = getOpenCaseEls();
    if (!els || !item) return;

    const title = utils.escapeHtml(item.title || 'БЕЗ НАЗВАНИЯ');
    const category = utils.escapeHtml(item.category || 'БЕЗ КАТЕГОРИИ');
    const slogan = utils.escapeHtml(item.slogan || 'Кусок бунта в личную коллекцию.');
    const heat = utils.clamp(Number(item.heatLevel) || 4, 1, 5);
    const isBusted = item.status === 'busted';

    if (els.category) els.category.textContent = category;
    if (els.title) els.title.textContent = title;
    if (els.quote) els.quote.textContent = '«' + slogan + '»';
    if (els.heat) els.heat.textContent = heat + ' / 5';
    if (els.status) els.status.textContent = isBusted ? 'ACQUIRED' : 'WANTED';
    if (els.discTitle) els.discTitle.textContent = title;

    if (els.print) {
      const photo = utils.thumbUrl(item.photoUrl) || X360.FALLBACK_ART;
      els.print.innerHTML =
        '<img class="disc-artwork-img" src="' + utils.escapeHtml(photo) + '" alt="" draggable="false" decoding="async">' +
        '<div class="disc-artwork"></div>';
      bindImageFallbacks(els.print);
    }

    els.wrapper.classList.add('is-open');
    els.wrapper.setAttribute('aria-hidden', 'false');
    if (els.backdrop) {
      els.backdrop.classList.add('is-open');
      els.backdrop.setAttribute('aria-hidden', 'false');
    }
  }

  function hideOpenCase() {
    const els = getOpenCaseEls();
    if (els) {
      els.wrapper.classList.remove('is-open');
      els.wrapper.setAttribute('aria-hidden', 'true');
      if (els.backdrop) {
        els.backdrop.classList.remove('is-open');
        els.backdrop.setAttribute('aria-hidden', 'true');
      }
    }
    if (carousel.track) carousel.track.classList.remove('has-open-case');
  }

  function bindOpenCase() {
    const els = getOpenCaseEls();
    if (!els) return;
    if (els.closeBtn && !els.closeBtn.dataset.bound) {
      els.closeBtn.dataset.bound = '1';
      els.closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFlip(false);
      });
    }
    if (els.backdrop && !els.backdrop.dataset.bound) {
      els.backdrop.dataset.bound = '1';
      els.backdrop.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFlip(false);
      });
    }
  }

  function bindCardEvents(anchor, item, idx) {
    function isolateClick(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }

    function isolatePointer(e) {
      e.stopPropagation();
    }

    const fabBtn = anchor.querySelector('.case-flip-fab');
    if (fabBtn) {
      fabBtn.addEventListener('click', (e) => {
        isolateClick(e);
        if (!anchor.classList.contains('is-active')) {
          setActive(idx, { silent: true });
          toggleFlip();
          return;
        }
        toggleFlip();
      });
      fabBtn.addEventListener('pointerdown', isolatePointer);
      fabBtn.addEventListener('pointerup', isolatePointer);
      fabBtn.addEventListener('mousedown', isolatePointer);

      const artWrap = anchor.querySelector('.case-artwork-wrap');
      if (artWrap) {
        artWrap.addEventListener('click', (e) => {
          if (fabBtn.contains(e.target)) return;
          if (carousel.scrolledSinceDown) return;
          const b = fabBtn.getBoundingClientRect();
          if (!b.width) return;
          const cx = b.left + b.width / 2;
          const cy = b.top + b.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          const r = b.width / 2 + 6;
          if (dx * dx + dy * dy > r * r) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (!anchor.classList.contains('is-active')) setActive(idx, { silent: true });
          toggleFlip();
        });
      }
    }

    anchor.querySelectorAll('.ch-flip-btn:not(.case-flip-fab)').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        isolateClick(e);
        if (!anchor.classList.contains('is-active')) {
          setActive(idx, { silent: true });
          toggleFlip();
          return;
        }
        toggleFlip();
      });
      btn.addEventListener('pointerdown', isolatePointer);
      btn.addEventListener('pointerup', isolatePointer);
    });

    const inspectBtn = anchor.querySelector('.ch-inspect-btn');
    const inspectBar = anchor.querySelector('.case-hover-quick-bar');
    if (inspectBtn && inspectBar) {
      inspectBar.addEventListener('click', (e) => {
        isolateClick(e);
        if (!anchor.classList.contains('is-active')) {
          setActive(idx, { silent: true });
          return;
        }
        if (carousel.onOpenGuide) carousel.onOpenGuide(item);
      });
      inspectBtn.addEventListener('pointerdown', isolatePointer);
      inspectBtn.addEventListener('pointerup', isolatePointer);
    }

    anchor.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
      if (carousel.scrolledSinceDown) return;

      if (idx !== carousel.activeIndex) {
        setActive(idx);
      } else if (carousel.isFlipped) {
        toggleFlip();
      } else if (carousel.onOpenGuide) {
        carousel.onOpenGuide(item);
      }
    });
  }

  function onPointerDown(e) {
    const track = carousel.track;
    if (!track) return;
    if (document.body.classList.contains('blade-open')) return;
    if (typeof e.button === 'number' && e.button !== 0) return;

    carousel.syncing = false;

    if (e.pointerType === 'touch') return;
    if (e.target && e.target.closest && e.target.closest('button, a, input, select, textarea')) return;

    carousel.pointerId = e.pointerId;
    carousel.startX = e.clientX;
    carousel.startY = e.clientY;
    carousel.lastX = e.clientX;
    carousel.lastT = e.timeStamp || performance.now();
    carousel.velocity = 0;
    carousel.dragging = true;
    carousel.moved = false;
    carousel.startScroll = track.scrollLeft;

    track.style.scrollBehavior = 'auto';
    track.style.scrollSnapType = 'none';
    track.classList.add('is-dragging');
  }

  function onPointerMove(e) {
    if (!carousel.dragging || e.pointerId !== carousel.pointerId) return;
    const track = carousel.track;
    if (!track) return;

    const dx = e.clientX - carousel.startX;
    const dy = e.clientY - carousel.startY;

    if (!carousel.moved) {
      if (Math.abs(dx) < CLICK_SLOP && Math.abs(dy) < CLICK_SLOP) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        endDrag(false);
        return;
      }
      carousel.moved = true;
      try { track.setPointerCapture(e.pointerId); } catch (err) {   }
    }

    const now = e.timeStamp || performance.now();
    const dt = Math.max(1, now - carousel.lastT);
    carousel.velocity = utils.clamp((e.clientX - carousel.lastX) / dt, -3, 3);
    carousel.lastX = e.clientX;
    carousel.lastT = now;

    track.scrollLeft = carousel.startScroll - dx;
    e.preventDefault();
  }

  function endDrag(commit) {
    const track = carousel.track;
    if (!track) return;
    const wasMoved = carousel.moved;

    let target = null;
    if (wasMoved && commit) {
      const current = indexAt(track.scrollLeft);
      const projected = track.scrollLeft - carousel.velocity * 140;
      target = utils.clamp(indexAt(projected), current - 3, current + 3);
    }

    carousel.dragging = false;
    carousel.pointerId = null;
    carousel.moved = false;

    track.style.scrollBehavior = '';
    track.style.scrollSnapType = '';
    track.classList.remove('is-dragging');

    if (target === null) return;

    setActive(utils.clamp(target, 0, Math.max(0, carousel.items.length - 1)));
  }

  function onPointerUp(e) {
    if (!carousel.dragging) return;
    if (carousel.pointerId !== null && e.pointerId !== carousel.pointerId) return;
    endDrag(true);
  }

  function onPointerCancel() {
    if (!carousel.dragging) return;
    endDrag(false);
  }

  function onWheel(e) {
    if (!X360.state.booted) return;
    if (document.body.classList.contains('blade-open')) return;
    if (e.target && e.target.closest && e.target.closest('.media-stations-list, .blade-panel, .blades-nav-bar')) return;

    const count = carousel.items.length;
    if (count <= 1) return;

    const track = carousel.track;
    if (!track) return;

    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const delta = horizontal ? e.deltaX : e.deltaY;
    if (!delta) return;

    const overTrack = e.target && e.target.closest && e.target.closest('.carousel-track');
    if (overTrack) {
      if (horizontal) return;
      e.preventDefault();
    }

    carousel.wheelAccum += delta;
    const threshold = Math.max(24, carousel.caseStep * WHEEL_RATIO);
    if (Math.abs(carousel.wheelAccum) < threshold) return;

    const dir = carousel.wheelAccum > 0 ? 1 : -1;
    carousel.wheelAccum = 0;
    carousel.syncing = false;
    stepClamped(dir);
  }

  function onKeyDown(e) {
    if (!X360.state.booted) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' || target.isContentEditable)) return;

    if (e.code === 'ArrowRight' || e.code === 'KeyD') {
      stepClamped(1);
      e.preventDefault();
    } else if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
      stepClamped(-1);
      e.preventDefault();
    }
  }

  X360.Carousel = {
    init(options) {
      const opts = options || {};
      carousel.stage = opts.stage;
      carousel.track = opts.track || (opts.stage ? opts.stage.querySelector('.carousel-track') : null);
      carousel.prevBtn = opts.prevBtn;
      carousel.nextBtn = opts.nextBtn;
      carousel.pipsBox = opts.pipsBox;
      carousel.onActivate = opts.onActivate || null;
      carousel.onOpenGuide = opts.onOpenGuide || null;
      carousel.onToggleFlip = opts.onToggleFlip || null;
      carousel.onSfx = opts.onSfx || null;

      const track = carousel.track;
      if (track) {
        track.addEventListener('scroll', onScroll, { passive: true });
        track.addEventListener('pointerdown', onPointerDown);
        track.addEventListener('pointermove', onPointerMove, { passive: false });
        track.addEventListener('pointerup', onPointerUp);
        track.addEventListener('pointercancel', onPointerCancel);
        track.addEventListener('dragstart', (e) => e.preventDefault());

        track.addEventListener('pointerdown', () => {
          carousel.downScroll = track.scrollLeft;
          carousel.scrolledSinceDown = false;
        }, true);
      }

      if (carousel.prevBtn) {
        carousel.prevBtn.addEventListener('click', () => step(-1));
      }
      if (carousel.nextBtn) {
        carousel.nextBtn.addEventListener('click', () => step(1));
      }

      global.addEventListener('wheel', onWheel, { passive: false });
      global.addEventListener('keydown', onKeyDown);
    },

    setItems(items) {
      const next = Array.isArray(items) ? items : [];
      const changed = signature(next) !== carousel.sig;
      carousel.items = next;
      if (!next.length) carousel.activeIndex = 0;
      else carousel.activeIndex = utils.clamp(carousel.activeIndex, 0, next.length - 1);

      if (changed || !carousel.anchors.length) {
        build();
        if (carousel.track) {
          carousel.track.style.scrollBehavior = 'auto';
          carousel.track.scrollLeft = 0;
          carousel.track.style.scrollBehavior = '';
        }
        applyFan(0);
      } else {
        layout();
      }
    },

    refresh() {
      build();
    },

    layout,
    setActive,
    step,
    stepClamped,
    toggleFlip,
    unflipped,
    getActiveIndex: () => carousel.activeIndex,
    getActiveItem: () => carousel.items[carousel.activeIndex] || null,
    getItems: () => carousel.items,
    isFlipped: () => carousel.isFlipped,

    getState: () => ({
      activeIndex: carousel.activeIndex,
      scrollLeft: carousel.track ? carousel.track.scrollLeft : 0,
      caseStep: carousel.caseStep,
      syncing: carousel.syncing,
      scrollRaf: carousel.scrollRaf,
      items: carousel.items.length,
      near: carousel.anchors.filter((a) => a.classList.contains('is-near')).length
    })
  };
})(window);
