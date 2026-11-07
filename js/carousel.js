/* ============================================================
   XBOX 360 SYSTEM DASHBOARD · COVERFLOW CAROUSEL
   ---------------------------------------------------------
   • Математика 3D-раскладки, корректная для 0 / 1 / 2 / 5 / 20+ карточек
   • Физика свайпа с инерцией и rubber-band
   • Вращение обложек на 360°
   • Расчёт глубины (z-index) по дистанции
   • Разделение Drag vs Click: порог 10px, pointer events на
     дочерних кнопках не перехватываются
   ============================================================ */
(function (global) {
  'use strict';

  const X360 = global.X360 || (global.X360 = {});
  const utils = X360.utils;

  /* ---------------------------------------------------------
     КОНСТАНТЫ ФИЗИКИ
     --------------------------------------------------------- */
  const DRAG_THRESHOLD = 10;      // px — ниже этого жест считается кликом
  const SWIPE_VELOCITY = 0.35;    // px/ms — порог «флик»-свайпа
  const RUBBER_BAND = 0.42;       // коэффициент сопротивления за пределами
  const MAX_VISIBLE = 7;          // сколько карточек рисуем с каждой стороны

  const carousel = {
    stage: null,
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
    // drag state
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    dragging: false,
    moved: false,
    baseIndex: 0
  };

  /* ---------------------------------------------------------
     МАТЕМАТИКА РАСКЛАДКИ
     ---------------------------------------------------------

     Ключевая проблема старого кода: сдвиг вычислялся как
     ((idx - active) % total + total) % total, а затем «схлопывался»
     в диапазон [-total/2, total/2]. Для total = 1 или 2 это давало
     неверное позиционирование (карточки наезжали друг на друга).

     Здесь используется «короткое круговое расстояние»: для каждой
     карточки выбирается ближайшее к активной позиция в кольце, при
     равенстве расстояний — предпочтение отдаётся левой стороне
     (для чётного количества это даёт симметричную раскладку).
     --------------------------------------------------------- */

  /**
   * Короткое знаковое расстояние от активной карточки.
   *
   * Кольцо всегда центрируется на активной карточке, а расстояния
   * до соседей остаются сбалансированными при ЛЮБОМ количестве
   * элементов (соседи ±1 и ±2 присутствуют всегда, когда есть чему):
   *   n=1 → [0]
   *   n=2 → [0, -1]
   *   n=3 → [0, 1, -1]
   *   n=4 → [0, 1, -2, -1]
   *   n=5 → [0, 1, 2, -2, -1]
   *   n=20 → [0, 1..9, -10..-1]
   *
   * @param {number} index — индекс карточки
   * @param {number} active — индекс активной карточки
   * @param {number} total — общее количество карточек
   * @returns {number} смещение
   */
  function shortestOffset(index, active, total) {
    if (total <= 1) return 0;

    // Приводим разницу в диапазон [0, total)
    const raw = (((index - active) % total) + total) % total;
    // Половина кольца (с округлением вниз) уходит вправо, остальное — влево.
    const half = Math.floor((total - 1) / 2);
    return raw <= half ? raw : raw - total;
  }

  /**
   * Позиция карточки в 3D-пространстве.
   */
  function computeTransform(index, active, total, caseStep) {
    const offset = shortestOffset(index, active, total);
    const distance = Math.abs(offset);
    const isActive = index === active;

    const posX = offset * caseStep;
    // Активная карточка выезжает вперёд, остальные уходят вглубь.
    const posZ = isActive ? 160 : -distance * 110;
    // Угол поворота: чем дальше от центра, тем сильнее «заворачивается».
    const rotY = offset * -28;
    // Масштаб: активная крупнее, дальние мельче.
    const scale = isActive ? 1.15 : Math.max(0.72, 1 - distance * 0.05);

    return { offset, distance, isActive, posX, posZ, rotY, scale };
  }

  /**
   * z-index: чем ближе к центру, тем выше. Глубина сцены
   * рассчитывается от дистанции, а не от индекса в DOM.
   */
  function computeZIndex(distance, isActive) {
    if (isActive) return 30;
    return Math.max(1, 30 - Math.min(distance * 3, 29));
  }

  /* ---------------------------------------------------------
     RENDERING
     --------------------------------------------------------- */

  function buildCard(item, idx) {
    const isBusted = item.status === 'busted';
    const photoRaw = utils.safeUrl(item.photoUrl) || X360.FALLBACK_ART;
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
    anchor.className = 'xbox-case-anchor';
    anchor.dataset.itemId = String(item.id || item.title || idx);
    anchor.setAttribute('role', 'group');
    anchor.setAttribute('aria-label', `Диск: ${item.title || 'без названия'}`);

    anchor.innerHTML = `
      <div class="case-card-inner">
        <div class="case-chassis-glow" aria-hidden="true"></div>

        <!-- FRONT COVER -->
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

            <!-- Центральная панель: только ОДНА кнопка действия.
                 Переворот живёт исключительно в .case-flip-fab (угол бокса). -->
            <div class="case-hover-quick-bar">
              <button class="ch-btn ch-inspect-btn" type="button">
                <span class="xbox-btn-dot btn-a">A</span> ДОСЬЕ / КУПИТЬ
              </button>
            </div>

            <!-- Единственная кнопка переворота: круглый неоновый бейдж в углу -->
            <!-- ВАЖНО: класс ch-btn обязателен — он даёт display:flex.
                 Без него точка «Y» уезжает в угол круглой кнопки, где клик
                 проваливается сквозь обложку и открывает досье. -->
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
              <div class="case-progress-fill" style="width:${pct}%"></div>
            </div>
            <div class="case-progress-meta">
              <span>НАКОПЛЕНО ${utils.formatMoney(saved)}</span>
              <span class="pct">${pct}%</span>
            </div>
          </div>
        </div>

        <!-- BACK COVER -->
        <div class="case-face back">
          <div class="case-holo-sheen" aria-hidden="true"></div>
          <div>
            <div class="back-header-line">
              <span>${category} // DOSSIER</span>
              <span>PAL // 60HZ</span>
            </div>

            <div class="back-screens-row">
              <div class="back-screen-pic">
                <img src="${photoSrc}" alt="Screen 1" draggable="false" loading="lazy" decoding="async">
              </div>
              <div class="back-screen-pic" style="filter:hue-rotate(45deg);">
                <img src="${photoSrc}" alt="Screen 2" draggable="false" loading="lazy" decoding="async">
              </div>
            </div>

            <div class="back-handwritten-note">«${slogan}»</div>
          </div>

          <div>
            <div class="back-specs-table">
              <div>HEAT LVL: <span>${heat} / 5</span></div>
              <div>ONLINE: <span>ENABLED</span></div>
              <div>STATUS: <span>${isBusted ? 'ACQUIRED' : 'WANTED'}</span></div>
              <div>SAVE SIZE: <span>512 KB</span></div>
            </div>

            <div class="back-barcode-row">
              <div class="mini-barcode">||| | | |||| || | ||</div>
              <span>XBOX-360-2005-STASH</span>
            </div>
          </div>

          <!-- Быстрый возврат обложки: доступен даже когда front скрыт -->
          <button class="ch-btn back-return-btn ch-back-btn" type="button" title="Вернуть обложку (Y)">
            <span class="xbox-btn-dot btn-y">Y</span> ВЕРНУТЬ ОБЛОЖКУ
          </button>
        </div>
        <!-- ============================================================        <!-- ============================================================
             CUSTOM PRINTED DVD DISC — Xbox 360 (Minecraft: Xbox 360 Edition)
             Референс: серебряное отражающее поле, ПРЯМОУГОЛЬНАЯ
             шелкография с артом (углы срезаны кругом диска),
             белая шапка с логотипом слева и зелёным мотивом Xbox справа,
             голографическое кольцо втулки, копирайт по кромке.
             ============================================================ -->
        <div class="tray-disc" aria-hidden="true">
          <div class="disc-rotor">

            <!-- 0. Серебряное отражающее поле диска -->
            <div class="disc-surface"></div>

            <!-- 1. Прямоугольная печать (Picture Disc). Углы срезаны кругом диска. -->
            <div class="disc-print-clip">
              <div class="disc-artwork"></div>
            </div>

            <!-- 2. Белая шапка: логотип слева, зелёный мотив Xbox справа -->
            <div class="disc-xbox-header">
              <div class="disc-header-green-swoosh"></div>
              <div class="disc-header-brand">
                <svg class="xbox-logo-svg disc-brand-logo" aria-hidden="true"><use href="#xboxLogo"></use></svg>
                <span class="disc-brand-text">XBOX 360</span>
              </div>
            </div>

            <!-- 3. Технические лейблы: рейтинг/стандарты слева, издатель справа -->
            <div class="disc-meta-left">
              <div class="disc-rating-box">18+</div>
              <div class="disc-tech-row"><span class="dd-mark">DO</span> DOLBY DIGITAL</div>
              <div class="disc-tech-row disc-tech-strong">Microsoft</div>
              <div class="disc-tech-row">PAL // NTSC</div>
            </div>
            <div class="disc-meta-right">
              <div class="disc-studio-label">WISHLIST</div>
              <div class="disc-publisher">XBOX GAME STUDIOS</div>
              <div class="disc-title-text">${title}</div>
            </div>

            <!-- 4. Тонкий круговой юридический копирайт по внешней кромке -->
            <svg class="disc-edge-legal" viewBox="0 0 200 200" aria-hidden="true">
              <defs>
                <path id="discRimArc${idx}" d="M100,100 m-95,0 a95,95 0 1,1 190,0 a95,95 0 1,1 -190,0"></path>
              </defs>
              <text>
                <textPath href="#discRimArc${idx}" startOffset="0%">&#169; MICROSOFT CORPORATION. ALL RIGHTS RESERVED. UNAUTHORIZED COPYING, REVERSE ENGINEERING, TRANSMISSION OR DISCLOSURE PROHIBITED. SECURE ROM &#8226; XBOX 360 &#8226; PAL &#8226;</textPath>
              </text>
            </svg>

            <!-- 5. Дифракционная радуга света по дорожкам -->
            <div class="disc-holo-shine"></div>

            <!-- 6. Прозрачная втулка с голографической лентой безопасности -->
            <div class="disc-center-hub">
              <svg class="disc-holo-ring-svg" viewBox="0 0 200 200" aria-hidden="true">
                <defs>
                  <path id="discSecArc${idx}" d="M100,100 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0"></path>
                  <linearGradient id="discHoloGrad${idx}" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="#ff5fd0"/>
                    <stop offset="25%" stop-color="#7cff8a"/>
                    <stop offset="50%" stop-color="#7fd8ff"/>
                    <stop offset="75%" stop-color="#ffe66a"/>
                    <stop offset="100%" stop-color="#c98cff"/>
                  </linearGradient>
                </defs>
                <circle class="holo-band" cx="100" cy="100" r="44" fill="none" stroke="url(#discHoloGrad${idx})" stroke-width="13"/>
                <circle class="holo-edge" cx="100" cy="100" r="50.5" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.5"/>
                <circle class="holo-edge" cx="100" cy="100" r="37.5" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.5"/>
                <text class="holo-text">
                  <textPath href="#discSecArc${idx}" startOffset="0%">XBOX 360 &#8226; XBOX 360 &#8226; XBOX 360 &#8226; XBOX 360 &#8226;</textPath>
                </text>
              </svg>
              <div class="disc-spindle-hole"></div>
            </div>

            <!-- 7. Внешняя прозрачная фаска поликарбоната -->
            <div class="disc-outer-rim"></div>
          </div>
        </div>
      </div>
    `;

    /* Арт диска НЕ грузим сразу: вкладка может содержать десятки целей,
       и пачка параллельных запросов к CDN рвёт соединения.
       Ссылка лежит в data-атрибуте, фон ставится лениво — когда карточка
       становится активной (см. applyDiscArt). */
    anchor.dataset.discArt = photoRaw;
    bindImageFallbacks(anchor);

    return anchor;
  }

  /* Ленивая загрузка арта: активная карточка и её соседи.
     Обложки помечены loading="lazy", поэтому для показанных карточек
     принудительно снимаем ленивый режим — иначе при перелистывании
     возможна секундная «пустая» обложка. */
  function applyDiscArt(anchor) {
    if (!anchor) return;
    const discArt = anchor.querySelector('.disc-artwork');
    if (discArt && !discArt.style.backgroundImage) {
      const src = anchor.dataset.discArt;
      if (src) discArt.style.backgroundImage = utils.cssUrl(src);
    }
    const cover = anchor.querySelector('.case-artwork-wrap img');
    if (cover && cover.loading === 'lazy') cover.loading = 'eager';
    // Оборотная сторона использует ту же картинку — она уже в кэше.
    anchor.querySelectorAll('.back-screen-pic img').forEach((img) => {
      if (img.loading === 'lazy') img.loading = 'eager';
    });
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

  /* ---------------------------------------------------------
     BUILD / LAYOUT
     --------------------------------------------------------- */

  function build() {
    if (!carousel.stage) return;
    const items = carousel.items;
    carousel.stage.innerHTML = '';
    carousel.sig = signature(items);

    if (!items.length) {
      carousel.stage.innerHTML = `
        <div class="empty-stage">
          <div class="empty-disc">◌</div>
          <strong>В ЭТОМ РАЗДЕЛЕ ПОКА ПУСТО</strong>
          <span>Добавь цель в мастерской NERO — и она появится на полке.</span>
        </div>`;
      updateNavState();
      return;
    }

    carousel.activeIndex = utils.clamp(carousel.activeIndex, 0, items.length - 1);

    const frag = document.createDocumentFragment();
    items.forEach((item, idx) => {
      const anchor = buildCard(item, idx);
      bindCardEvents(anchor, item, idx);
      frag.appendChild(anchor);
    });
    carousel.stage.appendChild(frag);

    layout();
  }

  /* ---------------------------------------------------------
     ФИЗИКА ДИСКА — мягкое вращение с инерцией
     Угол задаётся CSS-переменной --disc-spin на активном роторе:
     так анимация не конфликтует с CSS-анимацией и даёт
     «разгон» после выезда диска из лотка.
     --------------------------------------------------------- */
  const discPhysics = {
    raf: null,
    running: false,
    angle: 0,
    velocity: 0,
    target: 34,        // градусов в секунду
    last: 0,
    activeRotor: null
  };

  function startDiscPhysics() {
    if (discPhysics.running) return;
    discPhysics.running = true;
    discPhysics.last = performance.now();
    if (!discPhysics.raf) {
      discPhysics.raf = requestAnimationFrame(stepDiscPhysics);
    }
  }

  function stopDiscPhysics() {
    discPhysics.running = false;
    if (discPhysics.raf) cancelAnimationFrame(discPhysics.raf);
    discPhysics.raf = null;
  }

  function stepDiscPhysics(now) {
    if (!discPhysics.running) {
      discPhysics.raf = null;
      return;
    }
    const dt = Math.min(0.05, (now - discPhysics.last) / 1000);
    discPhysics.last = now;

    // Инерция: скорость плавно набирается до целевой («разгон» диска).
    discPhysics.velocity += (discPhysics.target - discPhysics.velocity) * Math.min(1, dt * 2.2);
    discPhysics.angle = (discPhysics.angle + discPhysics.velocity * dt) % 360;

    const rotor = discPhysics.activeRotor;
    if (rotor && rotor.isConnected) {
      const wobble = Math.sin(now * 0.0011) * 2.4;
      rotor.style.setProperty('--disc-spin', discPhysics.angle.toFixed(2) + 'deg');
      rotor.style.setProperty('--disc-wobble', wobble.toFixed(2) + 'deg');
    }

    discPhysics.raf = requestAnimationFrame(stepDiscPhysics);
  }

  /** Привязывает физику к активному диску; при смене — сброс инерции. */
  function bindDiscPhysics(activeIndex) {
    const stage = carousel.stage;
    if (!stage) return;
    const rotors = stage.querySelectorAll('.xbox-case-anchor.is-active .disc-rotor');
    const rotor = rotors[0] || null;

    if (rotor !== discPhysics.activeRotor) {
      // Новый диск — начинаем раскрутку заново (лёгкая инерция).
      discPhysics.velocity = 0;
      discPhysics.activeRotor = rotor;
      if (rotor) {
        rotor.style.setProperty('--disc-spin', discPhysics.angle.toFixed(2) + 'deg');
      }
    }
    if (rotor) startDiscPhysics();
  }

  function bindCardEvents(anchor, item, idx) {
    /**
     * Полная изоляция события кнопки — ТОЛЬКО на самом `click`.
     *
     * ВАЖНО: нельзя вызывать preventDefault() на pointerup/mousedown —
     * по спецификации Pointer Events отмена pointerup отменяет
     * совместимостные mouse-события, а значит и браузер НЕ сгенерирует
     * `click`. Кнопка «Y 360°» выглядела «мёртвой» именно из-за этого.
     *
     * stopPropagation останавливает всплытие до карточки,
     * stopImmediatePropagation — до остальных слушателей на кнопке.
     */
    function isolateClick(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }

    /** Мягкая изоляция: только всплытие, без отмены default-действия. */
    function isolatePointer(e) {
      e.stopPropagation();
    }

    // Y — развернуть бокс (FAB «360°» в углу).
    const fabBtn = anchor.querySelector('.case-flip-fab');
    if (fabBtn) {
      fabBtn.addEventListener('click', (e) => {
        isolateClick(e);
        if (!anchor.classList.contains('is-active')) {
          setActive(idx, { silent: true });
          // После активации сразу переворачиваем — гость нажал один раз.
          toggleFlip();
          return;
        }
        toggleFlip();
      });
      // Гасим всплытие указателя, но НЕ отменяем default —
      // иначе браузер не сгенерирует click.
      fabBtn.addEventListener('pointerdown', isolatePointer);
      fabBtn.addEventListener('pointerup', isolatePointer);
      fabBtn.addEventListener('mousedown', isolatePointer);
    }

    // Y — прочие кнопки переворота (если появятся в разметке).
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

    // Клик по тыльной стороне возвращает обложку.
    const backFace = anchor.querySelector('.case-face.back');
    if (backFace) {
      backFace.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
        if (!anchor.classList.contains('is-active')) return;
        e.stopPropagation();
        if (carousel.isFlipped) toggleFlip();
      });
    }

    // «ВЕРНУТЬ ОБЛОЖКУ» — гарантированно возвращает rotateY(0).
    const backReturnBtn = anchor.querySelector('.ch-back-btn');
    if (backReturnBtn) {
      backReturnBtn.addEventListener('click', (e) => {
        isolateClick(e);
        if (!anchor.classList.contains('is-active')) {
          setActive(idx, { silent: true });
          return;
        }
        if (carousel.isFlipped) toggleFlip();
      });
      backReturnBtn.addEventListener('pointerdown', isolatePointer);
      backReturnBtn.addEventListener('pointerup', isolatePointer);
    }

    // A — досье.
    const inspectBtn = anchor.querySelector('.ch-inspect-btn');
    if (inspectBtn) {
      inspectBtn.addEventListener('click', (e) => {
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

    // Клик по самой карточке.
    anchor.addEventListener('click', (e) => {
      // Клик по дочерней кнопке обрабатывается её собственным хендлером.
      if (e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
      // Если это был свайп — клик проглатываем.
      if (carousel.moved) return;

      if (idx !== carousel.activeIndex) {
        setActive(idx);
      } else if (carousel.isFlipped) {
        toggleFlip();
      } else if (carousel.onOpenGuide) {
        carousel.onOpenGuide(item);
      }
    });
  }

  function layout() {
    if (!carousel.stage) return;
    const items = carousel.items;
    const anchors = Array.from(carousel.stage.querySelectorAll('.xbox-case-anchor'));
    if (!items.length || !anchors.length) {
      updateNavState();
      return;
    }

    // Шаг карусели зависит от реальной ширины коробки (адаптивность).
    const caseWidth = anchors[0].offsetWidth || 230;
    const caseStep = Math.max(110, caseWidth * 0.79);

    // Гарантированный сброс переворота при смене активного диска.
    const activeItem = items[carousel.activeIndex];
    const activeId = activeItem ? String(activeItem.id || activeItem.title || carousel.activeIndex) : '';
    if (activeId !== X360.state.lastActiveCaseId) {
      X360.state.lastActiveCaseId = activeId;
      carousel.isFlipped = false;
      X360.state.isFlipped = false;
    }

    const total = items.length;

    anchors.forEach((anchor, idx) => {
      const t = computeTransform(idx, carousel.activeIndex, total, caseStep);
      const z = computeZIndex(t.distance, t.isActive);

      anchor.style.transform = `translate3d(${t.posX.toFixed(2)}px, 0, ${t.posZ.toFixed(1)}px) ` +
        `rotateY(${t.rotY.toFixed(2)}deg) scale(${t.scale.toFixed(3)})`;
      anchor.style.zIndex = String(z);
      anchor.classList.toggle('is-active', t.isActive);
      anchor.classList.toggle('flipped', t.isActive && carousel.isFlipped);
      anchor.classList.toggle('is-offscreen', t.distance > MAX_VISIBLE);
      // Очень дальние карточки уводим в невидимость, но оставляем в DOM.
      anchor.style.opacity = t.distance > MAX_VISIBLE + 1 ? '0' : '';
      anchor.setAttribute('aria-hidden', t.isActive ? 'false' : 'true');
    });

    /* Ленивый арт диска: подгружаем текущую карточку и её соседей,
       чтобы перелистывание не ждало загрузки из сети. */
    const activeIdx = carousel.activeIndex;
    [activeIdx - 1, activeIdx, activeIdx + 1].forEach((i) => {
      if (i < 0 || i >= total) return;
      applyDiscArt(anchors[i]);
    });

    // Физика вращения диска привязана к активной карточке.
    bindDiscPhysics(carousel.activeIndex);

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
      return;
    }
    carousel.pipsBox.style.display = 'flex';
    carousel.pipsBox.innerHTML = '';
    items.forEach((_, i) => {
      const pip = document.createElement('button');
      pip.type = 'button';
      pip.className = 'carousel-pip' + (i === carousel.activeIndex ? ' active' : '');
      pip.title = `Диск ${i + 1}`;
      pip.setAttribute('aria-label', `Перейти к диску ${i + 1}`);
      pip.addEventListener('click', () => setActive(i));
      carousel.pipsBox.appendChild(pip);
    });
  }

  /* ---------------------------------------------------------
     НАВИГАЦИЯ
     --------------------------------------------------------- */

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
      if (carousel.onSfx) carousel.onSfx('nav');
    }
    layout();
    if (changed && carousel.onActivate) {
      carousel.onActivate(carousel.items[next], next);
    }
  }

  /** Циклический шаг (как в оригинале: с первого — на последний). */
  function step(delta) {
    const count = carousel.items.length;
    if (!count) return;
    const next = ((carousel.activeIndex + delta) % count + count) % count;
    setActive(next);
  }

  /** Шаг с «залипанием» на краях — для физики свайпа. */
  function stepClamped(delta) {
    const count = carousel.items.length;
    if (!count) return;
    const next = carousel.activeIndex + delta;
    if (next < 0 || next > count - 1) {
      // Отскок: слегка подсвечиваем крайний элемент.
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

  /**
   * Переворот коробки.
   *
   * Переворот применяется ТОЛЬКО к активной карточке, и её класс
   * .flipped ставится явно — поэтому состояние не может «залипнуть»
   * (например, если layout() пересобрал карточки в другой момент).
   */
  function toggleFlip(force) {
    const count = carousel.items.length;
    if (!count) return;

    const next = typeof force === 'boolean'
      ? force
      : !carousel.isFlipped;

    carousel.isFlipped = next;
    X360.state.isFlipped = next;

    // Явно синхронизируем классы на всех карточках.
    const anchors = carousel.stage
      ? carousel.stage.querySelectorAll('.xbox-case-anchor')
      : [];
    anchors.forEach((anchor, idx) => {
      anchor.classList.toggle('flipped', idx === carousel.activeIndex && next);
    });

    if (carousel.onToggleFlip) carousel.onToggleFlip(next);
    layout();
  }

  /** Возвращает активную коробку обложкой (rotateY(0deg)). */
  function unflipped() {
    if (!carousel.isFlipped) return;
    toggleFlip(false);
  }

  /** Полный оборот коробки на 360° (двойное нажатие по активной). */
  function spinActive() {
    const anchor = carousel.stage
      ? carousel.stage.querySelector('.xbox-case-anchor.is-active')
      : null;
    if (!anchor) return;
    anchor.classList.remove('is-spinning');
    // Принудительный reflow, чтобы анимация перезапустилась.
    void anchor.offsetWidth;
    anchor.style.setProperty('--spin-from', anchor.style.transform || 'none');
    anchor.classList.add('is-spinning');
    setTimeout(() => anchor.classList.remove('is-spinning'), 950);
    if (carousel.onSfx) carousel.onSfx('flip');
  }

  /* ---------------------------------------------------------
     POINTER / DRAG — без конфликта с кликами
     --------------------------------------------------------- */

  function isInteractive(target) {
    return !!(target && target.closest && target.closest('button, a, input, select, textarea, label'));
  }

  function onPointerDown(e) {
    if (!carousel.stage) return;
    // Открытые панели блокируют карусель.
    if (document.body.classList.contains('blade-open')) return;
    if (typeof e.button === 'number' && e.button !== 0) return;
    // НЕ перехватываем указатель на дочерних кнопках —
    // иначе клики по «Y (РАЗВЕРНУТЬ)» и «A (ДОСЬЕ)» проглатываются.
    if (isInteractive(e.target)) return;

    carousel.pointerId = e.pointerId;
    carousel.startX = e.clientX;
    carousel.startY = e.clientY;
    carousel.lastX = e.clientX;
    carousel.lastT = e.timeStamp || performance.now();
    carousel.velocity = 0;
    carousel.dragging = true;
    carousel.moved = false;
    carousel.baseIndex = carousel.activeIndex;
  }

  function onPointerMove(e) {
    if (!carousel.dragging || e.pointerId !== carousel.pointerId) return;

    const dx = e.clientX - carousel.startX;
    const dy = e.clientY - carousel.startY;

    if (!carousel.moved) {
      // Порог 10px — ниже него жест ещё считается кликом.
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      // Вертикальный жест — отдаём его скроллу, карусель не трогаем.
      if (Math.abs(dy) > Math.abs(dx)) {
        carousel.dragging = false;
        return;
      }
      carousel.moved = true;
      carousel.stage.classList.add('is-dragging');
      // Захват указателя — только когда начался реальный драг.
      try { carousel.stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }

    const now = e.timeStamp || performance.now();
    const dt = Math.max(1, now - carousel.lastT);
    carousel.velocity = (e.clientX - carousel.lastX) / dt;
    carousel.lastX = e.clientX;
    carousel.lastT = now;

    e.preventDefault();
    applyDragOffset(dx);
  }

  /**
   * «Rubber band» — карточки смещаются вместе с пальцем, но с
   * сопротивлением у краёв списка.
   */
  function applyDragOffset(dx) {
    const anchors = carousel.stage
      ? Array.from(carousel.stage.querySelectorAll('.xbox-case-anchor'))
      : [];
    const count = carousel.items.length;
    if (!anchors.length || !count) return;

    const caseWidth = anchors[0].offsetWidth || 230;
    const step = Math.max(110, caseWidth * 0.79);
    const raw = -dx / step;

    // Сопротивление за пределами диапазона.
    let offset = raw;
    if (carousel.baseIndex === 0 && raw < 0) offset = raw * RUBBER_BAND;
    if (carousel.baseIndex === count - 1 && raw > 0) offset = raw * RUBBER_BAND;

    anchors.forEach((anchor, idx) => {
      const t = computeTransform(idx, carousel.baseIndex, count, step);
      if (t.isActive) {
        anchor.style.transform =
          `translate3d(${(t.posX + offset * step).toFixed(2)}px, 0, ${t.posZ.toFixed(1)}px) ` +
          `rotateY(${t.rotY.toFixed(2)}deg) scale(${t.scale.toFixed(3)})`;
      }
    });
  }

  function onPointerUp(e) {
    if (!carousel.dragging) return;
    if (carousel.pointerId !== null && e.pointerId !== carousel.pointerId) return;

    const wasMoved = carousel.moved;
    const velocity = carousel.velocity;
    const dx = e.clientX - carousel.startX;

    carousel.dragging = false;
    carousel.pointerId = null;
    if (carousel.stage) carousel.stage.classList.remove('is-dragging');

    if (!wasMoved) {
      // Это был обычный клик — ничего не делаем, клик сработает сам.
      carousel.moved = false;
      return;
    }

    // Гасим «залипающий» клик после свайпа.
    carousel.moved = true;
    setTimeout(() => { carousel.moved = false; }, 80);

    const count = carousel.items.length;
    if (count <= 1) {
      layout();
      return;
    }

    const flick = Math.abs(velocity) > SWIPE_VELOCITY;
    const threshold = flick ? 20 : Math.max(48, carousel.stage.clientWidth * 0.08);

    if (Math.abs(dx) > threshold) {
      const dir = dx < 0 ? 1 : -1;
      // Флик по краю списка — отскок вместо перехода.
      if (flick && ((dir === 1 && carousel.activeIndex >= count - 1) ||
        (dir === -1 && carousel.activeIndex <= 0))) {
        bounce();
        layout();
        return;
      }
      stepClamped(dir);
    } else {
      layout();
    }
  }

  function onPointerCancel() {
    carousel.dragging = false;
    carousel.pointerId = null;
    carousel.moved = false;
    if (carousel.stage) carousel.stage.classList.remove('is-dragging');
    layout();
  }

  /* ---------------------------------------------------------
     WHEEL
     --------------------------------------------------------- */
  let lastWheelAt = 0;

  function onWheel(e) {
    if (!X360.state.booted) return;
    if (document.body.classList.contains('blade-open')) return;
    if (e.target && e.target.closest && e.target.closest('.media-stations-list, .blade-panel')) return;

    const now = performance.now();
    if (now - lastWheelAt < 180) return;

    const count = carousel.items.length;
    if (count <= 1) return;

    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 24) return;

    lastWheelAt = now;
    stepClamped(delta > 0 ? 1 : -1);
  }

  /* ---------------------------------------------------------
     KEYBOARD
     --------------------------------------------------------- */
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

  /* ---------------------------------------------------------
     PUBLIC API
     --------------------------------------------------------- */
  X360.Carousel = {
    init(options) {
      const opts = options || {};
      carousel.stage = opts.stage;
      carousel.prevBtn = opts.prevBtn;
      carousel.nextBtn = opts.nextBtn;
      carousel.pipsBox = opts.pipsBox;
      carousel.onActivate = opts.onActivate || null;
      carousel.onOpenGuide = opts.onOpenGuide || null;
      carousel.onToggleFlip = opts.onToggleFlip || null;
      carousel.onSfx = opts.onSfx || null;

      // JS управляет вращением диска — отключаем CSS-фоллбэк.
      document.body.classList.add('js-disc-motion');

      if (carousel.stage) {
        carousel.stage.addEventListener('pointerdown', onPointerDown);
        carousel.stage.addEventListener('pointermove', onPointerMove, { passive: false });
        carousel.stage.addEventListener('pointerup', onPointerUp);
        carousel.stage.addEventListener('pointercancel', onPointerCancel);
        carousel.stage.addEventListener('pointerleave', onPointerCancel);
        // Блокируем перетаскивание картинок внутри карусели.
        carousel.stage.addEventListener('dragstart', (e) => e.preventDefault());
      }

      if (carousel.prevBtn) {
        carousel.prevBtn.addEventListener('click', () => step(-1));
      }
      if (carousel.nextBtn) {
        carousel.nextBtn.addEventListener('click', () => step(1));
      }

      global.addEventListener('wheel', onWheel, { passive: true });
      global.addEventListener('keydown', onKeyDown);
    },

    setItems(items) {
      const next = Array.isArray(items) ? items : [];
      const changed = signature(next) !== carousel.sig;
      carousel.items = next;
      if (!next.length) carousel.activeIndex = 0;
      else carousel.activeIndex = utils.clamp(carousel.activeIndex, 0, next.length - 1);

      if (changed || !carousel.stage.querySelector('.xbox-case-anchor')) {
        build();
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
    spinActive,
    stopDiscPhysics,
    getDiscState: () => ({
      angle: discPhysics.angle,
      velocity: discPhysics.velocity,
      running: discPhysics.running,
      target: discPhysics.target
    }),
    getActiveIndex: () => carousel.activeIndex,
    getActiveItem: () => carousel.items[carousel.activeIndex] || null,
    getItems: () => carousel.items,
    isFlipped: () => carousel.isFlipped,
    shortestOffset
  };
})(window);
