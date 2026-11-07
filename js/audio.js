/* ============================================================
   XBOX 360 SYSTEM DASHBOARD · AUDIO ENGINE
   ---------------------------------------------------------
   Web Audio API:
     • Nexus Orb startup (суб-бас, колокольчики, шум, ревер)
     • Шум вентилятора консоли (кулер + привод)
     • Щелчок пластика (переворот коробки)
     • Свист Blades (переключение лезвий)
     • Achievement Unlocked
   Безопасно работает при Autoplay Policy: AudioContext создаётся
   только после первого жеста пользователя, ошибки не попадают
   в консоль браузера.
   ============================================================ */
(function (global) {
  'use strict';

  const X360 = global.X360 || (global.X360 = {});
  const utils = X360.utils;

  const audio = {
    ctx: null,
    master: null,
    sfxBus: null,
    musicBus: null,
    analyser: null,
    unlocked: false,
    fanNodes: null,
    fanGain: null,
    sfxEnabled: true,
    fanEnabled: true,
    lastPlayAt: 0
  };

  /* ---------------------------------------------------------
     CONTEXT LIFECYCLE
     --------------------------------------------------------- */

  /**
   * Создаёт AudioContext. Никогда не бросает исключений наружу —
   * любые проблемы (отсутствие API, политика автозапуска)
   * тихо деградируют в «звук выключен».
   */
  function createContext() {
    if (audio.ctx) return audio.ctx;

    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) {
      console.warn('[X360.Audio] Web Audio API недоступен в этом браузере.');
      return null;
    }

    try {
      audio.ctx = new Ctor();
    } catch (err) {
      console.warn('[X360.Audio] Не удалось создать AudioContext:', err && err.message);
      audio.ctx = null;
      return null;
    }

    // Мастер-шина: всё звуковое проходит через неё.
    audio.master = audio.ctx.createGain();
    audio.master.gain.value = 0.9;
    audio.master.connect(audio.ctx.destination);

    // Шина эффектов (SFX) — ею управляет тумблер SFX.
    audio.sfxBus = audio.ctx.createGain();
    audio.sfxBus.gain.value = audio.sfxEnabled ? 1 : 0;
    audio.sfxBus.connect(audio.master);

    // Шина музыки — ею управляет слайдер громкости.
    audio.musicBus = audio.ctx.createGain();
    const savedVol = X360.prefs ? Number(X360.prefs.musicVolume) : 0.55;
    audio.musicBus.gain.value = Number.isFinite(savedVol) ? Math.min(1, Math.max(0, savedVol)) : 0.55;
    audio.musicBus.connect(audio.master);

    // Анализатор для визуализатора.
    audio.analyser = audio.ctx.createAnalyser();
    audio.analyser.fftSize = 64;
    audio.analyser.smoothingTimeConstant = 0.75;
    audio.analyser.connect(audio.master);

    // Начальное состояние может быть 'suspended' — пробуем разбудить.
    if (audio.ctx.state === 'suspended') {
      const p = audio.ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => { /* тихо */ });
    }

    return audio.ctx;
  }

  /**
   * Возобновляет контекст. Вызывается на каждом пользовательском
   * взаимодействии — безопасно, если контекст ещё не создан.
   */
  function unlock() {
    // Контекст создаётся только после жеста — иначе Chrome выдаёт
    // предупреждение об autoplay-политике в консоли.
    const ctx = createContext();
    if (!ctx) return false;

    if (ctx.state === 'suspended') {
      try {
        const p = ctx.resume();
        if (p && typeof p.then === 'function') {
          p.then(() => { audio.unlocked = true; }).catch(() => { audio.unlocked = ctx.state === 'running'; });
        }
      } catch (err) {
        /* resume() бросает только в экзотических случаях */
      }
    } else {
      audio.unlocked = true;
    }
    return audio.unlocked;
  }

  function isRunning() {
    return !!(audio.ctx && audio.ctx.state === 'running');
  }

  /**
   * Безопасный запуск: если звук запрещён политикой браузера —
   * тихо выходим, без ошибок в консоли.
   */
  function guard(fn) {
    return function () {
      try {
        if (!audio.sfxEnabled) return;
        const ctx = audio.ctx || createContext();
        if (!ctx) return;
        if (ctx.state === 'suspended') {
          const p = ctx.resume();
          if (p && typeof p.catch === 'function') p.catch(() => { /* ignore */ });
          // Если контекст ещё не проснулся — отложим звук до resume().
          if (ctx.state !== 'running') {
            if (p && typeof p.then === 'function') {
              p.then(() => {
                try { fn.call(null, ctx); } catch (err) { /* ignore */ }
              }).catch(() => { /* ignore */ });
            }
            return;
          }
        }
        fn.call(null, ctx);
      } catch (err) {
        /* Никогда не выбрасываем ошибки аудио наружу */
      }
    };
  }

  /* ---------------------------------------------------------
     NEXUS ORB STARTUP SOUND
     --------------------------------------------------------- */

  /** Импульсный отклик «зала» для кристального нексуса. */
  function createBootReverb(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const impulse = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return impulse;
  }

  const playStartup = guard(function (ctx) {
    const t = ctx.currentTime;

    // Компрессор + «зальный» ревер.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15;
    comp.knee.value = 22;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.32;

    const bus = ctx.createGain();
    bus.gain.value = 0.7;

    const dry = ctx.createGain();
    dry.gain.value = 0.88;

    const convolver = ctx.createConvolver();
    convolver.buffer = createBootReverb(ctx, 2.8, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.3;

    bus.connect(dry);
    dry.connect(comp);
    bus.connect(convolver);
    convolver.connect(wet);
    wet.connect(comp);
    comp.connect(audio.sfxBus);

    // 1. Кинематографичный sub-bass sweep (48 → 110 → 73 Hz).
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    const subFilter = ctx.createBiquadFilter();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(48, t);
    sub.frequency.exponentialRampToValueAtTime(110, t + 1.55);
    sub.frequency.exponentialRampToValueAtTime(73.42, t + 2.9);
    subFilter.type = 'lowpass';
    subFilter.frequency.setValueAtTime(220, t);
    subFilter.Q.value = 1.2;
    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.exponentialRampToValueAtTime(0.34, t + 0.18);
    subGain.gain.exponentialRampToValueAtTime(0.16, t + 1.5);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 3.1);
    sub.connect(subFilter);
    subFilter.connect(subGain);
    subGain.connect(bus);
    sub.start(t);
    sub.stop(t + 3.15);

    // 2. Кристаллический аккорд D-мажорной пентатоники.
    const bells = [587.33, 739.99, 880.0, 1174.66, 1479.98, 1760.0];
    bells.forEach((freq, idx) => {
      const start = t + 0.72 + idx * 0.075;
      const dur = 2.35 - idx * 0.1;

      const osc = ctx.createOscillator();
      const shimmer = ctx.createOscillator();
      const shimmerGain = ctx.createGain();
      const gain = ctx.createGain();
      const hp = ctx.createBiquadFilter();

      osc.type = idx % 2 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, start);
      osc.detune.setValueAtTime(idx % 2 ? 3 : -3, start);

      shimmer.type = 'sine';
      shimmer.frequency.setValueAtTime(freq * 2.01, start);
      shimmerGain.gain.value = 0.16;

      hp.type = 'highpass';
      hp.frequency.value = 220;

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.11 / (1 + idx * 0.14), start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      osc.connect(gain);
      shimmer.connect(shimmerGain);
      shimmerGain.connect(gain);
      gain.connect(hp);
      hp.connect(bus);

      osc.start(start);
      shimmer.start(start);
      osc.stop(start + dur + 0.05);
      shimmer.stop(start + dur + 0.05);
    });

    // 3. Воздушный shimmer — «включение» сферы Nexus.
    const noiseLen = Math.floor(ctx.sampleRate * 2.4);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / noiseLen, 2);
    const noise = ctx.createBufferSource();
    const noiseFilter = ctx.createBiquadFilter();
    const noiseGain = ctx.createGain();
    noise.buffer = noiseBuf;
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.setValueAtTime(4200, t);
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.045, t + 0.55);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(t);
    noise.stop(t + 2.35);
  });

  /* ---------------------------------------------------------
     CONSOLE FAN HUM (кулер + привод)
     --------------------------------------------------------- */

  function startFanHum() {
    const ctx = audio.ctx || createContext();
    if (!ctx) return;
    if (audio.fanNodes) return;

    try {
      const bufferSize = Math.floor(ctx.sampleRate * 2);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      // Низкочастотный «гул» + лёгкий призвук привода.
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, ctx.currentTime);
      filter.Q.value = 0.6;

      const body = ctx.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.setValueAtTime(320, ctx.currentTime);
      body.gain.setValueAtTime(6, ctx.currentTime);
      body.Q.value = 1.4;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(audio.fanEnabled ? 0.07 : 0, ctx.currentTime);

      source.connect(filter);
      filter.connect(body);
      body.connect(gain);
      gain.connect(audio.master);
      source.start();

      audio.fanNodes = { source, filter, body };
      audio.fanGain = gain;
    } catch (err) {
      /* ignore */
    }
  }

  function setFanHum(enabled) {
    audio.fanEnabled = !!enabled;
    if (audio.fanGain && audio.ctx) {
      try {
        audio.fanGain.gain.linearRampToValueAtTime(
          audio.fanEnabled ? 0.07 : 0,
          audio.ctx.currentTime + 0.3
        );
      } catch (err) {
        /* ignore */
      }
    }
    if (audio.fanEnabled) startFanHum();
  }

  function stopFanHum() {
    if (!audio.fanNodes) return;
    try {
      audio.fanNodes.source.stop();
      audio.fanNodes.source.disconnect();
    } catch (err) {
      /* ignore */
    }
    audio.fanNodes = null;
    audio.fanGain = null;
  }

  /* ---------------------------------------------------------
     SFX
     --------------------------------------------------------- */

  /** Свист лезвий Blades. */
  const playBladeSwoosh = guard(function (ctx) {
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.18);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const out = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) out[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(1800, t + 0.09);
    filter.frequency.exponentialRampToValueAtTime(300, t + 0.18);
    filter.Q.value = 3.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(audio.sfxBus);
    src.start(t);
    src.stop(t + 0.18);
  });

  /** Щелчок пластика (переворот коробки). */
  const playPlasticClick = guard(function (ctx) {
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 2400;
    noiseFilter.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.16, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.14);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(gain);
    gain.connect(audio.sfxBus);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audio.sfxBus);

    osc.start(t);
    osc.stop(t + 0.15);
    noise.start(t);
    noise.stop(t + 0.06);
  });

  /** Achievement Unlocked. */
  const playAchievement = guard(function (ctx) {
    const t = ctx.currentTime;
    const tones = [1396.91, 2093.0, 2637.02];

    tones.forEach((freq, i) => {
      const at = t + i * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, at);

      gain.gain.setValueAtTime(0.001, at);
      gain.gain.linearRampToValueAtTime(0.24, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.2);

      osc.connect(gain);
      gain.connect(audio.sfxBus);
      osc.start(at);
      osc.stop(at + 1.2);
    });
  });

  /** Мягкий «клик» навигации (категория/диск). */
  const playNavTick = guard(function (ctx) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(1320, t + 0.05);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(gain);
    gain.connect(audio.sfxBus);
    osc.start(t);
    osc.stop(t + 0.07);
  });

  /* ---------------------------------------------------------
     ТОЧКИ ПОДКЛЮЧЕНИЯ (глобальные обработчики)
     --------------------------------------------------------- */
  function bindUnlockHandlers() {
    const opts = { passive: true };
    global.addEventListener('pointerdown', unlock, opts);
    global.addEventListener('touchstart', unlock, opts);
    global.addEventListener('keydown', unlock);
    global.addEventListener('mousedown', unlock, opts);
    global.addEventListener('wheel', unlock, opts);
    // Возвращаем звук после переключения вкладки.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) unlock();
    });
  }

  /* ---------------------------------------------------------
     ПУБЛИЧНОЕ API
     --------------------------------------------------------- */
  X360.Audio = {
    init() {
      // Контекст намеренно НЕ создаётся здесь: до первого жеста браузер
      // пишет warning "AudioContext was not allowed to start".
      // Создание отложено до unlock() — консоль браузера остаётся чистой.
      bindUnlockHandlers();
    },
    unlock,
    isRunning,
    getContext: () => audio.ctx,
    getAnalyser: () => audio.analyser,
    getMusicBus: () => audio.musicBus,
    getMaster: () => audio.master,

    setSfx(enabled) {
      audio.sfxEnabled = !!enabled;
      if (audio.sfxBus && audio.ctx) {
        try {
          audio.sfxBus.gain.setTargetAtTime(audio.sfxEnabled ? 1 : 0, audio.ctx.currentTime, 0.03);
        } catch (err) {
          /* ignore */
        }
      }
      return audio.sfxEnabled;
    },
    isSfxEnabled: () => audio.sfxEnabled,

    setFanHum,
    startFanHum,
    stopFanHum,
    isFanHumEnabled: () => audio.fanEnabled,

    playStartup,
    playBladeSwoosh,
    playPlasticClick,
    playAchievement,
    playNavTick
  };
})(window);
