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
    measurementId: 'G-XD60M6NEX4',
  };

  const {
    initializeApp, getAnalytics, analyticsSupported,
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, connectAuthEmulator,
    GoogleAuthProvider, OAuthProvider, signInWithPopup,
    initializeFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, deleteField,
    collection, query, where, orderBy, limit, limitToLast, onSnapshot, increment, writeBatch, runTransaction,
    arrayUnion, arrayRemove, serverTimestamp,
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
  } else if (/^https?:$/.test(location.protocol)) {
    analyticsSupported().then((ok) => ok && getAnalytics(app)).catch(() => {});
  }

  const LEGACY_DOMAIN = 'xitter.app'; // старые аккаунты: username@xitter.app
  const ONLINE_WINDOW = 75e3;
  const COLORS = [
    ['#FF9A3C', '#FF5F1F'], ['#FFB86B', '#FF7A59'], ['#FF8A65', '#F4511E'], ['#FFC371', '#FF5F6D'],
    ['#F7971E', '#FFD200'], ['#FF7E5F', '#FEB47B'], ['#FDA085', '#F6D365'], ['#FF6A00', '#EE0979'],
  ];
  const randomColors = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  let me = null; // uid
  const users = new Map(); // uid -> данные профиля
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
  function publicUser(uid) {
    const u = users.get(uid);
    if (!u) return { id: uid, username: '', name: '…', bio: '', colors: COLORS[0], online: false, lastSeen: null, following: [] };
    return {
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
    const cred = await signInWithPopup(auth, p);
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
    await updateDoc(doc(db, 'users', me), data);
    users.set(me, { ...users.get(me), ...data });
    return publicUser(me);
  });

  const searchUsers = wrap(async (q) => {
    q = String(q || '').trim().toLowerCase().replace(/^@/, '');
    const snap = await getDocs(collection(db, 'users'));
    const out = [];
    snap.forEach((d) => {
      const u = d.data();
      users.set(d.id, u);
      if (d.id === me || !u.username) return;
      if (!q || u.username.includes(q) || (u.name || '').toLowerCase().includes(q)) out.push(publicUser(d.id));
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
  const createPost = wrap(async ({ text, image }) => {
    text = String(text || '').trim().slice(0, 2000);
    if (!text && !image) throw new Error('Пост пустой');
    const data = { author: me, text, createdAt: Date.now(), likes: [], commentCount: 0 };
    if (image) data.image = image;
    await addDoc(collection(db, 'posts'), data);
  });

  const deletePost = wrap(async (id) => { await deleteDoc(doc(db, 'posts', id)); });

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
        break;
      case 'call:busy':
        updateDoc(ref, { status: 'busy' }).catch(fail);
        break;
      case 'call:end':
        updateDoc(ref, { status: 'ended', endedBy: me }).catch(fail);
        unwatchCall(d.callId);
        break;
    }
  }

  window.XBackend = {
    projectId: firebaseConfig.projectId,
    emulator: !!emu,
    signInOrUp, signInWith, createProfile, onAuth, start, logout, updateMe, searchUsers, getUser, user: publicUser,
    follow, markActivityRead,
    createPost, deletePost, toggleLike, subscribeComments, addComment,
    openDM, createGroup, subscribeMessages, send, markRead, typing, signal,
    get uid() { return me; },
  };
})();
