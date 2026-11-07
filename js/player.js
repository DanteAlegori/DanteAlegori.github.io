/* ============================================================
   XBOX 360 SYSTEM DASHBOARD · MUSIC PLAYER (BRADYYCARDIA)
   ---------------------------------------------------------
   • Воспроизведение треков из локальной папки music/
   • File System Access API (выбор папки) + fallback <input webkitdirectory>
   • Сохранение выбранной папки в IndexedDB
   • Shuffle-очередь
   • Fallback-синтезатор (Web Audio) если папка пуста
   • Визуализатор спектра
   ============================================================ */
(function (global) {
  'use strict';

  const X360 = global.X360 || (global.X360 = {});
  const utils = X360.utils;

  /* ---------------------------------------------------------
     СОСТОЯНИЕ
     --------------------------------------------------------- */
  const player = {
    tracks: [],
    order: [],
    orderPos: -1,
    current: null,
    audioEl: null,
    sourceNode: null,
    gainNode: null,
    graphReady: false,
    errorStreak: 0,
    isPlaying: false,
    volume: 0.55,
    synthTimer: null,
    synthStep: 0,
    synthNextTime: 0,
    synthDelay: null,
    synthFeedback: null,
    synthWet: null,
    synthNoise: null,
    onStateChange: null,
    visualFrame: 0,
    accent: '#52b043',
    toxic: '#7cfc00'
  };

  /* ---------------------------------------------------------
     СИНТЕЗАТОР (fallback, если папка music/ пуста)
     --------------------------------------------------------- */
  const STATION = {
    id: 'bradyycardia',
    station: 'BRADYYCARDIA',
    title: 'MUSIC FROM THE FOLDER',
    artist: 'BRADYYCARDIA // SHUFFLE',
    bpm: 112,
    rootFreq: 73.42,
    lead: [0, null, 7, null, 3, 5, 7, null, 10, 7, 5, 3, 2, 0, null, null],
    bass: [0, null, null, 0, null, null, 5, null, 3, null, null, 3, null, null, 7, null],
    chords: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [7, 10, 14]],
    kick: [0, 4, 8, 12],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    leadWave: 'triangle',
    padGain: 0.055,
    leadGain: 0.1,
    bassGain: 0.2,
    hatGain: 0.045
  };

  /* ---------------------------------------------------------
     DOM
     --------------------------------------------------------- */
  function el(id) {
    return document.getElementById(id);
  }

  /* ---------------------------------------------------------
     ИМЯ ТРЕКА / МЕТАДАННЫЕ
     --------------------------------------------------------- */
  function cleanTrackName(name) {
    const clean = String(name || '')
      .replace(/^.*[\\/]/, '')
      .replace(/\.[^.]+$/, '')
      .replace(/\s*\((?:www\.)?[^)]*(?:lightaudio|download|mp3)[^)]*\)\s*/gi, ' ')
      .replace(/\s*\[[^\]]*(?:lightaudio|download)[^\]]*\]\s*/gi, ' ')
      .replace(/\s*\(\d+\)\s*$/, '')
      .replace(/_+/g, ' ')
      .replace(/\s+-\s+/g, ' — ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean || 'БЕЗ НАЗВАНИЯ';
  }

  function parseTrackMeta(name) {
    const clean = cleanTrackName(name);
    const parts = clean.split(/\s+—\s+/);
    if (parts.length > 1) {
      return {
        artist: parts[0].trim() || 'BRADYYCARDIA',
        title: parts.slice(1).join(' — ').trim() || clean
      };
    }
    return { artist: 'BRADYYCARDIA', title: clean };
  }

  function buildTrackRecord(name, url, file) {
    const meta = parseTrackMeta(name);
    return {
      name: String(name || ''),
      displayName: meta.title,
      displayArtist: meta.artist,
      url,
      file: file || null
    };
  }

  /* ---------------------------------------------------------
     АУДИОГРАФ
     --------------------------------------------------------- */

  function ensureAudioEl() {
    if (player.audioEl) return player.audioEl;

    const node = new Audio();
    node.id = 'bradyycardiaAudio';
    node.preload = 'auto';
    // crossOrigin НЕ выставляем: на file:// это ломает загрузку локальных
    // треков (непрозрачный origin → CORS-ошибка → тишина).
    node.crossOrigin = null;

    node.addEventListener('ended', () => {
      if (player.isPlaying) playNext(false);
    });

    node.addEventListener('playing', () => {
      player.errorStreak = 0;
      player.isPlaying = true;
      updateChip();
      updateDisplay();
    });

    node.addEventListener('pause', () => {
      if (!player.isPlaying) {
        updateChip();
        updateDisplay();
      }
    });

    node.addEventListener('error', () => {
      player.errorStreak++;
      // Слишком много ошибок подряд — не мучаем пользователя.
      if (player.errorStreak > 3) {
        player.isPlaying = false;
        updateChip();
        updateDisplay();
        return;
      }
      if (player.tracks.length > 1) {
        setTimeout(() => playNext(false), 600);
      }
    });

    player.audioEl = node;
    return node;
  }

  /**
   * Можно ли безопасно забрать <audio> в Web Audio-граф?
   *
   * На протоколе file:// источник имеет «непрозрачный» origin, и
   * createMediaElementSource() обесшумливает такой элемент (CORS-taint).
   * Поэтому на file:// играем напрямую через HTMLMediaElement.volume,
   * а визуализатор получает синтетический сигнал.
   */
  function canRouteThroughWebAudio() {
    const proto = (global.location && global.location.protocol) || '';
    // blob:/object URL (выбор папки через File System Access) — свой origin, всё ок.
    return proto !== 'file:';
  }

  function connectGraph() {
    if (player.graphReady || !player.audioEl) return;

    if (!canRouteThroughWebAudio()) {
      // file:// — играем нативно, громкость ставим на элемент.
      player.graphReady = false;
      player.audioEl.volume = clampVolume(player.volume);
      return;
    }

    const ctx = X360.Audio.getContext();
    if (!ctx) return;
    try {
      const source = ctx.createMediaElementSource(player.audioEl);
      const gain = ctx.createGain();
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(X360.Audio.getMusicBus());
      player.sourceNode = source;
      player.gainNode = gain;
      player.graphReady = true;
      player.audioEl.volume = 1;
    } catch (err) {
      // Web Audio не смог забрать элемент (кросс-домен) —
      // играем напрямую через HTMLMediaElement.
      player.graphReady = false;
      player.audioEl.volume = clampVolume(player.volume);
    }
  }

  function clampVolume(value) {
    return utils.clamp(value, 0, 1);
  }

  /* ---------------------------------------------------------
     ОЧЕРЕДЬ
     --------------------------------------------------------- */
  function buildOrder(avoidFirst) {
    const indices = player.tracks.map((_, i) => i);
    player.order = utils.shuffleArray(indices);
    if (player.order.length > 1 && avoidFirst) {
      const cur = player.tracks.indexOf(player.current);
      if (cur >= 0 && player.order[0] === cur) {
        const t = player.order[0];
        player.order[0] = player.order[1];
        player.order[1] = t;
      }
    }
    player.orderPos = -1;
  }

  function playAt(pos) {
    if (!player.tracks.length) return;
    const node = ensureAudioEl();

    if (!player.order.length) buildOrder(false);
    player.orderPos = ((pos % player.order.length) + player.order.length) % player.order.length;
    player.current = player.tracks[player.order[player.orderPos]];
    player.errorStreak = 0;

    node.muted = false;
    if (!player.graphReady) node.volume = clampVolume(player.volume);

    // Прямой путь к файлу без ломающего URL-encoding для file:///
    node.src = player.current.url;

    X360.prefs.lastTrack = player.current.name;
    X360.savePrefs();

    // Media Session — название трека в системном плеере.
    try {
      if ('mediaSession' in navigator && global.MediaMetadata) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: player.current.displayName || cleanTrackName(player.current.name),
          artist: player.current.displayArtist || 'BRADYYCARDIA',
          album: 'BRADYYCARDIA // CUSTOM SOUNDTRACK'
        });
      }
    } catch (err) { /* optional API */ }

    const promise = node.play();
    if (promise && typeof promise.then === 'function') {
      promise.then(() => {
        player.isPlaying = true;
        updateChip();
        updateDisplay();
      }).catch(() => {
        // Браузер ждёт жеста пользователя — не ругаемся в консоль.
        player.isPlaying = false;
        updateDisplay();
      });
    }
    updateDisplay();
  }

  function playNext(fromUser) {
    if (!player.tracks.length) return;
    if (fromUser) X360.prefs.musicUserSet = true;
    if (!player.order.length) buildOrder(false);
    let next = player.orderPos + 1;
    if (next >= player.order.length) {
      buildOrder(true);
      next = 0;
    }
    playAt(next);
  }

  function playPrev() {
    if (!player.tracks.length) return;
    if (!player.order.length) buildOrder(false);
    let prev = player.orderPos - 1;
    if (prev < 0) prev = player.order.length - 1;
    playAt(prev);
  }

  /* ---------------------------------------------------------
     ЗАГРУЗКА ТРЕКОВ
     --------------------------------------------------------- */

  /** Загрузка из music/playlist.js (работает на file://). */
  function loadManifest() {
    const list = Array.isArray(global.BRADYYCARDIA_PLAYLIST) ? global.BRADYYCARDIA_PLAYLIST : [];
    const tracks = [];
    list.forEach((entry) => {
      const raw = String(entry || '').trim();
      if (!raw || !utils.isAudioFile(raw)) return;
      const rel = raw.replace(/^\.?\//, '').replace(/^music\//i, '');
      // Кодируем каждый сегмент отдельно: пробелы, кириллица и # не ломают file://
      const safeRel = rel.split('/').map(encodeURIComponent).join('/');
      tracks.push(buildTrackRecord(rel, 'music/' + safeRel));
    });
    if (tracks.length) setTracks(tracks, 'music/');
    return tracks.length;
  }

  function setTracks(tracks) {
    player.tracks = Array.isArray(tracks) ? tracks.slice() : [];
    player.order = [];
    player.orderPos = -1;
    player.current = null;
    player.errorStreak = 0;
    updateFolderStatus();
    renderStations();
    updateDisplay();
    if (player.isPlaying && player.tracks.length) {
      player.isPlaying = true;
      startPlayback();
    }
  }


  /* ---------------------------------------------------------
     СИНТЕЗАТОР
     --------------------------------------------------------- */
  function getNoiseBuffer(ctx) {
    if (!player.synthNoise) {
      const len = Math.floor(ctx.sampleRate * 1);
      player.synthNoise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = player.synthNoise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return player.synthNoise;
  }

  function ensureSynthChain(ctx) {
    if (player.synthDelay) return;
    player.synthDelay = ctx.createDelay(1);
    player.synthDelay.delayTime.value = 0.26;
    player.synthFeedback = ctx.createGain();
    player.synthFeedback.gain.value = 0.32;
    player.synthWet = ctx.createGain();
    player.synthWet.gain.value = 0.35;

    player.synthDelay.connect(player.synthFeedback);
    player.synthFeedback.connect(player.synthDelay);
    player.synthDelay.connect(player.synthWet);
    player.synthWet.connect(X360.Audio.getMusicBus());
  }

  function scheduleTone(ctx, dest, delaySend, cfg) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = cfg.wave || 'triangle';
    osc.frequency.setValueAtTime(Math.max(20, cfg.freq), cfg.time);
    if (cfg.detune) osc.detune.setValueAtTime(cfg.detune, cfg.time);

    filter.type = 'lowpass';
    filter.Q.value = cfg.q || 0.8;
    filter.frequency.setValueAtTime(cfg.filterFreq || 1800, cfg.time);
    if (cfg.filterEnd) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(80, cfg.filterEnd), cfg.time + cfg.duration);
    }

    const peak = Math.max(0.0002, cfg.gain || 0.1);
    gain.gain.setValueAtTime(0.0001, cfg.time);
    gain.gain.exponentialRampToValueAtTime(peak, cfg.time + (cfg.attack || 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, cfg.time + cfg.duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    if (delaySend) {
      const send = ctx.createGain();
      send.gain.value = cfg.delayAmount || 0.28;
      gain.connect(send);
      send.connect(delaySend);
    }

    osc.start(cfg.time);
    osc.stop(cfg.time + cfg.duration + 0.03);
  }

  function scheduleNoise(ctx, dest, cfg) {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = cfg.filterType || 'highpass';
    filter.frequency.setValueAtTime(cfg.filterFreq || 5000, cfg.time);
    filter.Q.value = cfg.q || 0.7;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0002, cfg.gain || 0.08), cfg.time);
    gain.gain.exponentialRampToValueAtTime(0.0001, cfg.time + cfg.duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);

    src.start(cfg.time);
    src.stop(cfg.time + cfg.duration + 0.02);
  }

  function scheduleKick(ctx, dest, time, gain) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(155, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);
    g.gain.setValueAtTime(Math.max(0.0002, gain || 0.75), time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.17);
    osc.connect(g);
    g.connect(dest);
    osc.start(time);
    osc.stop(time + 0.19);
  }

  function scheduleStep(ctx, dest, step, time, stepDur) {
    const bar = Math.floor(step / 16) % STATION.chords.length;
    const s16 = step % 16;
    const chord = STATION.chords[bar];

    if (s16 === 0) {
      chord.forEach((semi, i) => {
        scheduleTone(ctx, dest, player.synthDelay, {
          freq: STATION.rootFreq * 2 * Math.pow(2, semi / 12),
          time,
          duration: stepDur * 15,
          wave: 'sawtooth',
          gain: (STATION.padGain || 0.05) / (i + 1.4),
          attack: stepDur * 1.6,
          filterFreq: 1200,
          filterEnd: 650,
          detune: i === 1 ? 6 : -4,
          delayAmount: 0.12
        });
      });
    }

    const bassSemi = STATION.bass[s16];
    if (bassSemi !== null && bassSemi !== undefined) {
      scheduleTone(ctx, dest, null, {
        freq: STATION.rootFreq * Math.pow(2, bassSemi / 12),
        time,
        duration: stepDur * 1.55,
        wave: 'sawtooth',
        gain: STATION.bassGain || 0.18,
        attack: 0.012,
        filterFreq: 520,
        filterEnd: 220
      });
    }

    const leadSemi = STATION.lead[s16];
    if (leadSemi !== null && leadSemi !== undefined) {
      scheduleTone(ctx, dest, player.synthDelay, {
        freq: STATION.rootFreq * 2 * Math.pow(2, leadSemi / 12),
        time,
        duration: stepDur * 1.7,
        wave: STATION.leadWave || 'square',
        gain: STATION.leadGain || 0.1,
        attack: 0.01,
        filterFreq: 2600,
        filterEnd: 1100,
        delayAmount: 0.32
      });
    }

    if (STATION.kick.includes(s16)) scheduleKick(ctx, dest, time, 0.8);
    if (STATION.snare.includes(s16)) {
      scheduleNoise(ctx, dest, {
        time, duration: 0.14, gain: 0.2, filterType: 'bandpass', filterFreq: 1900, q: 0.9
      });
    }
    if (STATION.hat.includes(s16)) {
      scheduleNoise(ctx, dest, {
        time,
        duration: s16 % 4 === 0 ? 0.055 : 0.032,
        gain: STATION.hatGain || 0.05,
        filterType: 'highpass',
        filterFreq: 7200,
        q: 0.7
      });
    }
  }

  function synthTick() {
    if (!player.isPlaying) return;
    const ctx = X360.Audio.getContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => { /* ignore */ });
      return;
    }

    const stepDur = (60 / STATION.bpm) / 4;
    if (player.synthNextTime < ctx.currentTime - 0.4) {
      player.synthNextTime = ctx.currentTime + 0.05;
    }
    const horizon = ctx.currentTime + 0.18;
    let guard = 0;
    while (player.synthNextTime < horizon && guard < 48) {
      scheduleStep(ctx, X360.Audio.getMusicBus(), player.synthStep, player.synthNextTime, stepDur);
      player.synthStep++;
      player.synthNextTime += stepDur;
      guard++;
    }
  }

  function startSynth() {
    const ctx = X360.Audio.getContext();
    if (!ctx) return;
    ensureSynthChain(ctx);
    player.synthStep = 0;
    player.synthNextTime = ctx.currentTime + 0.06;
    if (player.synthTimer) clearInterval(player.synthTimer);
    player.synthTimer = setInterval(synthTick, 25);
    synthTick();
  }

  function stopSynth() {
    if (player.synthTimer) clearInterval(player.synthTimer);
    player.synthTimer = null;
  }

  /* ---------------------------------------------------------
     УПРАВЛЕНИЕ ВОСПРОИЗВЕДЕНИЕМ
     --------------------------------------------------------- */
  function startPlayback() {
    if (!player.tracks.length) return false;
    stopSynth();
    const node = ensureAudioEl();
    connectGraph();
    if (!player.order.length || !player.current) {
      buildOrder(false);
      playAt(0);
    } else if (node.paused) {
      const p = node.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* ignore */ });
    }
    updateDisplay();
    return true;
  }

  function stopPlayback() {
    if (player.audioEl && !player.audioEl.paused) player.audioEl.pause();
    stopSynth();
  }

  function start(fromUser) {
    if (fromUser) X360.prefs.musicUserSet = true;
    X360.prefs.music = true;
    X360.savePrefs();

    if (!player.tracks.length) {
      // Плейлист пуст — тихо остаёмся в паузе, гость ничего не заметит.
      player.isPlaying = false;
      updateDisplay();
      return;
    }

    player.isPlaying = true;
    startPlayback();
    updateChip();
    updateDisplay();
  }

  function pause(fromUser) {
    if (fromUser) X360.prefs.musicUserSet = true;
    player.isPlaying = false;
    X360.prefs.music = false;
    X360.savePrefs();
    stopSynth();
    stopPlayback();
    updateChip();
    updateDisplay();
  }

  function toggle(fromUser) {
    if (player.isPlaying) {
      pause(fromUser);
    } else {
      start(fromUser);
    }
  }

  function next(fromUser) {
    if (player.tracks.length) {
      if (!player.isPlaying) start(true);
      else playNext(fromUser);
    } else {
      // Синтезатор: перезапуск.
      start(fromUser);
    }
  }

  function prev(fromUser) {
    if (player.tracks.length) {
      if (!player.isPlaying) start(true);
      else playPrev();
    } else {
      start(fromUser);
    }
  }

  function setVolume(value, persist) {
    const vol = clampVolume(value);
    player.volume = vol;
    X360.prefs.musicVolume = vol;
    if (persist) X360.savePrefs();

    const ctx = X360.Audio.getContext();
    const musicBus = X360.Audio.getMusicBus();
    if (ctx && musicBus && player.graphReady) {
      try {
        musicBus.gain.setTargetAtTime(vol, ctx.currentTime, 0.04);
      } catch (err) { /* ignore */ }
    }
    // Если элемент играет нативно (file:// или без графа) — громкость ставим в него.
    if (player.audioEl && !player.graphReady) {
      player.audioEl.volume = vol;
    }

    const slider = el('musicVolume');
    const label = el('musicVolumeVal');
    if (slider) slider.value = String(Math.round(vol * 100));
    if (label) label.textContent = Math.round(vol * 100) + '%';
  }

  /* ---------------------------------------------------------
     UI
     --------------------------------------------------------- */
  function updateChip() {
    const btnText = el('mediaBtnText');
    const openBtn = el('mediaOpenBtn');
    if (btnText) {
      btnText.textContent = player.isPlaying ? 'МУЗЫКА: ИГРАЕТ ▶' : 'МУЗЫКА: ПАУЗА ||';
    }
    if (openBtn) openBtn.classList.toggle('active', player.isPlaying);
  }

  /** Счётчик треков в заголовке станции (гость не видит путей к файлам). */
  function updateFolderStatus() {
    const node = el('musicTrackCount');
    if (!node) return;
    node.textContent = player.tracks.length
      ? player.tracks.length + ' трек(ов) // shuffle'
      : 'плейлист пуст';
  }

  function updateDisplay() {
    const stationEl = el('mnpStation');
    const trackEl = el('mnpTrack');
    const artistEl = el('mnpArtist');
    if (!stationEl || !trackEl || !artistEl) return;

    stationEl.textContent = 'РАДИОСТАНЦИЯ: ' + STATION.station;
    if (player.current) {
      trackEl.textContent = player.current.displayName || cleanTrackName(player.current.name);
      const artist = player.current.displayArtist || 'BRADYYCARDIA';
      artistEl.textContent = `${artist} // SHUFFLE`;
    } else if (player.tracks.length) {
      trackEl.textContent = 'Готово к запуску';
      artistEl.textContent = `${player.tracks.length} трек(ов) в папке // shuffle`;
    } else {
      trackEl.textContent = 'Плейлист пуст';
      artistEl.textContent = 'BRADYYCARDIA // радио без источника';
    }

    const rows = document.querySelectorAll('.station-item-row');
    rows.forEach((row) => row.classList.toggle('active', row.dataset.stationId === STATION.id));
  }

  function renderStations() {
    const box = el('stationsList');
    if (!box) return;
    box.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'station-item-row active';
    row.dataset.stationId = STATION.id;
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.innerHTML = `
      <div class="sir-info">
        <div class="sir-title">${STATION.station}</div>
        <div class="sir-desc">${player.tracks.length ? player.tracks.length + ' трек(ов) // shuffle' : 'радио без источника'}</div>
      </div>
      <div class="sir-icon">▶</div>
    `;
    const activate = () => {
      if (!player.tracks.length) {
        // Плейлист пуст — включаем встроенный синтезатор, чтобы музыка
        // всё равно играла и интерфейс не выглядел сломанным.
        player.isPlaying = true;
        startSynth();
        updateChip();
        updateDisplay();
        return;
      }
      if (!player.isPlaying) start(true);
      else startPlayback();
    };
    row.addEventListener('click', activate);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
    box.appendChild(row);
  }

  /* ---------------------------------------------------------
     ВИЗУАЛИЗАТОР
     --------------------------------------------------------- */
  function readTheme() {
    const cs = getComputedStyle(document.body);
    player.accent = cs.getPropertyValue('--theme-accent').trim() || '#52b043';
    player.toxic = cs.getPropertyValue('--theme-toxic').trim() || '#7cfc00';
  }

  function startVisualizer() {
    const canvas = el('mediaVisualizer');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bars = 24;
    const heights = new Array(bars).fill(4);
    const freqData = new Uint8Array(32);

    function frame() {
      player.visualFrame++;
      if (player.visualFrame % 60 === 0) readTheme();

      ctx.fillStyle = '#040605';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Анализатор доступен только когда элемент играет через Web Audio.
      // На file:// (и без графа) рисуем псевдоспектр — визуал не должен «замирать».
      const analyser = player.graphReady ? X360.Audio.getAnalyser() : null;
      let freq = null;
      if (player.isPlaying && analyser) {
        analyser.getByteFrequencyData(freqData);
        freq = freqData;
      }

      const barWidth = (canvas.width / bars) - 2;
      for (let i = 0; i < bars; i++) {
        let target;
        if (freq) {
          const bin = Math.min(freq.length - 1, Math.floor((i / bars) * freq.length));
          target = 2 + (freq[bin] / 255) * (canvas.height - 6);
        } else if (player.isPlaying) {
          // Псевдоспектр: сумма нескольких синусов + шум — выглядит как музыка.
          const t = player.visualFrame * 0.06 + i * 0.42;
          target = 3 + (Math.sin(t) * 0.5 + 0.5) * (canvas.height - 10) * 0.75
            + Math.random() * 4;
        } else {
          target = 2;
        }

        heights[i] += (target - heights[i]) * (freq ? 0.45 : 0.2);
        const h = Math.max(2, heights[i]);
        const x = i * (barWidth + 2);
        const y = canvas.height - h;

        const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
        grad.addColorStop(0, player.accent);
        grad.addColorStop(0.7, player.toxic);
        grad.addColorStop(1, '#ffffff');

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, h);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------
     PUBLIC API
     --------------------------------------------------------- */
  X360.Player = {
    init(options) {
      const opts = options || {};
      player.onStateChange = opts.onStateChange || null;

      // Громкость из настроек.
      player.volume = clampVolume(X360.prefs.musicVolume);
      setVolume(player.volume, false);

      const slider = el('musicVolume');
      if (slider) {
        slider.addEventListener('input', (e) => setVolume(Number(e.target.value) / 100, true));
      }

      const playBtn = el('mpPlayBtn');
      if (playBtn) playBtn.addEventListener('click', () => toggle(true));

      const nextBtn = el('mpNextBtn');
      if (nextBtn) nextBtn.addEventListener('click', () => next(true));

      const prevBtn = el('mpPrevBtn');
      if (prevBtn) prevBtn.addEventListener('click', () => prev(true));

      renderStations();
      updateFolderStatus();
      updateDisplay();
      updateChip();
      startVisualizer();

      // Гостю доступен только встроенный плейлист music/playlist.js.
      loadManifest();
    },

    loadManifest,
    toggle,
    start,
    pause,
    next,
    prev,
    setVolume,
    stop: stopPlayback,
    isPlaying: () => player.isPlaying,
    getTracks: () => player.tracks,
    getCurrent: () => player.current,
    getStation: () => STATION,
    renderStations,
    updateDisplay,
    updateFolderStatus
  };
})(window);
