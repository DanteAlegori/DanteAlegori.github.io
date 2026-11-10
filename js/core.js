(function (global) {
  'use strict';

  const X360 = global.X360 || (global.X360 = {});

  const DEFAULT_CONFIG = {
    profile: {
      callsign: 'DANTE // 2003',
      statusMessage: 'STATUS: MOST WANTED #1 // CHIPPED XBOX FAT',
      currency: '₽',
      vibeNote: 'Руки от банок с мелочью убрал. Коплю на корч и комбик.'
    },
    categories: ['ВСЕ ДИСКИ', 'ГАРАЖ & КОРЧИ', 'МУЗЛО & ГИТАРЫ', 'КОНСОЛИ & ЖЕЛЕЗО', 'ШМОТ & СКЕЙТ'],
    items: [
      {
        id: 'target-01',
        title: 'Mazda RX-7 FD3S (Twin Turbo)',
        category: 'ГАРАЖ & КОРЧИ',
        price: 1400000,
        collected: 450000,
        heatLevel: 5,
        status: 'wanted',
        photoUrl: 'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?w=800',
        shopUrl: 'https://auto.ru',
        slogan: 'Ротор 13B-REW. Прямоток на весь ночной спальник.',
        bountyTag: 'MOST WANTED #1'
      },
      {
        id: 'target-02',
        title: 'Ibanez RG550 + Стек Marshall JCM800',
        category: 'МУЗЛО & ГИТАРЫ',
        price: 185000,
        collected: 185000,
        heatLevel: 5,
        status: 'busted',
        photoUrl: 'https://images.unsplash.com/photo-1516924962500-2b4b3b99ea02?w=800',
        shopUrl: 'https://muffingear.ru',
        slogan: 'Drop-D строй, тяжелые риффы прямо в стену соседям.',
        bountyTag: 'CLAIMED // 1000G'
      },
      {
        id: 'target-03',
        title: 'PlayStation 2 Fat (Чипованная) + Винчестер',
        category: 'КОНСОЛИ & ЖЕЛЕЗО',
        price: 24000,
        collected: 14000,
        heatLevel: 4,
        status: 'wanted',
        photoUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800',
        shopUrl: 'https://avito.ru',
        slogan: 'Шпилить в Def Jam, Burnout 3 и Black до утра.',
        bountyTag: 'BLACK MARKET'
      },
      {
        id: 'target-04',
        title: 'Osiris D3 2001 (Дутые тапки)',
        category: 'ШМОТ & СКЕЙТ',
        price: 21000,
        collected: 8500,
        heatLevel: 3,
        status: 'wanted',
        photoUrl: 'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=800',
        shopUrl: 'https://ebay.com',
        slogan: 'Самые жирные дутыши под широченные карго.',
        bountyTag: 'SKATE PUNK'
      }
    ]
  };

  const LIVE_CONFIG_KEY = 'x360-wishlist-config';

  function readLiveConfig() {
    let raw = null;
    try { raw = global.localStorage.getItem(LIVE_CONFIG_KEY); } catch (err) { return null; }
    if (!raw) return null;

    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (err) { return null; }
    if (!parsed || !parsed.config || !Array.isArray(parsed.config.items)) return null;

    const fileStamp = Number(
      (global.WISHLIST_CONFIG_META && global.WISHLIST_CONFIG_META.generated) || 0
    );
    const liveStamp = Number(parsed.savedAt) || 0;

    if (fileStamp && fileStamp >= liveStamp) return null;

    return { config: parsed.config, savedAt: liveStamp };
  }

  function resolveConfig() {
    const live = readLiveConfig();
    const raw = (live && live.config) || global.WISHLIST_CONFIG;

    if (!raw || !Array.isArray(raw.items) || raw.items.length === 0) {
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
    const cfg = {
      profile: Object.assign({}, DEFAULT_CONFIG.profile, raw.profile || {}),
      categories: Array.isArray(raw.categories) && raw.categories.length
        ? raw.categories.slice()
        : DEFAULT_CONFIG.categories.slice(),
      items: raw.items.map((item, i) => {
        const src = item || {};
        return {
          id: String(src.id || 'target-' + (i + 1)),
          title: src.title || 'БЕЗ НАЗВАНИЯ',
          category: src.category || 'БЕЗ КАТЕГОРИИ',
          price: Number(src.price) || 0,
          collected: Number(src.collected) || 0,
          heatLevel: Number(src.heatLevel) || 4,
          status: src.status === 'busted' ? 'busted' : 'wanted',
          photoUrl: src.photoUrl || '',
          shopUrl: src.shopUrl || '',
          slogan: src.slogan || '',
          bountyTag: src.bountyTag || ''
        };
      })
    };
    return cfg;
  }

  const PREFS_KEY = 'x360-wishlist-prefs-v1';

  const prefs = {
    theme: 'theme-fat',
    sfx: true,
    fan: true,
    music: true,
    musicUserSet: false,
    musicVolume: 0.55,
    crt: true,
    lastTrack: ''
  };

  try {
    const stored = JSON.parse(global.localStorage.getItem(PREFS_KEY) || '{}');
    if (stored && typeof stored === 'object') Object.assign(prefs, stored);
  } catch (err) {
  }

  function savePrefs() {
    try {
      global.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (err) {
    }
  }

  const utils = {
    escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch]));
    },

    safeUrl(value) {
      const url = String(value == null ? '' : value).trim();
      if (!url) return '';
      if (/^(?:javascript|vbscript|data:text\/html)/i.test(url)) return '';
      return url;
    },

    thumbUrl(value) {
      const url = utils.safeUrl(value);
      if (!url) return '';
      return url
        .replace(/\/w1200\//, '/w600/')
        .replace(/\/c1000\//, '/c600/')
        .replace(/\/wc1000\//, '/wc600/');
    },

    safeLinkUrl(value) {
      const url = String(value == null ? '' : value).trim();
      if (!url) return '';
      if (/^(?:javascript|vbscript|data):/i.test(url)) return '';
      return url;
    },

    cssUrl(value) {
      return 'url("' + String(value)
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/[\r\n]/g, '') + '")';
    },

    clamp(value, min, max) {
      const n = Number(value);
      if (!Number.isFinite(n)) return min;
      return Math.min(max, Math.max(min, n));
    },

    formatMoney(amount, currency) {
      const cur = currency || (X360.config && X360.config.profile && X360.config.profile.currency) || '₽';
      return (Number(amount) || 0).toLocaleString('ru-RU') + ' ' + cur;
    },

    isAudioFile(name) {
      return /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm)$/i.test(String(name || ''));
    },

    shuffleArray(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      return a;
    }
  };

  const FALLBACK_ART = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">' +
    '<rect width="100%" height="100%" fill="#0d120f"/>' +
    '<rect x="24" y="24" width="552" height="752" fill="none" stroke="#52b043" stroke-width="3"/>' +
    '<text x="50%" y="47%" fill="#52b043" font-family="monospace" font-size="34" text-anchor="middle">NO SIGNAL</text>' +
    '<text x="50%" y="53%" fill="#6b7f6e" font-family="monospace" font-size="16" text-anchor="middle">INSERT DISC</text>' +
    '</svg>'
  );

  X360.DEFAULT_CONFIG = DEFAULT_CONFIG;
  X360.config = resolveConfig();
  X360.prefs = prefs;
  X360.savePrefs = savePrefs;
  X360.utils = utils;
  X360.FALLBACK_ART = FALLBACK_ART;
  X360.LIVE_CONFIG_KEY = LIVE_CONFIG_KEY;

  X360.isLiveConfig = !!(readLiveConfig());

  X360.getCategories = function getCategories() {
    const configured = Array.isArray(X360.config.categories)
      ? X360.config.categories.map((c) => String(c || '').trim()).filter(Boolean)
      : [];
    const allIdx = configured.findIndex((c) => /^(все|всё|all|everything)/i.test(c));
    const allLabel = allIdx >= 0 ? configured[allIdx] : 'ВСЕ ДИСКИ';
    const rest = configured.filter((_, i) => i !== allIdx);
    const itemCats = (X360.config.items || [])
      .map((item) => String(item && item.category || '').trim())
      .filter(Boolean);

    const result = [allLabel];
    const seen = new Set([allLabel.toLowerCase()]);
    rest.concat(itemCats).forEach((cat) => {
      const key = cat.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(cat);
      }
    });
    return result;
  };

  X360.ALL_CATEGORY = X360.getCategories()[0];

  X360.state = {
    booted: false,
    activeCategory: X360.ALL_CATEGORY,
    activeIndex: 0,
    isFlipped: false,
    lastActiveCaseId: null,
    sfxEnabled: prefs.sfx !== false,
    fanHumEnabled: prefs.fan !== false
  };
})(window);
