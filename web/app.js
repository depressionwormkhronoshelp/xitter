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
  const store = {
    get(k) { try { return localStorage.getItem('xitter.' + k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem('xitter.' + k) : localStorage.setItem('xitter.' + k, v); } catch {} },
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
  function avatarHTML(entity, cls = '', online = false, attrs = '') {
    const photo = safePhoto(entity && entity.photo);
    return `<span class="avatar ${cls} ${online ? 'online' : ''} ${photo ? 'photo' : ''}" style="${avatarStyle(entity)}" ${attrs}>${photo ? '' : esc(initials(entity && (entity.title || entity.name)))}<i class="dot"></i></span>`;
  }
  function setAvatar(el, entity, online) {
    const photo = safePhoto(entity && entity.photo);
    el.setAttribute('style', avatarStyle(entity));
    el.classList.toggle('online', !!online);
    el.classList.toggle('photo', !!photo);
    el.innerHTML = `${photo ? '' : esc(initials(entity && (entity.title || entity.name)))}<i class="dot"></i>`;
  }

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
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === (t || 'auto')));
    const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('meta[name=theme-color]').content = dark ? '#000000' : '#ffffff';
  }
  $$('#themeSeg button').forEach((b) => b.addEventListener('click', () => {
    store.set('theme', b.dataset.theme === 'auto' ? null : b.dataset.theme);
    applyTheme(store.get('theme'));
    haptic(5);
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
  }
  addEventListener('online', renderMe);
  addEventListener('offline', renderMe);

  const user = (uid) => (S.me && uid === S.me.id ? S.me : B.user(uid));
  const following = () => new Set((S.me && S.me.following) || []);

  // ---------- навигация: стек страниц ----------
  const stack = ['tabsPage'];
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
  $$('#tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

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
        <button class="who" data-user="${esc(p.author)}"><b>${esc(a.name)}</b><small>@${esc(a.username)} · ${fmtAgo(p.createdAt)}</small></button>
        <button class="icon-btn more" data-more aria-label="Ещё"><svg><use href="#i-more"/></svg></button>
      </div>
      ${p.text ? `<p class="post-text" ${opts.full ? '' : 'data-open'}>${esc(p.text)}</p>` : ''}
      ${p.image ? `<div class="post-img" data-img><img src="${esc(p.image)}" alt="" loading="lazy" /></div>` : ''}
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
          <div class="c-main"><b data-user="${esc(c.author)}">${esc(a.username || a.name)}</b><time>${fmtAgo(c.createdAt)}</time><p>${esc(c.text)}</p></div></li>`;
      }).join('')
      : '<div class="empty"><b>Комментариев нет</b><span>Напишите первый</span></div>';
  }
  $('#commentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#commentInput');
    const text = input.value.trim();
    const p = findPost(S.postId);
    if (!text || !p) return;
    input.value = '';
    try {
      await B.addComment(p, text);
      const sc = $('#postView');
      sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
      haptic(8);
    } catch (err) { toast(err.message); input.value = text; }
  });

  // ---------- новый пост ----------
  let composeImage = null;
  function openCompose() {
    composeImage = null;
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
  $('#publishBtn').addEventListener('click', async (e) => {
    const text = $('#postText').value.trim();
    if (!text && !composeImage) { toast('Напишите что-нибудь или добавьте фото'); return; }
    try {
      await busy(e.currentTarget, () => B.createPost({ text, image: composeImage }));
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
      <div class="row-main"><b>${esc(u.name)}</b><span>@${esc(u.username)}${u.bio ? ' · ' + esc(u.bio) : ''}</span></div>
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
    const name = `<b data-user="${esc(a.from)}">${esc(u.name)}</b>`;
    const t = `<time> · ${fmtAgo(a.createdAt)}</time>`;
    if (a.type === 'follow') return `${name} подписался(-ась) на вас${t}`;
    if (a.type === 'like') return `${name} оценил(а) ваш пост${t}`;
    if (a.type === 'comment') return `${name} прокомментировал(а): ${esc(a.text || '')}${t}`;
    return name + t;
  }
  function renderActivity(animate) {
    if (!S.me) return;
    const f = following();
    const items = S.activity.filter((a) => S.actCat === 'all' || a.type === S.actCat);
    const row = (a, i) => {
      const u = user(a.from);
      let right = '';
      if (a.type === 'follow') right = `<button class="btn-out ${f.has(a.from) ? 'on' : ''}" data-follow="${esc(a.from)}" data-label="Подписаться">${f.has(a.from) ? 'Вы подписаны' : 'Подписаться'}</button>`;
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
    if (u || a.type === 'follow') openUser(a.from);
    else if (findPost(a.postId)) openPost(a.postId);
    else toast('Пост удалён');
  });

  // ---------- профили ----------
  function profileHTML(u, isMe, followers) {
    const posts = S.posts.filter((p) => p.author === u.id);
    const f = following();
    const btns = isMe
      ? `<button class="btn-soft" id="editProfileBtn">Редактировать профиль</button><button class="btn-soft" data-chats>Сообщения</button>`
      : `<button class="btn-out ${f.has(u.id) ? 'on' : ''}" data-follow="${esc(u.id)}">${f.has(u.id) ? 'Вы подписаны' : 'Подписаться'}</button><button class="btn-soft" data-message="${esc(u.id)}">Сообщение</button>`;
    return `<div class="profile">
      <div class="profile-top">
        ${avatarHTML(u, 'xl', !isMe && u.online)}
        <div class="stats">
          <div><b>${num(posts.length)}</b><span>${plural(posts.length, 'пост', 'поста', 'постов')}</span></div>
          <div><b>${followers == null ? '—' : num(followers)}</b><span>${plural(followers || 0, 'подписчик', 'подписчика', 'подписчиков')}</span></div>
          <div><b>${num((u.following || []).length)}</b><span>${plural((u.following || []).length, 'подписка', 'подписки', 'подписок')}</span></div>
        </div>
      </div>
      <h2>${esc(u.name)}</h2>
      <div class="handle">@${esc(u.username)}${isMe ? '' : ' · ' + esc(fmtSeen(u))}</div>
      ${u.bio ? `<p class="bio">${esc(u.bio)}</p>` : ''}
      <div class="profile-btns">${btns}</div>
    </div>
    <div class="profile-posts"></div>
    ${posts.length ? '' : `<div class="empty"><b>Постов пока нет</b>${isMe ? '<button class="btn-black small" data-go="compose">Новый пост</button>' : ''}</div>`}`;
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
  function renderMeProfile() { if (S.me) renderProfileInto($('#meProfile'), S.me, true, S.meFollowers); }
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
    $('#setName').value = S.me.name;
    $('#setBio').value = S.me.bio || '';
    renderEditAvatar();
    $('#swatches').innerHTML = COLORS.map((c, i) => `<button data-i="${i}" style="--c1:${c[0]};--c2:${c[1]}" class="${c[0] === (editColors || [])[0] && c[1] === (editColors || [])[1] ? 'active' : ''}" aria-label="Цвет ${i + 1}"></button>`).join('');
    openSheet('editSheet');
  }
  function renderEditAvatar() {
    const wrap = $('.edit-avatar');
    setAvatar($('#editAvatar'), { ...S.me, colors: editColors, photo: editPhoto });
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
      S.me = await B.updateMe({ name: $('#setName').value, bio: $('#setBio').value, colors: editColors, photo: editPhoto });
      renderMe();
      schedule();
      closeSheet();
      toast('Профиль сохранён');
      haptic(10);
    } catch (e) { toast(e.message); }
  });
  $('#logoutBtn').addEventListener('click', () => logout());

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

  function openViewer(src) {
    const v = $('#viewer');
    $('img', v).src = src;
    v.hidden = false;
  }
  $('#viewer').addEventListener('click', () => { $('#viewer').hidden = true; });

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
        ${avatarHTML(c, 'l', other && other.online)}
        <div class="row-main"><b>${esc(c.title)}</b><p>${preview}${last && !typing ? ` <time>· ${fmtAgo(last.ts)}</time>` : ''}</p></div>
        ${c.unread ? '<i class="udot"></i>' : ''}
      </li>`;
    }).join('');
    $('#chatsEmpty').hidden = S.chats.size > 0;
    const total = [...S.chats.values()].reduce((n, c) => n + (c.unread || 0), 0);
    const badge = $('#dmBadge');
    badge.hidden = !total;
    badge.textContent = total > 99 ? '99+' : total;
  }
  $('#chatList').addEventListener('click', (e) => { const row = e.target.closest('.row'); if (row) openChat(row.dataset.id); });
  $('#chatSearch').addEventListener('input', () => renderChats(false));
  function openChats() { renderChats(true); push('chatsPage'); }
  $('#openChats').addEventListener('click', openChats);

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
    $('#chatTitle').textContent = chat.title;
    const other = chat.type === 'dm' ? otherMember(chat) : null;
    setAvatar($('#chatAvatar'), chat, other && other.online);
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
    if (S.current === chatId) { const box = $('#messages'); box.scrollTop = box.scrollHeight; }
    B.send(chatId, text, extra);
    haptic(8);
  }

  // эмодзи
  $('#emojiPop').innerHTML = EMOJI.map((e) => `<button type="button">${e}</button>`).join('');
  $('#emojiBtn').addEventListener('click', () => { $('#emojiPop').hidden = !$('#emojiPop').hidden; haptic(5); });
  $('#emojiPop').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    input.value += b.textContent;
    syncComposer();
    haptic(4);
  });
  $('#messages').addEventListener('pointerdown', () => { $('#emojiPop').hidden = true; });

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
            <div class="row-main"><b>${esc(u.name)}</b><span>@${esc(u.username)}</span></div>
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
    let turn = null;
    try { turn = JSON.parse(store.get('turn') || 'null'); } catch {}
    const ICE = {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        // TURN-сервер нужен, если звонок не соединяется через мобильный интернет. Свой можно указать в localStorage['xitter.turn'] = JSON
        ...(turn ? [turn] : []),
      ],
    };
    let c = null;
    let ringTimer = null, ringOsc = null, durTimer = null;

    function setState(text) { $('#callState').textContent = text; }

    function show(peer, video, incoming) {
      setAvatar($('#callAvatar'), peer);
      $('#callName').textContent = peer.name || peer.title;
      el.classList.toggle('video', !!video);
      el.classList.toggle('incoming', !!incoming);
      el.classList.remove('active', 'closing');
      el.hidden = false;
      ['#muteBtn', '#camBtn', '#speakerBtn'].forEach((s) => $(s).classList.remove('on'));
      $('#camBtn').classList.toggle('dim', !video);
      el.classList.remove('keypad-open', 'cam-off');
      $('#keypadDigits').textContent = '';
      document.body.classList.add('calling');
    }
    function hide() {
      el.classList.add('closing');
      document.body.classList.remove('calling');
      setTimeout(() => { el.hidden = true; el.classList.remove('closing', 'active', 'incoming'); }, 450);
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

    return { start, onSignal, get active() { return !!c; } };
  })();

  $('#audioCallBtn').addEventListener('click', () => Call.start(false));
  $('#videoCallBtn').addEventListener('click', () => Call.start(true));

  // системная кнопка «Назад» на Android
  window.__xitterBack = () => {
    if (document.body.classList.contains('calling')) return true;
    if (!$('#viewer').hidden) { $('#viewer').hidden = true; return true; }
    if (document.body.classList.contains('as-open')) { closeActions(); return true; }
    if (openSheetId) { closeSheet(); return true; }
    if (rec) { stopRecording(false); return true; }
    if (!$('#main').hidden && pop()) return true;
    if (!$('#main').hidden && S.tab !== 'feed') { switchTab('feed'); return true; }
    if (!$('#auth').hidden && !$('#stepEmail').classList.contains('active')) { goStep('stepEmail', true); return true; }
    return false;
  };

  // время «5 мин» в ленте само обновляется
  setInterval(() => { if (S.started && document.visibilityState === 'visible') schedule(); }, 60e3);

  // ---------- старт ----------
  initAuth();
  applyTheme(store.get('theme'));
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
