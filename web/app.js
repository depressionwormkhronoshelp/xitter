/* Xitter — клиент. Без сборки, чистый JS. */
(() => {
  'use strict';

  // ---------- окружение ----------
  const isApp =
    location.protocol === 'file:' ||
    !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ||
    /XitterApp/.test(navigator.userAgent);
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // настройки внешнего вида дублируются в куки: их не теряем, даже если браузер чистит localStorage
  const COOKIE_KEYS = ['theme', 'icon', 'themeColors'];
  // согласие: 'all' — настройки дублируются в cookie, 'essential' — только localStorage
  const consent = () => { try { return localStorage.getItem('xitter.consent') || cookie.get('consent'); } catch { return cookie.get('consent'); } };
  const cookie = {
    get(k) { const m = document.cookie.match(new RegExp('(?:^|; )xitter_' + k + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : null; },
    set(k, v) {
      try { document.cookie = `xitter_${k}=${v == null ? '' : encodeURIComponent(v)}; path=/; max-age=${v == null ? 0 : 400 * 864e2}; SameSite=Lax`; } catch {}
    },
  };
  const store = {
    get(k) {
      let v = null;
      try { v = localStorage.getItem('xitter.' + k); } catch {}
      if (v == null && COOKIE_KEYS.includes(k)) v = cookie.get(k);
      return v;
    },
    set(k, v) {
      try { v == null ? localStorage.removeItem('xitter.' + k) : localStorage.setItem('xitter.' + k, v); } catch {}
      if (COOKIE_KEYS.includes(k) && consent() === 'all') cookie.set(k, v);
    },
  };

  const COLORS = [
    ['#FF9A3C', '#FF5F1F'], ['#FFB86B', '#FF7A59'], ['#FF8A65', '#F4511E'], ['#FFC371', '#FF5F6D'],
    ['#F7971E', '#FFD200'], ['#FF7E5F', '#FEB47B'], ['#FDA085', '#F6D365'], ['#FF6A00', '#EE0979'],
  ];
  const EMOJI = '😀 😂 🥹 😍 🥰 😘 😎 🤩 🤔 🙃 😴 😭 😡 🤯 🥳 😇 👍 👎 👏 🙏 💪 🤝 👀 🔥 ❤️ 🧡 💔 ✨ 🎉 💯 ✅ ❌ 🍕 ☕ 🍺 🎮 ⚽ 🎧 📷 🚀 🌈 ☀️ 🌙 🐶 🐱 🦊 🌸 🍀'.split(' ');

  const B = window.XBackend;
  const S = {
    me: null,
    started: false,
    chats: new Map(),
    messages: new Map(),
    typing: new Map(),
    posts: [],
    activity: [],
    feedMode: 'all',
    actCat: 'all',
    tab: 'feed',
    current: null,       // открытый чат
    msgUnsub: null,
    postId: null,        // открытый пост
    comments: [],
    commentsUnsub: null,
    viewUser: null,      // { id, followers }
    meFollowers: null,
  };

  // ---------- утилиты ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const initials = (name) => (String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
  const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
  const safePhoto = (p) => (typeof p === 'string' && /^data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+$/.test(p) ? p : '');

  function avatarStyle(entity) {
    const [c1, c2] = (entity && entity.colors) || COLORS[0];
    const photo = safePhoto(entity && entity.photo);
    return `--c1:${c1};--c2:${c2}${photo ? `;background-image:url('${photo}')` : ''}`;
  }
  // ---------- оформление Plus: обводка, видео на аватарке, шрифт и эмодзи у ника, галочка ----------
  const FONTS = { '': 'Обычный', serif: 'С засечками', mono: 'Моно', round: 'Округлый', hand: 'Рукописный', pixel: 'Пиксели', heavy: 'Жирный' };
  const RINGS = { '': 'Нет', gold: 'Золото', fire: 'Огонь', rainbow: 'Радуга', neon: 'Неон', ice: 'Лёд', ink: 'Чёрная', custom: 'Свой цвет' };
  const EFFECTS = { '': 'Нет', shine: 'Блик', snow: 'Снег', stars: 'Звёзды', aurora: 'Сияние', glitch: 'Глитч' };
  const VERIFIED = '<svg class="vbadge" viewBox="0 0 24 24"><title>Подтверждённый аккаунт</title><path d="M12 1.8l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3 1 3-2.6 1.9-1 3-3.2-.1L12 22.2l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3-1-3 2.6-1.9 1-3 3.2.1z"/><path class="tick" d="M8 12.3l2.7 2.7 5.5-5.5"/></svg>';
  const styleOf = (u) => (u && u.style) || {};
  const okColor = (c) => /^#[0-9a-f]{6}$/i.test(c || '');
  function nameHTML(u, text) {
    const s = styleOf(u);
    const font = s.font && FONTS[s.font] ? ` font-${s.font}` : '';
    const emoji = typeof s.emoji === 'string' && s.emoji.length <= 8 ? s.emoji : '';
    return `<span class="uname${font}">${esc(text != null ? text : (u && (u.name || u.title)) || '')}</span>${u && u.verified ? VERIFIED : ''}${emoji ? `<span class="nemoji">${esc(emoji)}</span>` : ''}`;
  }
  function decor(entity) {
    const s = styleOf(entity);
    let cls = '', css = '';
    if (s.ring === 'custom' && okColor(s.ringColor)) { cls = ' ring ring-custom'; css = `;--ring:${s.ringColor}`; }
    else if (s.ring && RINGS[s.ring] && s.ring !== 'custom') cls = ` ring ring-${s.ring}`;
    const media = s.avatarMedia && s.avatarMedia.id ? s.avatarMedia.id : '';
    return { cls, css, media };
  }
  function avatarHTML(entity, cls = '', online = false, attrs = '') {
    const photo = safePhoto(entity && entity.photo);
    const d = decor(entity);
    return `<span class="avatar ${cls} ${online ? 'online' : ''} ${photo ? 'photo' : ''}${d.cls}" style="${avatarStyle(entity)}${d.css}" ${attrs}${d.media ? ` data-media="${esc(d.media)}"` : ''}>${photo ? '' : esc(initials(entity && (entity.title || entity.name)))}<i class="dot"></i></span>`;
  }
  function setAvatar(el, entity, online) {
    const photo = safePhoto(entity && entity.photo);
    const d = decor(entity);
    el.setAttribute('style', avatarStyle(entity) + d.css);
    el.className = `${el.className.split(' ').filter((c) => !/^(ring|ring-.*|online|photo|has-media)$/.test(c)).join(' ')}${d.cls}`;
    el.classList.toggle('online', !!online);
    el.classList.toggle('photo', !!photo);
    if (d.media) el.dataset.media = d.media; else delete el.dataset.media;
    delete el.dataset.loaded;
    el.innerHTML = `${photo ? '' : esc(initials(entity && (entity.title || entity.name)))}<i class="dot"></i>`;
  }
  // видео и GIF (аватарки и баннеры) подгружаются из файлов после отрисовки
  let hydrateTimer = 0;
  function hydrateMedia() {
    for (const el of document.querySelectorAll('[data-media]')) {
      const id = el.dataset.media;
      if (el.dataset.loaded === id) continue;
      el.dataset.loaded = id;
      B.fileURL(id).then((f) => {
        if (el.dataset.media !== id) return;
        el.querySelector(':scope > .amedia')?.remove();
        const vid = /^video\//.test(f.type);
        const m = document.createElement(vid ? 'video' : 'img');
        m.className = 'amedia';
        if (vid) { m.muted = true; m.loop = true; m.autoplay = true; m.playsInline = true; m.setAttribute('playsinline', ''); }
        m.src = f.url;
        el.prepend(m);
        el.classList.add('has-media');
      }).catch(() => {});
    }
  }
  new MutationObserver(() => { clearTimeout(hydrateTimer); hydrateTimer = setTimeout(hydrateMedia, 30); }).observe(document.body, { childList: true, subtree: true });

  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  function fmtListTime(ts) {
    const d = new Date(ts), now = new Date();
    if (sameDay(d, now)) return fmtTime(ts);
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'Вчера';
    if (now - d < 6 * 864e5) return d.toLocaleDateString('ru-RU', { weekday: 'short' });
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  function fmtDay(ts) {
    const d = new Date(ts), now = new Date();
    if (sameDay(d, now)) return 'Сегодня';
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (sameDay(d, y)) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  }
  function fmtAgo(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'сейчас';
    if (s < 3600) return `${Math.floor(s / 60)} мин`;
    if (s < 86400) return `${Math.floor(s / 3600)} ч`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} д`;
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }
  function fmtSeen(u) {
    if (!u) return '';
    if (u.online) return 'в сети';
    if (!u.lastSeen) return 'не в сети';
    const a = fmtAgo(u.lastSeen);
    if (a === 'сейчас') return 'был(а) только что';
    return /\d (мин|ч|д)$/.test(a) ? `был(а) ${a} назад` : `был(а) ${a}`;
  }
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  };
  const num = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' млн' : n >= 1e4 ? (n / 1e3).toFixed(1).replace('.0', '') + ' тыс' : String(n));

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }
  window.addEventListener('xitter-error', (e) => toast(e.detail));
  window.addEventListener('xitter-db-missing', () => { $('#dbBanner').hidden = false; });

  // сжатие фото перед сохранением в Firestore (документ не больше 1 МБ)
  function compressImage(file, max = 1080, limit = 900000) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Это не фото'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.naturalWidth, h = img.naturalHeight, q = 0.8;
        const c = document.createElement('canvas');
        for (let i = 0; i < 8; i++) {
          const k = Math.min(1, max / Math.max(w, h));
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          const data = c.toDataURL('image/jpeg', q);
          if (data.length <= limit) return resolve(data);
          q = Math.max(0.45, q - 0.1);
          max = Math.round(max * 0.82);
        }
        reject(new Error('Фото слишком большое'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фото')); };
      img.src = url;
    });
  }
  function pickFile(input) {
    return new Promise((resolve) => {
      input.value = '';
      input.onchange = () => resolve(input.files && input.files[0]);
      input.click();
    });
  }

  // ---------- тема ----------
  // три бесплатные темы (белая, чёрная, оранжевая) и своя с Plus
  const THEME_DEFAULT = { bg: '#101820', text: '#f2f5f7', ink: '#7c5cff', bubble: '#1e2a36' };
  function customColors() {
    try { return { ...THEME_DEFAULT, ...JSON.parse(store.get('themeColors') || '{}') }; } catch { return { ...THEME_DEFAULT }; }
  }
  // яркость цвета, чтобы подобрать текст на акценте
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  function applyTheme(t) {
    const root = document.documentElement;
    if (['light', 'dark', 'orange', 'custom'].includes(t)) root.dataset.theme = t;
    else delete root.dataset.theme;
    for (const k of ['--bg', '--text', '--ink', '--on-ink', '--bubble-them', '--scheme-dark']) root.style.removeProperty(k);
    let bar = '#ffffff';
    if (t === 'custom') {
      const c = customColors();
      root.style.setProperty('--bg', c.bg);
      root.style.setProperty('--text', c.text);
      root.style.setProperty('--ink', c.ink);
      root.style.setProperty('--on-ink', lum(c.ink) > 0.6 ? '#0a0a0a' : '#ffffff');
      root.style.setProperty('--bubble-them', c.bubble);
      root.style.colorScheme = lum(c.bg) < 0.5 ? 'dark' : 'light';
      bar = c.bg;
      $$('#customColors input').forEach((i) => { i.value = c[i.dataset.var]; });
    } else root.style.removeProperty('color-scheme');
    $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === (t || 'auto')));
    $('#customColors').hidden = t !== 'custom';
    const dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
    if (t === 'orange') bar = '#fff4ea'; else if (dark) bar = '#000000';
    $('meta[name=theme-color]').content = bar;
  }
  $$('#themeSeg button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.theme === 'custom' && !(S.me && S.me.plus)) { toast('Своя тема доступна с Xitter Plus'); return; }
    store.set('theme', b.dataset.theme === 'auto' ? null : b.dataset.theme);
    applyTheme(store.get('theme'));
    haptic(5);
  }));
  $$('#customColors input').forEach((i) => i.addEventListener('input', () => {
    const c = customColors();
    c[i.dataset.var] = i.value;
    store.set('themeColors', JSON.stringify(c));
    applyTheme('custom');
  }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(store.get('theme')));

  // ---------- вход ----------
  let authEmail = '';
  function goStep(id, back) {
    $$('.auth-step').forEach((f) => {
      const on = f.id === id;
      f.classList.toggle('active', on);
      f.classList.toggle('back-anim', on && !!back);
    });
    $('#authError').textContent = '';
    const focus = { stepEmail: '#authEmail', stepPassword: '#authPassword', stepProfile: '#profName' }[id];
    if (focus && matchMedia('(pointer: fine)').matches) setTimeout(() => $(focus).focus(), 60);
  }
  function authFail(err, form) {
    $('#authError').textContent = err.message;
    (form || $('.auth-step.active')).animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }],
      { duration: 380, easing: 'ease-out' }
    );
    haptic([10, 40, 10]);
  }
  async function busy(btn, fn) {
    btn.classList.add('loading');
    btn.disabled = true;
    try { return await fn(); } finally { btn.classList.remove('loading'); btn.disabled = false; }
  }
  function afterSignIn(res, suggestedName) {
    if (!res) return;
    if (res.needsProfile) {
      const guess = (authEmail.split('@')[0] || '').toLowerCase().replace(/[^a-z0-9_.]/g, '').slice(0, 24);
      if (!$('#profUsername').value) $('#profUsername').value = guess;
      if (suggestedName && !$('#profName').value) $('#profName').value = suggestedName;
      goStep('stepProfile');
    } else if (res.user) {
      S.me = res.user;
      enterMain();
    }
  }

  function initAuth() {
    if (!isApp && /Android/i.test(navigator.userAgent)) $('#apkLink').hidden = false;
    // во встроенном WebView всплывающие окна Google и Apple не работают
    if (isApp) { $('#googleBtn').hidden = $('#appleBtn').hidden = true; $('.or').hidden = true; }

    $('#stepEmail').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('#authEmail').value.trim();
      if (!v) return authFail(new Error('Введите email'), e.currentTarget);
      if (v.includes('@') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return authFail(new Error('Проверьте email'), e.currentTarget);
      authEmail = v;
      $('#pwHint').textContent = `${v} · если аккаунта ещё нет, мы его создадим`;
      goStep('stepPassword');
    });
    $('#stepPassword').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      try {
        const res = await busy($('button[type=submit]', form), () => B.signInOrUp(authEmail, $('#authPassword').value));
        $('#authPassword').value = '';
        afterSignIn(res);
      } catch (err) { authFail(err, form); }
    });
    $$('[data-back]').forEach((b) => b.addEventListener('click', () => goStep(b.dataset.back, true)));
    const social = (provider) => async (e) => {
      try {
        const res = await busy(e.currentTarget, () => B.signInWith(provider));
        afterSignIn(res, res.suggestedName);
      } catch (err) { authFail(err); }
    };
    $('#googleBtn').addEventListener('click', social('google'));
    $('#appleBtn').addEventListener('click', social('apple'));
    $('#stepProfile').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      try {
        S.me = await busy($('button[type=submit]', form), () => B.createProfile({ name: $('#profName').value, username: $('#profUsername').value }));
        enterMain();
      } catch (err) { authFail(err, form); }
    });
    $('#profLogout').addEventListener('click', async () => { try { await B.logout(); } catch {} goStep('stepEmail', true); });
  }

  function showAuth(step = 'stepEmail', error = '') {
    $('#main').hidden = true;
    $('#auth').hidden = false;
    goStep(step);
    if (error) $('#authError').textContent = error;
  }

  async function logout() {
    closeSheet();
    if (S.msgUnsub) S.msgUnsub();
    if (S.commentsUnsub) S.commentsUnsub();
    S.msgUnsub = S.commentsUnsub = null;
    S.started = false;
    try { await B.logout(); } catch {}
    S.me = null;
    S.chats.clear();
    S.messages.clear();
    S.posts = [];
    S.activity = [];
    resetStack();
    showAuth();
  }

  // TURN-сервер для звонков из настроек приложения (config/calls)
  let callConfig = null;
  async function loadCallConfig() {
    try {
      callConfig = await B.getConfig('calls');
      if (callConfig && callConfig.turn && callConfig.turn.length && !store.get('turn')) Call.setTurn(callConfig.turn);
    } catch (e) { console.warn(e); }
  }

  // ---------- cookie: баннер согласия ----------
  function setConsent(v) {
    try { localStorage.setItem('xitter.consent', v); } catch {}
    if (v === 'all') {
      // запомнить выбор и сразу продублировать текущие настройки
      cookie.set('consent', 'all');
      COOKIE_KEYS.forEach((k) => { let x = null; try { x = localStorage.getItem('xitter.' + k); } catch {} if (x != null) cookie.set(k, x); });
    } else {
      cookie.set('consent', null);
      COOKIE_KEYS.forEach((k) => cookie.set(k, null));
    }
    $('#cookieBanner').hidden = true;
    renderCookieInfo();
  }
  function renderCookieInfo() {
    $('#cookieInfo').textContent = consent() === 'all' ? 'Настройки дублируются в cookie' : consent() === 'essential' ? 'Только необходимые' : 'Выбор не сделан';
  }
  $('#cookieBanner').addEventListener('click', (e) => {
    const b = e.target.closest('[data-consent]');
    if (b) setConsent(b.dataset.consent);
  });
  $('#cookieBtn').addEventListener('click', () => showActions([
    { label: 'Разрешить cookie для настроек', fn: () => { setConsent('all'); toast('Настройки сохраняются и в cookie'); } },
    { label: 'Только необходимые', fn: () => { setConsent('essential'); toast('Cookie с настройками удалены'); } },
    { label: 'Политика cookie', fn: () => openLegal('cookies') },
  ]));
  if (!isApp && !consent()) $('#cookieBanner').hidden = false;
  renderCookieInfo();

  // ---------- документы ----------
  const LEGAL = { privacy: 'Конфиденциальность', terms: 'Условия использования', refunds: 'Политика возврата', cookies: 'Политика cookie' };
  function openLegal(name) {
    $('#legalTitle').textContent = LEGAL[name] || 'Документ';
    $('#legalFrame').src = `legal/${name}.html?embed=1`;
    openSheet('legalSheet');
  }
  document.addEventListener('click', (e) => {
    const l = e.target.closest('[data-legal]');
    if (!l) return;
    e.preventDefault();
    openLegal(l.dataset.legal);
  });

  // ---------- мои данные: выгрузка и удаление ----------
  $('#exportBtn').addEventListener('click', async (e) => {
    try {
      const data = await busy(e.currentTarget, () => B.exportMyData());
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `xitter-${(S.me && S.me.username) || 'data'}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      toast('Файл с данными сохранён');
    } catch (err) { toast(err.message); }
  });
  async function runWipe(account, btn) {
    try {
      await busy(btn, () => B.deleteMyData({ account, onProgress: (t) => toast('Удаляю: ' + t.toLowerCase() + '…') }));
      if (account) { toast('Аккаунт удалён'); closeSheet(); setTimeout(() => location.reload(), 1200); return; }
      toast('Ваши данные удалены');
      closeSheet();
    } catch (err) {
      if (err.code === 'relogin') { toast(err.message); return; }
      toast(err.message);
    }
  }
  $('#wipeBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    showActions([{ label: 'Удалить посты, комментарии, лайки, сообщения и файлы', danger: true, fn: () => runWipe(false, btn) }]);
  });
  $('#deleteAccountBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    showActions([{ label: 'Удалить аккаунт навсегда', danger: true, fn: () => runWipe(true, btn) }]);
  });

  // ---------- основной экран ----------
  let firstChats = true;
  function enterMain() {
    if (S.started) return;
    S.started = true;
    firstChats = true;
    $('#auth').hidden = true;
    const main = $('#main');
    main.hidden = false;
    main.animate([{ opacity: 0, transform: 'scale(1.04)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    switchTab('feed', true);
    renderMe();
    loadCallConfig();
    B.start({
      onChats: (chats) => { onChats(chats, firstChats); firstChats = false; },
      onMe: (u) => { S.me = u; renderMe(); schedule(); },
      onSignal: (d) => Call.onSignal(d),
      onPosts: (posts) => { S.posts = posts; schedule(); },
      onActivity: (items) => { onActivity(items); },
      onUsers: () => schedule(),
    });
  }

  // перерисовка всего, что видно, не чаще раза за кадр
  let raf = 0;
  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!S.started) return;
      renderFeed();
      renderActivity();
      renderChats(false);
      if (S.tab === 'me') renderMeProfile();
      if (isOpen('userPage')) renderUserProfile();
      if (isOpen('postPage')) renderPostPage();
      if (S.current && S.chats.has(S.current)) { renderChatHeader(); renderMessages(false); }
    });
  }

  function renderMe() {
    if (!S.me) return;
    $('#tabAvatar').innerHTML = avatarHTML(S.me);
    setAvatar($('#composeAvatar'), S.me);
    setAvatar($('#commentAvatar'), S.me);
    $('#meHandle').textContent = S.me.username ? '@' + S.me.username : '';
    $('#serverInfo').textContent = B.projectId + (B.emulator ? ' (эмулятор)' : '');
    $('#connInfo').textContent = navigator.onLine ? 'в сети' : 'нет интернета';
    $('#bannedScreen').hidden = !S.me.banned;
    $('#luneInfo').textContent = `${num(S.me.lune || 0)} ☾`;
    $('#adminBtn').hidden = !B.isAdmin;
    if (isOpen('adminPage') && !B.isAdmin) resetStack();
    renderWallet();
    renderIconPicker();
    // Plus закончился: своя тема и иконка возвращаются к обычным
    // (только когда статус уже загружен, иначе при обновлении страницы всё сбрасывалось)
    if (!S.me.statusLoaded) return;
    if (!S.me.plus && store.get('theme') === 'custom') { store.set('theme', null); applyTheme(null); }
    if (!S.me.plus && store.get('icon')) { store.set('icon', null); setAppIcon('orange'); }
  }
  $('#bannedLogout').addEventListener('click', () => logout());
  // ограниченный аккаунт может читать, но не писать
  function canPost() {
    if (S.me && (S.me.restricted || S.me.banned)) { toast('Ваш аккаунт ограничен администрацией'); return false; }
    return true;
  }
  addEventListener('online', renderMe);
  addEventListener('offline', renderMe);

  const user = (uid) => (S.me && uid === S.me.id ? S.me : B.user(uid));
  const following = () => new Set((S.me && S.me.following) || []);

  // ---------- навигация: стек страниц ----------
  const stack = ['tabsPage'];
  // на компьютере: боковое меню слева, сообщения в две колонки
  const desktop = matchMedia('(min-width: 900px)');
  const syncSide = () => $('#sideChats').classList.toggle('active', stack.includes('chatsPage'));
  const isOpen = (id) => stack.includes(id);
  function push(id) {
    if (stack.includes(id)) { while (stack[stack.length - 1] !== id) pop(true); return; }
    const top = $('#' + stack[stack.length - 1]);
    top.classList.add('covered');
    const page = $('#' + id);
    page.style.zIndex = stack.length + 1; // порядок слоёв = порядок в стеке
    page.classList.remove('pushed');
    void page.offsetWidth;
    page.classList.add('open');
    stack.push(id);
    syncSide();
    haptic(6);
  }
  function pop(silent) {
    if (stack.length < 2) return false;
    const id = stack.pop();
    const page = $('#' + id);
    page.classList.remove('open');
    page.classList.add('pushed');
    $('#' + stack[stack.length - 1]).classList.remove('covered');
    onPagePopped(id);
    syncSide();
    if (!silent) haptic(5);
    return true;
  }
  function resetStack() { while (stack.length > 1) pop(true); }
  function onPagePopped(id) {
    if (id === 'chatPage') closeChat();
    if (id === 'postPage') { if (S.commentsUnsub) S.commentsUnsub(); S.commentsUnsub = null; S.postId = null; }
    if (id === 'userPage') S.viewUser = null;
  }
  $$('[data-pop]').forEach((b) => b.addEventListener('click', () => pop()));

  // свайп «назад» от левого края, как в iOS
  $$('.page.pushed').forEach((page) => {
    let sx = 0, sy = 0, dx = 0, t0 = 0, active = false, decided = false, under = null;
    page.addEventListener('touchstart', (e) => {
      if (stack[stack.length - 1] !== page.id) return;
      const t = e.touches[0];
      const left = t.clientX - page.getBoundingClientRect().left;
      if (left > 30) return;
      sx = t.clientX; sy = t.clientY; dx = 0; t0 = performance.now(); active = true; decided = false;
      under = $('#' + stack[stack.length - 2]);
    }, { passive: true });
    page.addEventListener('touchmove', (e) => {
      if (!active) return;
      const t = e.touches[0];
      dx = Math.max(0, t.clientX - sx);
      if (!decided) {
        if (Math.abs(t.clientY - sy) > 12 && Math.abs(t.clientY - sy) > dx) { active = false; return; }
        if (dx > 6) { decided = true; page.classList.add('dragging'); under.classList.add('dragging'); } else return;
      }
      const p = Math.min(1, dx / page.offsetWidth);
      page.style.transform = `translateX(${dx}px)`;
      under.style.transform = `translateX(${-28 * (1 - p)}%)`;
    }, { passive: true });
    const end = () => {
      if (!active) return;
      active = false;
      if (!decided) return;
      const v = dx / Math.max(1, performance.now() - t0);
      page.classList.remove('dragging'); under.classList.remove('dragging');
      page.style.transform = under.style.transform = '';
      if (dx > page.offsetWidth * 0.35 || v > 0.5) pop();
    };
    page.addEventListener('touchend', end);
    page.addEventListener('touchcancel', end);
  });

  // ---------- вкладки ----------
  function switchTab(name, quiet) {
    if (name === 'compose') { openCompose(); return; }
    if (S.tab === 'activity' && name !== 'activity') markActivitySeen();
    if (name === S.tab && !quiet) {
      const sc = $(`#tab-${name} .scroller`);
      if (sc) sc.scrollTo({ top: 0, behavior: 'smooth' });
    }
    S.tab = name;
    $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    if (name === 'search') loadPeople();
    if (name === 'me') { renderMeProfile(); loadMyFollowers(); }
    if (name === 'activity') renderActivity(true);
    if (!quiet) haptic(5);
  }
  $$('#tabbar button[data-tab]').forEach((b) => b.addEventListener('click', () => { if (desktop.matches && b.dataset.tab !== 'compose') resetStack(); switchTab(b.dataset.tab); }));

  // ---------- посты ----------
  const HEART = '<svg><use href="#i-heart"/></svg>';
  function postHTML(p, opts = {}) {
    const a = user(p.author);
    const liked = (p.likes || []).includes(S.me.id);
    const likes = (p.likes || []).length;
    const comments = p.commentCount || 0;
    return `<article class="post" data-post="${p.id}">
      <div class="post-head">
        ${avatarHTML(a, '', false, `data-user="${esc(p.author)}"`)}
        <button class="who" data-user="${esc(p.author)}"><b>${nameHTML(a)}</b><small>@${esc(a.username)} · ${fmtAgo(p.createdAt)}</small></button>
        <button class="icon-btn more" data-more aria-label="Ещё"><svg><use href="#i-more"/></svg></button>
      </div>
      ${p.text ? `<p class="post-text" ${opts.full ? '' : 'data-open'}>${esc(p.text)}</p>` : ''}
      ${p.image ? `<div class="post-img" data-img><img src="${esc(p.image)}" alt="" loading="lazy" /></div>` : ''}
      ${p.file && p.file.id ? `<div class="bubble file-bubble post-file" data-file="${esc(p.file.id)}"><span class="ficon"><svg><use href="#i-${/^audio\//.test(p.file.type) ? (profileMusic.id === p.file.id && profileMusic.playing ? 'pause' : 'play') : 'file'}"/></svg></span><span class="fmeta"><b>${esc(p.file.name)}</b><small>${fmtSize(p.file.size)} · ${/^audio\//.test(p.file.type) ? (profileMusic.id === p.file.id && profileMusic.playing ? 'играет' : 'слушать') : /^(video|image)\//.test(p.file.type) ? 'открыть' : 'скачать'}</small></span></div>` : ''}
      <div class="post-actions">
        <button class="like ${liked ? 'on' : ''}" data-like aria-label="Нравится">${HEART}<span>${likes ? num(likes) : ''}</span></button>
        <button data-open aria-label="Комментарии"><svg><use href="#i-comment"/></svg><span>${comments ? num(comments) : ''}</span></button>
        <button class="share" data-share aria-label="Поделиться"><svg><use href="#i-send"/></svg></button>
      </div>
    </article>`;
  }
  // перерисовка без мерцания: узлы постов, которые не изменились, остаются на месте
  const listCache = new WeakMap();
  function renderPosts(container, posts, opts = {}) {
    let cache = listCache.get(container);
    if (!cache) { cache = new Map(); listCache.set(container, cache); }
    const firstRender = !cache.size;
    const next = new Map();
    const nodes = posts.map((p, i) => {
      const html = postHTML(p, opts);
      let entry = cache.get(p.id);
      if (!entry || entry.html !== html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        entry = { html, el: t.content.firstChild };
        if (!firstRender && cache.size) entry.el.style.animation = cache.has(p.id) ? 'none' : '';
        entry.el.style.setProperty('--i', firstRender ? i : 0);
      }
      next.set(p.id, entry);
      return entry.el;
    });
    listCache.set(container, next);
    // заменяем только если порядок или состав поменялся
    const cur = [...container.children];
    if (cur.length !== nodes.length || cur.some((n, i) => n !== nodes[i])) container.replaceChildren(...nodes);
  }
  function findPost(id) { return S.posts.find((p) => p.id === id); }

  function feedPosts() {
    const f = following();
    if (S.feedMode === 'following') return S.posts.filter((p) => f.has(p.author) || p.author === S.me.id);
    if (S.feedMode === 'fav') return S.posts.filter((p) => (p.likes || []).includes(S.me.id));
    return S.posts;
  }
  function renderFeed() {
    if (!S.me) return;
    const posts = feedPosts();
    renderPosts($('#feedList'), posts);
    const empty = $('#feedEmpty');
    empty.hidden = posts.length > 0;
    if (!posts.length) {
      empty.innerHTML = {
        following: '<b>Здесь пока пусто</b><span>Подпишитесь на людей, и их посты появятся в этой ленте</span><button class="btn-black small" data-go="search">Найти людей</button>',
        fav: '<b>Нет избранного</b><span>Посты, которые вам понравились, будут здесь</span>',
        all: '<b>Пока нет постов</b><span>Станьте первым, кто что-нибудь опубликует</span><button class="btn-black small" data-go="compose">Новый пост</button>',
      }[S.feedMode];
    }
  }
  $('#feedEmpty').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) switchTab(b.dataset.go); });
  $$('#feedSeg button').forEach((b) => b.addEventListener('click', () => {
    S.feedMode = b.dataset.feed;
    $$('#feedSeg button').forEach((x) => x.classList.toggle('active', x === b));
    const list = $('#feedList');
    list.replaceChildren();
    listCache.delete(list);
    renderFeed();
    $('#feedScroll').scrollTop = 0;
    haptic(5);
  }));

  function likePost(id, el, fromImage) {
    const p = findPost(id);
    if (!p) return;
    const liked = (p.likes || []).includes(S.me.id);
    if (fromImage && liked) { burstHeart(el); return; }
    const on = B.toggleLike(p);
    p.likes = on ? [...(p.likes || []), S.me.id] : (p.likes || []).filter((x) => x !== S.me.id);
    // обновляем кнопку на месте, чтобы анимация не сбилась
    $$(`[data-post="${CSS.escape(id)}"] [data-like]`).forEach((btn) => {
      btn.classList.toggle('on', on);
      btn.querySelector('span').textContent = p.likes.length ? num(p.likes.length) : '';
      if (on) { const svg = btn.querySelector('svg'); svg.style.animation = 'none'; void svg.offsetWidth; svg.style.animation = ''; }
    });
    for (const c of $$('#feedList, #meProfile .profile-posts, #userProfile .profile-posts, #postView .post-holder')) {
      const cache = listCache.get(c);
      const entry = cache && cache.get(id);
      if (entry) entry.html = postHTML(p, c.matches('.post-holder') ? { full: true } : {});
    }
    if (on && fromImage) burstHeart(el);
    haptic(on ? 12 : 6);
  }
  function burstHeart(postEl) {
    const img = postEl.querySelector('.post-img');
    if (!img) return;
    const h = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    h.setAttribute('class', 'big-heart');
    h.innerHTML = '<use href="#i-heart"/>';
    img.appendChild(h);
    setTimeout(() => h.remove(), 950);
  }

  // клики по постам — один обработчик на все списки
  let lastTap = { id: null, t: 0, timer: 0 };
  function onPostClick(e) {
    const postEl = e.target.closest('[data-post]');
    const u = e.target.closest('[data-user]');
    if (u) { openUser(u.dataset.user); return; }
    if (!postEl) return;
    const id = postEl.dataset.post;
    if (e.target.closest('[data-like]')) return likePost(id, postEl);
    if (e.target.closest('[data-share]')) return sharePost(id);
    if (e.target.closest('[data-more]')) return postMenu(id);
    if (e.target.closest('[data-img]')) {
      // двойное касание — лайк, одиночное — открыть фото
      const now = performance.now();
      if (lastTap.id === id && now - lastTap.t < 300) {
        clearTimeout(lastTap.timer);
        lastTap = { id: null, t: 0, timer: 0 };
        likePost(id, postEl, true);
      } else {
        const src = e.target.closest('[data-img]').querySelector('img').src;
        lastTap = { id, t: now, timer: setTimeout(() => openViewer(src), 300) };
      }
      return;
    }
    const pf = e.target.closest('[data-file]');
    if (pf) { openFile(pf.dataset.file, pf); return; }
    if (e.target.closest('[data-open]')) openPost(id);
  }
  ['#feedList', '#meProfile', '#userProfile', '#postView'].forEach((s) => $(s).addEventListener('click', onPostClick));

  async function sharePost(id) {
    const p = findPost(id);
    if (!p) return;
    const a = user(p.author);
    const text = `${a.name} (@${a.username}) в Xitter:\n${p.text || ''}`.trim();
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); toast('Текст поста скопирован'); }
    } catch {}
  }
  function postMenu(id) {
    const p = findPost(id);
    if (!p) return;
    const items = [];
    if (p.author === S.me.id) items.push({ label: 'Удалить пост', danger: true, fn: async () => { try { await B.deletePost(id); toast('Пост удалён'); if (S.postId === id) pop(); } catch (e) { toast(e.message); } } });
    else {
      const on = following().has(p.author);
      items.push({ label: on ? 'Отписаться' : 'Подписаться', fn: () => toggleFollow(p.author) });
      items.push({ label: 'Написать сообщение', fn: () => messageUser(p.author) });
    }
    items.push({ label: 'Открыть профиль', fn: () => openUser(p.author) });
    showActions(items);
  }

  // ---------- пост и комментарии ----------
  function openPost(id) {
    if (!findPost(id)) return;
    if (S.commentsUnsub && S.postId !== id) { S.commentsUnsub(); S.commentsUnsub = null; }
    S.postId = id;
    S.comments = [];
    $('#postView').innerHTML = '<div class="post-holder"></div><ul class="comments" id="commentList"></ul>';
    renderPostPage();
    push('postPage');
    if (!S.commentsUnsub) S.commentsUnsub = B.subscribeComments(id, (list) => { S.comments = list; renderComments(); });
  }
  function renderPostPage() {
    const p = S.postId && findPost(S.postId);
    const holder = $('#postView .post-holder');
    if (!holder) return;
    if (!p) { holder.innerHTML = '<div class="empty"><b>Пост удалён</b></div>'; return; }
    renderPosts(holder, [p], { full: true });
    renderComments();
  }
  function renderComments() {
    const list = $('#commentList');
    if (!list) return;
    list.innerHTML = S.comments.length
      ? S.comments.map((c, i) => {
        const a = user(c.author);
        return `<li class="comment" style="--i:${i}">${avatarHTML(a, 's', false, `data-user="${esc(c.author)}"`)}
          <div class="c-main"><b data-user="${esc(c.author)}">${nameHTML(a, a.username || a.name)}</b><time>${fmtAgo(c.createdAt)}</time><p>${esc(c.text)}</p></div></li>`;
      }).join('')
      : '<div class="empty"><b>Комментариев нет</b><span>Напишите первый</span></div>';
  }
  $('#commentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#commentInput');
    const text = input.value.trim();
    const p = findPost(S.postId);
    if (!text || !p || !canPost()) return;
    input.value = '';
    try {
      await B.addComment(p, text);
      const sc = $('#postView');
      sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
      haptic(8);
    } catch (err) { toast(err.message); input.value = text; }
  });

  // ---------- новый пост ----------
  let composeImage = null, composeFile = null;
  function renderComposeFile() {
    const box = $('#composeFile');
    box.hidden = !composeFile;
    if (composeFile) box.querySelector('b').textContent = `${composeFile.name} · ${fmtSize(composeFile.size)}`;
  }
  function openCompose() {
    composeImage = null; composeFile = null;
    renderComposeFile();
    $('#postText').value = '';
    $('#composeImage').hidden = true;
    setAvatar($('#composeAvatar'), S.me);
    openSheet('composeSheet');
    setTimeout(() => $('#postText').focus(), 350);
  }
  $('#addPhotoBtn').addEventListener('click', async () => {
    const f = await pickFile($('#postFile'));
    if (!f) return;
    try {
      composeImage = await compressImage(f);
      $('#composeImage img').src = composeImage;
      $('#composeImage').hidden = false;
    } catch (e) { toast(e.message); }
  });
  $('#removeImage').addEventListener('click', () => { composeImage = null; $('#composeImage').hidden = true; });
  // файл к посту: до 20 МБ, с Plus до 50 МБ (как в чатах)
  $('#addFileBtn').addEventListener('click', async (e) => {
    const f = await anyFile('');
    if (!f) return;
    try {
      composeFile = await uploadPicked(f, e.currentTarget);
      renderComposeFile();
    } catch (err) { toast(err.message); }
  });
  $('#removeFile').addEventListener('click', () => { composeFile = null; renderComposeFile(); });
  $('#publishBtn').addEventListener('click', async (e) => {
    const text = $('#postText').value.trim();
    if (!text && !composeImage && !composeFile) { toast('Напишите что-нибудь или добавьте фото или файл'); return; }
    if (!canPost()) return;
    try {
      await busy(e.currentTarget, () => B.createPost({ text, image: composeImage, file: composeFile }));
      closeSheet();
      if (S.feedMode === 'fav') $('#feedSeg [data-feed="all"]').click();
      switchTab('feed', true);
      $('#feedScroll').scrollTo({ top: 0, behavior: 'smooth' });
      haptic(12);
      toast('Опубликовано');
    } catch (err) { toast(err.message); }
  });

  // ---------- поиск людей и подписки ----------
  let peopleTimer, peopleReq = 0;
  async function loadPeople() {
    const req = ++peopleReq;
    try {
      const users = await B.searchUsers($('#peopleSearch').value);
      if (req !== peopleReq) return;
      renderPeople(users);
    } catch (e) { toast(e.message); }
  }
  let lastPeople = [];
  function renderPeople(users = lastPeople) {
    lastPeople = users;
    const f = following();
    $('#peopleList').innerHTML = users.map((u, i) => `<li class="row" data-user="${esc(u.id)}" style="--i:${i}">
      ${avatarHTML(u, '', u.online)}
      <div class="row-main"><b>${nameHTML(u)}</b><span>@${esc(u.username)}${u.bio ? ' · ' + esc(u.bio) : ''}</span></div>
      <button class="btn-out ${f.has(u.id) ? 'on' : ''}" data-follow="${esc(u.id)}">${f.has(u.id) ? 'Вы подписаны' : 'Подписаться'}</button>
    </li>`).join('');
    $('#peopleEmpty').hidden = users.length > 0;
  }
  $('#peopleSearch').addEventListener('input', () => { clearTimeout(peopleTimer); peopleTimer = setTimeout(loadPeople, 200); });
  $('#peopleList').addEventListener('click', (e) => {
    const fb = e.target.closest('[data-follow]');
    if (fb) { toggleFollow(fb.dataset.follow); return; }
    const row = e.target.closest('[data-user]');
    if (row) openUser(row.dataset.user);
  });

  async function toggleFollow(uid) {
    const on = !following().has(uid);
    // сразу показываем результат, Firestore догонит
    S.me = { ...S.me, following: on ? [...following(), uid] : [...following()].filter((x) => x !== uid) };
    if (S.viewUser && S.viewUser.id === uid && S.viewUser.followers != null) S.viewUser.followers += on ? 1 : -1;
    $$(`[data-follow="${CSS.escape(uid)}"]`).forEach((b) => { b.classList.toggle('on', on); b.textContent = on ? 'Вы подписаны' : b.dataset.label || 'Подписаться'; });
    haptic(on ? 12 : 6);
    schedule();
    try { await B.follow(uid, on); } catch (e) { toast(e.message); }
  }

  // ---------- активность ----------
  function onActivity(items) {
    S.activity = items;
    const unread = items.filter((a) => !a.read).length;
    const badge = $('#actBadge');
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? '99+' : unread || '';
    if (S.tab === 'activity' && document.visibilityState === 'visible') queueSeen();
    schedule();
  }
  let seenTimer;
  function queueSeen() { clearTimeout(seenTimer); seenTimer = setTimeout(markActivitySeen, 1500); }
  function markActivitySeen() {
    clearTimeout(seenTimer);
    const ids = S.activity.filter((a) => !a.read).map((a) => a.id);
    if (ids.length) B.markActivityRead(ids);
  }
  function activityText(a) {
    const u = user(a.from);
    const name = `<b data-user="${esc(a.from)}">${nameHTML(u)}</b>`;
    const t = `<time> · ${fmtAgo(a.createdAt)}</time>`;
    if (a.type === 'follow') return `${name} подписался(-ась) на вас${t}`;
    if (a.type === 'like') return `${name} оценил(а) ваш пост${t}`;
    if (a.type === 'comment') return `${name} прокомментировал(а): ${esc(a.text || '')}${t}`;
    if (a.type === 'gift') return `${name} подарил(а) вам ${esc((GIFT_INFO[a.gift] || ['🎁', 'подарок'])[0])} ${esc((GIFT_INFO[a.gift] || ['', 'подарок'])[1].toLowerCase())}${(a.count || 1) > 1 ? ' ×' + a.count : ''}${t}`;
    if (a.type === 'nft') return `${name} подарил(а) вам NFT${t}`;
    return name + t;
  }
  function renderActivity(animate) {
    if (!S.me) return;
    const f = following();
    const items = S.activity.filter((a) => S.actCat === 'all' || a.type === S.actCat);
    const row = (a, i) => {
      const u = user(a.from);
      let right = '';
      if (a.type === 'gift' || a.type === 'nft') right = `<span class="thumb gift-thumb">${a.type === 'gift' ? (GIFT_INFO[a.gift] || ['🎁'])[0] : '💎'}</span>`;
      else if (a.type === 'follow') right = `<button class="btn-out ${f.has(a.from) ? 'on' : ''}" data-follow="${esc(a.from)}" data-label="Подписаться">${f.has(a.from) ? 'Вы подписаны' : 'Подписаться'}</button>`;
      else {
        const p = findPost(a.postId);
        const img = p && safePhoto(p.image);
        right = img ? `<span class="thumb" style="background-image:url('${img}')"></span>` : `<span class="thumb">${esc(((p && p.text) || (a.preview && a.preview.text) || '').slice(0, 40))}</span>`;
      }
      return `<li class="row ${a.read ? '' : 'unread'}" data-act="${esc(a.id)}" style="--i:${i}">
        ${a.read ? '' : '<i class="udot"></i>'}
        ${avatarHTML(u, '', false, `data-user="${esc(a.from)}"`)}
        <div class="row-main"><p class="wrap">${activityText(a)}</p></div>
        ${right}
      </li>`;
    };
    const fresh = items.filter((a) => !a.read), old = items.filter((a) => a.read);
    let html = '';
    if (fresh.length) html += `<li class="act-section">Новое</li>` + fresh.map(row).join('');
    if (old.length) html += `<li class="act-section">Ранее</li>` + old.map((a, i) => row(a, i + fresh.length)).join('');
    const list = $('#activityList');
    list.classList.toggle('settled', !animate);
    list.innerHTML = html;
    $('#activityEmpty').hidden = items.length > 0;
  }
  $$('#actChips button').forEach((b) => b.addEventListener('click', () => {
    S.actCat = b.dataset.cat;
    $$('#actChips button').forEach((x) => x.classList.toggle('active', x === b));
    renderActivity(true);
    haptic(5);
  }));
  $('#activityList').addEventListener('click', (e) => {
    const fb = e.target.closest('[data-follow]');
    if (fb) { toggleFollow(fb.dataset.follow); return; }
    const u = e.target.closest('[data-user]');
    const row = e.target.closest('[data-act]');
    if (!row) return;
    const a = S.activity.find((x) => x.id === row.dataset.act);
    if (!a) return;
    if (a.type === 'gift' || a.type === 'nft') { resetStack(); switchTab('me'); loadGifts(S.me.id); return; }
    if (u || a.type === 'follow') openUser(a.from);
    else if (findPost(a.postId)) openPost(a.postId);
    else toast('Пост удалён');
  });

  // ---------- профили ----------
  // узор из подарков вокруг аватарки (как в Telegram)
  const PATTERN = [[8, 18, 22, 0.5], [22, 52, 16, 0.35], [10, 80, 18, 0.3], [28, 12, 14, 0.3], [30, 84, 20, 0.45], [70, 12, 14, 0.3],
    [92, 18, 22, 0.5], [78, 52, 16, 0.35], [90, 80, 18, 0.3], [70, 84, 20, 0.45], [50, 6, 12, 0.25], [16, 36, 12, 0.25], [84, 36, 12, 0.25]];
  function giftPatternHTML(uid) {
    const g = giftCache.get(uid);
    if (!g || (!g.nfts.length && !g.gifts.length)) return { html: '', css: '' };
    const n = g.nfts[0];
    let item, css = '';
    if (n) {
      const col = B.collection(n.cid) || {};
      const bd = BACKDROPS[n.backdrop] || BACKDROPS.sapphire;
      css = `--b1:${bd[1]};--b2:${bd[2]}`;
      item = col.image && col.image.id ? `<i data-media="${esc(col.image.id)}"></i>` : esc(col.emoji || '🎁');
    } else item = esc((GIFT_INFO[g.gifts[0].type] || ['🎁'])[0]);
    const html = `<div class="gift-pattern">${PATTERN.map(([x, y, sz, o]) => `<span style="left:${x}%;top:${y}%;font-size:${sz}px;opacity:${o}">${item}</span>`).join('')}</div>`;
    return { html, css, nft: !!n };
  }
  const PTAB = { me: 'posts', user: 'posts' };
  function profileHTML(u, isMe, followers) {
    const posts = S.posts.filter((p) => p.author === u.id);
    const f = following();
    const tile = (attrs, icon, label, cls = '') => `<button class="tg-act ${cls}" ${attrs}>${icon}<span>${label}</span></button>`;
    const svg = (n) => `<svg><use href="#i-${n}"/></svg>`;
    const acts = isMe
      ? tile('id="editProfileBtn"', svg('edit'), 'Изменить') + tile('data-chats', svg('send'), 'Сообщения')
        + tile('data-wallet', '<b class="moon">☾</b>', `${num(u.lune || 0)} LUNE`) + tile('data-market', svg('gift'), 'Маркет')
      : tile(`data-message="${esc(u.id)}"`, svg('comment'), 'Сообщение')
        + tile(`data-follow="${esc(u.id)}"`, svg(f.has(u.id) ? 'heart' : 'plus'), f.has(u.id) ? 'Подписаны' : 'Подписаться', f.has(u.id) ? 'on' : '')
        + tile(`data-callto="${esc(u.id)}"`, svg('phone'), 'Звонок') + tile(`data-giftto="${esc(u.id)}"`, svg('gift'), 'Подарок');
    const s = styleOf(u);
    const banner = s.banner && s.banner.id
      ? `<div class="banner fx-${esc(EFFECTS[s.effect] ? s.effect || 'none' : 'none')}" data-media="${esc(s.banner.id)}"><i class="fx"></i></div>` : '';
    const pat = giftPatternHTML(u.id);
    const music = u.music && u.music.id
      ? `<button class="music-card ${profileMusic.id === u.music.id && profileMusic.playing ? 'playing' : ''}" data-music="${esc(u.music.id)}"><span class="mplay"><svg><use href="#i-${profileMusic.id === u.music.id && profileMusic.playing ? 'pause' : 'play'}"/></svg></span><span class="mtext"><b>${esc(u.music.title || 'Трек')}</b><small>Музыка профиля</small></span><span class="eq"><i></i><i></i><i></i><i></i></span></button>` : '';
    const g = giftCache.get(u.id) || { gifts: [], nfts: [] };
    const giftCount = g.nfts.length + g.gifts.reduce((t, x) => t + (x.count || 1), 0);
    const giftIcons = [...g.nfts.slice(0, 3).map((n) => esc((B.collection(n.cid) || {}).emoji || '💎')), ...g.gifts.slice(0, 3).map((x) => (GIFT_INFO[x.type] || ['🎁'])[0])].slice(0, 3).join('');
    const extra = u.usernames || [];
    const tab = PTAB[isMe ? 'me' : 'user'];
    return `<div class="profile tg">
      <div class="tg-head ${banner ? 'has-banner' : ''} ${pat.nft ? 'tinted' : ''}" style="${pat.css}">
        ${banner}${pat.html}
        ${avatarHTML(u, 'xl', !isMe && u.online)}
        <h2>${nameHTML(u)}</h2>
        <div class="tg-seen">${isMe ? 'в сети' : esc(fmtSeen(u))}${u.plus ? ' <span class="plus-badge">Plus</span>' : ''}</div>
      </div>
      <div class="tg-acts">${acts}</div>
      ${music}
      <div class="tg-card">
        <div class="tg-row"><div><b class="link">@${esc(u.username)}</b>${extra.length ? `<small>также ${extra.map((n) => '<b class="link">@' + esc(n) + '</b>').join(', ')}</small>` : ''}<small>имя пользователя</small></div></div>
        ${u.bio ? `<div class="tg-row"><div><p class="bio">${esc(u.bio)}</p><small>о себе</small></div></div>` : ''}
      </div>
      <div class="tg-card">
        <button class="tg-row" data-ptab="posts">${svg('image')}<span>${num(posts.length)} ${plural(posts.length, 'пост', 'поста', 'постов')}</span></button>
        <button class="tg-row" data-ptab="gifts">${svg('gift')}<span>${num(giftCount)} ${plural(giftCount, 'подарок', 'подарка', 'подарков')} <i class="gicons">${giftIcons}</i></span></button>
        <div class="tg-row">${svg('heart')}<span>${followers == null ? '—' : num(followers)} ${plural(followers || 0, 'подписчик', 'подписчика', 'подписчиков')} · ${num((u.following || []).length)} ${plural((u.following || []).length, 'подписка', 'подписки', 'подписок')}</span></div>
      </div>
    </div>
    <nav class="seg-text profile-tabs"><button data-ptab="posts" class="${tab === 'posts' ? 'active' : ''}">Посты</button><button data-ptab="gifts" class="${tab === 'gifts' ? 'active' : ''}">Подарки</button></nav>
    <div class="profile-posts" ${tab === 'posts' ? '' : 'hidden'}></div>
    ${tab === 'posts' && !posts.length ? `<div class="empty"><b>Постов пока нет</b>${isMe ? '<button class="btn-black small" data-go="compose">Новый пост</button>' : ''}</div>` : ''}
    ${tab === 'gifts' ? giftsGridHTML(u.id, isMe) : ''}`;
  }
  // разметку профиля обновляем, а список постов внутри — через кэш узлов
  function renderProfileInto(box, u, isMe, followers) {
    const holder = box.querySelector('.profile-posts');
    const keep = holder && [...holder.children];
    box.innerHTML = profileHTML(u, isMe, followers);
    const nh = box.querySelector('.profile-posts');
    if (keep && keep.length) nh.replaceChildren(...keep);
    const cache = holder && listCache.get(holder);
    if (cache) listCache.set(nh, cache);
    renderPosts(nh, S.posts.filter((p) => p.author === u.id));
  }
  function renderMeProfile() {
    if (!S.me) return;
    if (!giftCache.has(S.me.id)) loadGifts(S.me.id);
    renderProfileInto($('#meProfile'), S.me, true, S.meFollowers);
  }
  async function loadMyFollowers() {
    try { S.meFollowers = (await B.getUser(S.me.id)).followers; renderMeProfile(); } catch {}
  }
  function renderUserProfile() {
    if (!S.viewUser) return;
    const u = user(S.viewUser.id);
    $('#userHandle').textContent = u.username ? '@' + u.username : '';
    renderProfileInto($('#userProfile'), u, false, S.viewUser.followers);
  }
  async function openUser(uid) {
    if (!uid) return;
    if (uid === S.me.id) { resetStack(); switchTab('me'); return; }
    S.viewUser = { id: uid, followers: null };
    PTAB.user = 'posts';
    loadGifts(uid);
    const box = $('#userProfile');
    box.replaceChildren();
    renderUserProfile();
    push('userPage');
    box.scrollTop = 0;
    try {
      const u = await B.getUser(uid);
      if (S.viewUser && S.viewUser.id === uid) { S.viewUser.followers = u.followers; renderUserProfile(); }
    } catch (e) { toast(e.message); }
  }
  for (const box of [$('#meProfile'), $('#userProfile')]) {
    box.addEventListener('click', (e) => {
      const fb = e.target.closest('[data-follow]');
      if (fb) { e.stopPropagation(); toggleFollow(fb.dataset.follow); return; }
      const m = e.target.closest('[data-message]');
      if (m) { e.stopPropagation(); messageUser(m.dataset.message); return; }
      if (e.target.closest('#editProfileBtn')) { openEdit(); return; }
      if (e.target.closest('[data-chats]')) { openChats(); return; }
      if (e.target.closest('[data-wallet]')) { openWallet(); return; }
      const gt = e.target.closest('[data-giftto]');
      if (gt) { openGiftSheet(gt.dataset.giftto); return; }
      const ct = e.target.closest('[data-callto]');
      if (ct) { messageUser(ct.dataset.callto).then(() => Call.start(false)); return; }
      const pt = e.target.closest('[data-ptab]');
      if (pt) {
        const isMe = box.id === 'meProfile';
        PTAB[isMe ? 'me' : 'user'] = pt.dataset.ptab;
        if (isMe) renderMeProfile(); else renderUserProfile();
        if (pt.classList.contains('tg-row')) box.querySelector('.profile-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.closest('[data-market]')) { openMarket(); return; }
      const nf = e.target.closest('[data-nft]');
      if (nf) { openNft(nf.dataset.nft); return; }
      const gf = e.target.closest('[data-giftinfo]');
      if (gf) { giftInfo(gf.dataset.giftinfo); return; }
      const mu = e.target.closest('[data-music]');
      if (mu) { toggleProfileMusic(mu.dataset.music); return; }
      const g = e.target.closest('[data-go]');
      if (g) switchTab(g.dataset.go);
    }, true);
  }
  $('#settingsBtn').addEventListener('click', () => { renderMe(); openSheet('settingsSheet'); });

  // ---------- редактирование профиля ----------
  let editColors = null, editPhoto = null;
  const avatarFile = document.createElement('input');
  avatarFile.type = 'file'; avatarFile.accept = 'image/*'; avatarFile.hidden = true;
  document.body.appendChild(avatarFile);
  function openEdit() {
    editColors = S.me.colors;
    editPhoto = S.me.photo || '';
    editStyle = JSON.parse(JSON.stringify(S.me.style || {}));
    editMusic = S.me.music || null;
    musicChanged = false;
    renderPlusEdit();
    $('#setName').value = S.me.name;
    $('#setBio').value = S.me.bio || '';
    renderEditAvatar();
    $('#swatches').innerHTML = COLORS.map((c, i) => `<button data-i="${i}" style="--c1:${c[0]};--c2:${c[1]}" class="${c[0] === (editColors || [])[0] && c[1] === (editColors || [])[1] ? 'active' : ''}" aria-label="Цвет ${i + 1}"></button>`).join('');
    openSheet('editSheet');
  }
  function renderEditAvatar() {
    const wrap = $('.edit-avatar');
    setAvatar($('#editAvatar'), { ...S.me, colors: editColors, photo: editPhoto, style: editStyle });
    let btns = $('.edit-photo-btns', wrap);
    if (!btns) {
      btns = document.createElement('div');
      btns.className = 'edit-photo-btns';
      wrap.appendChild(btns);
    }
    btns.innerHTML = `<button type="button" data-photo="pick">${editPhoto ? 'Сменить фото' : 'Добавить фото'}</button>${editPhoto ? ' · <button type="button" data-photo="del">Убрать</button>' : ''}`;
  }
  $('.edit-avatar').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-photo]') || e.target.closest('#editAvatar');
    if (!b) return;
    if (b.dataset.photo === 'del') { editPhoto = ''; renderEditAvatar(); return; }
    const f = await pickFile(avatarFile);
    if (!f) return;
    try { editPhoto = await compressImage(f, 320, 120000); renderEditAvatar(); } catch (err) { toast(err.message); }
  });
  $('#swatches').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    editColors = COLORS[+b.dataset.i];
    $$('#swatches button').forEach((x) => x.classList.toggle('active', x === b));
    renderEditAvatar();
    haptic(5);
  });
  $('#saveProfile').addEventListener('click', async () => {
    try {
      if (S.me.plus) editStyle.emoji = firstGrapheme($('#setEmoji').value.trim());
      S.me = await B.updateMe({
        name: $('#setName').value, bio: $('#setBio').value, colors: editColors, photo: editPhoto,
        ...(S.me.plus ? { style: editStyle } : {}),
        ...(musicChanged ? { music: editMusic } : {}),
      });
      renderMe();
      schedule();
      closeSheet();
      toast('Профиль сохранён');
      haptic(10);
    } catch (e) { toast(e.message); }
  });
  $('#logoutBtn').addEventListener('click', () => logout());


  // ---------- оформление профиля (Plus) и музыка ----------
  let editStyle = {}, editMusic = null, musicChanged = false;
  const firstGrapheme = (v) => {
    if (!v) return '';
    try { return [...new Intl.Segmenter('ru', { granularity: 'grapheme' }).segment(v)][0].segment.slice(0, 8); } catch { return [...v][0] || ''; }
  };
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace('.0', '') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ');
  const anyFile = (accept) => { const i = $('#anyFile'); i.accept = accept || ''; return pickFile(i); };
  function chipsHTML(map, cur) {
    return Object.entries(map).map(([k, v]) => `<button type="button" data-k="${esc(k)}" class="${(cur || '') === k ? 'active' : ''}">${esc(v)}</button>`).join('');
  }
  function mediaEditHTML(item, label, kind) {
    return item && item.id
      ? `<span class="media-name">${esc(item.title || label)}</span><button type="button" class="btn-soft small" data-medit="${kind}">Заменить</button><button type="button" class="btn-soft small danger" data-mdel="${kind}">Убрать</button>`
      : `<button type="button" class="btn-soft small" data-medit="${kind}">Выбрать файл</button>`;
  }
  function renderPlusEdit() {
    const plus = !!S.me.plus;
    $('#plusEdit').classList.toggle('locked', !plus);
    $('#plusLock').hidden = plus;
    $('#effectChips').innerHTML = chipsHTML(EFFECTS, editStyle.effect);
    $('#ringChips').innerHTML = chipsHTML(RINGS, editStyle.ring) + `<input type="color" id="ringColor" value="${okColor(editStyle.ringColor) ? editStyle.ringColor : '#ff7a1a'}" ${editStyle.ring === 'custom' ? '' : 'hidden'} />`;
    $('#fontChips').innerHTML = Object.entries(FONTS).map(([k, v]) => `<button type="button" data-k="${k}" class="font-${k || 'none'} ${(editStyle.font || '') === k ? 'active' : ''}">${v}</button>`).join('');
    $('#setEmoji').value = editStyle.emoji || '';
    $('#bannerEdit').innerHTML = mediaEditHTML(editStyle.banner, 'Баннер', 'banner');
    $('#avMediaEdit').innerHTML = mediaEditHTML(editStyle.avatarMedia, 'Видео или GIF', 'avatar');
    $('#musicEdit').innerHTML = mediaEditHTML(editMusic, 'Трек', 'music');
    $$('#plusEdit input, #plusEdit button').forEach((x) => { x.disabled = !plus; });
  }
  function onChip(boxSel, key) {
    $(boxSel).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      editStyle[key] = b.dataset.k;
      renderPlusEdit();
      renderEditAvatar();
      haptic(5);
    });
  }
  onChip('#effectChips', 'effect');
  onChip('#ringChips', 'ring');
  onChip('#fontChips', 'font');
  $('#ringChips').addEventListener('input', (e) => { if (e.target.id === 'ringColor') { editStyle.ringColor = e.target.value; renderEditAvatar(); } });
  async function uploadPicked(file, btn) {
    const label = btn ? btn.textContent : '';
    try {
      return await B.uploadFile(file, (p) => { if (btn) btn.textContent = `Загрузка ${Math.round(p * 100)}%`; });
    } finally { if (btn) btn.textContent = label; }
  }
  $('#editSheet').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-mdel]');
    if (del) {
      const k = del.dataset.mdel;
      if (k === 'music') { editMusic = null; musicChanged = true; }
      else if (k === 'banner') delete editStyle.banner;
      else delete editStyle.avatarMedia;
      renderPlusEdit(); renderEditAvatar();
      return;
    }
    const ed = e.target.closest('[data-medit]');
    if (!ed) return;
    const k = ed.dataset.medit;
    const f = await anyFile(k === 'music' ? 'audio/*' : k === 'banner' ? 'image/*' : 'image/gif,video/*');
    if (!f) return;
    if (k === 'avatar' && !/^(video\/|image\/gif)/.test(f.type)) { toast('Нужно видео или GIF'); return; }
    if (k === 'banner' && !/^image\//.test(f.type)) { toast('Нужно фото или GIF'); return; }
    if (k === 'music' && !/^audio\//.test(f.type)) { toast('Нужен аудиофайл'); return; }
    try {
      const up = await uploadPicked(f, ed);
      if (k === 'music') { editMusic = { id: up.id, title: f.name.replace(/\.[^.]+$/, '').slice(0, 80), size: up.size }; musicChanged = true; }
      else if (k === 'banner') editStyle.banner = { id: up.id, type: up.type };
      else editStyle.avatarMedia = { id: up.id, type: up.type };
      renderPlusEdit(); renderEditAvatar();
    } catch (err) { toast(err.message); }
  });

  // музыка профиля: один плеер
  const profileMusic = { audio: new Audio(), id: null, playing: false };
  profileMusic.audio.addEventListener('ended', () => { profileMusic.playing = false; schedule(); });
  profileMusic.audio.addEventListener('pause', () => { profileMusic.playing = false; schedule(); });
  profileMusic.audio.addEventListener('play', () => { profileMusic.playing = true; schedule(); });
  async function toggleProfileMusic(id) {
    const a = profileMusic.audio;
    if (profileMusic.id === id) { a.paused ? a.play().catch(() => {}) : a.pause(); return; }
    Voice.stop();
    a.pause();
    profileMusic.id = id;
    try {
      toast('Загружаю трек…');
      const f = await B.fileURL(id);
      if (profileMusic.id !== id) return;
      a.src = f.url;
      await a.play();
      $('#toast').classList.remove('show');
    } catch (err) { toast(err.message || 'Не удалось включить трек'); }
  }

  // ---------- LUNE: кошелёк и юзернеймы ----------
  function renderWallet() {
    if (!S.me) return;
    $('#walletBalance').textContent = num(S.me.lune || 0);
    $('#myUsernames').innerHTML = (S.me.usernames || []).length
      ? S.me.usernames.map((n) => `<span class="chip-static">@${esc(n)}</span>`).join('')
      : '<span class="fine">Пока нет</span>';
    $('#buyNameBtn').textContent = `Купить за ${B.USERNAME_PRICE}`;
  }
  function openWallet() { renderWallet(); openSheet('walletSheet'); }
  $('#walletBtn').addEventListener('click', openWallet);
  $('#buyNameBtn').addEventListener('click', async (e) => {
    const name = $('#buyName').value;
    if ((S.me.lune || 0) < B.USERNAME_PRICE) { toast(`Нужно ${B.USERNAME_PRICE} LUNE`); return; }
    try {
      await busy(e.currentTarget, () => B.buyUsername(name));
      $('#buyName').value = '';
      toast('Юзернейм куплен');
      haptic(12);
    } catch (err) { toast(err.message); }
  });

  // ---------- иконка приложения (Plus) ----------
  const ICONS = {
    orange: ['#FFC07A', '#FF7A1A', '#FF4D2E', '#ffffff'],
    dark: ['#48484a', '#1c1c1e', '#000000', '#ffffff'],
    light: ['#ffffff', '#f4f4f6', '#dcdce0', '#0a0a0a'],
    sunset: ['#FFB199', '#FF0844', '#8E2DE2', '#ffffff'],
    mint: ['#C2F7DE', '#1FD1A5', '#0F8B7E', '#ffffff'],
    ocean: ['#9BE7FF', '#4FACFE', '#1E3C72', '#ffffff'],
  };
  const ICON_NAMES = { orange: 'Оранжевая', dark: 'Чёрная', light: 'Белая', sunset: 'Закат', mint: 'Мята', ocean: 'Океан' };
  function iconSVG(name) {
    const [a, b, c, g] = ICONS[name] || ICONS.orange;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".5" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient><radialGradient id="hl" cx=".3" cy=".1" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="512" height="512" fill="url(#bg)"/><rect width="512" height="512" fill="url(#hl)"/><path d="M150 140h72l34 56 34-56h72l-70 116 74 116h-72l-38-62-38 62h-72l74-116z" fill="${g}" fill-opacity=".92"/></svg>`;
  }
  const iconURL = (name) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSVG(name));
  function setAppIcon(name) {
    if (!ICONS[name]) name = 'orange';
    const url = iconURL(name);
    for (const sel of ['link[rel=icon]', 'link[rel=apple-touch-icon]']) { const l = $(sel); if (l) l.href = url; }
    // Android: переключение значка на рабочем столе; Windows: значок окна и панели задач
    try { window.XitterNative && window.XitterNative.setIcon(name); } catch {}
    if (window.xitterDesktop) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        c.getContext('2d').drawImage(img, 0, 0, 256, 256);
        try { window.xitterDesktop.setIcon(c.toDataURL('image/png')); } catch {}
      };
      img.src = url;
    }
  }
  function renderIconPicker() {
    const cur = store.get('icon') || 'orange';
    $('#iconPicker').innerHTML = Object.keys(ICONS).map((k) => `<button type="button" data-icon="${k}" class="${k === cur ? 'active' : ''}" aria-label="${ICON_NAMES[k]}"><img src="${iconURL(k)}" alt="" /><span>${ICON_NAMES[k]}</span></button>`).join('');
  }
  $('#iconPicker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-icon]');
    if (!b) return;
    if (!(S.me && S.me.plus)) { toast('Смена иконки доступна с Xitter Plus'); return; }
    store.set('icon', b.dataset.icon === 'orange' ? null : b.dataset.icon);
    setAppIcon(b.dataset.icon);
    renderIconPicker();
    toast(window.XitterNative ? 'Иконка сменится на рабочем столе через пару секунд' : 'Иконка изменена');
    haptic(8);
  });

  // ---------- стикеры ----------
  const STICKERS = [
    { pack: 'Эмоции', items: [
      ['love', '😍', 'beat'], ['lol', '😂', 'shake'], ['cool', '😎', 'float'], ['cry', '😭', 'wobble'], ['wow', '🤯', 'pop'], ['angry', '😡', 'shake'],
      ['party', '🥳', 'bounce'], ['think', '🤔', 'tilt'], ['sleep', '😴', 'float'], ['kiss', '😘', 'beat'], ['halo', '😇', 'float'], ['skull', '💀', 'wobble'],
    ] },
    { pack: 'Звери', items: [
      ['fox', '🦊', 'bounce'], ['cat', '🐱', 'tilt'], ['dog', '🐶', 'wobble'], ['frog', '🐸', 'bounce'], ['panda', '🐼', 'float'], ['unicorn', '🦄', 'float'],
    ] },
    { pack: 'Фразы', items: [
      ['t-hi', 'ПРИВЕТ', 'text'], ['t-ok', 'ОК', 'text'], ['t-thx', 'СПАСИБО', 'text'], ['t-fire', 'ОГОНЬ', 'text'], ['t-wait', 'ЖДУ', 'text'], ['t-lol', 'АХАХА', 'text'],
      ['t-love', 'ЛЮБЛЮ', 'text'], ['t-gn', 'СПОКОЙНОЙ НОЧИ', 'text'],
    ] },
    { pack: 'Разное', items: [
      ['fire', '🔥', 'beat'], ['heart', '❤️', 'beat'], ['rocket', '🚀', 'fly'], ['moon', '🌙', 'tilt'], ['star', '⭐', 'spin'], ['100', '💯', 'pop'],
    ] },
  ];
  const STICKER_MAP = new Map(STICKERS.flatMap((p) => p.items.map((it) => [it[0], it])));
  function stickerHTML(id, fallback) {
    const it = STICKER_MAP.get(id);
    if (!it) return `<div class="bubble emoji-only">${esc(fallback || '')}</div>`;
    return it[2] === 'text'
      ? `<div class="sticker text-sticker st-${esc(id)}"><span>${esc(it[1])}</span></div>`
      : `<div class="sticker anim-${it[2]}"><span>${it[1]}</span></div>`;
  }
  $('#stickerPop').innerHTML = STICKERS.map((p) => `<div class="sp-title">${esc(p.pack)}</div><div class="sp-grid">${p.items.map((it) => `<button type="button" data-sticker="${it[0]}">${it[2] === 'text' ? `<span class="sp-text">${esc(it[1])}</span>` : it[1]}</button>`).join('')}</div>`).join('');
  $('#stickerBtn').addEventListener('click', () => { $('#emojiPop').hidden = true; $('#stickerPop').hidden = !$('#stickerPop').hidden; haptic(5); });
  $('#stickerPop').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sticker]');
    if (!b || !S.current) return;
    const it = STICKER_MAP.get(b.dataset.sticker);
    sendText(S.current, it[2] === 'text' ? it[1] : it[1], { kind: 'sticker', sticker: it[0] });
    $('#stickerPop').hidden = true;
  });

  // ---------- файлы в чате: до 20 МБ, с Plus до 50 МБ ----------
  $('#fileBtn').addEventListener('click', async () => {
    const chatId = S.current;
    if (!canPost()) return;
    const f = await anyFile('');
    if (!f || !chatId) return;
    const bar = $('#uploadBar');
    $('#uploadText').textContent = `${f.name} · ${fmtSize(f.size)}`;
    $('#uploadFill').style.width = '0%';
    bar.hidden = false;
    try {
      const up = await B.uploadFile(f, (p) => { $('#uploadFill').style.width = Math.round(p * 100) + '%'; });
      sendText(chatId, '📎 ' + up.name, { kind: 'file', file: up });
    } catch (e) { toast(e.message); }
    bar.hidden = true;
  });
  async function openFile(id, el) {
    el.classList.add('loading');
    try {
      const f = await B.fileURL(id);
      if (/^image\//.test(f.type)) openViewer(f.url);
      else if (/^video\//.test(f.type)) openViewer(f.url, true);
      else if (/^audio\//.test(f.type)) toggleProfileMusic(id); // повторное нажатие ставит на паузу
      else {
        const a = document.createElement('a');
        a.href = f.url; a.download = f.name;
        document.body.appendChild(a); a.click();
        setTimeout(() => a.remove(), 1000);
      }
    } catch (e) { toast(e.message); }
    el.classList.remove('loading');
  }


  // ---------- подарки ----------
  const GIFT_INFO = {
    heart: ['💝', 'Сердце'], bear: ['🧸', 'Мишка'], gift: ['🎁', 'Подарок'], rose: ['🌹', 'Роза'], cake: ['🎂', 'Торт'], bouquet: ['💐', 'Букет'],
    rocket: ['🚀', 'Ракета'], trophy: ['🏆', 'Кубок'], ring: ['💍', 'Кольцо'], diamond: ['💎', 'Бриллиант'], champagne: ['🍾', 'Шампанское'],
  };
  const BACKDROPS = {
    sapphire: ['Сапфир', '#4facfe', '#1e3c72'], emerald: ['Изумруд', '#43e97b', '#0b6e4f'], ruby: ['Рубин', '#ff5f6d', '#8b0a1a'],
    amethyst: ['Аметист', '#c471f5', '#4a1b8c'], gold: ['Золото', '#f9d423', '#c76b00'], onyx: ['Оникс', '#5a5a5a', '#0b0b0b'],
    coral: ['Коралл', '#ff9a8b', '#ff5e62'], mint: ['Мята', '#a8edea', '#2bb3a3'], midnight: ['Полночь', '#3a4bb0', '#0f0c29'], sunset: ['Закат', '#ffb347', '#e1306c'],
  };
  const giftCache = new Map(); // uid -> { gifts, nfts }
  let collectionsLoaded = null;
  const ensureCollections = () => (collectionsLoaded ||= B.listCollections().catch((e) => { collectionsLoaded = null; throw e; }));
  async function loadGifts(uid) {
    try {
      await ensureCollections();
      giftCache.set(uid, await B.userGifts(uid));
      schedule();
      if (isOpen('marketPage')) renderMarket();
    } catch (e) { console.warn(e); }
  }
  // NFT: экземпляр (cid, num, backdrop) или коллекция (id, backdrops)
  function nftArtHTML(n, big) {
    const col = n.cid ? B.collection(n.cid) || n : n;
    const bd = BACKDROPS[n.backdrop || (col.backdrops || [])[0]] || BACKDROPS.sapphire;
    const img = col.image && col.image.id ? ` data-media="${esc(col.image.id)}"` : '';
    return `<span class="nft-art ${big ? 'big' : ''} ${img && col.fullBleed ? 'full' : ''}" style="--b1:${bd[1]};--b2:${bd[2]}"><span class="nft-img"${img}>${img ? '' : esc(col.emoji || '🎁')}</span></span>`;
  }
  const nftName = (n) => { const c = B.collection(n.cid); return `${c ? c.name : 'NFT'} #${n.num}`; };
  function giftsGridHTML(uid, isMe) {
    const g = giftCache.get(uid);
    if (!g) return '<div class="empty"><b>Загружаю подарки…</b></div>';
    const tiles = [
      ...g.nfts.map((n) => `<button class="gift-tile nft" data-nft="${esc(n.id)}">${nftArtHTML(n)}<small>#${n.num}</small></button>`),
      ...g.gifts.map((x) => `<button class="gift-tile" data-giftinfo="${esc(x.id)}"><span class="gift-art">${(GIFT_INFO[x.type] || ['🎁'])[0]}</span>${(x.count || 1) > 1 ? `<em class="gcount">×${x.count}</em>` : ''}<small>${avatarHTML(user(x.from), 'xxs')}</small></button>`),
    ].join('');
    return `<div class="profile-gifts">${tiles ? `<div class="gift-grid">${tiles}</div>` : `<div class="empty"><b>Пока нет подарков</b>${isMe ? '<button class="btn-black small" data-market>Открыть маркет</button>' : ''}</div>`}</div>`;
  }
  // карточка обычного подарка (в той же шторке, что и NFT)
  function giftInfo(id) {
    let x = null, owner = null;
    for (const [uid, g] of giftCache) { const y = g.gifts.find((z) => z.id === id); if (y) { x = y; owner = uid; break; } }
    if (!x) return;
    nftOpen = null;
    const i = GIFT_INFO[x.type] || ['🎁', 'Подарок'];
    const cnt = x.count || 1;
    const mine = owner === S.me.id;
    $('#nftSheetTitle').textContent = i[1];
    $('#nftSheetBody').innerHTML = `
      <div class="nft-hero"><span class="gift-art hero">${i[0]}</span><h3>${esc(i[1])}${cnt > 1 ? ' ×' + cnt : ''}</h3>${x.text ? `<p class="fine center">«${esc(x.text)}»</p>` : ''}</div>
      <div class="group">
        <div class="group-row"><span>От кого</span><b>${esc(user(x.from).name)}</b></div>
        <div class="group-row"><span>Дата</span><b>${esc(fmtDay(x.createdAt))}</b></div>
        <div class="group-row"><span>Стоимость</span><b>☾ ${num(x.price)}</b></div>
      </div>
      ${mine ? `<button class="btn-black" data-sellgift="${esc(x.id)}">Продать за ☾ ${num(B.giftSellValue(x.price))}</button><p class="fine center">Комиссия при продаже 15%: из ☾ ${num(x.price)} вы получите ☾ ${num(B.giftSellValue(x.price))}. Подарок исчезнет из профиля.</p>` : ''}`;
    openSheet('nftSheet');
  }
  // шторка «Подарить»
  const GS = { to: null, tab: 'gifts', sel: null, count: 1 };
  async function openGiftSheet(uid) {
    GS.to = uid; GS.tab = 'gifts'; GS.sel = null; GS.count = 1;
    $('#giftQty').value = 1;
    $('#giftText').value = '';
    $('#giftTitle').textContent = 'Подарок для ' + user(uid).name;
    $$('#giftSeg button').forEach((b) => b.classList.toggle('active', b.dataset.g === 'gifts'));
    renderGiftSheet();
    openSheet('giftSheet');
    if (!giftCache.has(S.me.id)) { await loadGifts(S.me.id); renderGiftSheet(); }
  }
  function renderGiftSheet() {
    $('#giftLune').textContent = '☾ ' + num(S.me.lune || 0);
    const grid = $('#giftGrid');
    if (GS.tab === 'gifts') {
      grid.innerHTML = Object.entries(GIFT_INFO).map(([k, [e, name]]) => `<button class="gift-tile big ${GS.sel === k ? 'sel' : ''}" data-pick="${k}"><span class="gift-art">${e}</span><span class="gname">${name}</span><span class="price">☾ ${B.GIFTS[k]}</span></button>`).join('');
    } else {
      const mine = (giftCache.get(S.me.id) || { nfts: [] }).nfts;
      grid.innerHTML = mine.length
        ? mine.map((n) => `<button class="gift-tile big nft ${GS.sel === n.id ? 'sel' : ''}" data-pick="${esc(n.id)}">${nftArtHTML(n)}<span class="gname">${esc(nftName(n))}</span></button>`).join('')
        : '<div class="empty"><b>У вас нет NFT</b><span>Их можно купить в маркете</span></div>';
    }
    $('#giftText').hidden = GS.tab !== 'gifts';
    $('#giftCount').hidden = GS.tab !== 'gifts';
    const btn = $('#giftSendBtn');
    btn.disabled = !GS.sel;
    btn.textContent = !GS.sel ? 'Выберите подарок' : GS.tab === 'gifts'
      ? `Отправить${GS.count > 1 ? ' ' + GS.count + ' шт.' : ''} за ☾ ${num(B.GIFTS[GS.sel] * GS.count)}` : 'Подарить NFT';
  }
  $$('#giftSeg button').forEach((b) => b.addEventListener('click', () => {
    GS.tab = b.dataset.g; GS.sel = null;
    $$('#giftSeg button').forEach((x) => x.classList.toggle('active', x === b));
    renderGiftSheet();
  }));
  $('#giftGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    GS.sel = b.dataset.pick;
    renderGiftSheet();
    haptic(6);
  });
  const setGiftCount = (n) => {
    GS.count = Math.max(1, Math.min(999, Math.round(+n || 1)));
    if (document.activeElement !== $('#giftQty') || +$('#giftQty').value !== GS.count) $('#giftQty').value = GS.count;
    renderGiftSheet();
  };
  $('#giftQty').addEventListener('input', () => { if ($('#giftQty').value !== '') setGiftCount($('#giftQty').value); });
  $('#giftQty').addEventListener('blur', () => setGiftCount($('#giftQty').value));
  $('#giftCount').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cnt]');
    if (b) { setGiftCount(GS.count + +b.dataset.cnt); haptic(5); }
  });
  $('#giftSendBtn').addEventListener('click', async (e) => {
    if (!GS.sel || !GS.to || !canPost()) return;
    const to = GS.to;
    try {
      if (GS.tab === 'gifts') {
        const type = GS.sel, note = $('#giftText').value.trim(), count = GS.count, total = B.GIFTS[type] * count;
        if ((S.me.lune || 0) < total) { toast(`Нужно ${total} LUNE`); return; }
        await busy(e.currentTarget, () => B.sendGift(to, type, note, count));
        const chat = await B.openDM(to);
        S.chats.set(chat.id, S.chats.get(chat.id) || chat);
        B.send(chat.id, `${GIFT_INFO[type][0]} Подарок: ${GIFT_INFO[type][1]}${count > 1 ? ' ×' + count : ''}`, { kind: 'gift', gift: type, count, price: total, note });
      } else {
        const n = giftCache.get(S.me.id).nfts.find((x) => x.id === GS.sel);
        await busy(e.currentTarget, () => B.transferNFT(n.id, to));
        const chat = await B.openDM(to);
        S.chats.set(chat.id, S.chats.get(chat.id) || chat);
        B.send(chat.id, `💎 NFT-подарок: ${nftName(n)}`, { kind: 'nftgift', nft: { id: n.id, name: (B.collection(n.cid) || {}).name || 'NFT', num: n.num, cid: n.cid, backdrop: n.backdrop } });
      }
      closeSheet();
      toast('Подарок отправлен 🎉');
      haptic([10, 40, 10]);
      loadGifts(to); loadGifts(S.me.id);
    } catch (err) { toast(err.message); }
  });

  // ---------- маркет NFT ----------
  const MK = { tab: 'shop', cols: [], resale: [] };
  async function openMarket() {
    if (!isOpen('marketPage')) push('marketPage');
    renderMarket();
    try {
      collectionsLoaded = null;
      const [cols, resale] = await Promise.all([ensureCollections(), B.market()]);
      MK.cols = cols; MK.resale = resale;
      await loadGifts(S.me.id);
      renderMarket();
    } catch (e) { toast(e.message); }
  }
  function renderMarket() {
    $('#marketLune').textContent = '☾ ' + num(S.me.lune || 0);
    let html = '', empty = '';
    if (MK.tab === 'shop') {
      const cols = MK.cols.filter((c) => c.active !== false || B.isAdmin);
      html = cols.map((c) => {
        const left = c.supply - c.minted;
        return `<div class="nft-card">${nftArtHTML(c)}<b>${esc(c.name)}</b><small>${num(c.minted)} из ${num(c.supply)} выпущено</small>
          ${left > 0 && c.active !== false ? `<button class="price-btn" data-mint="${esc(c.id)}">☾ ${num(c.price)}</button>` : `<span class="sold">${left > 0 ? 'Продажи остановлены' : 'Распродано'}</span>`}</div>`;
      }).join('');
      empty = '<b>Коллекций пока нет</b><span>Их выпускает администрация</span>';
    } else if (MK.tab === 'resale') {
      html = MK.resale.map((n) => `<div class="nft-card" data-nft="${esc(n.id)}">${nftArtHTML(n)}<b>${esc(nftName(n))}</b><small>${esc((BACKDROPS[n.backdrop] || [''])[0])} · ${esc(user(n.owner).name)}</small>
        ${n.owner === S.me.id ? '<span class="sold">Ваш</span>' : `<button class="price-btn resale" data-buy="${esc(n.id)}">☾ ${num(n.salePrice)}</button>`}</div>`).join('');
      empty = '<b>Сейчас ничего не продаётся</b><span>Свои NFT можно выставить во вкладке «Мои NFT»</span>';
    } else {
      const mine = (giftCache.get(S.me.id) || { nfts: [] }).nfts;
      html = mine.map((n) => `<div class="nft-card" data-nft="${esc(n.id)}">${nftArtHTML(n)}<b>${esc(nftName(n))}</b><small>${esc((BACKDROPS[n.backdrop] || [''])[0])}</small>${n.salePrice > 0 ? `<span class="sold">на продаже · ☾ ${num(n.salePrice)}</span>` : ''}</div>`).join('');
      empty = '<b>У вас пока нет NFT</b><span>Купите во вкладке «Коллекции»</span>';
    }
    $('#marketGrid').innerHTML = html;
    $('#marketEmpty').innerHTML = empty;
    $('#marketEmpty').hidden = !!html;
  }
  $$('#marketSeg button').forEach((b) => b.addEventListener('click', () => {
    MK.tab = b.dataset.m;
    $$('#marketSeg button').forEach((x) => x.classList.toggle('active', x === b));
    renderMarket();
  }));
  $('#marketLune').addEventListener('click', openWallet);
  $('#marketGrid').addEventListener('click', async (e) => {
    const m = e.target.closest('[data-mint]');
    if (m) {
      const c = MK.cols.find((x) => x.id === m.dataset.mint);
      if ((S.me.lune || 0) < c.price) { toast(`Нужно ${c.price} LUNE`); return; }
      if (!canPost()) return;
      try {
        const nid = await busy(m, () => B.mintNFT(c.id));
        toast(`Ваш ${c.name} #${nid.split('_').pop()} 🎉`);
        haptic([10, 40, 10]);
        await openMarket();
        openNft(nid);
      } catch (err) { toast(err.message); }
      return;
    }
    const bb = e.target.closest('[data-buy]');
    if (bb) { e.stopPropagation(); buyNft(bb.dataset.buy, bb); return; }
    const n = e.target.closest('[data-nft]');
    if (n) openNft(n.dataset.nft);
  });
  async function buyNft(nid, btn) {
    const n = MK.resale.find((x) => x.id === nid);
    if (n && (S.me.lune || 0) < n.salePrice) { toast(`Нужно ${n.salePrice} LUNE`); return; }
    if (!canPost()) return;
    try {
      await busy(btn, () => B.buyNFT(nid));
      toast('NFT куплен 🎉');
      haptic([10, 40, 10]);
      closeSheet();
      await openMarket();
    } catch (err) { toast(err.message); }
  }

  // карточка NFT
  let nftOpen = null;
  function findNft(nid) {
    for (const g of giftCache.values()) { const n = g.nfts.find((x) => x.id === nid); if (n) return n; }
    return MK.resale.find((x) => x.id === nid) || null;
  }
  async function openNft(nid) {
    nftOpen = findNft(nid) || { id: nid, cid: nid.split('_').slice(0, -1).join('_'), num: +nid.split('_').pop(), owner: null };
    await ensureCollections().catch(() => {});
    renderNftSheet();
    openSheet('nftSheet');
  }
  function renderNftSheet() {
    const n = nftOpen;
    if (!n) return;
    const c = B.collection(n.cid) || {};
    const mine = n.owner === S.me.id;
    $('#nftSheetTitle').textContent = nftName(n);
    $('#nftSheetBody').innerHTML = `
      <div class="nft-hero">${nftArtHTML(n, true)}<h3>${esc(nftName(n))}</h3>${c.description ? `<p class="fine center">${esc(c.description)}</p>` : ''}</div>
      <div class="group">
        <div class="group-row"><span>Владелец</span><b>${n.owner ? esc(mine ? 'Вы' : user(n.owner).name) : '—'}</b></div>
        <div class="group-row"><span>Фон</span><b>${esc((BACKDROPS[n.backdrop] || ['—'])[0])}</b></div>
        <div class="group-row"><span>Тираж</span><b>${c.supply ? `${num(c.minted)} / ${num(c.supply)}` : '—'}</b></div>
        ${n.salePrice > 0 ? `<div class="group-row"><span>Цена</span><b>☾ ${num(n.salePrice)}</b></div>` : ''}
      </div>
      ${mine ? `
        <div class="field"><span>${n.salePrice > 0 ? 'На продаже' : 'Выставить на перепродажу'}</span>
          <div class="buy-row"><input class="input" id="nftSaleInput" type="number" min="1" placeholder="Цена в LUNE" value="${n.salePrice || ''}" /><button class="btn-black small" data-sale>${n.salePrice > 0 ? 'Изменить' : 'Выставить'}</button>${n.salePrice > 0 ? '<button class="btn-soft small danger" data-unsale>Снять</button>' : ''}</div></div>
        <div class="field"><span>Подарить</span>
          <div class="buy-row"><input class="input" id="nftToInput" placeholder="@username" autocapitalize="none" /><button class="btn-soft small" data-transfer>Подарить</button></div></div>`
      : n.salePrice > 0 ? `<button class="btn-black" data-buynft>Купить за ☾ ${num(n.salePrice)}</button>` : ''}`;
  }
  $('#nftSheetBody').addEventListener('click', async (e) => {
    const sg = e.target.closest('[data-sellgift]');
    if (sg) {
      try {
        const v = await busy(sg, () => B.sellGift(sg.dataset.sellgift));
        closeSheet();
        toast(`Продано: +${v} LUNE`);
        haptic([10, 40, 10]);
        loadGifts(S.me.id);
      } catch (err) { toast(err.message); }
      return;
    }
    const n = nftOpen;
    if (!n) return;
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.matches('[data-sale]')) {
        const price = Math.round(+$('#nftSaleInput').value || 0);
        if (price < 1) { toast('Введите цену'); return; }
        await busy(b, () => B.setSalePrice(n.id, price));
        n.salePrice = price;
        toast('Выставлено на продажу');
      } else if (b.matches('[data-unsale]')) {
        await busy(b, () => B.setSalePrice(n.id, 0));
        n.salePrice = 0;
        toast('Снято с продажи');
      } else if (b.matches('[data-transfer]')) {
        const to = await B.findUserByName($('#nftToInput').value);
        if (to === S.me.id) { toast('Это вы'); return; }
        await busy(b, () => B.transferNFT(n.id, to));
        const chat = await B.openDM(to);
        S.chats.set(chat.id, S.chats.get(chat.id) || chat);
        B.send(chat.id, `💎 NFT-подарок: ${nftName(n)}`, { kind: 'nftgift', nft: { id: n.id, name: (B.collection(n.cid) || {}).name || 'NFT', num: n.num, cid: n.cid, backdrop: n.backdrop } });
        n.owner = to;
        toast('NFT подарен 🎉');
        loadGifts(to);
      } else if (b.matches('[data-buynft]')) {
        await buyNft(n.id, b);
        return;
      } else return;
      renderNftSheet();
      await loadGifts(S.me.id);
      if (isOpen('marketPage')) openMarket();
    } catch (err) { toast(err.message); }
  });

  // ---------- создатель NFT в админке ----------
  const NC = { backdrops: new Set(['sapphire', 'amethyst', 'gold']), image: null };
  function renderNftCreator() {
    $('#nftBackdrops').innerHTML = Object.entries(BACKDROPS).map(([k, [name, a, b]]) => `<button type="button" data-bd="${k}" class="bd-chip ${NC.backdrops.has(k) ? 'active' : ''}" style="--b1:${a};--b2:${b}"><i></i>${name}</button>`).join('');
    $('#nftFull').disabled = !NC.image;
    if (!NC.image) $('#nftFull').checked = false;
    const preview = { emoji: $('#nftEmoji').value.trim() || '🎁', image: NC.image, fullBleed: $('#nftFull').checked, backdrops: [...NC.backdrops] };
    $('#nftPreview').innerHTML = (preview.backdrops.length ? preview.backdrops : ['sapphire']).slice(0, 4).map((bd) => nftArtHTML({ ...preview, backdrop: bd })).join('');
    $('#nftImageBtn').textContent = NC.image ? 'Картинка загружена · убрать' : 'Загрузить картинку';
    renderAdminCollections();
  }
  async function renderAdminCollections() {
    try {
      collectionsLoaded = null;
      const cols = await ensureCollections();
      $('#adminCollections').innerHTML = cols.map((c) => `<li class="row">${nftArtHTML(c)}<div class="row-main"><b>${esc(c.name)}</b><span>${num(c.minted)} / ${num(c.supply)} · ☾ ${num(c.price)}</span></div>
        <button class="btn-out ${c.active !== false ? '' : 'on'}" data-colactive="${esc(c.id)}">${c.active !== false ? 'Остановить' : 'Запустить'}</button></li>`).join('') || '<p class="fine">Коллекций пока нет</p>';
    } catch (e) { toast(e.message); }
  }
  $('#nftBackdrops').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bd]');
    if (!b) return;
    NC.backdrops.has(b.dataset.bd) ? NC.backdrops.delete(b.dataset.bd) : NC.backdrops.add(b.dataset.bd);
    renderNftCreator();
  });
  $('#nftEmoji').addEventListener('input', () => renderNftCreator());
  $('#nftFull').addEventListener('change', () => renderNftCreator());
  $('#nftImageBtn').addEventListener('click', async (e) => {
    if (NC.image) { NC.image = null; renderNftCreator(); return; }
    const f = await anyFile('image/*');
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast('Нужна картинка'); return; }
    try { const up = await uploadPicked(f, e.currentTarget); NC.image = { id: up.id, type: up.type }; renderNftCreator(); } catch (err) { toast(err.message); }
  });
  $('#nftCreateBtn').addEventListener('click', async (e) => {
    try {
      await busy(e.currentTarget, () => B.createCollection({
        name: $('#nftName').value, emoji: firstGrapheme($('#nftEmoji').value.trim()), image: NC.image, fullBleed: $('#nftFull').checked, description: $('#nftDesc').value,
        price: $('#nftPrice').value, supply: $('#nftSupply').value, backdrops: [...NC.backdrops],
      }));
      toast('Коллекция выпущена 🎉');
      $('#nftName').value = ''; $('#nftEmoji').value = ''; $('#nftDesc').value = ''; NC.image = null;
      renderNftCreator();
    } catch (err) { toast(err.message); }
  });
  $('#adminCollections').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-colactive]');
    if (!b) return;
    const c = B.collection(b.dataset.colactive);
    try { await B.setCollectionActive(c.id, c.active === false); toast(c.active === false ? 'Продажи запущены' : 'Продажи остановлены'); renderAdminCollections(); } catch (err) { toast(err.message); }
  });

  // ---------- обновления ----------
  const BUILD = window.XITTER_BUILD || { run: 0, sha: 'dev' };
  const REPO = 'depressionwormkhronoshelp/xitter';
  const ASSETS = { android: 'Xitter.apk', windows: 'Xitter-Setup.exe', ios: 'Xitter-unsigned.ipa' };
  const PLATFORM_NAME = { android: 'Android', windows: 'Windows', ios: 'iPhone', web: 'веб-версия' };
  function platform() {
    if (window.xitterDesktop) return 'windows';
    if (window.XitterNative || (isApp && /Android/i.test(navigator.userAgent))) return 'android';
    if (isApp && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) return 'ios';
    return 'web';
  }
  const UPD = { latest: null, url: null, checking: false, error: '' };
  async function checkUpdate() {
    UPD.checking = true; UPD.error = '';
    renderUpdate();
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/latest`, { cache: 'no-store' });
      if (!r.ok) throw new Error('GitHub ответил ' + r.status);
      const j = await r.json();
      const m = /#(\d+)/.exec(j.name || '');
      UPD.latest = m ? +m[1] : null;
      const asset = (j.assets || []).find((a) => a.name === ASSETS[platform()]);
      UPD.url = asset ? asset.browser_download_url : j.html_url;
    } catch (e) { UPD.error = 'Не удалось проверить: ' + (e.message || 'нет связи'); }
    UPD.checking = false;
    renderUpdate();
  }
  const hasUpdate = () => UPD.latest && BUILD.run && UPD.latest > BUILD.run;
  function renderUpdate() {
    $('#versionInfo').textContent = hasUpdate() ? 'есть обновление' : BUILD.run ? `сборка ${BUILD.run}` : 'dev';
    $('#versionInfo').classList.toggle('accent', !!hasUpdate());
    const p = platform();
    let state;
    if (UPD.checking) state = '<p class="upd-state">Проверяю обновления…</p>';
    else if (UPD.error) state = `<p class="upd-state">${esc(UPD.error)}</p>`;
    else if (hasUpdate()) {
      state = `<p class="upd-state ok">Доступна сборка ${UPD.latest}</p>` + (p === 'web'
        ? '<button class="btn-black" data-upd="reload">Обновить</button>'
        : `<button class="btn-black" data-upd="download">Скачать для ${PLATFORM_NAME[p]}</button>${p === 'ios' ? '<p class="fine center">Файл нужно подписать через Sideloadly или AltStore</p>' : ''}`);
    } else if (UPD.latest) state = '<p class="upd-state">У вас последняя версия</p>';
    else state = '';
    $('#updateBody').innerHTML = `
      <div class="upd-top"><img src="${iconURL(store.get('icon') || 'orange')}" alt="" /><b>Xitter</b><small>${BUILD.run ? `Сборка ${BUILD.run} · ${esc(BUILD.sha)}${BUILD.date ? ' · ' + esc(BUILD.date) : ''}` : 'Версия для разработки'} · ${PLATFORM_NAME[p]}</small></div>
      ${state}
      <button class="btn-soft" data-upd="check" ${UPD.checking ? 'disabled' : ''}>Проверить обновления</button>`;
  }
  function openUpdate() { closeSheet(); setTimeout(() => { openSheet('updateSheet'); checkUpdate(); }, 150); }
  $('#updateBtn').addEventListener('click', openUpdate);
  $('#updateBody').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-upd]');
    if (!b) return;
    if (b.dataset.upd === 'check') checkUpdate();
    else if (b.dataset.upd === 'reload') {
      try { const regs = await navigator.serviceWorker?.getRegistrations?.(); (regs || []).forEach((r) => r.update()); } catch {}
      location.reload();
    } else if (b.dataset.upd === 'download' && UPD.url) {
      if (window.XitterNative && window.XitterNative.openUrl) window.XitterNative.openUrl(UPD.url);
      else window.open(UPD.url, '_blank');
    }
  });

  // ---------- админ-панель ----------
  const ADMIN = { tab: 'overview', users: [], stats: null, sel: null };
  function openAdmin() {
    if (!B.isAdmin) return;
    closeSheet();
    push('adminPage');
    loadAdmin();
  }
  $('#adminBtn').addEventListener('click', openAdmin);
  $('#marketBtn').addEventListener('click', () => { closeSheet(); setTimeout(openMarket, 150); });
  $('#sideMarket').addEventListener('click', () => { resetStack(); openMarket(); });
  $('#sideSettings').addEventListener('click', () => { renderMe(); openSheet('settingsSheet'); });
  $('#adminRefresh').addEventListener('click', () => loadAdmin());
  async function loadAdmin() {
    try {
      const [stats, users] = await Promise.all([B.adminStats(), B.adminUsers()]);
      ADMIN.stats = stats; ADMIN.users = users;
      renderAdmin();
    } catch (e) { toast(e.message); }
  }
  function renderAdmin() {
    const st = ADMIN.stats || { users: 0, admins: 0 };
    const us = ADMIN.users;
    const cards = [
      ['Пользователи', st.users], ['Админы', st.admins],
      ['С Plus', us.filter((u) => u.plus).length], ['С галочкой', us.filter((u) => u.verified).length],
      ['Забанены', us.filter((u) => u.banned).length], ['Ограничены', us.filter((u) => u.restricted).length],
      ['LUNE у всех', us.reduce((n, u) => n + (u.lune || 0), 0)], ['В сети', us.filter((u) => u.online).length],
    ];
    const t = (callConfig && callConfig.turn && callConfig.turn[0]) || {};
    if (!$('#turnUrls').matches(':focus')) $('#turnUrls').value = [].concat(t.urls || []).join(', ');
    if (!$('#turnUser').matches(':focus')) $('#turnUser').value = t.username || '';
    if (!$('#turnPass').matches(':focus')) $('#turnPass').value = t.credential || '';
    $('#adminStats').innerHTML = cards.map(([t, v]) => `<div class="stat"><b>${num(v)}</b><span>${t}</span></div>`).join('');
    $('#adminOverview').hidden = ADMIN.tab !== 'overview';
    $('#adminUsersBox').hidden = ADMIN.tab !== 'users';
    $('#adminNftBox').hidden = ADMIN.tab !== 'nft';
    if (ADMIN.tab === 'nft') renderNftCreator();
    const q = $('#adminSearch').value.trim().toLowerCase().replace(/^@/, '');
    const list = us.filter((u) => !q || u.username.includes(q) || u.name.toLowerCase().includes(q) || (u.usernames || []).some((n) => n.includes(q)));
    $('#adminList').innerHTML = list.map((u, i) => `<li class="row" data-auid="${esc(u.id)}" style="--i:${Math.min(i, 12)}">
      ${avatarHTML(u, '', u.online)}
      <div class="row-main"><b>${nameHTML(u)}</b><span>@${esc(u.username)} · ☾ ${num(u.lune || 0)}</span></div>
      <span class="tags">${u.admin ? '<i class="tag">админ</i>' : ''}${u.plus ? '<i class="tag plus">Plus</i>' : ''}${u.banned ? '<i class="tag red">бан</i>' : ''}${u.restricted ? '<i class="tag amber">огр.</i>' : ''}</span>
    </li>`).join('') || '<div class="empty"><b>Никого не нашли</b></div>';
    if (ADMIN.sel) renderAdminUser();
  }
  $$('#adminSeg button').forEach((b) => b.addEventListener('click', () => {
    ADMIN.tab = b.dataset.admin;
    $$('#adminSeg button').forEach((x) => x.classList.toggle('active', x === b));
    renderAdmin();
  }));
  $('#adminSearch').addEventListener('input', () => renderAdmin());
  $('#turnSave').addEventListener('click', async (e) => {
    const urls = $('#turnUrls').value.split(/[\s,]+/).filter((u) => /^turns?:/.test(u));
    if ($('#turnUrls').value.trim() && !urls.length) { toast('Адрес должен начинаться с turn: или turns:'); return; }
    const data = { turn: urls.length ? [{ urls, username: $('#turnUser').value.trim(), credential: $('#turnPass').value.trim() }] : [] };
    try {
      await busy(e.currentTarget, () => B.setConfig('calls', data));
      callConfig = data;
      if (!store.get('turn')) Call.setTurn(data.turn);
      toast(urls.length ? 'TURN-сервер сохранён' : 'Вернул бесплатный TURN-сервер');
    } catch (err) { toast(err.message); }
  });
  $('#adminList').addEventListener('click', (e) => {
    const r = e.target.closest('[data-auid]');
    if (!r) return;
    ADMIN.sel = r.dataset.auid;
    renderAdminUser();
    openSheet('adminUserSheet');
  });
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  function renderAdminUser() {
    const u = ADMIN.users.find((x) => x.id === ADMIN.sel);
    if (!u) return;
    const forever = u.plusUntil > Date.now() + 50 * 365 * 864e5;
    const toggle = (k, label, on, hint) => `<div class="group-row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><button class="switch ${on ? 'on' : ''}" data-tog="${k}" aria-label="${label}"><i></i></button></div>`;
    $('#adminUserBody').innerHTML = `
      <div class="au-head">${avatarHTML(u, 'l', u.online)}<div><b>${nameHTML(u)}</b><small>@${esc(u.username)}${(u.usernames || []).map((n) => ' · @' + esc(n)).join('')}</small></div></div>
      <div class="group">
        ${toggle('verified', 'Верификация', u.verified, 'галочка у имени')}
        ${toggle('restricted', 'Ограничить', u.restricted, 'не может писать посты, комментарии и сообщения')}
        ${toggle('banned', 'Забанить', u.banned, 'аккаунт заблокирован полностью')}
      </div>
      <div class="group pad">
        <div class="au-line"><span>LUNE</span><b>☾ ${num(u.lune || 0)}</b></div>
        <div class="buy-row"><input class="input" id="luneAmount" type="number" min="1" step="1" value="100" /><button class="btn-black small" data-lune="1">Выдать</button><button class="btn-soft small" data-lune="-1">Забрать</button></div>
      </div>
      <div class="group pad">
        <div class="au-line"><span>Xitter Plus</span><b>${u.plus ? (forever ? 'навсегда' : 'до ' + fmtDate(u.plusUntil)) : 'нет'}</b></div>
        <div class="btn-wrap"><button class="btn-soft small" data-plus="30">+30 дней</button><button class="btn-soft small" data-plus="365">+1 год</button><button class="btn-soft small" data-plus="forever">Навсегда</button>${u.plus ? '<button class="btn-soft small danger" data-plus="off">Забрать</button>' : ''}</div>
      </div>
      ${B.isOwner && u.id !== S.me.id ? `<button class="btn-soft ${u.admin ? 'danger' : ''}" data-setadmin="${u.admin ? 0 : 1}">${u.admin ? 'Убрать из админов' : 'Сделать админом'}</button>` : ''}
      <button class="btn-soft" data-openprofile>Открыть профиль</button>`;
  }
  async function adminDo(fn, okText) {
    try { await fn(); toast(okText); haptic(10); await loadAdmin(); } catch (e) { toast(e.message); }
  }
  $('#adminUserBody').addEventListener('click', (e) => {
    const u = ADMIN.users.find((x) => x.id === ADMIN.sel);
    if (!u) return;
    const t = e.target.closest('[data-tog]');
    if (t) {
      const k = t.dataset.tog, on = !u[k];
      t.classList.toggle('on', on);
      const words = { verified: ['Галочка выдана', 'Галочка снята'], restricted: ['Аккаунт ограничен', 'Ограничение снято'], banned: ['Пользователь забанен', 'Бан снят'] }[k];
      adminDo(() => B.adminUpdate(u.id, { [k]: on }), on ? words[0] : words[1]);
      return;
    }
    const l = e.target.closest('[data-lune]');
    if (l) {
      const n = Math.round(Math.abs(+$('#luneAmount').value || 0));
      if (!n) { toast('Введите количество'); return; }
      const d = n * +l.dataset.lune;
      adminDo(() => B.adminUpdate(u.id, { luneDelta: d }), d > 0 ? `Выдано ${n} LUNE` : `Забрано ${Math.min(n, u.lune || 0)} LUNE`);
      return;
    }
    const pl = e.target.closest('[data-plus]');
    if (pl) {
      const v = pl.dataset.plus;
      const base = Math.max(Date.now(), u.plusUntil || 0);
      const until = v === 'off' ? 0 : v === 'forever' ? 4102444800000 : base + +v * 864e5;
      adminDo(() => B.adminUpdate(u.id, { plusUntil: until }), v === 'off' ? 'Plus забран' : 'Plus выдан');
      return;
    }
    const sa = e.target.closest('[data-setadmin]');
    if (sa) { adminDo(() => B.setAdmin(u.id, sa.dataset.setadmin === '1'), sa.dataset.setadmin === '1' ? 'Теперь админ' : 'Больше не админ'); return; }
    if (e.target.closest('[data-openprofile]')) { closeSheet(); setTimeout(() => openUser(u.id), 200); }
  });

  // ---------- шторки ----------
  let openSheetId = null;
  function openSheet(id) {
    if (openSheetId && openSheetId !== id) $('#' + openSheetId).classList.remove('open');
    openSheetId = id;
    document.body.classList.add('sheet-open');
    $('#' + id).classList.add('open');
    haptic(6);
  }
  function closeSheet() {
    if (!openSheetId) return;
    $('#' + openSheetId).classList.remove('open');
    openSheetId = null;
    document.body.classList.remove('sheet-open');
    if (document.activeElement) document.activeElement.blur();
  }
  $('#sheetBackdrop').addEventListener('click', () => { if (document.body.classList.contains('as-open')) closeActions(); else closeSheet(); });
  $$('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
  // смахивание шторки вниз за «ручку» или шапку
  $$('.sheet').forEach((sheet) => {
    let sy = 0, dy = 0, t0 = 0, on = false;
    sheet.addEventListener('touchstart', (e) => {
      if (!e.target.closest('.grabber, .sheet-head') || e.target.closest('button')) return;
      sy = e.touches[0].clientY; dy = 0; t0 = performance.now(); on = true;
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (!on) return;
      dy = Math.max(0, e.touches[0].clientY - sy);
      if (dy > 4) { sheet.classList.add('dragging'); sheet.style.transform = `translateY(${dy}px)`; }
    }, { passive: true });
    sheet.addEventListener('touchend', () => {
      if (!on) return;
      on = false;
      sheet.classList.remove('dragging');
      sheet.style.transform = '';
      if (dy > 120 || dy / (performance.now() - t0) > 0.6) closeSheet();
    });
  });

  // меню действий
  function showActions(items) {
    const box = $('#asButtons');
    box.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
    box.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      closeActions();
      items[+b.dataset.i].fn();
    };
    const as = $('#actionSheet');
    as.classList.remove('closing');
    as.hidden = false;
    document.body.classList.add('as-open');
    setTimeout(() => box.querySelector('button')?.focus({ preventScroll: true }), 60);
    haptic(6);
  }
  function closeActions() {
    const as = $('#actionSheet');
    if (as.hidden) return;
    as.classList.add('closing');
    document.body.classList.remove('as-open');
    setTimeout(() => { as.hidden = true; as.classList.remove('closing'); }, 280);
  }
  $('#asCancel').addEventListener('click', closeActions);

  function openViewer(src, video) {
    const v = $('#viewer');
    const vid = $('video', v), img = $('img', v);
    img.hidden = !!video; vid.hidden = !video;
    if (video) { vid.src = src; vid.play().catch(() => {}); } else img.src = src;
    v.hidden = false;
  }
  $('#viewer').addEventListener('click', (e) => {
    if (e.target.tagName === 'VIDEO') return;
    const vid = $('#viewer video');
    vid.pause(); vid.removeAttribute('src');
    $('#viewer').hidden = true;
  });

  // ---------- чаты ----------
  function onChats(chats, first) {
    const prev = S.chats;
    S.chats = new Map(chats.map((c) => [c.id, c]));
    S.typing = new Map(chats.filter((c) => c.typing).map((c) => [c.id, c.typing]));
    for (const c of chats) {
      const old = prev.get(c.id);
      const lm = c.lastMessage;
      const isNew = !first && lm && lm.from !== S.me.id && (!old || !old.lastMessage || old.lastMessage.ts !== lm.ts);
      if (isNew && (S.current !== c.id || document.visibilityState !== 'visible')) { haptic([12, 60, 12]); blip(); notify(c.title, lm.text, 'chat-' + c.id); }
      if (S.current === c.id && c.unread && document.visibilityState === 'visible') B.markRead(c.id);
    }
    renderChats(first);
    if (S.current && S.chats.has(S.current)) { renderChatHeader(); renderMessages(false); }
    if (S.typing.size) setTimeout(() => { renderChats(false); if (S.current) { renderChatHeader(); renderMessages(false); } }, 4100);
  }
  const sortedChats = () => [...S.chats.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const otherMember = (chat) => chat.members.find((m) => m && m.id !== S.me.id) || chat.members[0];
  function isTyping(chatId) {
    const t = S.typing.get(chatId);
    return t && t.until > Date.now() ? t : null;
  }
  function isReadByOthers(chat, msg) {
    if (!chat) return false;
    return Object.entries(chat.lastRead || {}).some(([uid, ts]) => uid !== S.me.id && ts >= msg.ts);
  }

  function renderChats(animate) {
    if (!S.me) return;
    const list = $('#chatList');
    const q = $('#chatSearch').value.trim().toLowerCase();
    const chats = sortedChats().filter((c) => !q || c.title.toLowerCase().includes(q));
    list.classList.toggle('settled', !animate);
    list.innerHTML = chats.map((c, i) => {
      const other = c.type === 'dm' ? otherMember(c) : null;
      const typing = isTyping(c.id);
      const last = c.lastMessage;
      let preview = last ? esc(last.text) : 'Нет сообщений';
      if (last && last.from === S.me.id) preview = 'Вы: ' + preview;
      else if (last && c.type === 'group') preview = esc((c.members.find((m) => m && m.id === last.from) || {}).name || '') + ': ' + preview;
      if (typing) preview = `<span class="typing">${c.type === 'group' ? esc(typing.name) + ' печатает…' : 'печатает…'}</span>`;
      else if (!last && other) preview = esc(fmtSeen(other));
      return `<li class="row ${c.unread ? 'unread' : ''}" data-id="${esc(c.id)}" style="--i:${i}">
        ${avatarHTML(other || c, 'l', other && other.online)}
        <div class="row-main"><b>${other ? nameHTML(other) : esc(c.title)}</b><p>${preview}${last && !typing ? ` <time>· ${fmtAgo(last.ts)}</time>` : ''}</p></div>
        ${c.unread ? '<i class="udot"></i>' : ''}
      </li>`;
    }).join('');
    $('#chatsEmpty').hidden = S.chats.size > 0;
    const total = [...S.chats.values()].reduce((n, c) => n + (c.unread || 0), 0);
    const badge = $('#dmBadge');
    badge.hidden = !total;
    badge.textContent = total > 99 ? '99+' : total;
    const side = $('#sideDmBadge');
    side.hidden = !total;
    side.textContent = badge.textContent;
  }
  $('#chatList').addEventListener('click', (e) => { const row = e.target.closest('.row'); if (row) openChat(row.dataset.id); });
  $('#chatSearch').addEventListener('input', () => renderChats(false));
  function openChats() { renderChats(true); push('chatsPage'); }
  $('#openChats').addEventListener('click', openChats);
  $('#sideChats').addEventListener('click', () => { resetStack(); openChats(); });

  async function messageUser(uid) {
    try {
      const chat = await B.openDM(uid);
      if (!S.chats.has(chat.id)) S.chats.set(chat.id, chat);
      openChat(chat.id);
    } catch (e) { toast(e.message); }
  }

  // ---------- переписка ----------
  function openChat(id) {
    const chat = S.chats.get(id);
    if (!chat) return;
    // на компьютере список чатов всегда остаётся колонкой слева от переписки
    if (desktop.matches && !isOpen('chatsPage')) { resetStack(); openChats(); }
    if (S.msgUnsub && S.current !== id) { S.msgUnsub(); S.msgUnsub = null; }
    S.current = id;
    $('#emojiPop').hidden = true;
    renderChatHeader();
    renderMessages(true);
    push('chatPage');
    if (!S.msgUnsub) {
      let jump = true;
      S.msgUnsub = B.subscribeMessages(id, (messages, fresh) => {
        S.messages.set(id, messages);
        fresh.forEach((m) => animateIds.add(m));
        if (S.current === id) { renderMessages(jump); jump = false; }
      });
    }
    markRead(id);
  }
  function closeChat() {
    $('#msgInput').blur();
    if (S.msgUnsub) { S.msgUnsub(); S.msgUnsub = null; }
    S.current = null;
    stopRecording(false);
    Voice.stop();
  }
  function markRead(id) {
    const chat = S.chats.get(id);
    if (!chat) return;
    if (chat.unread) { chat.unread = 0; renderChats(false); }
    B.markRead(id);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.current) markRead(S.current);
  });

  function renderChatHeader() {
    const chat = S.chats.get(S.current);
    if (!chat) return;
    const other = chat.type === 'dm' ? otherMember(chat) : null;
    $('#chatTitle').innerHTML = other ? nameHTML(other) : esc(chat.title);
    setAvatar($('#chatAvatar'), other || chat, other && other.online);
    const st = $('#chatStatus');
    const typing = isTyping(chat.id);
    st.classList.toggle('live', !!typing || !!(other && other.online));
    if (typing) st.textContent = chat.type === 'group' ? `${typing.name} печатает…` : 'печатает…';
    else if (chat.type === 'group') {
      const on = chat.members.filter((m) => m && m.online).length;
      st.textContent = `${chat.members.length} ${plural(chat.members.length, 'участник', 'участника', 'участников')} · ${on} в сети`;
      st.classList.remove('live');
    } else st.textContent = fmtSeen(other);
    $('#callBtns').hidden = chat.type !== 'dm';
  }
  $('#chatWho').addEventListener('click', () => {
    const chat = S.chats.get(S.current);
    if (chat && chat.type === 'dm') openUser(otherMember(chat).id);
  });

  // подписи для записей о звонках (mine — звонил я)
  function callLabel(info, mine) {
    const kind = info.video ? 'Видеовызов' : 'Голосовой вызов';
    const kindLow = info.video ? 'видеовызов' : 'голосовой вызов';
    const dur = `${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')}`;
    switch (info.result) {
      case 'ended': return { title: `${kind} завершён`, sub: dur, ok: true };
      case 'declined': return { title: mine ? `${kind} отклонён` : 'Вы отклонили вызов' };
      case 'busy': return { title: mine ? 'Абонент был занят' : `Пропущенный ${kindLow}` };
      case 'missed': return { title: mine ? `${kind}: нет ответа` : `Пропущенный ${kindLow}` };
      default: return { title: mine ? `${kind} отменён` : `Пропущенный ${kindLow}` };
    }
  }
  const ICON_PHONE = '<svg viewBox="0 0 24 24"><path d="M5 4h3.5l1.8 4.5-2.3 1.4a11 11 0 0 0 6.1 6.1l1.4-2.3L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5C10.6 20 4 13.4 3.5 5.6A1.5 1.5 0 0 1 5 4z" fill="currentColor" stroke="none"/></svg>';
  const ICON_VIDEO = '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="13" height="12" rx="3" fill="currentColor" stroke="none"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z" fill="currentColor" stroke="none"/></svg>';
  const ICON_MISSED_IN = '<svg viewBox="0 0 24 24"><path d="M7 15.5c3.5-3 6.5-3 10 0l-1.6 2-2.4-1v-1.7a5 5 0 0 0-2 0v1.7l-2.4 1z" fill="currentColor" stroke="none"/><path d="M8 4l4 4 4-4M12 8V3" stroke-width="1.8"/></svg>';
  function callMessageHTML(m, mine) {
    const info = m.call || {};
    const l = callLabel(info, mine);
    if (l.ok) {
      return `<div class="bubble callbubble" data-recall="${info.video ? 'video' : 'audio'}">
        <span class="cb-icon">${info.video ? ICON_VIDEO : ICON_PHONE}</span>
        <span class="cb-text"><b>${esc(l.title)}</b><small>${esc(l.sub)}</small></span></div>`;
    }
    return `<div class="callrow ${mine ? '' : 'missed'}" data-recall="${info.video ? 'video' : 'audio'}">
      <span class="cr-icon">${mine ? (info.video ? ICON_VIDEO : ICON_PHONE) : ICON_MISSED_IN}</span>
      <span class="cb-text"><b>${esc(l.title)}</b><small>Нажмите, чтобы перезвонить</small></span></div>`;
  }
  const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function waveBars(id) {
    // псевдослучайная «волна» по id сообщения, чтобы не менялась при перерисовке
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    let out = '';
    for (let i = 0; i < 28; i++) { h = (h * 1103515245 + 12345) >>> 0; out += `<i style="height:${25 + (h % 75)}%"></i>`; }
    return out;
  }
  function bubbleHTML(m) {
    if (m.kind === 'sticker') return stickerHTML(m.sticker, m.text);
    if (m.kind === 'gift' && GIFT_INFO[m.gift]) {
      return `<div class="gift-bubble"><span class="gift-art">${GIFT_INFO[m.gift][0]}</span><b>${esc(GIFT_INFO[m.gift][1])}${(m.count || 1) > 1 ? ' ×' + esc(m.count) : ''}</b><small>Подарок · ☾ ${num(m.price || B.GIFTS[m.gift] || 0)}</small>${m.note ? `<p>${esc(m.note)}</p>` : ''}</div>`;
    }
    if (m.kind === 'nftgift' && m.nft) {
      return `<div class="gift-bubble nft" data-nft="${esc(m.nft.id)}">${nftArtHTML(m.nft)}<b>${esc(m.nft.name || 'NFT')} #${esc(m.nft.num)}</b><small>NFT-подарок</small></div>`;
    }
    if (m.kind === 'file' && m.file && m.file.id) {
      const f = m.file;
      return `<div class="bubble file-bubble" data-file="${esc(f.id)}"><span class="ficon"><svg><use href="#i-file"/></svg></span><span class="fmeta"><b>${esc(f.name)}</b><small>${fmtSize(f.size)} · ${/^(video|audio|image)\//.test(f.type) ? 'открыть' : 'скачать'}</small></span></div>`;
    }
    if (m.kind === 'image' && safePhoto(m.image)) return `<div class="bubble img-bubble"><img src="${m.image}" alt="Фото" data-view /></div>`;
    if (m.kind === 'voice' && /^data:audio\//.test(m.audio || '')) {
      return `<div class="bubble voice" data-voice="${esc(m.id)}"><button class="vplay" aria-label="Слушать"><svg><use href="#i-play"/></svg></button><span class="wave">${waveBars(m.id)}</span><time>${fmtDur(m.dur || 0)}</time></div>`;
    }
    return `<div class="bubble ${emojiOnly(m.text) ? 'emoji-only' : ''}">${esc(m.text)}</div>`;
  }
  const emojiOnly = (t) => /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,12}$/u.test(t || '') && !/^[\d#*\s]+$/.test(t);

  let animateIds = new Set();
  function renderMessages(jump) {
    const box = $('#messages');
    const chat = S.chats.get(S.current);
    const msgs = S.messages.get(S.current);
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (!chat) return;
    if (!msgs) { box.innerHTML = ''; return; }
    if (!msgs.length) {
      const other = chat.type === 'dm' ? otherMember(chat) : null;
      box.innerHTML = `<div class="chat-empty">${avatarHTML(chat, 'xl')}<h3>${esc(chat.title)}</h3><p>${other ? '@' + esc(other.username) + ' · ' : ''}Напишите первым</p>${other ? `<button class="btn-soft" data-profile="${esc(other.id)}">Открыть профиль</button>` : ''}</div>`;
      return;
    }
    let html = '';
    const isGroup = chat.type === 'group';
    let lastMine = -1;
    msgs.forEach((m, i) => { if (m.from === S.me.id) lastMine = i; });
    msgs.forEach((m, i) => {
      const prev = msgs[i - 1], next = msgs[i + 1];
      if (!prev || !sameDay(prev.ts, m.ts) || m.ts - prev.ts > 3600e3) html += `<div class="day"><b>${fmtDay(m.ts)}</b> ${fmtTime(m.ts)}</div>`;
      const mine = m.from === S.me.id;
      const gapNext = next && (next.from !== m.from || !sameDay(next.ts, m.ts) || next.ts - m.ts > 3600e3);
      const tail = !next || gapNext || next.ts - m.ts > 60e3;
      const first = !prev || prev.from !== m.from || !sameDay(prev.ts, m.ts) || m.ts - prev.ts > 3600e3;
      const sender = isGroup && !mine && first ? (chat.members.find((x) => x && x.id === m.from) || {}).name : null;
      html += `<div class="msg ${mine ? 'me' : 'them'} ${tail ? 'tail' : ''} ${animateIds.has(m.id) ? 'new' : ''} ${m.pending ? 'pending' : ''}" data-id="${esc(m.id)}" title="${fmtTime(m.ts)}">
        ${sender ? `<div class="sender">${esc(sender)}</div>` : ''}
        ${m.kind === 'call' ? callMessageHTML(m, mine) : bubbleHTML(m)}
      </div>`;
      if (i === lastMine && i === msgs.length - 1) {
        const read = !m.pending && isReadByOthers(chat, m);
        const readTs = read ? Math.max(...Object.entries(chat.lastRead || {}).filter(([u]) => u !== S.me.id).map(([, t]) => t)) : 0;
        html += `<div class="receipt">${m.pending ? 'Отправка…' : read ? `<b>Прочитано</b> ${fmtTime(readTs)}` : 'Доставлено'}</div>`;
      }
    });
    if (isTyping(chat.id)) html += `<div class="typing-row msg them"><div class="bubble"><i></i><i></i><i></i></div></div>`;
    const playing = Voice.id;
    box.innerHTML = html;
    if (playing) Voice.rebind();
    animateIds.clear();
    if (jump || nearBottom) box.scrollTop = box.scrollHeight;
  }
  $('#messages').addEventListener('click', (e) => {
    const rc = e.target.closest('[data-recall]');
    if (rc) { haptic(8); Call.start(rc.dataset.recall === 'video'); return; }
    const img = e.target.closest('[data-view]');
    if (img) { openViewer(img.src); return; }
    const v = e.target.closest('[data-voice]');
    if (v) { Voice.toggle(v.dataset.voice); return; }
    const nfm = e.target.closest('[data-nft]');
    if (nfm) { openNft(nfm.dataset.nft); return; }
    const fl = e.target.closest('[data-file]');
    if (fl) { openFile(fl.dataset.file, fl); return; }
    const pr = e.target.closest('[data-profile]');
    if (pr) openUser(pr.dataset.profile);
  });

  // голосовые: один плеер на все сообщения
  const Voice = (() => {
    const audio = new Audio();
    let id = null;
    function el() { return id && $(`[data-voice="${CSS.escape(id)}"]`); }
    function paint() {
      const v = el();
      if (!v) return;
      const p = audio.duration ? audio.currentTime / audio.duration : 0;
      const bars = $$('.wave i', v);
      bars.forEach((b, i) => b.classList.toggle('on', i / bars.length < p));
      $('time', v).textContent = fmtDur(audio.paused && !audio.currentTime ? (audio.duration || 0) : audio.currentTime);
      $('use', v).setAttribute('href', audio.paused ? '#i-play' : '#i-pause');
    }
    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('pause', paint);
    audio.addEventListener('ended', () => { audio.currentTime = 0; paint(); id = null; });
    function toggle(mid) {
      if (id === mid) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); return; }
      stop();
      const msgs = S.messages.get(S.current) || [];
      const m = msgs.find((x) => x.id === mid);
      if (!m) return;
      id = mid;
      audio.src = m.audio;
      audio.play().catch(() => toast('Не удалось воспроизвести'));
    }
    function stop() {
      if (!id) return;
      audio.pause();
      const v = el();
      audio.currentTime = 0;
      id = null;
      if (v) { $$('.wave i', v).forEach((b) => b.classList.remove('on')); $('use', v).setAttribute('href', '#i-play'); }
    }
    return { toggle, stop, rebind: paint, get id() { return id; } };
  })();

  // поле ввода
  const input = $('#msgInput');
  let lastTypingSent = 0;
  function syncComposer() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 132) + 'px';
    $('#composer').classList.toggle('has-text', input.value.trim().length > 0);
  }
  input.addEventListener('input', () => {
    syncComposer();
    if (Date.now() - lastTypingSent > 2500 && input.value) { lastTypingSent = Date.now(); B.typing(S.current); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !S.current) return;
    sendText(S.current, text);
    input.value = '';
    syncComposer();
    $('#emojiPop').hidden = true;
    input.focus();
  });
  function sendText(chatId, text, extra) {
    if (!canPost()) return;
    if (S.current === chatId) { const box = $('#messages'); box.scrollTop = box.scrollHeight; }
    B.send(chatId, text, extra);
    haptic(8);
  }

  // эмодзи
  $('#emojiPop').innerHTML = EMOJI.map((e) => `<button type="button">${e}</button>`).join('');
  $('#emojiBtn').addEventListener('click', () => { $('#stickerPop').hidden = true; $('#emojiPop').hidden = !$('#emojiPop').hidden; haptic(5); });
  $('#emojiPop').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    input.value += b.textContent;
    syncComposer();
    haptic(4);
  });
  $('#messages').addEventListener('pointerdown', () => { $('#emojiPop').hidden = true; $('#stickerPop').hidden = true; });

  // фото в чат
  $('#imgBtn').addEventListener('click', async () => {
    const chatId = S.current;
    const f = await pickFile($('#imgFile'));
    if (!f || !chatId) return;
    try {
      const image = await compressImage(f, 1080, 900000);
      sendText(chatId, '📷 Фото', { kind: 'image', image });
    } catch (e) { toast(e.message); }
  });

  // голосовые сообщения (до 60 секунд)
  let rec = null;
  async function startRecording() {
    if (!window.MediaRecorder || !navigator.mediaDevices) { toast('Запись голоса не поддерживается'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { toast('Нет доступа к микрофону'); return; }
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32000 });
    rec = { mr, stream, chunks: [], t0: Date.now(), chatId: S.current, send: false };
    mr.ondataavailable = (e) => e.data.size && rec && rec.chunks.push(e.data);
    mr.onstop = () => finishRecording();
    mr.start(250);
    $('#recording').hidden = false;
    $('#recTime').textContent = '0:00';
    rec.timer = setInterval(() => {
      const s = (Date.now() - rec.t0) / 1000;
      $('#recTime').textContent = fmtDur(s);
      if (s >= 60) stopRecording(true);
    }, 250);
    haptic(12);
  }
  function stopRecording(send) {
    if (!rec) return;
    rec.send = send;
    clearInterval(rec.timer);
    $('#recording').hidden = true;
    if (rec.mr.state !== 'inactive') rec.mr.stop(); else finishRecording();
  }
  function finishRecording() {
    const r = rec;
    rec = null;
    if (!r) return;
    r.stream.getTracks().forEach((t) => t.stop());
    const dur = Math.round((Date.now() - r.t0) / 1000);
    if (!r.send || dur < 1 || !r.chunks.length) return;
    const blob = new Blob(r.chunks, { type: r.mr.mimeType || 'audio/webm' });
    const fr = new FileReader();
    fr.onload = () => {
      const audio = String(fr.result);
      if (audio.length > 940000) { toast('Голосовое слишком длинное'); return; }
      sendText(r.chatId, '🎤 Голосовое сообщение', { kind: 'voice', audio, dur });
    };
    fr.readAsDataURL(blob);
  }
  $('#micBtn').addEventListener('click', startRecording);
  $('#recCancel').addEventListener('click', () => stopRecording(false));
  $('#recSend').addEventListener('click', () => stopRecording(true));

  // ---------- новый чат и группы ----------
  let sheetMode = 'dm';
  const picked = new Set();
  function openPeopleSheet() {
    sheetMode = 'dm';
    picked.clear();
    $('#peopleSheetTitle').textContent = 'Новый чат';
    $('#groupDone').hidden = true;
    $('#groupName').hidden = true;
    $('#newGroupBtn').hidden = false;
    $('#sheetSearch').value = '';
    $('#groupName').value = '';
    openSheet('peopleSheet');
    loadSheetUsers();
  }
  async function loadSheetUsers() {
    try {
      const users = await B.searchUsers($('#sheetSearch').value);
      $('#sheetList').innerHTML = users.length
        ? users.map((u, i) => `<li class="row ${picked.has(u.id) ? 'picked' : ''}" data-uid="${esc(u.id)}" style="--i:${i}">
            ${avatarHTML(u, '', u.online)}
            <div class="row-main"><b>${nameHTML(u)}</b><span>@${esc(u.username)}</span></div>
            <span class="pick" ${sheetMode === 'group' ? '' : 'hidden'}><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
          </li>`).join('')
        : '<div class="empty"><b>Никого нет</b><span>Друзья появятся здесь, когда зарегистрируются в Xitter</span></div>';
    } catch (e) { toast(e.message); }
  }
  let sheetTimer;
  $('#sheetSearch').addEventListener('input', () => { clearTimeout(sheetTimer); sheetTimer = setTimeout(loadSheetUsers, 200); });
  $('#composeChat').addEventListener('click', openPeopleSheet);
  $('#emptyCompose').addEventListener('click', openPeopleSheet);
  $('#newGroupBtn').addEventListener('click', () => {
    sheetMode = 'group';
    $('#peopleSheetTitle').textContent = 'Новая группа';
    $('#groupDone').hidden = false;
    $('#groupName').hidden = false;
    $('#newGroupBtn').hidden = true;
    $$('#sheetList .pick').forEach((p) => (p.hidden = false));
    $('#groupName').focus();
  });
  $('#sheetList').addEventListener('click', async (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const uid = row.dataset.uid;
    if (sheetMode === 'group') {
      picked.has(uid) ? picked.delete(uid) : picked.add(uid);
      row.classList.toggle('picked', picked.has(uid));
      haptic(5);
      return;
    }
    closeSheet();
    setTimeout(() => messageUser(uid), 200);
  });
  $('#groupDone').addEventListener('click', async () => {
    const name = $('#groupName').value.trim();
    if (!name) { toast('Введите название группы'); return; }
    if (!picked.size) { toast('Выберите участников'); return; }
    try {
      const chat = await B.createGroup(name, [...picked]);
      S.chats.set(chat.id, chat);
      renderChats(false);
      closeSheet();
      setTimeout(() => openChat(chat.id), 200);
    } catch (err) { toast(err.message); }
  });

  // ---------- системные уведомления (когда вкладка Xitter не на экране) ----------
  function askNotify() {
    try {
      if (window.Notification && Notification.permission === 'default') Notification.requestPermission().catch?.(() => {});
    } catch {}
  }
  // разрешение спрашиваем по первому касанию: браузеры не дают спросить без действия пользователя
  addEventListener('pointerdown', function once() { if (S.started) { askNotify(); removeEventListener('pointerdown', once); } });
  function notify(title, body, tag) {
    if (document.visibilityState === 'visible') return;
    try {
      if (!window.Notification || Notification.permission !== 'granted') return;
      const n = new Notification(title, { body, tag, icon: 'icons/icon-192.png', renotify: true, requireInteraction: tag === 'call' });
      n.onclick = () => { window.focus(); n.close(); };
    } catch {}
  }

  // ---------- звуки ----------
  let actx;
  function audioCtx() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    return actx;
  }
  function blip() {
    const ctx = audioCtx();
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.3);
  }

  // ---------- звонки (WebRTC) ----------
  const wsSend = (d) => B.signal(d);
  const Call = (() => {
    const el = $('#call');
    const remoteV = $('#remoteVideo'), localV = $('#localVideo');
    // TURN-сервер пересылает звонок, когда телефоны в разных сетях (мобильный интернет, разные Wi-Fi)
    // и не могут соединиться напрямую. Свой сервер админ задаёт в админке, иначе берётся бесплатный Open Relay.
    const ICE = { iceServers: [] };
    const DEFAULT_TURN = [{ urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }];
    function setTurn(list) {
      ICE.iceServers = [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
        ...(list && list.length ? list : DEFAULT_TURN),
      ];
    }
    let localTurn = null;
    try { localTurn = JSON.parse(store.get('turn') || 'null'); } catch {}
    setTurn(localTurn ? [localTurn] : null);
    let c = null;
    let ringTimer = null, ringOsc = null, durTimer = null;

    function setState(text) { $('#callState').textContent = text; $('#callBarTime').textContent = text; }
    // свернуть звонок: экран прячется, сверху остаётся полоска, звук и видео продолжают идти
    function minimize() {
      if (!c || el.classList.contains('incoming')) return;
      el.classList.add('mini');
      document.body.classList.remove('calling');
      document.body.classList.add('call-mini');
      $('#callBarName').textContent = c.peer.name || c.peer.title || 'Звонок';
      $('#callBar').hidden = false;
      if (c.chatId && S.current !== c.chatId && S.chats.has(c.chatId)) openChat(c.chatId);
    }
    function restore() {
      el.classList.remove('mini');
      document.body.classList.add('calling');
      document.body.classList.remove('call-mini');
      $('#callBar').hidden = true;
    }
    $('#minBtn').addEventListener('click', minimize);
    $('#callBar').addEventListener('click', restore);

    function show(peer, video, incoming) {
      setAvatar($('#callAvatar'), peer);
      $('#callName').textContent = peer.name || peer.title;
      el.classList.toggle('video', !!video);
      el.classList.toggle('incoming', !!incoming);
      el.classList.remove('active', 'closing', 'mini');
      document.body.classList.remove('call-mini');
      $('#callBar').hidden = true;
      el.hidden = false;
      ['#muteBtn', '#camBtn', '#speakerBtn'].forEach((s) => $(s).classList.remove('on'));
      $('#camBtn').classList.toggle('dim', !video);
      el.classList.remove('keypad-open', 'cam-off');
      $('#keypadDigits').textContent = '';
      document.body.classList.add('calling');
    }
    function hide() {
      el.classList.add('closing');
      document.body.classList.remove('calling', 'call-mini');
      $('#callBar').hidden = true;
      setTimeout(() => { el.hidden = true; el.classList.remove('closing', 'active', 'incoming', 'mini'); }, 450);
    }
    function startRing(incoming) {
      stopRing();
      const ctx = audioCtx();
      const beep = () => {
        if (incoming) haptic([300, 200, 300]);
        if (!ctx) return;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = incoming ? 740 : 440;
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(incoming ? 0.15 : 0.06, ctx.currentTime + 0.05);
        g.gain.setValueAtTime(incoming ? 0.15 : 0.06, ctx.currentTime + 0.9);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.1);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 1.2);
        ringOsc = o;
      };
      beep();
      ringTimer = setInterval(beep, 3000);
    }
    function stopRing() {
      clearInterval(ringTimer);
      ringTimer = null;
      try { ringOsc && ringOsc.stop(); } catch {}
      try { navigator.vibrate && navigator.vibrate(0); } catch {}
    }
    async function getMedia(video) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
        throw new Error('Для звонков откройте Xitter по адресу https:// или в приложении');
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: video ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        });
      } catch (e) {
        if (video) { try { return await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {} }
        throw new Error('Нет доступа к микрофону' + (video ? ' или камере' : ''));
      }
    }
    // Если микрофона или камеры нет (или страница открыта не по https), звонок всё равно идёт:
    // собеседника слышно и видно, а нас — нет.
    async function attachMedia(video) {
      let local = null;
      try { local = await getMedia(video); } catch (e) { toast(e.message + '. Звонок продолжится без вашего звука'); }
      if (!c) { local && local.getTracks().forEach((t) => t.stop()); return false; }
      c.local = local || new MediaStream();
      localV.srcObject = c.local;
      c.pc = makePC();
      c.local.getTracks().forEach((t) => c.pc.addTrack(t, c.local));
      if (!c.local.getAudioTracks().length) c.pc.addTransceiver('audio', { direction: 'recvonly' });
      if (video && !c.local.getVideoTracks().length) c.pc.addTransceiver('video', { direction: 'recvonly' });
      return true;
    }

    function makePC() {
      const pc = new RTCPeerConnection(ICE);
      pc.onicecandidate = (e) => { if (e.candidate && c) wsSend({ type: 'call:ice', to: c.peer.id, callId: c.id, candidate: e.candidate }); };
      pc.ontrack = (e) => {
        if (remoteV.srcObject !== e.streams[0]) remoteV.srcObject = e.streams[0];
        remoteV.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (!c) return;
        if (pc.connectionState === 'connected') onConnected();
        if (pc.connectionState === 'failed') end('Соединение потеряно');
      };
      return pc;
    }
    function onConnected() {
      if (c.startedAt) return;
      c.startedAt = Date.now();
      stopRing();
      clearTimeout(c.timeout);
      el.classList.add('active');
      el.classList.remove('incoming');
      haptic(15);
      const tick = () => {
        const s = Math.floor((Date.now() - c.startedAt) / 1000);
        setState(`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
      };
      tick();
      durTimer = setInterval(tick, 1000);
    }
    async function flushIce() {
      for (const cand of c.ice.splice(0)) try { await c.pc.addIceCandidate(cand); } catch {}
    }
    async function start(video) {
      const chat = S.chats.get(S.current);
      if (!chat || chat.type !== 'dm') return;
      if (c) return toast('Звонок уже идёт');
      const peer = otherMember(chat);
      c = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), peer, chatId: chat.id, video, outgoing: true, ice: [] };
      show(peer, video, false);
      setState(video ? 'Xitter Видео…' : 'Xitter Аудио…');
      startRing(false);
      try {
        if (!(await attachMedia(video))) return;
        const offer = await c.pc.createOffer();
        await c.pc.setLocalDescription(offer);
        wsSend({ type: 'call:offer', to: peer.id, callId: c.id, chatId: chat.id, video, sdp: c.pc.localDescription });
        c.timeout = setTimeout(() => end('Нет ответа', 'missed'), 45000);
      } catch (e) {
        toast(e.message);
        end(null);
      }
    }
    async function accept() {
      if (!c || c.outgoing) return;
      stopRing();
      setState('Соединение…');
      el.classList.remove('incoming');
      try {
        if (!(await attachMedia(c.video))) return;
        await c.pc.setRemoteDescription(c.offer);
        await flushIce();
        const answer = await c.pc.createAnswer();
        await c.pc.setLocalDescription(answer);
        wsSend({ type: 'call:answer', to: c.peer.id, callId: c.id, sdp: c.pc.localDescription });
      } catch (e) {
        toast(e.message);
        decline();
      }
    }
    function decline() {
      if (!c) return;
      wsSend({ type: 'call:decline', to: c.peer.id, callId: c.id });
      cleanup();
    }
    function end(reason, logText) {
      if (!c) return;
      wsSend({ type: 'call:end', to: c.peer.id, callId: c.id });
      if (c.outgoing) {
        // запись о звонке в чате: result = ended | cancelled | missed | declined | busy
        const result = logText || (c.startedAt ? 'ended' : 'cancelled');
        const duration = c.startedAt ? Math.floor((Date.now() - c.startedAt) / 1000) : 0;
        const info = { video: !!c.video, result, duration };
        B.send(c.chatId, (c.video ? '🎥 ' : '📞 ') + callLabel(info, true).title, { kind: 'call', call: info });
      }
      if (reason) toast(reason);
      cleanup();
    }
    function cleanup() {
      stopRing();
      clearInterval(durTimer);
      if (c) {
        clearTimeout(c.timeout);
        try { c.pc && c.pc.close(); } catch {}
        c.local && c.local.getTracks().forEach((t) => t.stop());
      }
      remoteV.srcObject = null;
      localV.srcObject = null;
      c = null;
      hide();
    }
    async function onSignal(d) {
      switch (d.type) {
        case 'call:offer': {
          if (c) { wsSend({ type: 'call:busy', to: d.from, callId: d.callId }); return; }
          const chat = S.chats.get(d.chatId);
          const peer = (chat && otherMember(chat)) || { id: d.from, name: d.fromName, colors: d.fromColors };
          c = { id: d.callId, peer, chatId: d.chatId, video: !!d.video, outgoing: false, offer: d.sdp, ice: [] };
          show(peer, d.video, true);
          setState(d.video ? 'Xitter Видео' : 'Xitter Аудио');
          startRing(true);
          notify(`${peer.name || 'Xitter'}`, d.video ? 'Входящий видеозвонок' : 'Входящий звонок', 'call');
          c.timeout = setTimeout(() => { if (c && !c.pc) cleanup(); }, 45000);
          break;
        }
        case 'call:answer':
          if (!c || c.id !== d.callId) return;
          stopRing();
          setState('Соединение…');
          await c.pc.setRemoteDescription(d.sdp);
          await flushIce();
          break;
        case 'call:ice':
          if (!c || c.id !== d.callId) return;
          if (c.pc && c.pc.remoteDescription) { try { await c.pc.addIceCandidate(d.candidate); } catch {} }
          else c.ice.push(d.candidate);
          break;
        case 'call:decline':
          if (c && c.id === d.callId) end('Звонок отклонён', 'declined');
          break;
        case 'call:busy':
          if (c && c.id === d.callId) end('Абонент занят', 'busy');
          break;
        case 'call:end':
          if (c && c.id === d.callId) { const was = c.startedAt; cleanup(); toast(was ? 'Звонок завершён' : 'Звонок отменён'); }
          break;
      }
    }

    $('#acceptBtn').addEventListener('click', accept);
    $('#declineBtn').addEventListener('click', decline);
    $('#hangupBtn').addEventListener('click', () => end(null));
    $('#hangupBtn2').addEventListener('click', () => end(null));
    $('#speakerBtn').addEventListener('click', (e) => {
      const on = e.currentTarget.classList.toggle('on');
      remoteV.volume = on ? 1 : 0.6;
      haptic(6);
    });
    $('#addBtn').addEventListener('click', () => toast('Групповые звонки появятся позже'));
    $('#infoBtn').addEventListener('click', () => c && toast(c.peer.username ? '@' + c.peer.username : c.peer.name));
    $('#keypadBtn').addEventListener('click', () => el.classList.add('keypad-open'));
    $('#keypadHide').addEventListener('click', () => el.classList.remove('keypad-open'));
    // тоны клавиш (DTMF)
    const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477], '*': [941, 1209], 0: [941, 1336], '#': [941, 1477] };
    $$('.keypad-grid button').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k;
      $('#keypadDigits').textContent = ($('#keypadDigits').textContent + k).slice(-16);
      const ctx = audioCtx();
      if (ctx) {
        const g = ctx.createGain();
        g.gain.value = 0.08;
        g.connect(ctx.destination);
        DTMF[k].forEach((f) => { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(g); o.start(); o.stop(ctx.currentTime + 0.15); });
      }
      try { c && c.pc && c.pc.getSenders().find((x) => x.dtmf)?.dtmf.insertDTMF(k); } catch {}
      haptic(5);
    }));
    $('#msgBtn').addEventListener('click', () => {
      if (!c) return;
      const chatId = c.chatId;
      decline();
      if (S.chats.has(chatId)) setTimeout(() => { openChat(chatId); $('#msgInput').focus(); }, 450);
    });
    $('#vmBtn').addEventListener('click', () => {
      if (!c) return;
      const chatId = c.chatId;
      decline();
      sendText(chatId, 'Не могу сейчас говорить, перезвоню позже.');
      toast('Отправлен автоответ');
    });
    $('#muteBtn').addEventListener('click', (e) => {
      if (!c || !c.local) return;
      const muted = e.currentTarget.classList.toggle('on');
      c.local.getAudioTracks().forEach((t) => (t.enabled = !muted));
      haptic(6);
    });
    $('#camBtn').addEventListener('click', (e) => {
      if (!c || !c.local) return;
      if (!c.local.getVideoTracks().length) { toast('Это аудиозвонок. Для видео позвоните по видео'); return; }
      const off = e.currentTarget.classList.toggle('on');
      c.local.getVideoTracks().forEach((t) => (t.enabled = !off));
      el.classList.toggle('cam-off', off);
      haptic(6);
    });
    $('#flipBtn').addEventListener('click', async () => {
      if (!c || !c.local || !c.pc) return;
      const old = c.local.getVideoTracks()[0];
      if (!old) return;
      const facing = (old.getSettings().facingMode || 'user') === 'user' ? 'environment' : 'user';
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
        const track = s.getVideoTracks()[0];
        const sender = c.pc.getSenders().find((x) => x.track && x.track.kind === 'video');
        if (sender) await sender.replaceTrack(track);
        c.local.removeTrack(old);
        old.stop();
        c.local.addTrack(track);
        localV.srcObject = c.local;
        localV.classList.toggle('mirror', facing === 'user');
      } catch { toast('Не удалось переключить камеру'); }
    });
    // локальное превью можно перетаскивать
    (() => {
      let ox = 0, oy = 0, sx = 0, sy = 0, drag = false;
      localV.addEventListener('pointerdown', (e) => { drag = true; sx = e.clientX - ox; sy = e.clientY - oy; localV.setPointerCapture(e.pointerId); localV.style.transition = 'none'; });
      localV.addEventListener('pointermove', (e) => { if (!drag) return; ox = e.clientX - sx; oy = e.clientY - sy; localV.style.translate = `${ox}px ${oy}px`; });
      localV.addEventListener('pointerup', () => {
        drag = false;
        localV.style.transition = '';
        // прилипание к ближайшему углу
        const r = localV.getBoundingClientRect();
        const left = r.left + r.width / 2 < innerWidth / 2;
        const top = r.top + r.height / 2 < innerHeight / 2;
        const baseR = localV.offsetLeft, baseT = localV.offsetTop;
        ox = left ? 16 - baseR : 0;
        oy = top ? 0 : innerHeight - r.height - 180 - baseT;
        localV.style.translate = `${ox}px ${oy}px`;
      });
    })();

    return { start, onSignal, setTurn, minimize, get active() { return !!c; } };
  })();

  // меню сообщения: правая кнопка мыши, долгое нажатие или клавиша Delete / меню
  function messageMenu(el) {
    const msgs = S.messages.get(S.current) || [];
    const m = msgs.find((x) => x.id === el.dataset.id);
    if (!m) return;
    const items = [];
    if (m.text && !m.kind) items.push({ label: 'Скопировать', fn: () => { navigator.clipboard?.writeText(m.text).then(() => toast('Скопировано'), () => {}); } });
    if (m.from === S.me.id && !m.pending) items.push({ label: 'Удалить у всех', danger: true, fn: async () => {
      try { await B.deleteMessage(S.current, m.id); toast('Сообщение удалено'); } catch (err) { toast(err.message); }
    } });
    if (items.length) showActions(items);
  }
  $('#messages').addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.msg[data-id]');
    if (!el) return;
    e.preventDefault();
    messageMenu(el);
  });
  {
    let lp = 0, sx = 0, sy = 0;
    $('#messages').addEventListener('touchstart', (e) => {
      const el = e.target.closest('.msg[data-id]');
      if (!el) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      lp = setTimeout(() => { lp = 0; haptic(10); messageMenu(el); }, 500);
    }, { passive: true });
    const cancel = () => { clearTimeout(lp); lp = 0; };
    $('#messages').addEventListener('touchmove', (e) => { if (Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 8) cancel(); }, { passive: true });
    $('#messages').addEventListener('touchend', cancel);
  }
  $('#messages').addEventListener('keydown', (e) => {
    const el = e.target.closest('.msg[data-id]');
    if (el && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); messageMenu(el); }
  });

  $('#audioCallBtn').addEventListener('click', () => Call.start(false));
  $('#videoCallBtn').addEventListener('click', () => Call.start(true));

  // системная кнопка «Назад» на Android
  window.__xitterBack = () => {
    if (document.body.classList.contains('calling')) { Call.minimize(); return true; }
    if (!$('#viewer').hidden) { $('#viewer').hidden = true; return true; }
    if (document.body.classList.contains('as-open')) { closeActions(); return true; }
    if (openSheetId) { closeSheet(); return true; }
    if (rec) { stopRecording(false); return true; }
    if (!$('#main').hidden && pop()) return true;
    if (!$('#main').hidden && S.tab !== 'feed') { switchTab('feed'); return true; }
    if (!$('#auth').hidden && !$('#stepEmail').classList.contains('active')) { goStep('stepEmail', true); return true; }
    return false;
  };

  // ---------- навигация с клавиатуры ----------
  // кликабельные строки и карточки получают фокус, Enter/пробел нажимает, Escape закрывает верхнее окно
  const FOCUSABLE = 'li.row[data-id], li.row[data-uid], li.row[data-user], li.row[data-act], li.row[data-auid], li.row[data-chat], .nft-card, .post-text[data-open], .post-img, [data-view], .bubble[data-file], .bubble[data-recall], .gift-bubble[data-nft], .msg[data-id]';
  function markFocusable(root) {
    root.querySelectorAll(FOCUSABLE).forEach((el) => {
      if (el.hasAttribute('tabindex')) return;
      el.tabIndex = 0;
      if (!el.matches('.msg')) el.setAttribute('role', 'button');
    });
  }
  new MutationObserver(() => markFocusable(document.body)).observe(document.body, { childList: true, subtree: true });
  markFocusable(document.body);
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t.matches && t.matches('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape') {
      if (typing && t.value) return;
      if (typing) t.blur();
      if (window.__xitterBack && window.__xitterBack()) e.preventDefault();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !typing && t.tabIndex >= 0 && t.matches(FOCUSABLE) && !t.matches('.msg')) {
      e.preventDefault();
      t.click();
    }
  });
  // при открытии окна фокус переходит внутрь, при закрытии — обратно
  let lastFocus = null;
  new MutationObserver((list) => {
    for (const m of list) {
      const el = m.target;
      if (!el.classList.contains('sheet')) continue;
      if (el.classList.contains('open') && !m.oldValue?.includes('open')) {
        lastFocus = document.activeElement;
        setTimeout(() => el.querySelector('input:not([type=hidden]), button:not([disabled]), [tabindex="0"]')?.focus({ preventScroll: true }), 350);
      } else if (!el.classList.contains('open') && m.oldValue?.includes(' open') && lastFocus && document.contains(lastFocus)) {
        lastFocus.focus({ preventScroll: true });
        lastFocus = null;
      }
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });

  // время «5 мин» в ленте само обновляется
  setInterval(() => { if (S.started && document.visibilityState === 'visible') schedule(); }, 60e3);

  // ---------- старт ----------
  initAuth();
  applyTheme(store.get('theme'));
  if (store.get('icon')) setAppIcon(store.get('icon'));
  renderUpdate();
  $('#buildFine').textContent = BUILD.run ? `Xitter · сборка ${BUILD.run}` : 'Xitter';
  if (BUILD.run) setTimeout(checkUpdate, 4000);
  B.onAuth((res) => {
    if (!res) { if (!S.started) showAuth(); return; }
    if (res.error) { if (!S.started) showAuth('stepEmail', res.error); return; }
    if (res.needsProfile) { if (!S.started) showAuth('stepProfile'); return; }
    S.me = res.user;
    enterMain();
  });

  if ('serviceWorker' in navigator && !isApp && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
