/* Xitter — работа с Firebase (вход, Firestore, сигналинг звонков). */
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
    initializeFirestore, connectFirestoreEmulator, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteField,
    collection, query, where, orderBy, limitToLast, onSnapshot, increment, writeBatch,
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

  const EMAIL_DOMAIN = 'xitter.app';
  const ONLINE_WINDOW = 75e3;
  const COLORS = [
    ['#FF9A3C', '#FF5F1F'], ['#FFB86B', '#FF7A59'], ['#FF8A65', '#F4511E'], ['#FFC371', '#FF5F6D'],
    ['#F7971E', '#FFD200'], ['#FF7E5F', '#FEB47B'], ['#FDA085', '#F6D365'], ['#FF6A00', '#EE0979'],
  ];
  const randomColors = () => COLORS[Math.floor(Math.random() * COLORS.length)];

  let me = null; // uid
  const users = new Map(); // uid -> сырые данные профиля
  const userUnsubs = new Map();
  const rawChats = new Map();
  let chatsCb = null, meCb = null, signalCb = null;
  let unsubs = [];
  let heartbeat = null;

  // ---------- ошибки ----------
  function humanError(e) {
    const code = (e && e.code) || '';
    const map = {
      'auth/email-already-in-use': 'Такое имя пользователя уже занято',
      'auth/invalid-credential': 'Неверное имя пользователя или пароль',
      'auth/wrong-password': 'Неверное имя пользователя или пароль',
      'auth/user-not-found': 'Неверное имя пользователя или пароль',
      'auth/weak-password': 'Пароль должен быть не короче 6 символов',
      'auth/too-many-requests': 'Слишком много попыток, подождите немного',
      'auth/network-request-failed': 'Нет интернета',
      'auth/operation-not-allowed': 'В Firebase не включён вход по паролю (Authentication → Sign-in method → Email/Password)',
      'permission-denied': 'База отклонила запрос: проверьте правила Firestore (см. README)',
      'unavailable': 'Нет связи с Firebase',
      'not-found': 'База Firestore не создана (см. README)',
    };
    return new Error(map[code] || (e && e.message) || 'Ошибка');
  }
  const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw humanError(e); } };

  // ---------- профили ----------
  function publicUser(uid) {
    const u = users.get(uid);
    if (!u) return { id: uid, username: '', name: '…', bio: '', colors: COLORS[0], online: false, lastSeen: null };
    return {
      id: uid,
      username: u.username,
      name: u.name || u.username,
      bio: u.bio || '',
      colors: u.colors || COLORS[0],
      online: !!u.online && Date.now() - (u.lastSeen || 0) < ONLINE_WINDOW,
      lastSeen: u.lastSeen || null,
    };
  }

  let emitQueued = false;
  function emitChats() {
    if (emitQueued) return;
    emitQueued = true;
    queueMicrotask(() => {
      emitQueued = false;
      if (chatsCb) chatsCb([...rawChats.values()].map(chatView));
    });
  }

  function watchUser(uid) {
    if (userUnsubs.has(uid)) return;
    userUnsubs.set(uid, onSnapshot(doc(db, 'users', uid), (s) => {
      if (!s.exists()) return;
      users.set(uid, s.data());
      if (uid === me && meCb) meCb(publicUser(me));
      emitChats();
    }, (e) => console.warn('Xitter:', e.code || e)));
  }

  // ---------- вход ----------
  const register = wrap(async ({ username, name, password }) => {
    username = String(username || '').trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_.]{3,24}$/.test(username)) throw new Error('Имя пользователя: 3–24 символа, латиница, цифры, _ и .');
    if (String(password).length < 6) throw new Error('Пароль должен быть не короче 6 символов');
    const cred = await createUserWithEmailAndPassword(auth, `${username}@${EMAIL_DOMAIN}`, password);
    const data = {
      username,
      name: String(name || '').trim().slice(0, 64) || username,
      bio: '',
      colors: randomColors(),
      online: true,
      lastSeen: Date.now(),
      createdAt: Date.now(),
    };
    await setDoc(doc(db, 'users', cred.user.uid), data);
    users.set(cred.user.uid, data);
    return publicUser(cred.user.uid);
  });

  const login = wrap(async ({ username, password }) => {
    username = String(username || '').trim().toLowerCase().replace(/^@/, '');
    const cred = await signInWithEmailAndPassword(auth, `${username}@${EMAIL_DOMAIN}`, password);
    const ref = doc(db, 'users', cred.user.uid);
    const s = await getDoc(ref);
    if (!s.exists()) {
      await setDoc(ref, { username, name: username, bio: '', colors: randomColors(), online: true, lastSeen: Date.now(), createdAt: Date.now() });
    }
    users.set(cred.user.uid, (await getDoc(ref)).data());
    return publicUser(cred.user.uid);
  });

  // Вызывает cb(user | null) при входе/выходе (сессия сохраняется между запусками)
  function onAuth(cb) {
    return onAuthStateChanged(auth, async (u) => {
      if (!u) { me = null; cb(null); return; }
      me = u.uid;
      try {
        const s = await getDoc(doc(db, 'users', me));
        if (s.exists()) users.set(me, s.data());
      } catch {}
      cb(users.has(me) ? publicUser(me) : null);
    });
  }

  function setPresence(online) {
    if (!me) return;
    updateDoc(doc(db, 'users', me), { online, lastSeen: Date.now() }).catch(() => {});
  }

  // Запускает подписки после входа
  function start({ onChats, onMe, onSignal }) {
    chatsCb = onChats; meCb = onMe; signalCb = onSignal;
    watchUser(me);
    unsubs.push(onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', me)), (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type === 'removed') rawChats.delete(ch.doc.id);
        else rawChats.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
        if (ch.type !== 'removed') ch.doc.data().members.forEach(watchUser);
      });
      emitChats();
    }, (e) => window.dispatchEvent(new CustomEvent('xitter-error', { detail: humanError(e).message }))));
    listenIncomingCalls();
    setPresence(true);
    heartbeat = setInterval(() => { if (document.visibilityState === 'visible') setPresence(true); emitChats(); }, 30e3);
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
    await updateDoc(doc(db, 'users', me), data);
    users.set(me, { ...users.get(me), ...data });
    return publicUser(me);
  });

  const searchUsers = wrap(async (q) => {
    q = String(q || '').trim().toLowerCase().replace(/^@/, '');
    const snap = await getDocs(collection(db, 'users'));
    const out = [];
    snap.forEach((d) => {
      if (d.id === me) return;
      const u = d.data();
      users.set(d.id, u);
      if (!q || (u.username || '').includes(q) || (u.name || '').toLowerCase().includes(q)) out.push(publicUser(d.id));
    });
    return out.sort((a, b) => b.online - a.online || a.name.localeCompare(b.name)).slice(0, 50);
  });

  // ---------- чаты ----------
  function chatView(c) {
    const members = c.members.map(publicUser);
    let title = c.name, colors = c.colors || COLORS[0];
    if (c.type === 'dm') {
      const other = members.find((m) => m.id !== me) || members[0];
      title = other.name;
      colors = other.colors;
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
      (e) => window.dispatchEvent(new CustomEvent('xitter-error', { detail: humanError(e).message }))
    );
  }

  function send(chatId, text) {
    text = String(text || '').trim().slice(0, 4000);
    const c = rawChats.get(chatId);
    if (!text || !c) return;
    const ts = Date.now();
    const b = writeBatch(db);
    b.set(doc(collection(db, 'chats', chatId, 'messages')), { from: me, text, ts });
    const upd = { lastMessage: { text, from: me, ts }, updatedAt: ts, [`lastRead.${me}`]: ts, [`typing.${me}`]: deleteField() };
    c.members.forEach((m) => { if (m !== me) upd[`unread.${m}`] = increment(1); });
    b.update(doc(db, 'chats', chatId), upd);
    b.commit().catch((e) => window.dispatchEvent(new CustomEvent('xitter-error', { detail: humanError(e).message })));
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

  function listenIncomingCalls() {
    unsubs.push(onSnapshot(query(collection(db, 'calls'), where('to', '==', me), where('status', '==', 'ringing')), (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type !== 'added') return;
        const d = ch.doc.data();
        if (Date.now() - (d.createdAt || 0) > 45e3) return;
        watchCall(ch.doc.id, false);
        signalCb && signalCb({ type: 'call:offer', callId: ch.doc.id, chatId: d.chatId, video: d.video, sdp: d.offer, from: d.from, fromName: d.fromName, fromColors: d.fromColors });
      });
    }, (e) => console.warn('Xitter:', e.code || e)));
  }

  function watchCall(callId, outgoing) {
    if (callWatch.has(callId)) return;
    let answered = false;
    const list = [];
    list.push(onSnapshot(doc(db, 'calls', callId), (s) => {
      const d = s.data();
      if (!d || !signalCb) return;
      if (outgoing && d.answer && !answered) { answered = true; signalCb({ type: 'call:answer', callId, sdp: d.answer }); }
      if (outgoing && d.status === 'declined') { signalCb({ type: 'call:decline', callId }); unwatchCall(callId); }
      if (outgoing && d.status === 'busy') { signalCb({ type: 'call:busy', callId }); unwatchCall(callId); }
      if (d.status === 'ended' && d.endedBy !== me) { signalCb({ type: 'call:end', callId }); unwatchCall(callId); }
    }, (e) => console.warn('Xitter:', e.code || e)));
    list.push(onSnapshot(collection(db, 'calls', callId, 'candidates'), (snap) => {
      snap.docChanges().forEach((ch) => {
        const d = ch.doc.data();
        if (ch.type === 'added' && d.by !== me && signalCb) signalCb({ type: 'call:ice', callId, candidate: d.c });
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
        setDoc(ref, { from: me, to: d.to, chatId: d.chatId, video: !!d.video, offer: plain(d.sdp), status: 'ringing', fromName: meU.name, fromColors: meU.colors, createdAt: Date.now() })
          .then(() => watchCall(d.callId, true))
          .catch((e) => window.dispatchEvent(new CustomEvent('xitter-error', { detail: humanError(e).message })));
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
    register, login, onAuth, start, logout, updateMe, searchUsers,
    openDM, createGroup, subscribeMessages, send, markRead, typing, signal,
    get uid() { return me; },
  };
})();
