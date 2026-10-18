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

  if (/Chrome\//.test(navigator.userAgent) && CSS.supports('backdrop-filter', 'url(#lg-refract)'))
    document.documentElement.classList.add('refract');

  const COLORS = [
    ['#FF9A3C', '#FF5F1F'], ['#FFB86B', '#FF7A59'], ['#FF8A65', '#F4511E'], ['#FFC371', '#FF5F6D'],
    ['#F7971E', '#FFD200'], ['#FF7E5F', '#FEB47B'], ['#FDA085', '#F6D365'], ['#FF6A00', '#EE0979'],
  ];

  const B = window.XBackend;
  const S = {
    me: null,
    chats: new Map(),
    messages: new Map(),
    typing: new Map(),
    current: null,
    msgUnsub: null,
    started: false,
  };

  // ---------- утилиты ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const initials = (name) => (String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('') || '?').toUpperCase();
  const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  function avatarHTML(entity, cls = '', online = false) {
    const [c1, c2] = (entity && entity.colors) || COLORS[0];
    return `<div class="avatar ${cls} ${online ? 'online' : ''}" style="--c1:${c1};--c2:${c2}">${esc(initials(entity && (entity.title || entity.name)))}<i class="dot"></i></div>`;
  }
  function setAvatar(el, entity, online) {
    const [c1, c2] = (entity && entity.colors) || COLORS[0];
    el.style.setProperty('--c1', c1);
    el.style.setProperty('--c2', c2);
    el.classList.toggle('online', !!online);
    el.innerHTML = `${esc(initials(entity && (entity.title || entity.name)))}<i class="dot"></i>`;
  }

  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
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
  function fmtSeen(ts) {
    if (!ts) return 'не в сети';
    const diff = Date.now() - ts;
    if (diff < 60e3) return 'был(а) только что';
    if (diff < 3600e3) return `был(а) ${Math.floor(diff / 60e3)} мин назад`;
    if (sameDay(ts, Date.now())) return `был(а) в ${fmtTime(ts)}`;
    return `был(а) ${fmtListTime(ts).toLowerCase()}`;
  }

  let toastTimer;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  window.addEventListener('xitter-error', (e) => toast(e.detail));

  // ---------- тема ----------
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    $$('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === (t || 'auto')));
    layoutSeg($('#themeSeg'));
    const dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('meta[name=theme-color]').content = dark ? '#110904' : '#FFF7F0';
  }

  function layoutSeg(seg) {
    if (!seg) return;
    const btn = $('button.active', seg);
    const thumb = $('.seg-thumb', seg);
    if (!btn || !thumb) return;
    thumb.style.width = btn.offsetWidth + 'px';
    thumb.style.transform = `translateX(${btn.offsetLeft - 3}px)`;
  }

  // ---------- вход ----------
  let authMode = 'login';
  function initAuth() {
    const form = $('#authForm');
    if (!isApp && /Android/i.test(navigator.userAgent)) $('#apkLink').hidden = false;

    $$('#authSeg button').forEach((b) =>
      b.addEventListener('click', () => {
        authMode = b.dataset.mode;
        $$('#authSeg button').forEach((x) => x.classList.toggle('active', x === b));
        layoutSeg($('#authSeg'));
        $('#fieldName').hidden = authMode !== 'register';
        $('#authSubmit span').textContent = authMode === 'register' ? 'Создать аккаунт' : 'Войти';
        form.password.autocomplete = authMode === 'register' ? 'new-password' : 'current-password';
        $('#authError').textContent = '';
        haptic(5);
      })
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#authError').textContent = '';
      const btn = $('#authSubmit');
      btn.classList.add('loading');
      btn.disabled = true;
      try {
        const creds = { username: form.username.value, password: form.password.value, name: form.name.value };
        S.me = authMode === 'register' ? await B.register(creds) : await B.login(creds);
        form.password.value = '';
        enterMain();
      } catch (err) {
        $('#authError').textContent = err.message;
        form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }], { duration: 380, easing: 'ease-out' });
        haptic([10, 40, 10]);
      } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
      }
    });
    requestAnimationFrame(() => layoutSeg($('#authSeg')));
  }

  function showAuth() {
    $('#main').hidden = true;
    $('#auth').hidden = false;
    requestAnimationFrame(() => layoutSeg($('#authSeg')));
  }

  async function logout() {
    if (S.msgUnsub) S.msgUnsub();
    S.msgUnsub = null;
    S.started = false;
    try { await B.logout(); } catch {}
    S.me = null;
    S.chats.clear();
    S.messages.clear();
    document.body.classList.remove('in-chat');
    showAuth();
  }

  // ---------- основной экран ----------
  function enterMain() {
    if (S.started) return;
    S.started = true;
    $('#auth').hidden = true;
    const main = $('#main');
    main.hidden = false;
    main.animate([{ opacity: 0, transform: 'scale(1.04)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    renderMe();
    let first = true;
    B.start({
      onChats: (chats) => onChats(chats, first) || (first = false),
      onMe: (u) => { S.me = u; renderMe(); },
      onSignal: (d) => Call.onSignal(d),
    });
    requestAnimationFrame(() => applyTheme(store.get('theme')));
  }

  // новые данные чатов из Firestore
  function onChats(chats, first) {
    const prev = S.chats;
    S.chats = new Map(chats.map((c) => [c.id, c]));
    S.typing = new Map(chats.filter((c) => c.typing).map((c) => [c.id, c.typing]));
    for (const c of chats) {
      const old = prev.get(c.id);
      const lm = c.lastMessage;
      const isNew = !first && lm && lm.from !== S.me.id && (!old || !old.lastMessage || old.lastMessage.ts !== lm.ts);
      if (isNew && (S.current !== c.id || document.visibilityState !== 'visible')) { haptic([12, 60, 12]); blip(); }
      if (S.current === c.id && c.unread && document.visibilityState === 'visible') B.markRead(c.id);
    }
    renderChats(first);
    if (S.current && S.chats.has(S.current)) { renderChatHeader(); renderMessages(false); }
    // «печатает…» гаснет само
    if (S.typing.size) setTimeout(() => { renderChats(false); if (S.current) { renderChatHeader(); renderMessages(false); } }, 4100);
  }

  function sortedChats() {
    return [...S.chats.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function otherMember(chat) {
    return chat.members.find((m) => m && m.id !== S.me.id) || chat.members[0];
  }

  function isTyping(chatId) {
    const t = S.typing.get(chatId);
    return t && t.until > Date.now() ? t : null;
  }

  const CHECK = '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 6.5"/></svg>';
  const CHECK2 = '<svg viewBox="0 0 28 24"><path d="M2 12.5l5 5L18 6.5"/><path d="M12 16l1.5 1.5L24.5 6.5"/></svg>';

  function isReadByOthers(chat, msg) {
    if (!chat) return false;
    return Object.entries(chat.lastRead || {}).some(([uid, ts]) => uid !== S.me.id && ts >= msg.ts);
  }

  function renderChats(animate) {
    const list = $('#chatList');
    const q = $('#chatSearch').value.trim().toLowerCase();
    const chats = sortedChats().filter((c) => !q || c.title.toLowerCase().includes(q));
    list.classList.toggle('settled', !animate);
    list.innerHTML = chats
      .map((c, i) => {
        const other = c.type === 'dm' ? otherMember(c) : null;
        const typing = isTyping(c.id);
        const last = c.lastMessage;
        let preview = last ? esc(last.text) : '<i>Нет сообщений</i>';
        if (last && c.type === 'group') {
          const who = last.from === S.me.id ? 'Вы' : (c.members.find((m) => m && m.id === last.from) || {}).name;
          preview = `<b>${esc(who || '')}:</b> ${preview}`;
        } else if (last && last.from === S.me.id) preview = 'Вы: ' + preview;
        if (typing) preview = `<span class="typing">${c.type === 'group' ? esc(typing.name) + ' печатает…' : 'печатает…'}</span>`;
        const mine = last && last.from === S.me.id;
        return `<li class="row ${c.unread ? 'unread' : ''} ${S.current === c.id ? 'current' : ''}" data-id="${c.id}" style="--i:${i}">
          ${avatarHTML(c, '', other && other.online)}
          <div class="row-main">
            <div class="row-top"><b>${esc(c.title)}</b>${mine ? (isReadByOthers(c, last) ? `<span class="check">${CHECK2}</span>` : `<span class="check">${CHECK}</span>`) : ''}<time>${last ? fmtListTime(last.ts) : ''}</time></div>
            <div class="row-bottom"><p>${preview}</p>${c.unread ? `<span class="pill">${c.unread}</span>` : ''}</div>
          </div>
        </li>`;
      })
      .join('');
    $('#chatsEmpty').hidden = S.chats.size > 0;
    const total = [...S.chats.values()].reduce((n, c) => n + (c.unread || 0), 0);
    for (const el of [$('#tabBadge'), $('#backBadge')]) {
      el.hidden = !total;
      el.textContent = total > 99 ? '99+' : total;
    }
  }

  $('#chatList').addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (row) openChat(row.dataset.id);
  });
  $('#chatSearch').addEventListener('input', () => renderChats(false));

  // ---------- вкладки ----------
  const TABS = ['chats', 'people', 'settings'];
  function switchTab(name) {
    const idx = TABS.indexOf(name);
    $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $('.tab-thumb').style.transform = `translateX(${idx * 100}%)`;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    if (name === 'people') loadPeople();
    if (name === 'settings') { renderMe(); requestAnimationFrame(() => layoutSeg($('#themeSeg'))); }
    haptic(5);
  }
  $$('#tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // большой заголовок сворачивается при прокрутке
  $$('[data-large-title]').forEach((sc) => {
    const nav = sc.parentElement.querySelector('.navbar');
    const title = $('.large-title', sc);
    sc.addEventListener('scroll', () => {
      const y = sc.scrollTop;
      nav.classList.toggle('collapsed', y > 34);
      $('.navbar-glass', nav).classList.toggle('on', y > 2);
      const k = y < 0 ? 1 + Math.min(-y / 600, 0.12) : 1;
      title.style.transform = `scale(${k})`;
      title.style.opacity = String(Math.max(0, 1 - y / 40));
    }, { passive: true });
  });

  // ---------- люди ----------
  let peopleTimer;
  async function loadPeople() {
    try {
      const users = await B.searchUsers($('#peopleSearch').value);
      $('#peopleList').innerHTML = users.map((u, i) => userRow(u, i)).join('');
      $('#peopleEmpty').hidden = users.length > 0;
    } catch (e) {
      toast(e.message);
    }
  }
  function userRow(u, i, picked) {
    return `<li class="row ${picked ? 'picked' : ''}" data-uid="${u.id}" style="--i:${i}">
      ${avatarHTML(u, '', u.online)}
      <div class="row-main">
        <div class="row-top"><b>${esc(u.name)}</b></div>
        <div class="row-bottom"><p>@${esc(u.username)}${u.bio ? ' · ' + esc(u.bio) : ''}</p></div>
      </div>
      <span class="pick" ${sheetMode === 'group' ? '' : 'hidden'}><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
    </li>`;
  }
  $('#peopleSearch').addEventListener('input', () => { clearTimeout(peopleTimer); peopleTimer = setTimeout(loadPeople, 200); });
  $('#peopleList').addEventListener('click', async (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    try {
      const chat = await B.openDM(row.dataset.uid);
      S.chats.set(chat.id, chat);
      switchTab('chats');
      renderChats(false);
      openChat(chat.id);
    } catch (err) { toast(err.message); }
  });

  // ---------- настройки ----------
  let pickedColors = null;
  function renderMe() {
    if (!S.me) return;
    setAvatar($('#meAvatar'), S.me);
    $('#meName').textContent = S.me.name;
    $('#meUsername').textContent = '@' + S.me.username;
    $('#setName').value = S.me.name;
    $('#setBio').value = S.me.bio || '';
    $('#serverInfo').textContent = B.projectId + (B.emulator ? ' (эмулятор)' : '');
    $('#connInfo').textContent = navigator.onLine ? 'в сети' : 'нет интернета';
    pickedColors = S.me.colors;
    $('#swatches').innerHTML = COLORS.map((c, i) =>
      `<button data-i="${i}" style="--c1:${c[0]};--c2:${c[1]}" class="${c[0] === (S.me.colors || [])[0] && c[1] === (S.me.colors || [])[1] ? 'active' : ''}"></button>`
    ).join('');
  }
  $('#swatches').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pickedColors = COLORS[+b.dataset.i];
    $$('#swatches button').forEach((x) => x.classList.toggle('active', x === b));
    setAvatar($('#meAvatar'), { ...S.me, colors: pickedColors });
    haptic(5);
  });
  $('#saveProfile').addEventListener('click', async () => {
    try {
      S.me = await B.updateMe({ name: $('#setName').value, bio: $('#setBio').value, colors: pickedColors });
      renderMe();
      toast('Профиль сохранён');
      haptic(10);
    } catch (e) { toast(e.message); }
  });
  $$('#themeSeg button').forEach((b) => b.addEventListener('click', () => {
    store.set('theme', b.dataset.theme === 'auto' ? null : b.dataset.theme);
    applyTheme(store.get('theme'));
  }));
  $('#logoutBtn').addEventListener('click', () => logout());

  // ---------- переписка ----------
  function openChat(id) {
    const chat = S.chats.get(id);
    if (!chat) return;
    if (S.msgUnsub && S.current !== id) { S.msgUnsub(); S.msgUnsub = null; }
    S.current = id;
    document.body.classList.add('in-chat');
    $('#chatPage').setAttribute('aria-hidden', 'false');
    $$('#chatList .row').forEach((r) => r.classList.toggle('current', r.dataset.id === id));
    renderChatHeader();
    renderMessages(true);
    haptic(6);
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
    document.body.classList.remove('in-chat');
    $('#chatPage').setAttribute('aria-hidden', 'true');
    $('#msgInput').blur();
    if (S.msgUnsub) { S.msgUnsub(); S.msgUnsub = null; }
    S.current = null;
    $$('#chatList .row.current').forEach((r) => r.classList.remove('current'));
  }
  $('#backBtn').addEventListener('click', closeChat);

  function markRead(id) {
    const chat = S.chats.get(id);
    if (!chat) return;
    if (chat.unread) {
      chat.unread = 0;
      renderChats(false);
    }
    B.markRead(id);
  }

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
      st.textContent = `${chat.members.length} участн. · ${on} в сети`;
      st.classList.remove('live');
    } else st.textContent = other && other.online ? 'в сети' : fmtSeen(other && other.lastSeen);
    $('#callBtns').hidden = chat.type !== 'dm';
  }

  let animateIds = new Set();
  function renderMessages(jump) {
    const box = $('#messages');
    const chat = S.chats.get(S.current);
    const msgs = S.messages.get(S.current);
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (!msgs) { box.innerHTML = ''; return; }
    if (!msgs.length) {
      box.innerHTML = `<div class="chat-empty">${avatarHTML(chat, 'xl')}<h3>${esc(chat.title)}</h3><p>Напишите что-нибудь — первое сообщение всегда самое важное.</p></div>`;
      return;
    }
    let html = '';
    const isGroup = chat.type === 'group';
    let lastMine = -1;
    msgs.forEach((m, i) => { if (m.from === S.me.id) lastMine = i; });
    const emojiOnly = (t) => /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s){1,12}$/u.test(t) && !/^[\d#*\s]+$/.test(t);
    msgs.forEach((m, i) => {
      const prev = msgs[i - 1], next = msgs[i + 1];
      // как в iMessage: метка времени, если новый день или пауза больше часа
      if (!prev || !sameDay(prev.ts, m.ts) || m.ts - prev.ts > 3600e3) html += `<div class="day"><b>${fmtDay(m.ts)}</b> ${fmtTime(m.ts)}</div>`;
      const mine = m.from === S.me.id;
      const gapNext = next && (next.from !== m.from || !sameDay(next.ts, m.ts) || next.ts - m.ts > 3600e3);
      const tail = !next || gapNext || next.ts - m.ts > 60e3;
      const first = !prev || prev.from !== m.from || !sameDay(prev.ts, m.ts) || m.ts - prev.ts > 3600e3;
      const sender = isGroup && !mine && first ? (chat.members.find((x) => x && x.id === m.from) || {}).name : null;
      html += `<div class="msg ${mine ? 'me' : 'them'} ${tail ? 'tail' : ''} ${animateIds.has(m.id) ? 'new' : ''} ${m.pending ? 'pending' : ''}" data-id="${m.id}" title="${fmtTime(m.ts)}">
        ${sender ? `<div class="sender">${esc(sender)}</div>` : ''}
        <div class="bubble ${emojiOnly(m.text) ? 'emoji-only' : ''}">${esc(m.text)}</div>
      </div>`;
      if (i === lastMine && i === msgs.length - 1) {
        const read = !m.pending && isReadByOthers(chat, m);
        const readTs = read ? Math.max(...Object.entries(chat.lastRead || {}).filter(([u]) => u !== S.me.id).map(([, t]) => t)) : 0;
        html += `<div class="receipt">${m.pending ? 'Отправка…' : read ? `<b>Прочитано</b> ${fmtTime(readTs)}` : 'Доставлено'}</div>`;
      }
    });
    const typing = isTyping(chat.id);
    if (typing) html += `<div class="typing-row msg them"><div class="bubble"><i></i><i></i><i></i></div></div>`;
    box.innerHTML = html;
    animateIds.clear();
    if (jump || nearBottom) box.scrollTop = box.scrollHeight;
  }

  // поле ввода
  const input = $('#msgInput');
  let lastTypingSent = 0;
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 132) + 'px';
    $('#composer').classList.toggle('has-text', input.value.trim().length > 0);
    if (Date.now() - lastTypingSent > 2500 && input.value) {
      lastTypingSent = Date.now();
      B.typing(S.current);
    }
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
    input.style.height = 'auto';
    $('#composer').classList.remove('has-text');
    input.focus();
  });

  function sendText(chatId, text) {
    if (S.current === chatId) {
      // анимация для только что отправленного: id появится в снимке Firestore как «новый»
      const box = $('#messages');
      box.scrollTop = box.scrollHeight;
    }
    B.send(chatId, text);
    haptic(8);
  }

  // ---------- свайп «назад» от левого края ----------
  (() => {
    const page = $('#chatPage'), under = $('#tabsPage'), dim = $('#tabsPage .dim');
    let sx = 0, sy = 0, dx = 0, t0 = 0, active = false, decided = false;
    page.addEventListener('touchstart', (e) => {
      if (innerWidth >= 900 || !document.body.classList.contains('in-chat')) return;
      const t = e.touches[0];
      if (t.clientX > 28) return;
      sx = t.clientX; sy = t.clientY; dx = 0; t0 = performance.now(); active = true; decided = false;
    }, { passive: true });
    page.addEventListener('touchmove', (e) => {
      if (!active) return;
      const t = e.touches[0];
      dx = Math.max(0, t.clientX - sx);
      if (!decided) {
        if (Math.abs(t.clientY - sy) > 12 && Math.abs(t.clientY - sy) > dx) { active = false; return; }
        if (dx > 6) { decided = true; page.classList.add('dragging'); under.classList.add('dragging'); }
        else return;
      }
      const w = innerWidth, p = dx / w;
      page.style.transform = `translateX(${dx}px)`;
      under.style.transform = `translateX(${-28 * (1 - p)}%)`;
      dim.style.opacity = String(1 - p);
    }, { passive: true });
    const end = () => {
      if (!active) return;
      active = false;
      if (!decided) return;
      const v = dx / Math.max(1, performance.now() - t0);
      page.classList.remove('dragging'); under.classList.remove('dragging');
      page.style.transform = under.style.transform = dim.style.opacity = '';
      if (dx > innerWidth * 0.35 || v > 0.5) closeChat();
    };
    page.addEventListener('touchend', end);
    page.addEventListener('touchcancel', end);
  })();

  // ---------- шторка «новый чат» ----------
  let sheetMode = 'dm';
  const picked = new Set();
  let sheetUsers = [];
  function openSheet() {
    sheetMode = 'dm';
    picked.clear();
    $('#sheetTitle').textContent = 'Новый чат';
    $('#sheetDone').hidden = true;
    $('#groupNameField').hidden = true;
    $('#newGroupBtn').hidden = false;
    $('#sheetSearch').value = '';
    $('#groupName').value = '';
    document.body.classList.add('sheet-open');
    $('#sheet').setAttribute('aria-hidden', 'false');
    loadSheetUsers();
    haptic(6);
  }
  function closeSheet() {
    document.body.classList.remove('sheet-open');
    $('#sheet').setAttribute('aria-hidden', 'true');
    $('#sheetSearch').blur();
  }
  async function loadSheetUsers() {
    try {
      const users = await B.searchUsers($('#sheetSearch').value);
      sheetUsers = users;
      $('#sheetList').innerHTML = users.length
        ? users.map((u, i) => userRow(u, i, picked.has(u.id))).join('')
        : '<div class="empty"><h3>Никого нет</h3><p>Друзья появятся здесь, когда зарегистрируются на вашем сервере.</p></div>';
    } catch (e) { toast(e.message); }
  }
  let sheetTimer;
  $('#sheetSearch').addEventListener('input', () => { clearTimeout(sheetTimer); sheetTimer = setTimeout(loadSheetUsers, 200); });
  $('#composeBtn').addEventListener('click', openSheet);
  $('#emptyCompose').addEventListener('click', openSheet);
  $('#editBtn').addEventListener('click', () => switchTab('settings'));
  $('#sheetCancel').addEventListener('click', closeSheet);
  $('#sheetBackdrop').addEventListener('click', closeSheet);
  $('#newGroupBtn').addEventListener('click', () => {
    sheetMode = 'group';
    $('#sheetTitle').textContent = 'Новая группа';
    $('#sheetDone').hidden = false;
    $('#groupNameField').hidden = false;
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
    try {
      const chat = await B.openDM(uid);
      S.chats.set(chat.id, chat);
      renderChats(false);
      closeSheet();
      setTimeout(() => openChat(chat.id), 180);
    } catch (err) { toast(err.message); }
  });
  $('#sheetDone').addEventListener('click', async () => {
    const name = $('#groupName').value.trim();
    if (!name) { toast('Введите название группы'); return; }
    if (!picked.size) { toast('Выберите участников'); return; }
    try {
      const chat = await B.createGroup(name, [...picked]);
      S.chats.set(chat.id, chat);
      renderChats(false);
      closeSheet();
      setTimeout(() => openChat(chat.id), 180);
    } catch (err) { toast(err.message); }
  });
  // смахивание шторки вниз
  (() => {
    const sheet = $('#sheet');
    let sy = 0, dy = 0, t0 = 0, on = false;
    $('.sheet-grabber', sheet).parentElement.addEventListener('touchstart', (e) => {
      if (e.target.closest('.sheet-body') && $('.sheet-body').scrollTop > 0) return;
      if (e.target.closest('input,button')) return;
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
      if (dy > 140 || dy / (performance.now() - t0) > 0.6) closeSheet();
    });
  })();

  const wsSend = (d) => B.signal(d);
  addEventListener('online', renderMe);
  addEventListener('offline', renderMe);

  // короткий звук входящего сообщения
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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.current) markRead(S.current);
  });

  // ---------- звонки (WebRTC) ----------
  const Call = (() => {
    const el = $('#call');
    const remoteV = $('#remoteVideo'), localV = $('#localVideo');
    const ICE = {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        // TURN-сервер нужен, если звонок не соединяется через мобильный интернет. Свой можно указать в localStorage['xitter.turn'] = JSON
        ...(JSON.parse(store.get('turn') || 'null') ? [JSON.parse(store.get('turn'))] : []),
      ],
    };
    let c = null; // текущий звонок
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
        if (video) {
          // нет камеры — пробуем только звук
          try { return await navigator.mediaDevices.getUserMedia({ audio: true }); } catch {}
        }
        throw new Error('Нет доступа к микрофону' + (video ? ' или камере' : ''));
      }
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
      c = { id: Math.random().toString(36).slice(2), peer, chatId: chat.id, video, outgoing: true, ice: [] };
      show(peer, video, false);
      setState(video ? 'Xitter Видео…' : 'Xitter Аудио…');
      startRing(false);
      try {
        const local = await getMedia(video);
        if (!c) { local.getTracks().forEach((t) => t.stop()); return; }
        c.local = local;
        localV.srcObject = c.local;
        c.pc = makePC();
        c.local.getTracks().forEach((t) => c.pc.addTrack(t, c.local));
        const offer = await c.pc.createOffer();
        await c.pc.setLocalDescription(offer);
        wsSend({ type: 'call:offer', to: peer.id, callId: c.id, chatId: chat.id, video, sdp: c.pc.localDescription });
        c.timeout = setTimeout(() => end('Нет ответа', 'Пропущенный звонок'), 45000);
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
        c.local = await getMedia(c.video);
        localV.srcObject = c.local;
        c.pc = makePC();
        c.local.getTracks().forEach((t) => c.pc.addTrack(t, c.local));
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
        let text = logText;
        if (!text) {
          if (c.startedAt) {
            const s = Math.floor((Date.now() - c.startedAt) / 1000);
            text = `${c.video ? '🎥 Видеозвонок' : '📞 Аудиозвонок'} · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
          } else text = 'Отменённый звонок';
        } else text = (c.video ? '🎥 ' : '📞 ') + text;
        sendText(c.chatId, text);
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
          if (c && c.id === d.callId) end('Звонок отклонён', 'Звонок отклонён');
          break;
        case 'call:busy':
          if (c && c.id === d.callId) end('Абонент занят', 'Абонент занят');
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
      const btn = e.currentTarget;
      const muted = btn.classList.toggle('on');
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
    if (document.body.classList.contains('sheet-open')) { closeSheet(); return true; }
    if (document.body.classList.contains('in-chat')) { closeChat(); return true; }
    if (!$('#tab-chats').classList.contains('active') && !$('#main').hidden) { switchTab('chats'); return true; }
    return false;
  };

  // ---------- старт ----------
  addEventListener('resize', () => { layoutSeg($('#authSeg')); layoutSeg($('#themeSeg')); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(store.get('theme')));

  initAuth();
  applyTheme(store.get('theme'));
  B.onAuth((user) => {
    if (user) { S.me = user; enterMain(); }
    else if (!S.started) showAuth();
  });

  if ('serviceWorker' in navigator && !isApp && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
