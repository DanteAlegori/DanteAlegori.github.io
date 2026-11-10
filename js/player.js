(function (global) {
  'use strict';

  const X360 = global.X360 || (global.X360 = {});
  const utils = X360.utils;

  const player = {
    tracks: [],
    source: '',
    order: [],
    orderPos: -1,
    current: null,
    audioEl: null,
    errorStreak: 0,
    isPlaying: false,
    status: 'idle',
    statusText: '',
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

  function el(id) {
    return document.getElementById(id);
  }

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


  function ensureAudioEl() {
    if (player.audioEl) return player.audioEl;

    const node = new Audio();
    node.id = 'bradyycardiaAudio';
    node.preload = 'none';
    node.autoplay = false;
    if (node.hasAttribute('crossorigin')) node.removeAttribute('crossorigin');
    node.muted = false;
    node.volume = clampVolume(player.volume);
    X360.Audio.attachMusicElement(node);

    node.addEventListener('ended', () => {
      if (player.isPlaying) playNext(false);
    });

    node.addEventListener('playing', () => {
      player.errorStreak = 0;
      player.isPlaying = true;
      setStatus('playing');
      updateChip();
      updateDisplay();
      updateProgress();
    });

    node.addEventListener('pause', () => {
      if (!player.isPlaying) {
        if (player.status !== 'error') setStatus('paused');
        updateChip();
        updateDisplay();
      }
    });

    node.addEventListener('waiting', () => {
      setStatus('loading');
      updateDisplay();
    });

    node.addEventListener('loadedmetadata', () => {
      updateProgress();
    });

    node.addEventListener('durationchange', () => {
      updateProgress();
    });

    node.addEventListener('timeupdate', () => {
      updateProgress();
    });

    node.addEventListener('error', () => {
      player.errorStreak++;
      setStatus('error', 'Файл недоступен');
      if (player.errorStreak > 3) {
        player.isPlaying = false;
        setStatus('error', 'Файлы недоступны — радио остановлено');
        updateChip();
        updateDisplay();
        return;
      }
      if (player.tracks.length > 1) {
        setTimeout(() => playNext(false), 600);
      } else {
        updateChip();
        updateDisplay();
      }
    });

    player.audioEl = node;
    return node;
  }


  function clampVolume(value) {
    return utils.clamp(value, 0, 1);
  }

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

    node.muted = false;
    X360.Audio.attachMusicElement(node);
    node.volume = clampVolume(player.volume);

    node.src = player.current.url;

    X360.prefs.lastTrack = player.current.name;
    X360.savePrefs();

    try {
      if ('mediaSession' in navigator && global.MediaMetadata) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: player.current.displayName || cleanTrackName(player.current.name),
          artist: player.current.displayArtist || 'BRADYYCARDIA',
          album: 'BRADYYCARDIA // CUSTOM SOUNDTRACK'
        });
      }
    } catch (err) {   }

    const promise = node.play();
    if (promise && typeof promise.then === 'function') {
      promise.then(() => {
        player.isPlaying = true;
        startAmbientPulse();
        updateChip();
        updateDisplay();
      }).catch(() => {
        player.isPlaying = false;
        stopAmbientPulse();
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


  function loadManifest() {
    const release = Array.isArray(global.BRADYYCARDIA_RELEASE) ? global.BRADYYCARDIA_RELEASE : null;
    if (release && release.length) {
      const tracks = [];
      release.forEach((entry) => {
        const name = String((entry && entry.name) || '').trim();
        const url = String((entry && entry.url) || '').trim();
        if (!name || !url) return;
        if (!/^https?:\/\//i.test(url)) return;
        tracks.push(buildTrackRecord(name, url));
      });
      if (tracks.length) {
        setTracks(tracks, 'Music Release');
        return tracks.length;
      }
    }

    const list = Array.isArray(global.BRADYYCARDIA_PLAYLIST) ? global.BRADYYCARDIA_PLAYLIST : [];
    const tracks = [];
    list.forEach((entry) => {
      const raw = String(entry || '').trim();
      if (!raw || !utils.isAudioFile(raw)) return;
      const rel = raw.replace(/^\.?\//, '').replace(/^music\//i, '');
      const safeRel = rel.split('/').map(encodeURIComponent).join('/');
      tracks.push(buildTrackRecord(rel, 'music/' + safeRel));
    });
    if (tracks.length) setTracks(tracks, 'music/');
    return tracks.length;
  }

  function setTracks(tracks, source) {
    player.tracks = Array.isArray(tracks) ? tracks.slice() : [];
    player.source = source || '';
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
      if (p && typeof p.catch === 'function') p.catch(() => {   });
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

  function startPlayback() {
    if (!player.tracks.length) return false;
    stopSynth();
    const node = ensureAudioEl();
    if (!player.order.length || !player.current) {
      buildOrder(false);
      playAt(0);
    } else if (node.paused) {
      const p = node.play();
      if (p && typeof p.catch === 'function') p.catch(() => {   });
      player.isPlaying = true;
      startAmbientPulse();
    }
    updateDisplay();
    return true;
  }

  function stopPlayback() {
    if (player.audioEl && !player.audioEl.paused) player.audioEl.pause();
    stopSynth();
    stopAmbientPulse();
  }

  function start(fromUser) {
    if (fromUser) X360.prefs.musicUserSet = true;
    X360.prefs.music = true;
    X360.savePrefs();

    if (!player.tracks.length) {
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

    X360.Audio.setMusicVolume(vol);
    if (player.audioEl) {
      player.audioEl.muted = false;
      player.audioEl.volume = vol;
    }

    const slider = el('musicVolume');
    const label = el('musicVolumeVal');
    if (slider) slider.value = String(Math.round(vol * 100));
    if (label) label.textContent = Math.round(vol * 100) + '%';
  }

  function updateChip() {
    const btnText = el('mediaBtnText');
    const openBtn = el('mediaOpenBtn');
    if (btnText) {
      btnText.textContent = player.isPlaying ? 'МУЗЫКА: ИГРАЕТ ▶' : 'МУЗЫКА: ПАУЗА ||';
    }
    if (openBtn) openBtn.classList.toggle('active', player.isPlaying);
  }

  function updateFolderStatus() {
    const node = el('musicTrackCount');
    if (!node) return;
    node.textContent = player.tracks.length
      ? player.tracks.length + ' трек(ов) // shuffle'
      : 'плейлист пуст';
    const sub = el('mediaBladeSub');
    if (sub) {
      sub.textContent = player.source === 'Music Release'
        ? 'Custom Soundtrack — GitHub Release'
        : 'Custom Soundtrack — встроенный плейлист';
    }
  }

  let pulseRaf = 0;
  let pulseRunning = false;
  let lastPulse = -1;
  let lastPulseHi = -1;
  let lastPulseAt = 0;
  let pulseTargets = null;

  function getPulseTargets() {
    if (pulseTargets) return pulseTargets;
    pulseTargets = {
      aurora: document.querySelector('.aurora-ribbon'),
      ribbon: document.querySelector('.bg-ribbon'),
      spot: document.querySelector('.bg-spotlight'),
      crt: document.getElementById('crtOverlay'),
      card: document.querySelector('.card-item.is-active')
    };
    return pulseTargets;
  }

  function computePulse() {
    const el = player.audioEl;
    const live = !!(el && !el.paused && !el.ended);
    const t = live ? el.currentTime : 0;

    let bass = 0;
    let high = 0;

    if (live) {
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.8667)), 4);
      const swell = 0.5 + 0.5 * Math.sin(t * 0.83);
      bass = beat * 0.76 + swell * 0.24;
      high = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 0.61 + 1.2)), 3) * 0.65;
    }

    bass = Math.max(0, Math.min(1, bass));
    high = Math.max(0, Math.min(1, high));

    const tgt = getPulseTargets();

    const activeCard = document.querySelector('.card-item.is-active');
    if (activeCard !== tgt.card) {
      if (tgt.card) tgt.card.style.removeProperty('--p');
      tgt.card = activeCard;
    }

    if (Math.abs(bass - lastPulse) < 0.02) return;
    lastPulse = bass;

    const v = bass.toFixed(3);
    if (tgt.aurora) tgt.aurora.style.setProperty('--p', v);
    if (tgt.ribbon) tgt.ribbon.style.setProperty('--p', v);
    if (tgt.spot) tgt.spot.style.setProperty('--p', v);
    if (tgt.crt) tgt.crt.style.setProperty('--p', v);
    if (tgt.card) tgt.card.style.setProperty('--p', v);
  }

  function startAmbientPulse() {
    if (pulseRunning) return;
    pulseRunning = true;
    pulseTargets = null;
    lastPulseAt = 0;
    const tick = (now) => {
      if (!pulseRunning) { pulseRaf = 0; return; }
      if (now - lastPulseAt >= 42) {
        lastPulseAt = now;
        computePulse();
      }
      pulseRaf = requestAnimationFrame(tick);
    };
    pulseRaf = requestAnimationFrame(tick);
  }

  function stopAmbientPulse() {
    pulseRunning = false;
    if (pulseRaf) cancelAnimationFrame(pulseRaf);
    pulseRaf = 0;
    lastPulse = -1;
    lastPulseHi = -1;
    const tgt = getPulseTargets();
    ['aurora', 'ribbon', 'spot', 'crt', 'card'].forEach((k) => {
      if (tgt[k]) tgt[k].style.removeProperty('--p');
    });
  }


  function setStatus(kind, text) {
    player.status = kind || 'idle';
    player.statusText = text || '';
    updateDisplay();
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60) % 60;
    const h = Math.floor(sec / 3600);
    const mm = (h ? String(m).padStart(2, '0') : String(m));
    return (h ? h + ':' + mm : mm) + ':' + String(s).padStart(2, '0');
  }

  function updateProgress() {
    const node = player.audioEl;
    const seek = el('mpSeek');
    const curEl = el('mpTimeCurrent');
    const totalEl = el('mpTimeTotal');
    const dur = node && isFinite(node.duration) && node.duration > 0 ? node.duration : 0;
    const pos = node && isFinite(node.currentTime) ? node.currentTime : 0;

    if (curEl) curEl.textContent = fmtTime(pos);
    if (totalEl) totalEl.textContent = dur ? fmtTime(dur) : '--:--';

    if (seek) {
      if (seek.dataset.dragging !== '1') {
        seek.value = String(dur ? Math.round(Math.min(1, pos / dur) * 1000) : 0);
      }
      seek.disabled = !dur;
      seek.setAttribute('aria-valuetext',
        fmtTime(pos) + (dur ? ' из ' + fmtTime(dur) : ' (длительность неизвестна)'));
    }
  }

  function sizeVisualizer() {
    const canvas = el('mediaVisualizer');
    if (!canvas) return;
    const w = Math.max(120, Math.round(canvas.clientWidth || canvas.width || 300));
    const h = 38;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  function bindPanelKeyboard() {
    if (global.__bradyyKbBound) return;
    global.__bradyyKbBound = true;
    document.addEventListener('keydown', (e) => {
      const panel = el('mediaBlade');
      if (!panel || !panel.classList.contains('open')) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          toggle(true);
          break;
        case 'ArrowRight':
          e.preventDefault();
          next(true);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          prev(true);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(1, player.volume + 0.05), true);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(0, player.volume - 0.05), true);
          break;
        default:
          break;
      }
    });
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
      artistEl.textContent = `${player.tracks.length} трек(ов) // shuffle`;
    } else {
      trackEl.textContent = 'Плейлист пуст';
      artistEl.textContent = 'BRADYYCARDIA // радио без источника';
    }

    const statusEl = el('mnpStatus');
    if (statusEl) {
      let txt = '';
      if (player.status === 'loading') txt = 'ЗАГРУЗКА…';
      else if (player.status === 'error') txt = player.statusText || 'ОШИБКА ЗАГРУЗКИ';
      else if (player.status === 'paused') txt = 'ПАУЗА';
      else if (player.status === 'playing') txt = 'ИГРАЕТ';
      statusEl.textContent = txt;
      statusEl.className = 'mnp-status' + (txt ? ' is-on' : '') +
        (player.status === 'error' ? ' is-error' : '');
    }

    const playBtn = el('mpPlayBtn');
    if (playBtn) {
      const playing = !!player.isPlaying;
      playBtn.textContent = playing ? '|| ПАУЗА' : '▶ ПУСК';
      playBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      playBtn.setAttribute('aria-label', playing ? 'Пауза' : 'Воспроизвести');
    }

    const rows = document.querySelectorAll('.station-item-row');
    rows.forEach((row) => row.classList.toggle('active', row.dataset.stationId === STATION.id));

    updateProgress();
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

  function readTheme() {
    const cs = getComputedStyle(document.body);
    player.accent = cs.getPropertyValue('--theme-accent').trim() || '#52b043';
    player.toxic = cs.getPropertyValue('--theme-toxic').trim() || '#7cfc00';
  }

  let visualRaf = 0;
  let visualRunning = false;
  let visualLastPaint = 0;
  let visualGradient = null;

  const bars = 24;
  const heights = new Array(bars).fill(4);
  const spectrum = new Array(bars).fill(0);

  function buildGradient(canvas) {
    const grad = canvas.getContext('2d').createLinearGradient(0, canvas.height, 0, 0);
    grad.addColorStop(0, player.accent);
    grad.addColorStop(0.7, player.toxic);
    grad.addColorStop(1, '#ffffff');
    return grad;
  }

  function visualFrame() {
    if (!visualRunning) {
      visualRaf = 0;
      return;
    }
    const canvas = el('mediaVisualizer');
    if (!canvas) {
      visualRaf = requestAnimationFrame(visualFrame);
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      visualRaf = requestAnimationFrame(visualFrame);
      return;
    }

    const live = X360.Audio.isMusicPlaying();

    if (!live) {
      const now = performance.now();
      if (now - visualLastPaint < 80) {
        visualRaf = requestAnimationFrame(visualFrame);
        return;
      }
      visualLastPaint = now;
    }

    player.visualFrame++;
    if (player.visualFrame % 120 === 0) {
      readTheme();
      visualGradient = null;
    }

    ctx.fillStyle = '#040605';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    X360.Audio.getMusicSpectrum(bars, spectrum);

    if (!visualGradient) visualGradient = buildGradient(canvas);

    const barWidth = (canvas.width / bars) - 2;
    for (let i = 0; i < bars; i++) {
      const target = live
        ? 3 + spectrum[i] * (canvas.height - 12) + Math.random() * 3
        : 2;

      heights[i] += (target - heights[i]) * (live ? 0.45 : 0.18);
      const h = Math.max(2, heights[i]);
      const x = i * (barWidth + 2);
      const y = canvas.height - h;

      ctx.fillStyle = visualGradient;
      ctx.fillRect(x, y, barWidth, h);
    }
    visualRaf = requestAnimationFrame(visualFrame);
  }

  function startVisualizer() {
    if (visualRunning) return;
    visualRunning = true;
    if (!visualRaf) visualRaf = requestAnimationFrame(visualFrame);
  }

  function stopVisualizer() {
    visualRunning = false;
    if (visualRaf) cancelAnimationFrame(visualRaf);
    visualRaf = 0;
  }

  function setVisualizerActive(active) {
    if (active) {
      readTheme();
      visualGradient = null;
      sizeVisualizer();
      startVisualizer();
    } else {
      stopVisualizer();
    }
  }

  X360.Player = {
    init(options) {
      const opts = options || {};
      player.onStateChange = opts.onStateChange || null;

      player.volume = clampVolume(X360.prefs.musicVolume);
      setVolume(player.volume, false);

      const slider = el('musicVolume');
      if (slider) {
        slider.addEventListener('input', (e) => setVolume(Number(e.target.value) / 100, true));
      }

      const seek = el('mpSeek');
      if (seek) {
        const applySeek = () => {
          const node = player.audioEl;
          if (!node || !isFinite(node.duration) || !node.duration) return;
          node.currentTime = (Number(seek.value) / 1000) * node.duration;
          updateProgress();
        };
        seek.addEventListener('input', applySeek);
        seek.addEventListener('change', applySeek);
        seek.addEventListener('pointerdown', () => { seek.dataset.dragging = '1'; });
        seek.addEventListener('pointerup', () => { delete seek.dataset.dragging; });
        seek.addEventListener('blur', () => { delete seek.dataset.dragging; });
      }

      const playBtn = el('mpPlayBtn');
      if (playBtn) playBtn.addEventListener('click', () => toggle(true));

      const nextBtn = el('mpNextBtn');
      if (nextBtn) nextBtn.addEventListener('click', () => next(true));

      const prevBtn = el('mpPrevBtn');
      if (prevBtn) prevBtn.addEventListener('click', () => prev(true));

      bindPanelKeyboard();
      sizeVisualizer();
      let resizeTimer = 0;
      global.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(sizeVisualizer, 200);
      });

      renderStations();
      updateFolderStatus();
      updateDisplay();
      updateChip();

      loadManifest();
    },

    loadManifest,
    setVisualizerActive,
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
