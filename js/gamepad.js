/* ============================================================
   XBOX 360 SYSTEM DASHBOARD · GAMEPAD API
   ---------------------------------------------------------
   Поддержка геймпада в режиме Couch / TV:
     • Левый стик и D-Pad — листание дисков и категорий
     • LB / RB — предыдущая / следующая категория
     • A — открыть досье, B — закрыть, X — музыка, Y — переворот
     • Start — открыть досье текущего диска
   Обрабатываются edge-триггеры (нажатие), а не удержание.
   ============================================================ */
(function (global) {
  'use strict';

  const X360 = global.X360 || (global.X360 = {});

  const BUTTON = {
    A: 0,
    B: 1,
    X: 2,
    Y: 3,
    LB: 4,
    RB: 5,
    LT: 6,
    RT: 7,
    BACK: 8,
    START: 9,
    L3: 10,
    R3: 11,
    DPAD_UP: 12,
    DPAD_DOWN: 13,
    DPAD_LEFT: 14,
    DPAD_RIGHT: 15
  };

  const gamepad = {
    handlers: {},
    prevButtons: Object.create(null),
    lastNavAt: 0,
    badgeTimer: null,
    connectedOnce: false,
    pollTimer: null,
    started: false
  };

  const NAV_COOLDOWN = 190;   // ms между шагами навигации
  const STICK_DEADZONE = 0.68;

  function el(id) {
    return document.getElementById(id);
  }

  function showBadge(text) {
    const badge = el('gamepadBadge');
    const badgeText = el('gamepadBadgeText');
    if (!badge) return;
    if (badgeText) badgeText.textContent = text;
    badge.classList.add('show');
    clearTimeout(gamepad.badgeTimer);
    gamepad.badgeTimer = setTimeout(() => badge.classList.remove('show'), 4200);
  }

  function isPressed(pad, index) {
    const btn = pad.buttons && pad.buttons[index];
    return !!(btn && (btn.pressed || btn.value > 0.55));
  }

  function readPad() {
    if (!navigator.getGamepads) return null;
    let pads;
    try {
      pads = navigator.getGamepads();
    } catch (err) {
      return null;
    }
    if (!pads) return null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) return pads[i];
    }
    return null;
  }

  function fire(name, payload) {
    const fn = gamepad.handlers[name];
    if (typeof fn === 'function') {
      try {
        fn(payload);
      } catch (err) {
        console.warn('[X360.Gamepad] Ошибка обработчика ' + name + ':', err);
      }
    }
  }

  function poll() {
    const pad = readPad();
    if (!pad) return;

    if (!gamepad.connectedOnce) {
      gamepad.connectedOnce = true;
      showBadge('GAMEPAD: ' + String(pad.id || 'CONNECTED').slice(0, 26).toUpperCase());
    }

    const key = String(pad.index);
    const before = gamepad.prevButtons[key] || [];
    const edges = [];
    const snapshot = [];
    const count = (pad.buttons && pad.buttons.length) || 0;

    for (let i = 0; i < count; i++) {
      const down = isPressed(pad, i);
      snapshot[i] = down;
      if (down && !before[i]) edges.push(i);
    }
    gamepad.prevButtons[key] = snapshot;

    // На заставке любая кнопка = START (сценарий: сборка сферы → вход).
    if (!X360.state.booted) {
      if (edges.length) fire('start');
      return;
    }
    if (!document.body.classList.contains('dashboard-active')) return;

    const guideOpen = document.body.classList.contains('guide-open');
    const mediaOpen = document.body.classList.contains('media-open');
    const overlayOpen = guideOpen || mediaOpen;

    // A — досье / переход по ссылке покупки.
    if (edges.includes(BUTTON.A)) {
      if (guideOpen) {
        fire('confirm');
      } else if (!overlayOpen) {
        fire('openGuide');
      }
    }

    // B — закрыть панель / вернуть обложку.
    if (edges.includes(BUTTON.B)) {
      if (guideOpen || mediaOpen) {
        fire('close');
      } else {
        fire('back');
      }
    }

    // X — саундтрек, Y — переворот коробки.
    if (edges.includes(BUTTON.X)) fire('media');
    if (edges.includes(BUTTON.Y)) fire('flip');

    // START — досье текущего диска.
    if (edges.includes(BUTTON.START) && !overlayOpen) fire('openGuide');

    // LB / RB — категории-лезвия.
    if (edges.includes(BUTTON.LB)) fire('prevCategory');
    if (edges.includes(BUTTON.RB)) fire('nextCategory');

    // Стик / D-Pad: влево-вправо — диски, вверх-вниз — категории.
    const now = performance.now();
    if (!overlayOpen && now - gamepad.lastNavAt > NAV_COOLDOWN) {
      const ax = (pad.axes && pad.axes[0]) || 0;
      const ay = (pad.axes && pad.axes[1]) || 0;

      if (isPressed(pad, BUTTON.DPAD_LEFT) || ax < -STICK_DEADZONE) {
        fire('prevItem');
        gamepad.lastNavAt = now;
      } else if (isPressed(pad, BUTTON.DPAD_RIGHT) || ax > STICK_DEADZONE) {
        fire('nextItem');
        gamepad.lastNavAt = now;
      } else if (isPressed(pad, BUTTON.DPAD_UP) || ay < -STICK_DEADZONE) {
        fire('prevCategory');
        gamepad.lastNavAt = now;
      } else if (isPressed(pad, BUTTON.DPAD_DOWN) || ay > STICK_DEADZONE) {
        fire('nextCategory');
        gamepad.lastNavAt = now;
      }
    }
  }

  X360.Gamepad = {
    init(handlers) {
      gamepad.handlers = handlers || {};

      global.addEventListener('gamepadconnected', (e) => {
        gamepad.connectedOnce = true;
        const id = e.gamepad && e.gamepad.id ? e.gamepad.id : 'CONNECTED';
        showBadge('GAMEPAD: ' + String(id).slice(0, 26).toUpperCase());
      });

      global.addEventListener('gamepaddisconnected', () => {
        gamepad.connectedOnce = false;
        const badge = el('gamepadBadge');
        if (badge) badge.classList.remove('show');
      });

      // Опрос запускаем после первого жеста — иначе браузер
      // возвращает пустой массив геймпадов.
      const start = () => {
        if (gamepad.started) return;
        gamepad.started = true;
        gamepad.pollTimer = setInterval(poll, 80);
      };
      global.addEventListener('pointerdown', start, { once: true });
      global.addEventListener('keydown', start, { once: true });
      global.addEventListener('gamepadconnected', start, { once: true });
    },

    stop() {
      if (gamepad.pollTimer) clearInterval(gamepad.pollTimer);
      gamepad.pollTimer = null;
      gamepad.started = false;
    }
  };
})(window);
