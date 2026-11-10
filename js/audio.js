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
    fanPending: false,
    sfxEnabled: true,
    fanEnabled: true,
    pendingSfx: [],
    readyCbs: [],
    bound: false,
    lastPlayAt: 0
  };

  /* ---------------------------------------------------------
     CONTEXT LIFECYCLE
     --------------------------------------------------------- */

  /**
   * Создаёт AudioContext. Никогда не бросает исключений наружу —
   * любые проблемы (отсутствие API, политика автозапуска)
   * тихо деградируют в «звук выключен».
   *
   * ВАЖНО: вызывается ТОЛЬКО из unlock(), то есть из обработчика
   * пользовательского жеста. Создание контекста без жеста —
   * ровно та причина, по которой Chrome писал
   * «The AudioContext was not allowed to start…».
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

    return audio.ctx;
  }

  /* ---------------------------------------------------------
     ФОНОВАЯ МУЗЫКА — НАПРЯМУЮ В ДИНАМИКИ (без Web Audio)
     ---------------------------------------------------------
     Музыка принципиально НЕ проходит через Web Audio API.
     createMediaElementSource() у кросс-доменного файла без
     Access-Control-Allow-Origin (файлы GitHub Release:
     github.com -> 302 -> objects.githubusercontent.com) НЕ
     бросает исключение, а МОЛЧА заглушает поток: таймер идёт,
     статус «ИГРАЕТ», а в колонках — тишина. Обойти это нельзя,
     единственный путь — не брать музыку в граф.

     Поэтому обычный <audio> играет сам, прямо в систему:
       • element.muted  = false
       • element.volume = значение ползунка громкости
       • crossOrigin    НЕ выставляется (иначе запрос уходит
         в CORS-режиме, GitHub не отдаёт ACAO — снова тишина)
     Web Audio остаётся только для SFX: щелчки, свист лезвий,
     гул вентилятора, звук Orb.
     --------------------------------------------------------- */

  const music = {
    el: null,       // нативный <audio> с фоновой музыкой
    phase: 0        // фаза псевдоспектра (для визуализатора)
  };

  function clamp01(value) {
    const n = Number(value);
    if (!isFinite(n)) return 0;
    return n < 0 ? 0 : (n > 1 ? 1 : n);
  }

  /** Сохранённая громкость музыки (из настроек дашборда). */
  function savedMusicVolume() {
    const v = X360.prefs ? Number(X360.prefs.musicVolume) : 0.55;
    return isFinite(v) ? clamp01(v) : 0.55;
  }

  /**
   * Регистрирует нативный <audio> как источник фоновой музыки.
   * Вызывается плеером сразу после создания элемента.
   * Гарантирует: muted = false, громкость из настроек,
   * отсутствие атрибута crossorigin.
   */
  function attachMusicElement(el) {
    if (!el) return null;
    music.el = el;
    try {
      // CORS-режим выключен: без атрибута crossorigin обычный
      // <audio> спокойно играет кросс-доменный файл как есть.
      if (el.hasAttribute && el.hasAttribute('crossorigin')) {
        el.removeAttribute('crossorigin');
      }
      el.muted = false;
      el.volume = savedMusicVolume();
    } catch (err) { /* ignore */ }
    return el;
  }

  /** Громкость музыки: и нативный элемент, и шина синтезатора. */
  function setMusicVolume(value) {
    const v = clamp01(value);
    if (X360.prefs) X360.prefs.musicVolume = v;
    if (music.el) {
      try {
        music.el.muted = false;
        music.el.volume = v;
      } catch (err) { /* ignore */ }
    }
    // Синтезатор-заглушка (когда плейлист пуст) идёт через musicBus.
    if (audio.ctx && audio.musicBus) {
      try {
        audio.musicBus.gain.setTargetAtTime(v, audio.ctx.currentTime, 0.04);
      } catch (err) { /* ignore */ }
    }
    return v;
  }

  /** Идёт ли музыка прямо сейчас (элемент не на паузе и не закончен). */
  function isMusicPlaying() {
    const el = music.el;
    return !!(el && !el.paused && !el.ended);
  }

  /**
   * Псевдоспектр 0..1 для визуализатора.
   * Настоящий анализатор невозможен: музыка идёт мимо Web Audio.
   * Рисуем правдоподобные «прыгающие» полоски — сумма синусов
   * плюс шум, темп — примерно как у трека. На паузе отдаём нули:
   * полоски замирают на минимуме.
   */
  function getMusicSpectrum(count, out) {
    const n = Math.max(1, count | 0);
    const arr = (out && out.length >= n) ? out : new Array(n);
    if (!isMusicPlaying()) {
      for (let i = 0; i < n; i++) arr[i] = 0;
      return arr;
    }
    const el = music.el;
    const t = el.currentTime || 0;
    music.phase += 0.045;
    for (let i = 0; i < n; i++) {
      const x = t * 5.6 + i * 0.62 + music.phase;
      const v = 0.45 + 0.32 * Math.sin(x) + 0.22 * Math.sin(x * 2.17 + 1.1);
      arr[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
    }
    return arr;
  }

  /**
   * Отложенные эффекты: звук, запрошенный ДО жеста, не теряется —
   * он проигрывается сразу после разблокировки контекста.
   * Одинаковые ключи перезаписываются (не наслаиваются).
   */
  function queuePending(key, fn) {
    for (let i = 0; i < audio.pendingSfx.length; i++) {
      if (audio.pendingSfx[i].key === key) {
        audio.pendingSfx[i].fn = fn;
        return;
      }
    }
    if (audio.pendingSfx.length > 3) audio.pendingSfx.shift();
    audio.pendingSfx.push({ key: key, fn: fn });
  }

  function flushPending() {
    if (!audio.pendingSfx.length) return;
    const ctx = audio.ctx;
    if (!ctx || ctx.state !== 'running') return;

    const list = audio.pendingSfx.slice();
    audio.pendingSfx.length = 0;
    list.forEach((entry) => {
      try { entry.fn.call(null, ctx); } catch (err) { /* ignore */ }
    });
  }

  function notifyReady() {
    if (!audio.readyCbs.length) return;
    const cbs = audio.readyCbs.slice();
    audio.readyCbs.length = 0;
    cbs.forEach((cb) => {
      try { cb(); } catch (err) { /* ignore */ }
    });
  }

  /**
   * Возобновляет контекст. Вызывается на первом пользовательском
   * взаимодействии — безопасно, если контекст ещё не создан.
   */
  function unlock() {
    // Уже разблокировано — просто доигрываем отложенное.
    if (audio.ctx && audio.ctx.state === 'running') {
      audio.unlocked = true;
      flushPending();
      notifyReady();
      return true;
    }

    // Контекст создаётся только здесь — из жеста пользователя.
    const ctx = createContext();
    if (!ctx) {
      // Не получилось — пробуем снова при следующем жесте.
      armUnlockListeners();
      return false;
    }

    const onRunning = () => {
      audio.unlocked = true;
      if (audio.fanPending && audio.fanEnabled) {
        audio.fanPending = false;
        startFanHum();
      }
      flushPending();
      notifyReady();
    };

    if (ctx.state === 'suspended') {
      try {
        const p = ctx.resume();
        if (p && typeof p.then === 'function') {
          p.then(onRunning).catch(() => {
            // Политика всё ещё не пускает — пробуем при следующем жесте.
            audio.unlocked = ctx.state === 'running';
            armUnlockListeners();
          });
        } else {
          onRunning();
        }
      } catch (err) {
        /* resume() бросает только в экзотических случаях */
        armUnlockListeners();
      }
    } else {
      onRunning();
    }
    return audio.unlocked;
  }

  function isRunning() {
    return !!(audio.ctx && audio.ctx.state === 'running');
  }

  /**
   * Безопасный запуск: если звук запрещён политикой браузера —
   * тихо выходим, без ошибок в консоли.
   *
   * Ключевое отличие от старой версии: guard() НИКОГДА не создаёт
   * AudioContext. Если контекста ещё нет — эффект откладывается
   * до первого жеста (queuePending). Это убирает предупреждение
   * «The AudioContext was not allowed to start…».
   */
  function guard(key, fn) {
    return function () {
      // Аргументы пробрасываем внутрь эффекта (например, open=true/false).
      const args = Array.prototype.slice.call(arguments);
      try {
        if (!audio.sfxEnabled) return;
        const ctx = audio.ctx;
        if (!ctx) {
          // Жеста ещё не было — откладываем эффект.
          queuePending(key || 'sfx', fn);
          return;
        }
        if (ctx.state !== 'running') {
          const p = ctx.resume();
          if (p && typeof p.then === 'function') {
            p.then(() => {
              try { fn.apply(null, [ctx].concat(args)); } catch (err) { /* ignore */ }
            }).catch(() => { /* ignore */ });
          }
          return;
        }
        fn.apply(null, [ctx].concat(args));
      } catch (err) {
        /* Никогда не выбрасываем ошибки аудио наружу */
      }
    };
  }

  /* ---------------------------------------------------------
     ЗВУК ПРИВОДА DVD (лоток выезжает / заезжает)
     --------------------------------------------------------- */

  /**
   * Механика реального Xbox 360: серво привода, шуршание дорожки
   * и глухой щелчок защёлкивания.
   * @param {boolean} open — true: лоток выезжает, false: заезжает.
   */
  const playDrive = guard('drive', function (ctx, open) {
    const t = ctx.currentTime;
    const out = open ? 1 : 0.55;   // задвигание — короче и тише

    // 1) Серво: пила осаживается вниз.
    const servo = ctx.createOscillator();
    const servoGain = ctx.createGain();
    const servoLp = ctx.createBiquadFilter();
    servo.type = 'sawtooth';
    servo.frequency.setValueAtTime(open ? 215 : 150, t);
    servo.frequency.exponentialRampToValueAtTime(open ? 74 : 58, t + 0.42);
    servoGain.gain.setValueAtTime(0.0001, t);
    servoGain.gain.exponentialRampToValueAtTime(0.032 * out, t + 0.05);
    servoGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    servoLp.type = 'lowpass';
    servoLp.frequency.value = 880;
    servo.connect(servoGain);
    servoGain.connect(servoLp);
    servoLp.connect(audio.sfxBus);
    servo.start(t);
    servo.stop(t + 0.55);

    // 2) Шуршание дорожки лотка.
    const len = Math.floor(ctx.sampleRate * 0.65);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.55;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1100;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.05 * out, t + 0.07);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.52);
    noise.connect(hp);
    hp.connect(ng);
    ng.connect(audio.sfxBus);
    noise.start(t);
    noise.stop(t + 0.6);

    // 3) Защёлкивание: глухой «тук» в конце хода.
    const at = t + (open ? 0.46 : 0.3);
    const click = ctx.createOscillator();
    const clickGain = ctx.createGain();
    click.type = 'square';
    click.frequency.setValueAtTime(190, at);
    click.frequency.exponentialRampToValueAtTime(68, at + 0.07);
    clickGain.gain.setValueAtTime(0.0001, at);
    clickGain.gain.exponentialRampToValueAtTime(0.085 * out, at + 0.007);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    click.connect(clickGain);
    clickGain.connect(audio.sfxBus);
    click.start(at);
    click.stop(at + 0.18);
  });

  /* ---------------------------------------------------------
     ЗВУК ЗАПУСКА XBOX 360
     --------------------------------------------------------- */

  /** Разгон винчестера при включении консоли. */
  const playSpinUp = guard('spinup', function (ctx) {
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.7;

    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(240, t);
    bp.frequency.exponentialRampToValueAtTime(1250, t + 1.1);
    bp.Q.value = 1.6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.055, t + 0.6);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(audio.sfxBus);
    noise.start(t);
    noise.stop(t + 1.5);

    // Низкий «гул» раскачивающегося привода.
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(34, t);
    sub.frequency.exponentialRampToValueAtTime(78, t + 1.15);
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.exponentialRampToValueAtTime(0.16, t + 0.4);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    sub.connect(sg);
    sg.connect(audio.sfxBus);
    sub.start(t);
    sub.stop(t + 1.7);
  });

  /** Звонок Xbox 360: стеклянное арпеджио вверх + суб-свип. */
  const playStartupChime = guard('chime', function (ctx) {
    const t = ctx.currentTime;

    // Суб-свип «включения».
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(41, t);
    sub.frequency.exponentialRampToValueAtTime(76, t + 1.05);
    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.exponentialRampToValueAtTime(0.2, t + 0.3);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    sub.connect(subGain);
    subGain.connect(audio.sfxBus);
    sub.start(t);
    sub.stop(t + 1.8);

    // Стеклянное арпеджио вверх — четыре ноты.
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const at = t + 0.16 + i * 0.15;
      const osc = ctx.createOscillator();
      const shimmer = ctx.createOscillator();
      const shimmerGain = ctx.createGain();
      const gain = ctx.createGain();
      const hp = ctx.createBiquadFilter();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, at);
      shimmer.type = 'sine';
      shimmer.frequency.setValueAtTime(freq * 2.004, at);
      shimmerGain.gain.value = 0.2;
      hp.type = 'highpass';
      hp.frequency.value = 360;

      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.15, at + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);

      osc.connect(gain);
      shimmer.connect(shimmerGain);
      shimmerGain.connect(gain);
      gain.connect(hp);
      hp.connect(audio.sfxBus);

      osc.start(at);
      osc.stop(at + 1.7);
      shimmer.start(at);
      shimmer.stop(at + 1.7);
    });
  });

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

  const playStartup = guard('startup', function (ctx) {
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
    const ctx = audio.ctx;
    if (!ctx) {
      // Контекста ещё нет (жеста не было) — гул запустится автоматически
      // сразу после разблокировки. Никаких createContext() вне жеста!
      audio.fanPending = true;
      return;
    }
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
  const playBladeSwoosh = guard('swoosh', function (ctx) {
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
  const playPlasticClick = guard('click', function (ctx) {
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
  const playAchievement = guard('achieve', function (ctx) {
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
  const playNavTick = guard('tick', function (ctx) {
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
     ---------------------------------------------------------
     Ленивая разблокировка: обработчики одноразовые ({ once: true }).
     До первого жеста AudioContext НЕ существует — значит браузеру
     нечего ругаться в консоли.
     --------------------------------------------------------- */
  function armUnlockListeners() {
    const passiveOnce = { passive: true, once: true };
    document.addEventListener('pointerdown', unlock, passiveOnce);
    document.addEventListener('touchstart', unlock, passiveOnce);
    document.addEventListener('mousedown', unlock, passiveOnce);
    document.addEventListener('keydown', unlock, { once: true });
  }

  function bindUnlockHandlers() {
    if (audio.bound) return;
    audio.bound = true;
    armUnlockListeners();

    // Возвращаем звук после переключения вкладки (контекст уже создан).
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && audio.ctx) unlock();
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
    isUnlocked: () => audio.unlocked,

    /**
     * Подписка на момент разблокировки звука.
     * Используется плеером: музыка стартует после первого жеста.
     */
    onReady(cb) {
      if (typeof cb !== 'function') return;
      if (audio.unlocked && isRunning()) {
        try { cb(); } catch (err) { /* ignore */ }
        return;
      }
      audio.readyCbs.push(cb);
    },

    getContext: () => audio.ctx,
    getAnalyser: () => audio.analyser,
    getMusicBus: () => audio.musicBus,
    getMaster: () => audio.master,

    /* --- Фоновая музыка: нативно, без Web Audio-графа --- */
    attachMusicElement,
    getMusicElement: () => music.el,
    setMusicVolume,
    getMusicVolume: () => (music.el ? music.el.volume : savedMusicVolume()),
    isMusicPlaying,
    getMusicSpectrum,

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
    playSpinUp,
    playStartupChime,
    playDrive,
    playBladeSwoosh,
    playPlasticClick,
    playAchievement,
    playNavTick
  };
})(window);
