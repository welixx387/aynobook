(() => {
  const store = new Map(), listeners = new Set(), blobs = new Map();
  const segs = p => p.split('/');
  const clone = o => JSON.parse(JSON.stringify(o));
  const snapDoc = path => { const d = store.get(path); return { id: segs(path).pop(), exists: d !== undefined, data: () => d === undefined ? undefined : Object.freeze(clone(d)), metadata: { fromCache: false, hasPendingWrites: false } }; };
  const colDocs = cp => { const n = segs(cp).length + 1; const out = []; for (const [p] of store) if (p.startsWith(cp + '/') && segs(p).length === n) out.push(snapDoc(p)); return out.sort((a, b) => a.id.localeCompare(b.id)); };
  const qs = cp => { const docs = colDocs(cp); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }; };
  const notify = path => setTimeout(() => { for (const l of listeners) { if (l.kind === 'doc' && l.path === path) l.cb(snapDoc(path)); if (l.kind === 'col' && path.startsWith(l.path + '/') && segs(path).length === segs(l.path).length + 1) l.cb(qs(l.path)); } }, 5);
  const size = d => JSON.stringify(d).length;
  const docRef = path => ({ id: segs(path).pop(), path,
    get: async () => snapDoc(path),
    set: async d => { if (window.__denyUser && path.startsWith('data/users')) throw { code: 'invalid_argument', message: 'denied' }; if (size(d) > 262144) throw { code: 'invalid_argument', message: 'too big' }; store.set(path, clone(d)); notify(path); },
    update: async d => { if (!store.has(path)) throw { code: 'invalid_argument' }; store.set(path, { ...store.get(path), ...clone(d) }); notify(path); },
    delete: async () => { store.delete(path); notify(path); },
    onSnapshot(cb) { const l = { kind: 'doc', path, cb }; listeners.add(l); setTimeout(() => cb(snapDoc(path)), 5); return () => listeners.delete(l); },
    collection: sub => colRef(path + '/' + sub) });
  const colRef = path => ({ path, doc: id => docRef(path + '/' + (id || Math.random().toString(36).slice(2))), async get() { return qs(path); }, onSnapshot(cb) { const l = { kind: 'col', path, cb }; listeners.add(l); setTimeout(() => cb(qs(path)), 5); return () => listeners.delete(l); } });
  const db = { doc: docRef, collection: colRef };
  const owner = !window.__reader;
  const user = { me: async () => ({ id: 'u_test123', name: 'Шамиль', avatarUrl: '', color: '#888', email: null, isOwner: owner, canEdit: owner }), id: async () => 'u_test123', isOwner: async () => owner, canEdit: async () => owner, can: async () => null };
  const hex = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  const assets = { upload: async (blob, o) => { const id = hex(); blobs.set(id, { blob, type: o?.type || blob.type }); return { id, url: '/_blob/' + id, sizeBytes: blob.size, contentType: o?.type || blob.type }; },
    list: async () => ({ assets: [], usage: { files: blobs.size, bytes: [...blobs.values()].reduce((a, b) => a + b.blob.size, 0), maxFiles: 1000, maxBytes: 1073741824 } }),
    delete: async id => ({ deleted: blobs.delete(id) }) };
  window.__blobB64 = async id => { const b = blobs.get(id); if (!b) return null; const u = new Uint8Array(await b.blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192)); return { b64: btoa(s), type: b.type }; };
  window.__mock = { store, blobs };
  const gid = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  blobs.set(gid, { blob: new Blob([__GUIDE__], { type: 'application/json' }), type: 'application/json' });
  store.set('books/guide', Object.assign(__META__, { content: { kind: 'asset', id: gid } }));
  window.claude = { use: n => Promise.resolve({ db, user, assets }[n] || null) };
})();
