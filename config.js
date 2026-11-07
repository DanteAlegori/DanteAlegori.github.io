/* ============================================================
   XBOX 360 SYSTEM DASHBOARD — КОНФИГУРАЦИЯ ВИШЛИСТА
   ---------------------------------------------------------
   Файл автоматически генерируется мастерской NERO (admin.html).
   Его можно править и вручную — структура простая и понятная.

   ┌─ profile ───────────────────────────────────────────────┐
   │  callsign       — ник игрока (Gamertag)                  │
   │  statusMessage  — подпись под ником в шапке дашборда      │
   │  currency       — символ валюты (₽, $, €)                │
   │  vibeNote       — личная заметка (видна в подсказке)      │
   └──────────────────────────────────────────────────────────┘

   ┌─ categories ────────────────────────────────────────────┐
   │  Массив названий категорий.                             │
   │  ПЕРВАЯ категория — служебная («ВСЕ ДИСКИ»): она        │
   │  показывает все цели и не удаляется.                    │
   └──────────────────────────────────────────────────────────┘

   ┌─ items ─────────────────────────────────────────────────┐
   │  Массив целей. Поля каждой цели:                        │
   │    id         — уникальный идентификатор                 │
   │    title      — название цели                            │
   │    category   — категория (должна совпадать с одной из   │
   │                 categories)                               │
   │    price      — полная стоимость, число                  │
   │    collected  — уже накоплено, число                     │
   │    heatLevel  — важность 1..5                            │
   │    status     — "wanted" (в розыске) | "busted" (куплено)│
   │    photoUrl   — ссылка на обложку (показывается на боксе) │
   │                 • локальный файл: img/<имя>.jpg             │
   │                 • или прямая ссылка на интернет-картинку    │
   │    shopUrl    — ссылка на магазин                         │
   │    slogan     — заметка на обратной стороне диска        │
   │    bountyTag  — стикер на обложке (например MOST WANTED) │
   └──────────────────────────────────────────────────────────┘

   Картинки лежат в папке img/ рядом с config.js — витрина грузит их
   локально, поэтому работает без интернета и не ловит обрывов CDN.
   ============================================================ */
(function (global) {
  'use strict';

  /* Значения по умолчанию — используются, если поле не задано.
     Благодаря этому частично заполненный config.js не ломает витрину. */
  var DEFAULTS = {
    profile: {
      callsign: 'DANTE // 2003',
      statusMessage: 'STATUS: MOST WANTED #1 // CHIPPED XBOX FAT',
      currency: '₽',
      vibeNote: 'Руки от банок с мелочью убрал. Коплю на корч и комбик.'
    },
    categories: [
      'ВСЕ ДИСКИ',
      'Игры',
      'Дом',
      'Техника',
      'Библиотека',
      'Хобби',
      'Настолки',
      'Всякая шняга',
      'Кухня',
      'Питомцы'
    ],
    items: []
  };

  /* ============================================================
     ДАННЫЕ ВИШЛИСТА
     ---------------------------------------------------------
     Всё, что ниже — обычный JavaScript. Правьте прямо здесь:
     добавляйте цели, меняйте цены, ссылки и слоганы.

     Категория «Дом» — обстановка новой квартиры:
     техника, мебель, свет и всё, без чего новое жильё не жильё.
     ============================================================ */
  var DATA = {
    profile: {
      callsign: 'DANTE // 2003',
      statusMessage: 'STATUS: MOST WANTED #1 // CHIPPED XBOX FAT',
      currency: '₽',
      vibeNote: 'Руки от банок с мелочью убрал. Коплю на корч и комбик.'
    },
    categories: [
      'ВСЕ ДИСКИ',
      'Игры',
      'Дом',
      'Техника',
      'Библиотека',
      'Хобби',
      'Настолки',
      'Всякая шняга',
      'Кухня',
      'Питомцы'
    ],
    items: [
      {
        id: 'target-dom-fridge',
        title: 'Холодильник',
        category: 'Дом',
        price: 85000,
        collected: 15000,
        heatLevel: 5,
        status: 'wanted',
        photoUrl: 'img/fridge.jpg',
        shopUrl: 'https://www.dns-shop.ru/search/?q=холодильник+двухкамерный',
        slogan: 'Главный хранитель продуктов. Без него кухня — склад.',
        bountyTag: 'MOST WANTED'
      },
      {
        id: 'target-dom-cooker',
        title: 'Варочная панель',
        category: 'Дом',
        price: 32000,
        collected: 0,
        heatLevel: 5,
        status: 'wanted',
        photoUrl: 'img/stove.jpg',
        shopUrl: 'https://www.dns-shop.ru/search/?q=варочная+панель+газовая+4+конфорки',
        slogan: 'Четыре конфорки и чугун. Жарю мясо как на костре.',
        bountyTag: 'КУХНЯ'
      },
      {
        id: 'target-dom-bed',
        title: 'Кровать',
        category: 'Дом',
        price: 48000,
        collected: 0,
        heatLevel: 5,
        status: 'wanted',
        photoUrl: 'img/bed.jpg',
        shopUrl: 'https://www.ozon.ru/search/?text=кровать+двуспальная',
        slogan: 'Место силы. Матрац отдельно, но обещаю взять вместе.',
        bountyTag: 'PRIORITY'
      },
      {
        id: 'target-dom-mattress',
        title: 'Матрас',
        category: 'Дом',
        price: 27000,
        collected: 8000,
        heatLevel: 5,
        status: 'wanted',
        photoUrl: 'img/mattress.jpg',
        shopUrl: 'https://www.dns-shop.ru/search/?q=матрас+ортопедический',
        slogan: 'Ортопедический. Спина скажет спасибо через неделю.',
        bountyTag: 'PRIORITY'
      },
      {
        id: 'target-dom-sofa',
        title: 'Диван',
        category: 'Дом',
        price: 62000,
        collected: 20000,
        heatLevel: 4,
        status: 'wanted',
        photoUrl: 'img/sofa.jpg',
        shopUrl: 'https://www.ozon.ru/search/?text=диван+угловой',
        slogan: 'Тронный зал для сериалов и дрейфа в дождь.',
        bountyTag: 'ГОСТИНАЯ'
      },
      {
        id: 'target-dom-wardrobe',
        title: 'Шкаф-купе',
        category: 'Дом',
        price: 42000,
        collected: 0,
        heatLevel: 4,
        status: 'wanted',
        photoUrl: 'img/wardrobe.jpg',
        shopUrl: 'https://www.avito.ru/rossiya?q=шкаф+купе',
        slogan: 'Всё по полкам: от зимней куртки до запасов чая.',
        bountyTag: 'ХРАНИЛИЩЕ'
      },
      {
        id: 'target-dom-desk',
        title: 'Рабочий стол',
        category: 'Дом',
        price: 17500,
        collected: 0,
        heatLevel: 4,
        status: 'wanted',
        photoUrl: 'img/desk.jpg',
        shopUrl: 'https://www.dns-shop.ru/search/?q=стол+для+работы',
        slogan: 'Угол для ПК и купленных карт. Кабели — в коробку.',
        bountyTag: 'WORK MODE'
      },
      {
        id: 'target-dom-drill',
        title: 'Перфоратор',
        category: 'Дом',
        price: 9400,
        collected: 3000,
        heatLevel: 4,
        status: 'wanted',
        photoUrl: 'img/drill.jpg',
        shopUrl: 'https://www.dns-shop.ru/search/?q=перфоратор',
        slogan: 'Дюбель в стену — и полка на месте.',
        bountyTag: 'РЕМОНТ'
      },
      {
        id: 'target-dom-dining',
        title: 'Обеденный стол со стульями',
        category: 'Дом',
        price: 29000,
        collected: 0,
        heatLevel: 3,
        status: 'wanted',
        photoUrl: 'img/dining-table.jpg',
        shopUrl: 'https://www.ozon.ru/search/?text=обеденный+стол+со+стульями',
        slogan: 'Стол на шестерых. Собрания по понедельникам — отдельная боль.',
        bountyTag: 'СЕМЕЙНОЕ'
      },
      {
        id: 'target-dom-chair',
        title: 'Кресло',
        category: 'Дом',
        price: 21000,
        collected: 6000,
        heatLevel: 3,
        status: 'wanted',
        photoUrl: 'img/armchair.jpg',
        shopUrl: 'https://www.avito.ru/rossiya?q=кресло',
        slogan: 'Читалка с подоконником. Сюда влезает кот.',
        bountyTag: 'CHEAP WIN'
      },
      {
        id: 'target-dom-rug',
        title: 'Ковёр',
        category: 'Дом',
        price: 13500,
        collected: 0,
        heatLevel: 3,
        status: 'wanted',
        photoUrl: 'img/rug.jpg',
        shopUrl: 'https://www.avito.ru/rossiya?q=ковёр',
        slogan: 'Тёплый пол по-настоящему. Шерсть, синтетика, неважно.',
        bountyTag: 'ТЕПЛО'
      },
      {
        id: 'target-dom-microwave',
        title: 'Микроволновая печь',
        category: 'Дом',
        price: 11500,
        collected: 0,
        heatLevel: 3,
        status: 'wanted',
        photoUrl: 'img/microwave.jpg',
        shopUrl: 'https://www.dns-shop.ru/search/?q=микроволновая+печь+30+литров',
        slogan: 'Разогрев за минуту. Обед под ёжика в телевизоре.',
        bountyTag: 'QUICK WIN'
      },
      {
        id: 'target-dom-chandelier',
        title: 'Люстра',
        category: 'Дом',
        price: 8900,
        collected: 0,
        heatLevel: 3,
        status: 'wanted',
        photoUrl: 'img/chandelier.jpg',
        shopUrl: 'https://www.leroymerlin.ru/search/?q=люстра',
        slogan: 'Свет в центр комнаты. Без неё — лампа на проводе.',
        bountyTag: 'СВЕТ'
      },
      {
        id: 'target-dom-coffeemachine',
        title: 'Кофемашина',
        category: 'Дом',
        price: 34000,
        collected: 0,
        heatLevel: 2,
        status: 'wanted',
        photoUrl: 'img/coffee-machine.jpg',
        shopUrl: 'https://www.dns-shop.ru/search/?q=кофемашина',
        slogan: 'Ристретто на зерне. Утро начинается с неё.',
        bountyTag: 'ДОМАШНЕЕ'
      },
      {
        id: 'target-dom-shelf',
        title: 'Стеллаж',
        category: 'Дом',
        price: 11900,
        collected: 0,
        heatLevel: 2,
        status: 'wanted',
        photoUrl: 'img/shelf.jpg',
        shopUrl: 'https://www.leroymerlin.ru/search/?q=стеллаж',
        slogan: 'Дерево, полки и книги. Коллекция растёт.',
        bountyTag: 'DECOR'
      },
      {
        id: 'target-dom-lamp',
        title: 'Торшер',
        category: 'Дом',
        price: 4200,
        collected: 0,
        heatLevel: 2,
        status: 'wanted',
        photoUrl: 'img/floor-lamp.jpg',
        shopUrl: 'https://www.leroymerlin.ru/search/?q=торшер',
        slogan: 'Вечерний свет в углу. Уют включается кнопкой.',
        bountyTag: 'УЮТ'
      },
      {
        id: 'target-1793994233916',
        title: 'Стиральная машина',
        category: 'Дом',
        price: 50000,
        collected: 0,
        heatLevel: 5,
        status: 'wanted',
        photoUrl: 'img/washing-machine.png',
        shopUrl: 'https://www.dns-shop.ru/search/?q=стиральная+машина&category=c01df46f39137fd7',
        slogan: 'Стирать и сушить не в тазике же)',
        bountyTag: 'NEW TARGET'
      }
    ]
  };

  /* Пользовательские данные (могут прийти из старой версии файла). */
  var user = global.WISHLIST_CONFIG && typeof global.WISHLIST_CONFIG === 'object'
    ? global.WISHLIST_CONFIG
    : {};

  var profile = (user.profile && typeof user.profile === 'object')
    ? user.profile
    : DATA.profile;
  var categories = (Array.isArray(user.categories) && user.categories.length)
    ? user.categories.slice()
    : DATA.categories.slice();

  var rawItems = Array.isArray(user.items) ? user.items : DATA.items.slice();

  /* Если целей всё равно нет — подставляем демонстрационную, чтобы витрина
     не выглядела пустой до первой правки в мастерской NERO. */
  if (!rawItems.length) {
    rawItems = [{
      id: 'target-1793994233916',
      title: 'Стиральная машина',
      category: 'Дом',
      price: 50000,
      collected: 0,
      heatLevel: 5,
      status: 'wanted',
      photoUrl: 'img/washing-machine.png',
      shopUrl: 'https://www.dns-shop.ru/search/?q=стиральная+машина&category=c01df46f39137fd7',
      slogan: 'Стирать и сушить не в тазике же)',
      bountyTag: 'NEW TARGET'
    }];
  }

  var items = rawItems.map(function (src, i) {
    var it = (src && typeof src === 'object') ? src : {};
    var price = Math.max(0, Number(it.price) || 0);
    var collected = Math.min(price, Math.max(0, Number(it.collected) || 0));
    return {
      id: String(it.id || 'target-' + (i + 1)),
      title: String(it.title || 'БЕЗ НАЗВАНИЯ'),
      category: String(it.category || categories[1] || 'БЕЗ КАТЕГОРИИ'),
      price: price,
      collected: collected,
      heatLevel: Math.min(5, Math.max(1, Number(it.heatLevel) || 4)),
      status: it.status === 'busted' ? 'busted' : 'wanted',
      photoUrl: String(it.photoUrl || ''),
      shopUrl: String(it.shopUrl || ''),
      slogan: String(it.slogan || ''),
      bountyTag: String(it.bountyTag || '')
    };
  });

  global.WISHLIST_CONFIG = {
    profile: {
      callsign: String(profile.callsign || DEFAULTS.profile.callsign),
      statusMessage: String(profile.statusMessage || DEFAULTS.profile.statusMessage),
      currency: String(profile.currency || DEFAULTS.profile.currency),
      vibeNote: String(profile.vibeNote || DEFAULTS.profile.vibeNote)
    },
    categories: categories,
    items: items
  };

  /* Метка времени генерации файла.
     Витрина (js/core.js) сравнивает её с сохранённой в LocalStorage
     правкой из мастерской — так определяется, какая версия новее. */
  global.WISHLIST_CONFIG_META = {
    generated: 1794059905839
  };
})(window);
