// Replaces the claude.ai runtime (`claude.use('db')` / `claude.use('sample')`)
// with calls to the local Express server. The dashboard code is unchanged.
(function () {
  const listeners = { coll: new Map(), doc: new Map() };
  const state = { systems: {}, tasks: {}, days: {}, coach: {} };

  async function api(path, opts) {
    const r = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    if (!r.ok) { const e = new Error('http ' + r.status); e.code = 'http_' + r.status; throw e; }
    return r.status === 204 ? null : r.json();
  }

  const snapColl = (coll) => ({ docs: Object.entries(state[coll] || {}).map(([id, data]) => ({ id, data: () => data })) });
  const snapDoc = (coll, id) => { const d = (state[coll] || {})[id]; return { exists: !!d, data: () => d }; };

  function notify() {
    for (const [coll, fns] of listeners.coll) for (const fn of fns) fn(snapColl(coll));
    for (const [path, fns] of listeners.doc) { const [coll, id] = path.split('/'); for (const fn of fns) fn(snapDoc(coll, id)); }
  }
  async function reload() {
    const s = await api('/state');
    for (const k of Object.keys(state)) state[k] = s[k] || {};
    notify();
  }

  const db = {
    collection(name) {
      return {
        onSnapshot(cb, onErr) {
          if (!listeners.coll.has(name)) listeners.coll.set(name, new Set());
          listeners.coll.get(name).add(cb);
          Promise.resolve().then(() => cb(snapColl(name)));
          return () => listeners.coll.get(name).delete(cb);
        },
      };
    },
    doc(path) {
      const [coll, id] = path.split('/');
      return {
        async get() {
          const d = await api(`/doc/${coll}/${id}`);
          if (d) state[coll][id] = d; else delete state[coll][id];
          return snapDoc(coll, id);
        },
        async set(data) {
          await api(`/doc/${coll}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
          state[coll][id] = data; notify();
        },
        async delete() {
          await api(`/doc/${coll}/${id}`, { method: 'DELETE' });
          delete state[coll][id]; notify();
        },
        onSnapshot(cb, onErr) {
          if (!listeners.doc.has(path)) listeners.doc.set(path, new Set());
          listeners.doc.get(path).add(cb);
          Promise.resolve().then(() => cb(snapDoc(coll, id)));
          return () => listeners.doc.get(path).delete(cb);
        },
      };
    },
  };

  // sample(promptOrTurns, { signal, onText }) -> { text }
  async function sample(input, opts = {}) {
    const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
    let text = '';
    let res;
    try {
      res = await fetch('/api/sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages }), signal: opts.signal });
    } catch (e) {
      if (e.name === 'AbortError') { const err = new Error('cancelled'); err.code = 'cancelled'; err.text = text; throw err; }
      throw Object.assign(e, { code: 'network' });
    }
    if (!res.ok) {
      const err = new Error('http ' + res.status);
      err.code = res.status === 429 ? 'rate_limited' : res.status === 503 ? 'sampling_disabled' : 'http_' + res.status;
      throw err;
    }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.text) { text += ev.text; opts.onText && opts.onText({ text }); }
          if (ev.error) { const err = new Error(ev.error); err.code = ev.code || 'error'; err.text = text; throw err; }
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') { const err = new Error('cancelled'); err.code = 'cancelled'; err.text = text; throw err; }
      throw e;
    }
    return { text };
  }

  let ready = null;
  function boot() {
    if (ready) return ready;
    ready = reload().then(() => {
      // live updates from other tabs/devices
      const es = new EventSource('/api/events');
      es.onmessage = () => reload().catch(() => {});
    });
    return ready;
  }

  window.claude = {
    async use(name) {
      if (name === 'db') { await boot(); return db; }
      if (name === 'sample') { const s = await api('/sample/status'); return s.enabled ? sample : null; }
      return null;
    },
  };
})();
