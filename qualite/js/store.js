/**
 * Couche d'accès aux données.
 *
 * Deux implémentations interchangeables derrière la même API :
 *  - IndexedDbAdapter : base locale du navigateur (par défaut, aucune installation)
 *  - SupabaseAdapter  : base PostgreSQL hébergée (données partagées entre postes)
 *
 * L'application n'appelle jamais un adaptateur directement : elle utilise `db`.
 */

export const COLLECTIONS = [
  'clients', 'fournisseurs', 'articles', 'personnes',
  'reclamations', 'nc', 'ncreception', 'actions',
  'counters', 'settings'
];

const DB_NAME = 'qualiflow';
const DB_VERSION = 1;
const CFG_KEY = 'qualiflow.backend';

/* ------------------------------------------------------------------ */
/* IndexedDB                                                           */
/* ------------------------------------------------------------------ */

class IndexedDbAdapter {
  constructor() { this.kind = 'local'; this.label = 'IndexedDB (navigateur)'; }

  open() {
    if (this._p) return this._p;
    this._p = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const idb = req.result;
        for (const name of COLLECTIONS) {
          if (!idb.objectStoreNames.contains(name)) idb.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._p;
  }

  async _tx(coll, mode, fn) {
    const idb = await this.open();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(coll, mode);
      const req = fn(tx.objectStore(coll));
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve(req ? req.result : undefined);
    });
  }

  list(coll) { return this._tx(coll, 'readonly', s => s.getAll()); }
  get(coll, id) { return this._tx(coll, 'readonly', s => s.get(id)); }
  put(coll, obj) { return this._tx(coll, 'readwrite', s => s.put(obj)).then(() => obj); }
  remove(coll, id) { return this._tx(coll, 'readwrite', s => s.delete(id)); }

  async bulkPut(coll, rows) {
    const idb = await this.open();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(coll, 'readwrite');
      const store = tx.objectStore(coll);
      rows.forEach(r => store.put(r));
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve(rows);
    });
  }

  async clear(coll) { return this._tx(coll, 'readwrite', s => s.clear()); }
}

/* ------------------------------------------------------------------ */
/* Supabase (PostgREST)                                                */
/* ------------------------------------------------------------------ */

class SupabaseAdapter {
  constructor(cfg) {
    this.kind = 'supabase';
    this.url = cfg.url.replace(/\/+$/, '');
    this.key = cfg.key;
    this.label = 'Supabase — ' + this.url.replace(/^https?:\/\//, '');
  }

  get headers() {
    return {
      apikey: this.key,
      Authorization: 'Bearer ' + this.key,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    };
  }

  async _fetch(path, opts = {}) {
    const res = await fetch(`${this.url}/rest/v1/${path}`, { ...opts, headers: this.headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase ${res.status} — ${body.slice(0, 200)}`);
    }
    return res.status === 204 ? null : res.json();
  }

  // Les colonnes métier sont stockées dans un champ JSONB `data`,
  // ce qui garde le schéma SQL stable quand le modèle évolue.
  _in(obj) { const { id, ...rest } = obj; return { id, data: rest }; }
  _out(row) { return row ? { id: row.id, ...(row.data || {}) } : undefined; }

  async list(coll) { return (await this._fetch(`${coll}?select=*`)).map(r => this._out(r)); }
  async get(coll, id) {
    const rows = await this._fetch(`${coll}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    return this._out(rows[0]);
  }
  async put(coll, obj) {
    await this._fetch(coll, { method: 'POST', body: JSON.stringify(this._in(obj)) });
    return obj;
  }
  async bulkPut(coll, rows) {
    if (!rows.length) return rows;
    await this._fetch(coll, { method: 'POST', body: JSON.stringify(rows.map(r => this._in(r))) });
    return rows;
  }
  async remove(coll, id) { await this._fetch(`${coll}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async clear(coll) { await this._fetch(`${coll}?id=neq.__none__`, { method: 'DELETE' }); }
}

/* ------------------------------------------------------------------ */
/* Façade                                                              */
/* ------------------------------------------------------------------ */

function loadBackendConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { return null; }
}

export function saveBackendConfig(cfg) {
  if (cfg) localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(CFG_KEY);
}

export function getBackendConfig() { return loadBackendConfig(); }

function makeAdapter() {
  const cfg = loadBackendConfig();
  if (cfg && cfg.mode === 'supabase' && cfg.url && cfg.key) {
    try { return new SupabaseAdapter(cfg); } catch { /* retombe en local */ }
  }
  return new IndexedDbAdapter();
}

export const db = {
  adapter: makeAdapter(),

  get kind() { return this.adapter.kind; },
  get label() { return this.adapter.label; },

  list(coll) { return this.adapter.list(coll); },
  get(coll, id) { return this.adapter.get(coll, id); },
  remove(coll, id) { return this.adapter.remove(coll, id); },
  bulkPut(coll, rows) { return this.adapter.bulkPut(coll, rows); },
  clear(coll) { return this.adapter.clear(coll); },

  /** Insère ou met à jour, en tenant à jour id / createdAt / updatedAt. */
  async save(coll, obj) {
    const now = new Date().toISOString();
    const row = { ...obj };
    if (!row.id) { row.id = uid(); row.createdAt = row.createdAt || now; }
    row.updatedAt = now;
    await this.adapter.put(coll, row);
    return row;
  },

  /** Numérotation séquentielle par préfixe et par année : REC-2026-0007. */
  async nextRef(prefix) {
    const year = new Date().getFullYear();
    const key = `${prefix}-${year}`;
    const cur = await this.adapter.get('counters', key);
    const n = (cur?.value || 0) + 1;
    await this.adapter.put('counters', { id: key, value: n });
    return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
  },

  async exportAll() {
    const out = { app: 'QualiFlow', version: 1, exportedAt: new Date().toISOString(), data: {} };
    for (const c of COLLECTIONS) out.data[c] = await this.adapter.list(c);
    return out;
  },

  async importAll(payload, { replace = true } = {}) {
    if (!payload?.data) throw new Error('Fichier de sauvegarde invalide.');
    for (const c of COLLECTIONS) {
      const rows = payload.data[c];
      if (!Array.isArray(rows)) continue;
      if (replace) await this.adapter.clear(c);
      await this.adapter.bulkPut(c, rows);
    }
  },

  async isEmpty() {
    const r = await this.adapter.list('reclamations');
    const c = await this.adapter.list('clients');
    return r.length === 0 && c.length === 0;
  }
};

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
