/* Xitter — работа с Firebase: вход, профили, лента, активность, чаты, сигналинг звонков. */
(() => {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyDnxMa7xjEqgsWq3B4KbsxXBWIuFFm6Lps',
    authDomain: 'xittererere.firebaseapp.com',
    projectId: 'xittererere',
    storageBucket: 'xittererere.firebasestorage.app',
    messagingSenderId: '231494861072',
    appId: '1:231494861072:web:47ae00b55bc5066964a595',
  };

  const {
    initializeApp,
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, connectAuthEmulator, deleteUser,
    GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithCredential, initializeAuth, inMemoryPersistence, browserPopupRedirectResolver,
    initializeFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, deleteField,
    collection, query, where, orderBy, limit, limitToLast, onSnapshot, increment, writeBatch, runTransaction,
    arrayUnion, arrayRemove, serverTimestamp, getCountFromServer, Timestamp,
  } = window.FB;

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

  // Для локальной проверки: localStorage['xitter.emu'] = '127.0.0.1' подключает эмуляторы Firebase
  let emu = null;
  try { emu = localStorage.getItem('xitter.emu'); } catch {}
  if (emu) {
    connectAuthEmulator(auth, `http://${emu}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emu, 8080);
  }
  // Аналитика (Google Analytics) намеренно не подключена: приложению она не нужна

  const LEGACY_DOMAIN = 'xitter.app'; // старые аккаунты: username@xitter.app
  const ONLINE_WINDOW = 75e3;
  const COLORS = [
    ['#FF9A3C', '#FF5F1F'], ['#FFB86B', '#FF7A59'], ['#FF8A65', '#F4511E'], ['#FFC371', '#FF5F6D'],
    ['#F7971E', '#FFD200'], ['#FF7E5F', '#FEB47B'], ['#FDA085', '#F6D365'], ['#FF6A00', '#EE0979'],
  ];
  const randomColors = () => COLORS[Math.floor(Math.random() * COLORS.length)];
  const OWNER_EMAIL = 'cladecarvsna@gmail.com'; // владелец: вход через Google с этим адресом
  const USERNAME_PRICE = 100; // LUNE за дополнительный юзернейм
  const FILE_LIMIT = 20 * 1024 * 1024, PLUS_FILE_LIMIT = 50 * 1024 * 1024;
  const CHUNK = 720000; // байт в одной части файла (в base64 ≈ 960 КБ, меньше лимита документа)

  let me = null; // uid
  const users = new Map(); // uid -> данные профиля
  const statuses = new Map(); // uid -> { lune, plusUntil, verified, banned, restricted, usernames }
  let amAdmin = false;
  const userUnsubs = new Map();
  const rawChats = new Map();
  let cbs = {};
  let unsubs = [];
  let heartbeat = null;
  let clockOffset = 0; // время сервера минус время этого устройства

  // ---------- ошибки ----------
  const emitError = (msg) => window.dispatchEvent(new CustomEvent('xitter-error', { detail: msg }));
  function isDbMissing(e) {
    const m = String((e && e.message) || '');
    return /has not been used|is disabled|does not exist|NOT_FOUND/i.test(m) || (e && e.code === 'not-found' && /database/i.test(m));
  }
  function humanError(e) {
    if (isDbMissing(e)) {
      window.dispatchEvent(new CustomEvent('xitter-db-missing'));
      return new Error('В Firebase не создана база Firestore. Создайте её в консоли Firebase (см. README).');
    }
    const code = (e && e.code) || '';
    const map = {
      'auth/email-already-in-use': 'Этот email уже зарегистрирован, а пароль не подходит',
      'auth/invalid-credential': 'Неверный email или пароль',
      'auth/wrong-password': 'Неверный email или пароль',
      'auth/user-not-found': 'Неверный email или пароль',
      'auth/invalid-email': 'Проверьте email',
      'auth/weak-password': 'Пароль должен быть не короче 6 символов',
      'auth/too-many-requests': 'Слишком много попыток, подождите немного',
      'auth/network-request-failed': 'Нет интернета',
      'auth/popup-closed-by-user': 'Окно входа закрыто',
      'auth/popup-blocked': 'Браузер заблокировал окно входа',
      'auth/operation-not-allowed': 'Этот способ входа не включён в Firebase (Authentication → Sign-in method)',
      'auth/unauthorized-domain': 'Этот адрес не добавлен в Firebase (Authentication → Settings → Authorized domains)',
      'permission-denied': 'База отклонила запрос: опубликуйте правила из firestore.rules',
      'unavailable': 'Нет связи с Firebase',
    };
    return new Error(map[code] || (e && e.message) || 'Ошибка');
  }
  const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw humanError(e); } };
  const onErr = (e) => { console.warn('Xitter:', e.code || e, e.message || ''); const h = humanError(e); if (e.code !== 'cancelled') emitError(h.message); };

  // ---------- профили ----------
  const plusActive = (st) => !!st && (st.plusUntil || 0) > Date.now() + clockOffset;
  function publicUser(uid) {
    const u = users.get(uid);
    const st = statuses.get(uid) || {};
    const plus = plusActive(st);
    const perks = {
      lune: st.lune || 0,
      plus,
      plusUntil: st.plusUntil || 0,
      verified: !!st.verified,
      banned: !!st.banned,
      restricted: !!st.restricted,
      usernames: st.usernames || [],
      statusLoaded: statuses.has(uid),
    };
    if (!u) return { id: uid, username: '', name: '…', bio: '', colors: COLORS[0], online: false, lastSeen: null, following: [], style: {}, ...perks };
    return {
      ...perks,
      style: plus ? u.style || {} : {},
      music: u.music || null,
      id: uid,
      username: u.username || '',
      name: u.name || u.username || 'Без имени',
      bio: u.bio || '',
      colors: u.colors || COLORS[0],
      photo: u.photo || '',
      online: !!u.online && Date.now() - (u.lastSeen || 0) < ONLINE_WINDOW,
      lastSeen: u.lastSeen || null,
      following: u.following || [],
    };
  }

  let emitQueued = false;
  function emitAll() {
    if (emitQueued) return;
    emitQueued = true;
    queueMicrotask(() => {
      emitQueued = false;
      cbs.onChats && cbs.onChats([...rawChats.values()].map(chatView));
      cbs.onUsers && cbs.onUsers();
    });
  }

  function watchUser(uid) {
    if (!uid || userUnsubs.has(uid)) return;
    userUnsubs.set(uid, onSnapshot(doc(db, 'users', uid), (s) => {
      if (!s.exists()) return;
      users.set(uid, s.data());
      const d = s.data();
      if (uid === me && !s.metadata.hasPendingWrites && d.serverSeen && d.lastSeen && d.serverSeen.toMillis) clockOffset = d.serverSeen.toMillis() - d.lastSeen;
      if (uid === me && cbs.onMe) cbs.onMe(publicUser(me));
      emitAll();
    }, (e) => console.warn('Xitter:', e.code || e)));
    userUnsubs.set(uid + ':status', onSnapshot(doc(db, 'status', uid), (s) => {
      statuses.set(uid, s.exists() ? s.data() : {});
      if (uid === me && cbs.onMe) cbs.onMe(publicUser(me));
      emitAll();
    }, (e) => console.warn('Xitter:', e.code || e)));
  }

  // ---------- вход ----------
  const toEmail = (login) => {
    login = String(login || '').trim().toLowerCase();
    return login.includes('@') ? login : `${login.replace(/^@/, '')}@${LEGACY_DOMAIN}`;
  };

  // Один шаг: пробуем войти, а если такого аккаунта нет — регистрируем.
  const signInOrUp = wrap(async (login, password) => {
    const email = toEmail(login);
    if (String(password).length < 6) throw Object.assign(new Error(), { code: 'auth/weak-password' });
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      if (e.code !== 'auth/invalid-credential' && e.code !== 'auth/user-not-found') throw e;
      try {
        await createUserWithEmailAndPassword(auth, email, password);
      } catch (e2) {
        if (e2.code === 'auth/email-already-in-use') throw Object.assign(new Error(), { code: 'auth/wrong-password' });
        throw e2;
      }
    }
    return loadProfile();
  });

  const signInWith = wrap(async (provider) => {
    const p = provider === 'apple' ? new OAuthProvider('apple.com') : new GoogleAuthProvider();
    if (provider === 'apple') { p.addScope('email'); p.addScope('name'); }
    const desktop = provider === 'google' && window.xitterDesktop && window.xitterDesktop.googleSignIn;
    let cred;
    if (desktop) {
      // приложение для ПК: вход проходит в системном браузере, сюда приходит только токен Google
      const idToken = await window.xitterDesktop.googleSignIn().catch((e) => { throw new Error(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); });
      cred = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    } else cred = await signInWithPopup(auth, p);
    const prof = await loadProfile();
    return { ...prof, suggestedName: cred.user.displayName || '' };
  });

  // { needsProfile, user }
  async function loadProfile() {
    me = auth.currentUser && auth.currentUser.uid;
    if (!me) return { needsProfile: true, user: null };
    const s = await getDoc(doc(db, 'users', me));
    if (!s.exists() || !s.data().username) return { needsProfile: true, user: null };
    users.set(me, s.data());
    return { needsProfile: false, user: publicUser(me) };
  }

  const createProfile = wrap(async ({ name, username }) => {
    username = String(username || '').trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_.]{3,24}$/.test(username)) throw new Error('Имя пользователя: 3–24 символа, латиница, цифры, _ и .');
    const data = {
      username,
      name: String(name || '').trim().slice(0, 64) || username,
      bio: '',
      colors: randomColors(),
      following: [],
      online: true,
      lastSeen: Date.now(),
      createdAt: Date.now(),
    };
    await runTransaction(db, async (t) => {
      const uref = doc(db, 'usernames', username);
      const taken = await t.get(uref);
      if (taken.exists() && taken.data().uid !== me) throw new Error('Это имя пользователя уже занято');
      t.set(uref, { uid: me });
      t.set(doc(db, 'users', me), data);
    });
    users.set(me, data);
    return publicUser(me);
  });

  // cb({ user, needsProfile }) или cb(null) если не вошёл
  function onAuth(cb) {
    return onAuthStateChanged(auth, async (u) => {
      if (!u) { me = null; cb(null); return; }
      try {
        cb(await loadProfile());
      } catch (e) {
        humanError(e);
        cb({ needsProfile: false, user: null, error: humanError(e).message });
      }
    });
  }

  function setPresence(online) {
    if (!me || !users.has(me)) return;
    updateDoc(doc(db, 'users', me), { online, lastSeen: Date.now(), serverSeen: serverTimestamp() }).catch(() => {});
  }

  // Запускает подписки после входа
  function start(callbacks) {
    cbs = callbacks;
    watchUser(me);
    setTimeout(sweepExpiredFiles, 15e3);
    unsubs.push(onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', me)), (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type === 'removed') rawChats.delete(ch.doc.id);
        else {
          rawChats.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
          ch.doc.data().members.forEach(watchUser);
        }
      });
      emitAll();
    }, onErr));
    unsubs.push(onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(150)), (snap) => {
      const posts = snap.docs.map((d) => ({ id: d.id, ...d.data(), pending: d.metadata.hasPendingWrites }));
      posts.forEach((p) => watchUser(p.author));
      cbs.onPosts && cbs.onPosts(posts);
    }, onErr));
    unsubs.push(onSnapshot(query(collection(db, 'activity'), where('to', '==', me)), (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
      items.forEach((a) => watchUser(a.from));
      cbs.onActivity && cbs.onActivity(items);
    }, onErr));
    listenIncomingCalls();
    watchAdmin();
    setPresence(true);
    heartbeat = setInterval(() => { if (document.visibilityState === 'visible') setPresence(true); emitAll(); }, 30e3);
  }

  document.addEventListener('visibilitychange', () => setPresence(document.visibilityState === 'visible'));
  addEventListener('pagehide', () => setPresence(false));

  async function logout() {
    setPresence(false);
    stopAll();
    await signOut(auth);
  }

  function stopAll() {
    unsubs.forEach((u) => u());
    unsubs = [];
    userUnsubs.forEach((u) => u());
    userUnsubs.clear();
    users.clear();
    statuses.clear();
    amAdmin = false;
    rawChats.clear();
    for (const w of callWatch.values()) w.forEach((u) => u());
    callWatch.clear();
    clearInterval(heartbeat);
  }

  const updateMe = wrap(async (patch) => {
    const data = {};
    if (typeof patch.name === 'string' && patch.name.trim()) data.name = patch.name.trim().slice(0, 64);
    if (typeof patch.bio === 'string') data.bio = patch.bio.trim().slice(0, 140);
    if (Array.isArray(patch.colors)) data.colors = patch.colors;
    if (typeof patch.photo === 'string' && patch.photo.length < 300000) data.photo = patch.photo;
    if (patch.style && typeof patch.style === 'object') data.style = patch.style;
    if (patch.music !== undefined) data.music = patch.music ? { id: String(patch.music.id), title: String(patch.music.title || '').slice(0, 80), size: +patch.music.size || 0 } : deleteField();
    await updateDoc(doc(db, 'users', me), data);
    users.set(me, { ...users.get(me), ...data, ...(patch.music === null ? { music: null } : {}) });
    return publicUser(me);
  });

  const searchUsers = wrap(async (q) => {
    q = String(q || '').trim().toLowerCase().replace(/^@/, '');
    const [snap, sts] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'status')).catch(() => null)]);
    if (sts) sts.forEach((d) => statuses.set(d.id, d.data()));
    const out = [];
    snap.forEach((d) => {
      const u = d.data();
      users.set(d.id, u);
      if (d.id === me || !u.username) return;
      const extra = (statuses.get(d.id) || {}).usernames || [];
      if (!q || u.username.includes(q) || (u.name || '').toLowerCase().includes(q) || extra.some((n) => n.includes(q))) out.push(publicUser(d.id));
    });
    return out.sort((a, b) => b.online - a.online || a.name.localeCompare(b.name)).slice(0, 60);
  });

  const getUser = wrap(async (uid) => {
    watchUser(uid);
    const s = await getDoc(doc(db, 'users', uid));
    if (s.exists()) users.set(uid, s.data());
    const followers = await getDocs(query(collection(db, 'users'), where('following', 'array-contains', uid)));
    return { ...publicUser(uid), followers: followers.size };
  });

  // ---------- подписки ----------
  const follow = wrap(async (uid, on = true) => {
    await updateDoc(doc(db, 'users', me), { following: on ? arrayUnion(uid) : arrayRemove(uid) });
    const u = users.get(me);
    if (u) u.following = on ? [...new Set([...(u.following || []), uid])] : (u.following || []).filter((x) => x !== uid);
    if (on) addActivity(uid, { type: 'follow' });
  });

  function addActivity(to, data) {
    if (!to || to === me) return;
    addDoc(collection(db, 'activity'), { ...data, to, from: me, createdAt: Date.now(), read: false }).catch(() => {});
  }

  function markActivityRead(ids) {
    if (!ids.length) return;
    const b = writeBatch(db);
    ids.slice(0, 400).forEach((id) => b.update(doc(db, 'activity', id), { read: true }));
    b.commit().catch(() => {});
  }

  // ---------- лента ----------
  const createPost = wrap(async ({ text, image, file }) => {
    text = String(text || '').trim().slice(0, 2000);
    if (!text && !image && !file) throw new Error('Пост пустой');
    const data = { author: me, text, createdAt: Date.now(), likes: [], commentCount: 0 };
    if (image) data.image = image;
    if (file && file.id) data.file = { id: String(file.id), name: String(file.name).slice(0, 120), size: +file.size || 0, type: String(file.type || '').slice(0, 80) };
    await addDoc(collection(db, 'posts'), data);
  });

  // удалить пост может автор или админ; вместе с ним уходят комментарии и прикреплённый файл
  const deletePost = wrap(async (id) => {
    const p = await getDoc(doc(db, 'posts', id));
    const comments = await getDocs(collection(db, 'posts', id, 'comments')).catch(() => null);
    if (comments) await deleteAll(comments.docs.map((d) => d.ref)).catch(() => {});
    await deleteDoc(doc(db, 'posts', id));
    const f = p.exists() && p.data().file;
    if (f && f.id) deleteFile(f.id).catch(() => {});
  });

  function toggleLike(post) {
    const liked = (post.likes || []).includes(me);
    updateDoc(doc(db, 'posts', post.id), { likes: liked ? arrayRemove(me) : arrayUnion(me) }).catch(onErr);
    if (!liked) addActivity(post.author, { type: 'like', postId: post.id, preview: postPreview(post) });
    return !liked;
  }

  const postPreview = (p) => ({ text: (p.text || '').slice(0, 80), hasImage: !!p.image });

  function subscribeComments(postId, cb) {
    return onSnapshot(query(collection(db, 'posts', postId, 'comments'), orderBy('createdAt'), limitToLast(300)), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      list.forEach((c) => watchUser(c.author));
      cb(list);
    }, onErr);
  }

  const addComment = wrap(async (post, text) => {
    text = String(text || '').trim().slice(0, 1000);
    if (!text) return;
    const b = writeBatch(db);
    b.set(doc(collection(db, 'posts', post.id, 'comments')), { author: me, text, createdAt: Date.now() });
    b.update(doc(db, 'posts', post.id), { commentCount: increment(1) });
    await b.commit();
    addActivity(post.author, { type: 'comment', postId: post.id, text: text.slice(0, 120), preview: postPreview(post) });
  });

  // ---------- чаты ----------
  function chatView(c) {
    const members = c.members.map(publicUser);
    let title = c.name, colors = c.colors || COLORS[0], photo = '';
    if (c.type === 'dm') {
      const other = members.find((m) => m.id !== me) || members[0];
      title = other.name;
      colors = other.colors;
      photo = other.photo;
    }
    let typing = null;
    for (const [uid, ts] of Object.entries(c.typing || {})) {
      if (uid !== me && Date.now() - ts < 4000) typing = { userId: uid, name: publicUser(uid).name, until: ts + 4000 };
    }
    return {
      id: c.id,
      type: c.type,
      title,
      colors,
      photo,
      members,
      lastMessage: c.lastMessage || null,
      unread: (c.unread && c.unread[me]) || 0,
      lastRead: c.lastRead || {},
      typing,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt || c.createdAt,
    };
  }

  const openDM = wrap(async (otherId) => {
    const id = [me, otherId].sort().join('_');
    const ref = doc(db, 'chats', id);
    const s = await getDoc(ref);
    if (!s.exists()) {
      const now = Date.now();
      await setDoc(ref, { type: 'dm', members: [me, otherId], createdAt: now, updatedAt: now, lastRead: {}, unread: {} });
    }
    const data = s.exists() ? s.data() : { type: 'dm', members: [me, otherId], createdAt: Date.now() };
    rawChats.set(id, { id, ...data });
    watchUser(otherId);
    return chatView(rawChats.get(id));
  });

  const createGroup = wrap(async (name, ids) => {
    const now = Date.now();
    const data = { type: 'group', name: String(name).trim().slice(0, 64), members: [me, ...new Set(ids.filter((x) => x !== me))], colors: randomColors(), createdAt: now, updatedAt: now, lastRead: {}, unread: {} };
    const ref = await addDoc(collection(db, 'chats'), data);
    rawChats.set(ref.id, { id: ref.id, ...data });
    return chatView(rawChats.get(ref.id));
  });

  function subscribeMessages(chatId, cb) {
    let first = true;
    return onSnapshot(
      query(collection(db, 'chats', chatId, 'messages'), orderBy('ts'), limitToLast(300)),
      { includeMetadataChanges: true },
      (snap) => {
        const fresh = first ? [] : snap.docChanges().filter((c) => c.type === 'added').map((c) => c.doc.id);
        first = false;
        cb(snap.docs.map((d) => ({ id: d.id, chatId, ...d.data(), pending: d.metadata.hasPendingWrites })), fresh);
      },
      onErr
    );
  }

  // extra: необязательные поля, например { kind: 'call' | 'image' | 'voice', ... }
  function send(chatId, text, extra) {
    text = String(text || '').trim().slice(0, 4000);
    const c = rawChats.get(chatId);
    if (!text || !c) return;
    const ts = Date.now();
    const b = writeBatch(db);
    b.set(doc(collection(db, 'chats', chatId, 'messages')), { ...(extra || {}), from: me, text, ts });
    const upd = { lastMessage: { text, from: me, ts }, updatedAt: ts, [`lastRead.${me}`]: ts, [`typing.${me}`]: deleteField() };
    c.members.forEach((m) => { if (m !== me) upd[`unread.${m}`] = increment(1); });
    b.update(doc(db, 'chats', chatId), upd);
    b.commit().catch(onErr);
  }

  function markRead(chatId) {
    const c = rawChats.get(chatId);
    if (!c) return;
    const unread = (c.unread && c.unread[me]) || 0;
    const lastRead = (c.lastRead && c.lastRead[me]) || 0;
    if (!unread && (!c.lastMessage || lastRead >= c.lastMessage.ts)) return;
    updateDoc(doc(db, 'chats', chatId), { [`lastRead.${me}`]: Date.now(), [`unread.${me}`]: 0 }).catch(() => {});
  }

  function typing(chatId) {
    if (!rawChats.has(chatId)) return;
    updateDoc(doc(db, 'chats', chatId), { [`typing.${me}`]: Date.now() }).catch(() => {});
  }

  // ---------- звонки: сигналинг через Firestore ----------
  const callWatch = new Map(); // callId -> [unsub]
  const plain = (o) => (o ? JSON.parse(JSON.stringify(o)) : o);

  // Часы на устройствах могут расходиться на минуты и часы, поэтому возраст звонка
  // считаем по времени сервера. Новые вызовы, пришедшие после подписки, принимаем всегда.
  function listenIncomingCalls() {
    let initial = true;
    unsubs.push(onSnapshot(query(collection(db, 'calls'), where('to', '==', me), where('status', '==', 'ringing')), (snap) => {
      const first = initial;
      initial = false;
      snap.docChanges().forEach((ch) => {
        if (ch.type !== 'added') return;
        const d = ch.doc.data();
        if (first) {
          const at = d.at && d.at.toMillis ? d.at.toMillis() : null;
          const age = at != null ? Date.now() + clockOffset - at : Date.now() - (d.createdAt || 0);
          if (age > 45e3) return;
        }
        watchCall(ch.doc.id, false);
        cbs.onSignal && cbs.onSignal({ type: 'call:offer', callId: ch.doc.id, chatId: d.chatId, video: d.video, sdp: d.offer, from: d.from, fromName: d.fromName, fromColors: d.fromColors });
      });
    }, onErr));
  }

  function watchCall(callId, outgoing) {
    if (callWatch.has(callId)) return;
    let answered = false;
    const list = [];
    const sig = (d) => cbs.onSignal && cbs.onSignal(d);
    list.push(onSnapshot(doc(db, 'calls', callId), (s) => {
      const d = s.data();
      if (!d) return;
      if (outgoing && d.answer && !answered) { answered = true; sig({ type: 'call:answer', callId, sdp: d.answer }); }
      if (outgoing && d.status === 'declined') { sig({ type: 'call:decline', callId }); unwatchCall(callId); }
      if (outgoing && d.status === 'busy') { sig({ type: 'call:busy', callId }); unwatchCall(callId); }
      if (d.status === 'ended' && d.endedBy !== me) { sig({ type: 'call:end', callId }); unwatchCall(callId); }
    }, (e) => console.warn('Xitter:', e.code || e)));
    list.push(onSnapshot(collection(db, 'calls', callId, 'candidates'), (snap) => {
      snap.docChanges().forEach((ch) => {
        const d = ch.doc.data();
        if (ch.type === 'added' && d.by !== me) sig({ type: 'call:ice', callId, candidate: d.c });
      });
    }, (e) => console.warn('Xitter:', e.code || e)));
    callWatch.set(callId, list);
  }

  function unwatchCall(callId) {
    const l = callWatch.get(callId);
    if (l) setTimeout(() => l.forEach((u) => u()), 0);
    callWatch.delete(callId);
  }

  function signal(d) {
    const ref = d.callId && doc(db, 'calls', d.callId);
    const fail = () => {};
    switch (d.type) {
      case 'call:offer': {
        const meU = publicUser(me);
        setDoc(ref, { from: me, to: d.to, chatId: d.chatId, video: !!d.video, offer: plain(d.sdp), status: 'ringing', fromName: meU.name, fromColors: meU.colors, createdAt: Date.now(), at: serverTimestamp() })
          .then(() => watchCall(d.callId, true))
          .catch(onErr);
        break;
      }
      case 'call:answer':
        updateDoc(ref, { answer: plain(d.sdp), status: 'active' }).catch(fail);
        break;
      case 'call:ice':
        addDoc(collection(db, 'calls', d.callId, 'candidates'), { by: me, c: plain(d.candidate) }).catch(fail);
        break;
      case 'call:decline':
        updateDoc(ref, { status: 'declined' }).catch(fail);
        unwatchCall(d.callId);
        wipeCall(d.callId);
        break;
      case 'call:busy':
        updateDoc(ref, { status: 'busy' }).catch(fail);
        wipeCall(d.callId);
        break;
      case 'call:end':
        updateDoc(ref, { status: 'ended', endedBy: me }).catch(fail);
        unwatchCall(d.callId);
        wipeCall(d.callId);
        break;
    }
  }

  // После звонка удаляем его техническую часть: SDP и ICE-кандидаты содержат IP-адреса устройств
  function wipeCall(callId) {
    setTimeout(async () => {
      try {
        const snap = await getDocs(collection(db, 'calls', callId, 'candidates'));
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
        await updateDoc(doc(db, 'calls', callId), { offer: deleteField(), answer: deleteField() });
      } catch {}
    }, 4000);
  }

  // ---------- файлы: части по ~1 МБ в Firestore ----------
  const toB64 = (buf) => {
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const fileLimit = () => (plusActive(statuses.get(me)) ? PLUS_FILE_LIMIT : FILE_LIMIT);
  // Вложения (чаты, посты) живут неделю: поле expireAt удаляет их TTL-политика Firestore.
  // Оформление профиля и картинки NFT загружаются с keep: true и не удаляются.
  const FILE_TTL_DAYS = 7;
  // onProgress(0..1); возвращает { id, name, size, type }
  const uploadFile = wrap(async (file, onProgress, { keep = false } = {}) => {
    if (!file) throw new Error('Нет файла');
    const limitBytes = fileLimit();
    if (file.size > limitBytes) {
      throw new Error(limitBytes === FILE_LIMIT ? 'Файл больше 20 МБ. С Xitter Plus можно до 50 МБ' : 'Файл больше 50 МБ');
    }
    const ref = doc(collection(db, 'files'));
    const parts = Math.max(1, Math.ceil(file.size / CHUNK));
    const meta = { owner: me, name: String(file.name || 'файл').slice(0, 120), size: file.size, type: String(file.type || 'application/octet-stream').slice(0, 80), chunks: parts, createdAt: Date.now() };
    const expireAt = keep ? null : Timestamp.fromMillis(Date.now() + FILE_TTL_DAYS * 864e5);
    if (expireAt) meta.expireAt = expireAt;
    await setDoc(ref, meta);
    let done = 0;
    const one = async (i) => {
      const buf = await file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer();
      await setDoc(doc(db, 'files', ref.id, 'chunks', String(i).padStart(4, '0')), expireAt ? { d: toB64(buf), expireAt } : { d: toB64(buf) });
      done++;
      onProgress && onProgress(done / parts);
    };
    // по три части параллельно
    let next = 0;
    await Promise.all([0, 1, 2].map(async () => { while (next < parts) await one(next++); }));
    return { id: ref.id, name: meta.name, size: meta.size, type: meta.type };
  });

  const fileCache = new Map(); // id -> Promise<{ url, name, type, size }>
  function fileURL(id) {
    if (!fileCache.has(id)) {
      const p = (async () => {
        const m = await getDoc(doc(db, 'files', id));
        if (!m.exists()) throw new Error(`Файл удалён: вложения хранятся ${FILE_TTL_DAYS} дней`);
        const meta = m.data();
        const snap = await getDocs(collection(db, 'files', id, 'chunks'));
        if (snap.size < meta.chunks) throw new Error('Файл ещё загружается');
        const parts = snap.docs.sort((a, b) => a.id.localeCompare(b.id)).map((d) => fromB64(d.data().d));
        const blob = new Blob(parts, { type: meta.type });
        return { url: URL.createObjectURL(blob), name: meta.name, type: meta.type, size: meta.size };
      })();
      p.catch(() => fileCache.delete(id));
      fileCache.set(id, p);
    }
    return fileCache.get(id);
  }

  // base64 -> байты (встроенный Uint8Array.fromBase64, где он есть)
  function fromB64(s) {
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(s);
    const bin = atob(s), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  // ---------- LUNE, Plus и админка ----------
  const isOwner = () => {
    const u = auth.currentUser;
    return !!u && (u.email || '').toLowerCase() === OWNER_EMAIL && u.emailVerified;
  };
  function watchAdmin() {
    unsubs.push(onSnapshot(doc(db, 'admins', me), (s) => {
      amAdmin = s.exists() || isOwner();
      // владелец сам попадает в список админов, чтобы его было видно в счётчике
      if (isOwner() && !s.exists()) setDoc(doc(db, 'admins', me), { since: Date.now(), owner: true }).catch(() => {});
      cbs.onMe && cbs.onMe(publicUser(me));
    }, () => { amAdmin = isOwner(); }));
  }

  const buyUsername = wrap(async (name) => {
    name = String(name || '').trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_.]{3,24}$/.test(name)) throw new Error('Юзернейм: 3–24 символа, латиница, цифры, _ и .');
    await runTransaction(db, async (t) => {
      const sref = doc(db, 'status', me);
      const nref = doc(db, 'usernames', name);
      const [s, n] = await Promise.all([t.get(sref), t.get(nref)]);
      if (n.exists()) throw new Error('Этот юзернейм уже занят');
      const st = s.exists() ? s.data() : {};
      if ((st.lune || 0) < USERNAME_PRICE) throw new Error(`Нужно ${USERNAME_PRICE} LUNE`);
      t.set(nref, { uid: me });
      t.update(sref, { lune: st.lune - USERNAME_PRICE, usernames: [...(st.usernames || []), name] });
    });
  });

  // ---------- перепродажа юзернеймов (без комиссии, как NFT) ----------
  const NICK_MAX_PRICE = 1000000;
  const listUsername = wrap(async (name, price) => {
    price = Math.round(+price || 0);
    if (!(price >= 1 && price <= NICK_MAX_PRICE)) throw new Error('Цена от 1 до 1 000 000 LUNE');
    const st = statuses.get(me) || {};
    if (!(st.usernames || []).includes(name)) throw new Error('Можно продать только купленный юзернейм');
    if ((users.get(me) || {}).username === name) throw new Error('Основной юзернейм продать нельзя');
    await setDoc(doc(db, 'usernameSales', name), { seller: me, price, createdAt: Date.now() });
  });
  const unlistUsername = wrap(async (name) => { await deleteDoc(doc(db, 'usernameSales', name)); });
  const usernameMarket = wrap(async () => {
    const snap = await getDocs(collection(db, 'usernameSales'));
    const list = snap.docs.map((d) => ({ name: d.id, ...d.data() }));
    list.forEach((n) => watchUser(n.seller));
    return list.sort((a, b) => a.price - b.price);
  });
  const buyListedUsername = wrap(async (name) => {
    await runTransaction(db, async (t) => {
      const saleRef = doc(db, 'usernameSales', name), myRef = doc(db, 'status', me);
      const [sale, my] = await Promise.all([t.get(saleRef), t.get(myRef)]);
      if (!sale.exists()) throw new Error('Этот юзернейм уже не продаётся');
      const { seller, price } = sale.data();
      if (seller === me) throw new Error('Это ваш юзернейм');
      if (myLune(my) < price) throw new Error(`Нужно ${price} LUNE`);
      const selRef = doc(db, 'status', seller);
      const sel = await t.get(selRef);
      const mine = (my.exists() && my.data().usernames) || [];
      t.update(myRef, { lune: myLune(my) - price, usernames: [...mine, name], spend: { k: 'nick', id: name } });
      t.update(selRef, { lune: myLune(sel) + price, usernames: ((sel.data() || {}).usernames || []).filter((n) => n !== name), nickSold: name });
      t.update(doc(db, 'usernames', name), { uid: me });
      t.delete(saleRef);
    });
  });

  // ---------- копия публичных файлов в Google Диск владельца ----------
  // Своего сервера нет, поэтому копирует браузер владельца: вход в любой Google-аккаунт с доступом к Диску
  // (только к файлам, которые создал сам Xitter), папка «Xitter», уже скопированные файлы пропускаются.
  const DRIVE = 'https://www.googleapis.com/drive/v3', DRIVE_UP = 'https://www.googleapis.com/upload/drive/v3';
  let drive = null; // { token, until }
  // Диск может быть на любом Google-аккаунте: вход идёт в отдельном экземпляре Firebase Auth
  // только в памяти, поэтому основной вход в Xitter не меняется
  let driveAuth = null;
  async function driveToken() {
    if (drive && drive.until > Date.now()) return drive.token;
    if (!driveAuth) driveAuth = initializeAuth(initializeApp(firebaseConfig, 'drive'), { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
    const p = new GoogleAuthProvider();
    p.addScope('https://www.googleapis.com/auth/drive.file');
    p.setCustomParameters({ prompt: 'select_account' });
    const res = await signInWithPopup(driveAuth, p);
    const cred = GoogleAuthProvider.credentialFromResult(res);
    signOut(driveAuth).catch(() => {});
    if (!cred || !cred.accessToken) throw new Error('Google не дал доступ к Диску');
    drive = { token: cred.accessToken, until: Date.now() + 50 * 60e3, email: res.user.email };
    return drive.token;
  }
  async function driveFetch(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${await driveToken()}`, ...(opts.headers || {}) } });
    if (r.status === 401) drive = null;
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      const msg = (j.error && j.error.message) || `ошибка ${r.status}`;
      throw new Error(/has not been used|is disabled/.test(msg) ? 'В Google Cloud выключен Google Drive API для проекта xittererere: включите его и повторите' : `Google Диск: ${msg}`);
    }
    return r;
  }
  async function driveFolder() {
    const q = encodeURIComponent("name = 'Xitter' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const found = await (await driveFetch(`${DRIVE}/files?q=${q}&fields=files(id)`)).json();
    if (found.files.length) return found.files[0].id;
    const made = await (await driveFetch(`${DRIVE}/files?fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Xitter', mimeType: 'application/vnd.google-apps.folder' }),
    })).json();
    return made.id;
  }
  async function driveDone(folder) {
    const ids = new Set();
    let page = '';
    do {
      const q = encodeURIComponent(`'${folder}' in parents and trashed = false`);
      const r = await (await driveFetch(`${DRIVE}/files?q=${q}&pageSize=1000&fields=nextPageToken,files(appProperties)${page ? `&pageToken=${page}` : ''}`)).json();
      r.files.forEach((f) => f.appProperties && f.appProperties.xid && ids.add(f.appProperties.xid));
      page = r.nextPageToken || '';
    } while (page);
    return ids;
  }
  // только публичные файлы: вложения постов, оформление профилей и музыка, картинки NFT.
  // Вложения личных чатов не копируются и удаляются через 7 дней, как обычно.
  async function publicData() {
    const [ps, us, cs] = await Promise.all([getDocs(collection(db, 'posts')), getDocs(collection(db, 'users')), getDocs(collection(db, 'nftCollections'))]);
    const ids = new Set(), names = new Map();
    const add = (x) => x && x.id && ids.add(x.id);
    ps.forEach((d) => add(d.data().file));
    us.forEach((d) => { const u = d.data(), sty = u.style || {}; names.set(d.id, u); add(sty.banner); add(sty.avatarMedia); add(u.music); });
    cs.forEach((d) => add(d.data().image));
    return { ids, names, posts: ps.docs };
  }
  async function driveUpload(folder, name, type, body, appProperties) {
    const start = await driveFetch(`${DRIVE_UP}/files?uploadType=resumable`, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type },
      body: JSON.stringify({ name, parents: [folder], appProperties }),
    });
    await driveFetch(start.headers.get('Location'), { method: 'PUT', headers: { 'Content-Type': type }, body });
  }
  // картинка поста хранится как data:-ссылка (обычно JPEG) — перегоняем в PNG
  async function toPNG(dataUrl) {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Не удалось сделать PNG'))), 'image/png'));
  }
  const dayOf = (t) => new Date(t || Date.now()).toISOString().slice(0, 10);
  const safeName = (t) => String(t || '').replace(/[\\/:*?"<>|\s]+/g, ' ').trim().slice(0, 40);
  const backupToDrive = wrap(async (onProgress) => {
    if (!isOwner()) throw new Error('Копировать в Диск может только владелец');
    const say = (t) => onProgress && onProgress(t);
    say('Вход в Google…');
    const folder = await driveFolder();
    say('Смотрю, что уже скопировано…');
    const [done, all, pubData] = await Promise.all([driveDone(folder), getDocs(collection(db, 'files')), publicData()]);
    const uname = (uid) => (pubData.names.get(uid) || {}).username || uid;
    // задачи: публичные файлы, текст каждого поста (.txt) и фото из поста (.png)
    const jobs = [];
    all.docs.filter((d) => pubData.ids.has(d.id)).forEach((f) => jobs.push({ xid: f.id, kind: 'file', f }));
    pubData.posts.forEach((p) => {
      jobs.push({ xid: `post:${p.id}`, kind: 'post', p });
      if (p.data().image) jobs.push({ xid: `post-img:${p.id}`, kind: 'img', p });
    });
    const todo = jobs.filter((j) => !done.has(j.xid));
    let copied = 0, skipped = 0;
    for (const j of todo) {
      say(`Копирую ${copied + skipped + 1} из ${todo.length}`);
      if (j.kind === 'file') {
        const m = j.f.data();
        const snap = await getDocs(collection(db, 'files', j.f.id, 'chunks'));
        if (snap.size < m.chunks) { skipped++; continue; } // ещё загружается
        const blob = new Blob(snap.docs.sort((a, b) => a.id.localeCompare(b.id)).map((d) => fromB64(d.data().d)), { type: m.type });
        await driveUpload(folder, `${dayOf(m.createdAt)} @${uname(m.owner)} ${m.name}`, m.type, blob, { xid: j.xid, owner: m.owner });
      } else {
        const d = j.p.data(), u = pubData.names.get(d.author) || {};
        const base = `${dayOf(d.createdAt)} @${uname(d.author)} пост ${safeName(d.text) || j.p.id}`;
        if (j.kind === 'post') {
          const txt = [
            `${u.name || ''} @${uname(d.author)}`.trim(),
            new Date(d.createdAt || 0).toLocaleString('ru-RU'),
            `Лайков: ${(d.likes || []).length} · Комментариев: ${d.commentCount || 0}`,
            ...(d.image ? ['Фото: в файле .png с тем же названием'] : []),
            ...(d.file ? [`Файл: ${d.file.name}`] : []),
            '', d.text || '',
          ].join('\r\n');
          await driveUpload(folder, `${base}.txt`, 'text/plain', new Blob(['\ufeff' + txt], { type: 'text/plain' }), { xid: j.xid, owner: d.author });
        } else {
          await driveUpload(folder, `${base}.png`, 'image/png', await toPNG(d.image), { xid: j.xid, owner: d.author });
        }
      }
      copied++;
    }
    return { copied, skipped, already: jobs.length - todo.length, total: jobs.length, email: drive && drive.email };
  });

  // ---------- оценка приложения: одна на пользователя, повторная отправка заменяет прежнюю ----------
  const sendFeedback = wrap(async (stars, text) => {
    await setDoc(doc(db, 'feedback', me), {
      stars, text: String(text || '').trim().slice(0, 1000), createdAt: Date.now(), build: (window.XITTER_BUILD || {}).run || 0,
    });
  });
  const myFeedback = wrap(async () => {
    const s = await getDoc(doc(db, 'feedback', me));
    return s.exists() ? s.data() : null;
  });
  const adminFeedback = wrap(async () => {
    const s = await getDocs(query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(300)));
    return s.docs.map((d) => ({ uid: d.id, ...d.data() }));
  });

  const adminStats = wrap(async () => {
    const [u, a] = await Promise.all([getCountFromServer(collection(db, 'users')), getCountFromServer(collection(db, 'admins'))]);
    return { users: u.data().count, admins: a.data().count };
  });
  const adminUsers = wrap(async () => {
    const [us, sts, ads] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'status')), getDocs(collection(db, 'admins'))]);
    sts.forEach((d) => statuses.set(d.id, d.data()));
    const adminIds = new Set(ads.docs.map((d) => d.id));
    const out = [];
    us.forEach((d) => { users.set(d.id, d.data()); if (d.data().username) out.push({ ...publicUser(d.id), admin: adminIds.has(d.id), createdAt: d.data().createdAt || 0 }); });
    return out.sort((a, b) => b.createdAt - a.createdAt);
  });
  // patch: { verified, banned, restricted, plusUntil } или { luneDelta }
  const adminUpdate = wrap(async (uid, patch) => {
    const sref = doc(db, 'status', uid);
    await runTransaction(db, async (t) => {
      const s = await t.get(sref);
      const st = s.exists() ? s.data() : {};
      const data = {};
      for (const k of ['verified', 'banned', 'restricted']) if (typeof patch[k] === 'boolean') data[k] = patch[k];
      if (typeof patch.plusUntil === 'number') data.plusUntil = patch.plusUntil;
      if (typeof patch.luneDelta === 'number') data.lune = Math.max(0, Math.round((st.lune || 0) + patch.luneDelta));
      data.updatedBy = me;
      t.set(sref, data, { merge: true });
    });
  });
  const setAdmin = wrap(async (uid, on) => {
    if (on) await setDoc(doc(db, 'admins', uid), { since: Date.now(), by: me });
    else await deleteDoc(doc(db, 'admins', uid));
  });

  // ---------- подарки и NFT ----------
  const GIFTS = { heart: 15, bear: 15, gift: 25, rose: 25, cake: 50, bouquet: 50, rocket: 50, champagne: 50, trophy: 100, ring: 100, diamond: 100 };
  const myLune = (s) => (s.exists() ? s.data().lune || 0 : 0);

  const sendGift = wrap(async (to, type, text, count = 1) => {
    count = Math.round(+count || 1);
    if (count < 1 || count > 999) throw new Error('Количество от 1 до 999');
    const price = GIFTS[type] * count;
    if (!price || !to || to === me) throw new Error('Нельзя отправить этот подарок');
    const gref = doc(collection(db, 'gifts'));
    await runTransaction(db, async (t) => {
      const sref = doc(db, 'status', me);
      const s = await t.get(sref);
      if (myLune(s) < price) throw new Error(`Нужно ${price} LUNE`);
      t.set(gref, { from: me, to, type, count, price, text: String(text || '').trim().slice(0, 120), createdAt: Date.now() });
      t.update(sref, { lune: myLune(s) - price, spend: { k: 'gift', id: gref.id } });
    });
    addActivity(to, { type: 'gift', gift: type, count });
    return gref.id;
  });

  // продажа обычного подарка: 85% цены возвращается получателю
  const giftSellValue = (price) => Math.trunc((price * 85) / 100);
  const sellGift = wrap(async (id) => {
    let value = 0;
    await runTransaction(db, async (t) => {
      const gref = doc(db, 'gifts', id), sref = doc(db, 'status', me);
      const [g, s] = [await t.get(gref), await t.get(sref)];
      if (!g.exists() || g.data().to !== me) throw new Error('Подарок не найден');
      value = giftSellValue(g.data().price);
      t.delete(gref);
      t.set(sref, { lune: myLune(s) + value, sold: id }, { merge: true });
    });
    return value;
  });
  // настройки звонков (TURN)
  const getConfig = wrap(async (key) => { const d = await getDoc(doc(db, 'config', key)); return d.exists() ? d.data() : null; });
  const setConfig = wrap(async (key, data) => { await setDoc(doc(db, 'config', key), data); });

  // ---------- удаление сообщений и данных ----------
  // своё сообщение удаляется у всех; если оно было последним, в списке чатов показываем предыдущее
  const deleteMessage = wrap(async (chatId, msgId) => {
    const c = rawChats.get(chatId);
    const mref = doc(db, 'chats', chatId, 'messages', msgId);
    const m = await getDoc(mref);
    if (!m.exists() || m.data().from !== me) throw new Error('Можно удалить только своё сообщение');
    await deleteDoc(mref);
    if (m.data().file && m.data().file.id) deleteFile(m.data().file.id).catch(() => {});
    if (c && c.lastMessage && c.lastMessage.ts === m.data().ts) {
      const last = await getDocs(query(collection(db, 'chats', chatId, 'messages'), orderBy('ts'), limitToLast(1)));
      const l = last.docs[0] && last.docs[0].data();
      await updateDoc(doc(db, 'chats', chatId), { lastMessage: l ? { text: l.text, from: l.from, ts: l.ts } : deleteField() }).catch(() => {});
    }
  });
  // запасной вариант к TTL-политике: при входе удаляем свои просроченные вложения сами
  async function sweepExpiredFiles() {
    if (!me) return;
    try {
      const snap = await getDocs(query(collection(db, 'files'), where('owner', '==', me)));
      const now = Date.now();
      for (const d of snap.docs) {
        const exp = d.data().expireAt;
        if (exp && exp.toMillis() < now) await deleteFile(d.id).catch(() => {});
      }
    } catch (e) { /* не страшно, попробуем при следующем входе */ }
  }
  async function deleteFile(id) {
    const chunks = await getDocs(collection(db, 'files', id, 'chunks'));
    await deleteAll(chunks.docs.map((d) => d.ref));
    await deleteDoc(doc(db, 'files', id));
  }
  async function deleteAll(refs, onStep) {
    for (let i = 0; i < refs.length; i += 400) {
      const b = writeBatch(db);
      refs.slice(i, i + 400).forEach((r) => b.delete(r));
      await b.commit();
      onStep && onStep();
    }
  }
  const dataOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  // все мои данные в одном JSON (то, что хранится о пользователе)
  const exportMyData = wrap(async () => {
    const [u, st, fb, posts, gotGifts, sentGifts, nfts, actTo, actFrom, files, callsFrom, callsTo] = await Promise.all([
      getDoc(doc(db, 'users', me)), getDoc(doc(db, 'status', me)), getDoc(doc(db, 'feedback', me)).catch(() => null),
      getDocs(query(collection(db, 'posts'), where('author', '==', me))),
      getDocs(query(collection(db, 'gifts'), where('to', '==', me))), getDocs(query(collection(db, 'gifts'), where('from', '==', me))),
      getDocs(query(collection(db, 'nfts'), where('owner', '==', me))),
      getDocs(query(collection(db, 'activity'), where('to', '==', me))), getDocs(query(collection(db, 'activity'), where('from', '==', me))),
      getDocs(query(collection(db, 'files'), where('owner', '==', me))),
      getDocs(query(collection(db, 'calls'), where('from', '==', me))), getDocs(query(collection(db, 'calls'), where('to', '==', me))),
    ]);
    const messages = [];
    for (const c of rawChats.values()) {
      const ms = await getDocs(query(collection(db, 'chats', c.id, 'messages'), where('from', '==', me)));
      ms.docs.forEach((d) => messages.push({ chatId: c.id, id: d.id, ...d.data() }));
    }
    const comments = [];
    const allPosts = await getDocs(collection(db, 'posts'));
    for (const p of allPosts.docs) {
      if (!p.data().commentCount) continue;
      const cs = await getDocs(query(collection(db, 'posts', p.id, 'comments'), where('author', '==', me)));
      cs.docs.forEach((d) => comments.push({ postId: p.id, id: d.id, ...d.data() }));
    }
    const clean = (x) => JSON.parse(JSON.stringify(x, (k, v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v)));
    return clean({
      exportedAt: new Date().toISOString(),
      account: { uid: me, email: (auth.currentUser && auth.currentUser.email) || null },
      profile: u.exists() ? u.data() : null, status: st.exists() ? st.data() : null,
      posts: dataOf(posts), comments, messages,
      chats: [...rawChats.values()].map((c) => ({ id: c.id, type: c.type, title: c.title || null, members: c.members })),
      giftsReceived: dataOf(gotGifts), giftsSent: dataOf(sentGifts), nfts: dataOf(nfts),
      activity: [...dataOf(actTo), ...dataOf(actFrom)],
      files: dataOf(files), calls: [...dataOf(callsFrom), ...dataOf(callsTo)],
      feedback: fb && fb.exists() ? fb.data() : null,
    });
  });

  // удаляет посты, комментарии, лайки, сообщения, файлы, уведомления и звонки; с account = true — ещё и аккаунт
  const deleteMyData = wrap(async ({ account = false, onProgress } = {}) => {
    const step = (t) => onProgress && onProgress(t);
    if (account) {
      const t = auth.currentUser && Date.parse(auth.currentUser.metadata.lastSignInTime || '');
      if (!emu && (!t || Date.now() - t > 4 * 60e3)) {
        throw Object.assign(new Error('Для удаления аккаунта нужен свежий вход: выйдите, войдите снова и сразу повторите'), { code: 'relogin' });
      }
    }
    step('Сообщения');
    for (const c of rawChats.values()) {
      const ms = await getDocs(query(collection(db, 'chats', c.id, 'messages'), where('from', '==', me)));
      await deleteAll(ms.docs.map((d) => d.ref));
      if (c.lastMessage && c.lastMessage.from === me) await updateDoc(doc(db, 'chats', c.id), { lastMessage: deleteField() }).catch(() => {});
    }
    step('Комментарии и лайки');
    const allPosts = await getDocs(collection(db, 'posts'));
    for (const p of allPosts.docs) {
      const d = p.data();
      if (d.author === me) {
        const cs = await getDocs(collection(db, 'posts', p.id, 'comments'));
        await deleteAll(cs.docs.map((x) => x.ref));
        continue;
      }
      if (d.commentCount) {
        const cs = await getDocs(query(collection(db, 'posts', p.id, 'comments'), where('author', '==', me)));
        if (cs.size) {
          await deleteAll(cs.docs.map((x) => x.ref));
          await updateDoc(p.ref, { commentCount: increment(-cs.size) }).catch(() => {});
        }
      }
      if ((d.likes || []).includes(me)) await updateDoc(p.ref, { likes: arrayRemove(me) }).catch(() => {});
    }
    step('Посты');
    await deleteAll(allPosts.docs.filter((p) => p.data().author === me).map((p) => p.ref));
    step('Файлы');
    // файлы профиля (баннер, аватар, музыка) остаются, пока есть аккаунт; картинки коллекций NFT не трогаем
    const keep = new Set([...collections.values()].map((c) => c.image && c.image.id).filter(Boolean));
    if (!account) {
      const u = users.get(me) || {}, sty = u.style || {};
      [sty.banner, sty.avatarMedia, u.music].forEach((x) => x && x.id && keep.add(x.id));
    }
    const files = await getDocs(query(collection(db, 'files'), where('owner', '==', me)));
    for (const f of files.docs) if (!keep.has(f.id)) await deleteFile(f.id).catch(() => {});
    step('Уведомления и звонки');
    const [actTo, actFrom, callsFrom, callsTo] = await Promise.all([
      getDocs(query(collection(db, 'activity'), where('to', '==', me))), getDocs(query(collection(db, 'activity'), where('from', '==', me))),
      getDocs(query(collection(db, 'calls'), where('from', '==', me))), getDocs(query(collection(db, 'calls'), where('to', '==', me))),
    ]);
    await deleteAll([...actTo.docs, ...actFrom.docs].map((d) => d.ref));
    await deleteDoc(doc(db, 'feedback', me)).catch(() => {});
    for (const cl of [...callsFrom.docs, ...callsTo.docs]) {
      const cands = await getDocs(collection(db, 'calls', cl.id, 'candidates'));
      await deleteAll([...cands.docs.map((d) => d.ref), cl.ref]);
    }
    if (!account) return;

    step('Подарки и NFT');
    const [gifts, nfts] = await Promise.all([getDocs(query(collection(db, 'gifts'), where('to', '==', me))), getDocs(query(collection(db, 'nfts'), where('owner', '==', me)))]);
    await deleteAll([...gifts.docs, ...nfts.docs].map((d) => d.ref));
    step('Чаты');
    for (const c of rawChats.values()) {
      await updateDoc(doc(db, 'chats', c.id), { members: arrayRemove(me), [`unread.${me}`]: deleteField(), [`lastRead.${me}`]: deleteField(), [`typing.${me}`]: deleteField() }).catch(() => {});
    }
    step('Профиль');
    const u = users.get(me) || {};
    const st = statuses.get(me) || {};
    const names = [u.username, ...(st.usernames || [])].filter(Boolean);
    const user = auth.currentUser;
    stopAll();
    await deleteAll([...names.map((n) => doc(db, 'usernames', n)), doc(db, 'status', me), doc(db, 'users', me)]);
    step('Аккаунт');
    await deleteUser(user);
  });

  // подарки и NFT пользователя
  const userGifts = wrap(async (uid) => {
    const [g, n] = await Promise.all([
      getDocs(query(collection(db, 'gifts'), where('to', '==', uid))),
      getDocs(query(collection(db, 'nfts'), where('owner', '==', uid))),
    ]);
    const gifts = g.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.hidden).sort((a, b) => b.createdAt - a.createdAt);
    gifts.forEach((x) => watchUser(x.from));
    return { gifts, nfts: n.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.mintedAt - a.mintedAt) };
  });

  const collections = new Map();
  const listCollections = wrap(async () => {
    const snap = await getDocs(collection(db, 'nftCollections'));
    snap.forEach((d) => collections.set(d.id, { id: d.id, ...d.data() }));
    return [...collections.values()].sort((a, b) => b.createdAt - a.createdAt);
  });
  const collection_ = (cid) => collections.get(cid) || null;

  const createCollection = wrap(async (c) => {
    const name = String(c.name || '').trim().slice(0, 40);
    if (!name) throw new Error('Введите название');
    const price = Math.round(+c.price || 0), supply = Math.round(+c.supply || 0);
    if (price < 1) throw new Error('Цена от 1 LUNE');
    if (supply < 1 || supply > 1000000) throw new Error('Тираж от 1 до 1 000 000');
    if (!c.backdrops || !c.backdrops.length) throw new Error('Выберите хотя бы один фон');
    const ref = doc(collection(db, 'nftCollections'));
    const data = { name, emoji: String(c.emoji || '').slice(0, 16), image: c.image || null, fullBleed: !!(c.fullBleed && c.image), description: String(c.description || '').slice(0, 200), price, supply, minted: 0, backdrops: c.backdrops.slice(0, 12), active: true, createdBy: me, createdAt: Date.now() };
    await setDoc(ref, data);
    collections.set(ref.id, { id: ref.id, ...data });
    return ref.id;
  });
  const setCollectionActive = wrap(async (cid, active) => { await updateDoc(doc(db, 'nftCollections', cid), { active: !!active }); });

  const mintNFT = wrap(async (cid) => {
    let nid = null;
    await runTransaction(db, async (t) => {
      const cref = doc(db, 'nftCollections', cid), sref = doc(db, 'status', me);
      const [c, s] = await Promise.all([t.get(cref), t.get(sref)]);
      if (!c.exists()) throw new Error('Коллекция не найдена');
      const col = c.data();
      if (col.active === false) throw new Error('Продажи остановлены');
      if (col.minted >= col.supply) throw new Error('Все экземпляры раскуплены');
      if (myLune(s) < col.price) throw new Error(`Нужно ${col.price} LUNE`);
      const num = col.minted + 1;
      nid = `${cid}_${num}`;
      const backdrop = col.backdrops[Math.floor(Math.random() * col.backdrops.length)];
      t.update(cref, { minted: num });
      t.set(doc(db, 'nfts', nid), { cid, num, owner: me, backdrop, salePrice: 0, mintedAt: Date.now() });
      t.update(sref, { lune: myLune(s) - col.price, spend: { k: 'mint', id: nid } });
    });
    return nid;
  });

  const setSalePrice = wrap(async (nid, price) => {
    price = Math.max(0, Math.round(+price || 0));
    await updateDoc(doc(db, 'nfts', nid), { salePrice: price });
  });
  const transferNFT = wrap(async (nid, to) => {
    if (!to || to === me) throw new Error('Выберите получателя');
    await updateDoc(doc(db, 'nfts', nid), { owner: to, salePrice: 0, prevOwner: me });
    addActivity(to, { type: 'nft', nft: nid });
  });
  const buyNFT = wrap(async (nid) => {
    await runTransaction(db, async (t) => {
      const nref = doc(db, 'nfts', nid), sref = doc(db, 'status', me);
      const [n, s] = await Promise.all([t.get(nref), t.get(sref)]);
      if (!n.exists()) throw new Error('NFT не найден');
      const nft = n.data();
      if (nft.owner === me) throw new Error('Это уже ваш NFT');
      if (!(nft.salePrice > 0)) throw new Error('NFT больше не продаётся');
      if (myLune(s) < nft.salePrice) throw new Error(`Нужно ${nft.salePrice} LUNE`);
      const selRef = doc(db, 'status', nft.owner);
      const sel = await t.get(selRef);
      t.update(nref, { owner: me, salePrice: 0, prevOwner: nft.owner });
      t.update(sref, { lune: myLune(s) - nft.salePrice, spend: { k: 'buy', id: nid } });
      t.set(selRef, { lune: myLune(sel) + nft.salePrice, sale: nid }, { merge: true });
    });
  });
  const market = wrap(async () => {
    const snap = await getDocs(query(collection(db, 'nfts'), where('salePrice', '>', 0)));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.forEach((n) => watchUser(n.owner));
    return list.sort((a, b) => a.salePrice - b.salePrice);
  });
  const findUserByName = wrap(async (name) => {
    name = String(name || '').trim().toLowerCase().replace(/^@/, '');
    const s = await getDoc(doc(db, 'usernames', name));
    if (!s.exists()) throw new Error('Пользователь @' + name + ' не найден');
    watchUser(s.data().uid);
    return s.data().uid;
  });

  window.XBackend = {
    projectId: firebaseConfig.projectId,
    emulator: !!emu,
    signInOrUp, signInWith, createProfile, onAuth, start, logout, updateMe, searchUsers, getUser, user: publicUser,
    follow, markActivityRead,
    createPost, deletePost, toggleLike, subscribeComments, addComment,
    openDM, createGroup, subscribeMessages, send, markRead, typing, signal,
    uploadFile, fileURL, buyUsername, listUsername, unlistUsername, usernameMarket, buyListedUsername,
    deleteMessage, exportMyData, deleteMyData,
    GIFTS, sendGift, sellGift, giftSellValue, getConfig, setConfig, userGifts, listCollections, collection: collection_, createCollection, setCollectionActive,
    mintNFT, setSalePrice, transferNFT, buyNFT, market, findUserByName, adminStats, adminUsers, adminUpdate, setAdmin,
    sendFeedback, myFeedback, adminFeedback, backupToDrive,
    USERNAME_PRICE, FILE_LIMIT, PLUS_FILE_LIMIT, FILE_TTL_DAYS,
    get uid() { return me; },
    get isAdmin() { return amAdmin || isOwner(); },
    get isOwner() { return isOwner(); },
  };
})();
