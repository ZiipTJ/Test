/* Import de géométrie : STL (binaire + ASCII), OBJ, 3MF et STEP.
   Chaque importateur produit la même structure :
     { actors: [{ name, tris: Float32Array (9 flottants par triangle), color? }],
       source, warnings: [] }
   Les longueurs sont ramenées au millimètre. */
(function (root) {
  'use strict';

  /* ================= Utilitaires ================= */
  const dec = (buf, enc) => new TextDecoder(enc || 'utf-8').decode(buf);

  function looksBinarySTL(buf) {
    if (buf.byteLength < 84) return false;
    const head = dec(new Uint8Array(buf, 0, Math.min(512, buf.byteLength))).toLowerCase();
    if (head.trimStart().startsWith('solid') && /facet\s+normal|endsolid/.test(head)) return false;
    const n = new DataView(buf).getUint32(80, true);
    return 84 + n * 50 === buf.byteLength;
  }

  /* ================= STL ================= */
  function parseSTLBinary(buf) {
    const dv = new DataView(buf);
    const n = dv.getUint32(80, true);
    const tris = new Float32Array(n * 9);
    let o = 84;
    for (let i = 0; i < n; i++) {
      o += 12;                                   // normale du fichier : recalculée au maillage
      for (let k = 0; k < 9; k++) { tris[i * 9 + k] = dv.getFloat32(o, true); o += 4; }
      o += 2;                                    // attribute byte count
    }
    return [{ name: 'Corps 1', tris }];
  }

  function parseSTLAscii(text) {
    const groups = [];
    let cur = null;
    const num = /[-+0-9.eE]+/g;
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      if (/^solid\b/i.test(s)) { cur = { name: s.slice(5).trim() || `Corps ${groups.length + 1}`, v: [] }; groups.push(cur); continue; }
      if (/^vertex\b/i.test(s)) {
        if (!cur) { cur = { name: 'Corps 1', v: [] }; groups.push(cur); }
        const m = s.slice(6).match(num);
        if (m && m.length >= 3) cur.v.push(+m[0], +m[1], +m[2]);
      }
    }
    return groups.filter(g => g.v.length >= 9)
      .map((g, i) => ({ name: g.name || `Corps ${i + 1}`, tris: Float32Array.from(g.v) }));
  }

  function importSTL(buf) {
    const actors = looksBinarySTL(buf) ? parseSTLBinary(buf) : parseSTLAscii(dec(new Uint8Array(buf)));
    if (!actors.length || !actors[0].tris.length) throw new Error('Fichier STL vide ou illisible.');
    return { actors, source: 'STL', warnings: [] };
  }

  /* ================= OBJ ================= */
  function importOBJ(text) {
    const verts = [];
    const groups = [];
    let cur = null;
    const push = (name) => { cur = { name: name || `Corps ${groups.length + 1}`, idx: [] }; groups.push(cur); };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line[0] === '#') continue;
      const sp = line.indexOf(' ');
      const key = sp < 0 ? line : line.slice(0, sp);
      const rest = sp < 0 ? '' : line.slice(sp + 1).trim();
      if (key === 'v') {
        const p = rest.split(/\s+/).map(Number);
        verts.push(p[0] || 0, p[1] || 0, p[2] || 0);
      } else if (key === 'o' || key === 'g') {
        push(rest);
      } else if (key === 'f') {
        if (!cur) push(null);
        const ids = rest.split(/\s+/).map(t => {
          let i = parseInt(t.split('/')[0], 10);
          if (i < 0) i = verts.length / 3 + i; else i -= 1;
          return i;
        }).filter(i => i >= 0 && i < verts.length / 3);
        for (let k = 1; k + 1 < ids.length; k++) cur.idx.push(ids[0], ids[k], ids[k + 1]);   // éventail
      }
    }
    const actors = groups.filter(g => g.idx.length).map((g, i) => {
      const tris = new Float32Array(g.idx.length * 3);
      g.idx.forEach((vi, k) => {
        tris[k * 3] = verts[vi * 3];
        tris[k * 3 + 1] = verts[vi * 3 + 1];
        tris[k * 3 + 2] = verts[vi * 3 + 2];
      });
      return { name: g.name || `Corps ${i + 1}`, tris };
    });
    if (!actors.length) throw new Error('Fichier OBJ sans face exploitable.');
    return { actors, source: 'OBJ', warnings: [] };
  }

  /* ================= ZIP (lecture seule, pour le 3MF) ================= */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function')
      throw new Error("Ce navigateur ne sait pas décompresser le 3MF (DecompressionStream absent).");
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readZip(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 66000; i--)
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Archive 3MF invalide (fin de catalogue introuvable).');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = new Map();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec(u8.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = dv.getUint16(lho + 26, true);
      const lExtraLen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lNameLen + lExtraLen;
      files.set(name, { method, data: u8.subarray(start, start + csize) });
      p += 46 + nameLen + extraLen + commLen;
    }
    return {
      names: [...files.keys()],
      async text(name) {
        const f = files.get(name);
        if (!f) return null;
        if (f.method === 0) return dec(f.data);
        if (f.method === 8) return dec(await inflateRaw(f.data));
        throw new Error(`Compression ZIP non gérée (méthode ${f.method}).`);
      }
    };
  }

  /* ================= 3MF ================= */
  const UNIT_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

  function mat3mf(str) {
    const v = String(str).trim().split(/\s+/).map(Number);
    if (v.length < 12 || v.some(x => !isFinite(x))) return null;
    /* 3MF : ligne par ligne, p' = p·R + t */
    return (p) => [
      p[0] * v[0] + p[1] * v[3] + p[2] * v[6] + v[9],
      p[0] * v[1] + p[1] * v[4] + p[2] * v[7] + v[10],
      p[0] * v[2] + p[1] * v[5] + p[2] * v[8] + v[11]];
  }
  const composeT = (a, b) => (a && b) ? (p => a(b(p))) : (a || b || null);

  async function import3MF(buf) {
    const zip = await readZip(buf);
    let path = zip.names.find(n => /^3D\/.*\.model$/i.test(n)) || zip.names.find(n => /\.model$/i.test(n));
    if (!path) throw new Error('Archive 3MF sans fichier modèle (3D/3dmodel.model).');
    const xml = await zip.text(path);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Modèle 3MF illisible (XML invalide).');
    const model = doc.documentElement;
    const scale = UNIT_MM[(model.getAttribute('unit') || 'millimeter').toLowerCase()] || 1;

    const objects = new Map();
    for (const o of doc.getElementsByTagName('object')) objects.set(o.getAttribute('id'), o);

    const warnings = [];
    const meshOf = (obj) => {
      const mesh = obj.getElementsByTagName('mesh')[0];
      if (!mesh) return null;
      const vs = mesh.getElementsByTagName('vertex');
      const V = new Float64Array(vs.length * 3);
      for (let i = 0; i < vs.length; i++) {
        V[i * 3] = +vs[i].getAttribute('x') || 0;
        V[i * 3 + 1] = +vs[i].getAttribute('y') || 0;
        V[i * 3 + 2] = +vs[i].getAttribute('z') || 0;
      }
      const ts = mesh.getElementsByTagName('triangle');
      const out = new Float32Array(ts.length * 9);
      for (let i = 0; i < ts.length; i++) {
        const a = +ts[i].getAttribute('v1'), b = +ts[i].getAttribute('v2'), c = +ts[i].getAttribute('v3');
        [a, b, c].forEach((vi, k) => {
          out[i * 9 + k * 3] = V[vi * 3];
          out[i * 9 + k * 3 + 1] = V[vi * 3 + 1];
          out[i * 9 + k * 3 + 2] = V[vi * 3 + 2];
        });
      }
      return out.length ? out : null;
    };

    const actors = [];
    const emit = (objId, xf, depth, nameHint) => {
      if (depth > 12) { warnings.push('Hiérarchie 3MF trop profonde : une branche a été ignorée.'); return; }
      const obj = objects.get(String(objId));
      if (!obj) return;
      const name = obj.getAttribute('name') || nameHint || `Corps ${actors.length + 1}`;
      const tris = meshOf(obj);
      if (tris) {
        const out = new Float32Array(tris.length);
        for (let i = 0; i < tris.length; i += 3) {
          const p = xf ? xf([tris[i], tris[i + 1], tris[i + 2]]) : [tris[i], tris[i + 1], tris[i + 2]];
          out[i] = p[0] * scale; out[i + 1] = p[1] * scale; out[i + 2] = p[2] * scale;
        }
        actors.push({ name, tris: out });
      }
      for (const c of obj.getElementsByTagName('component')) {
        emit(c.getAttribute('objectid'), composeT(xf, mat3mf(c.getAttribute('transform') || '')), depth + 1, name);
      }
    };

    const items = doc.getElementsByTagName('item');
    if (items.length) {
      for (const it of items) emit(it.getAttribute('objectid'), mat3mf(it.getAttribute('transform') || ''), 0, null);
    } else {
      for (const id of objects.keys()) emit(id, null, 0, null);
    }
    if (!actors.length) throw new Error('Aucun maillage exploitable dans ce 3MF.');
    return { actors, source: '3MF', warnings };
  }

  /* ================= Séparation en corps ================= */
  /* Un STL ou un OBJ livre souvent l'assemblage entier en un seul bloc. On le
     redécoupe en composantes connexes par arête partagée : deux pièces qui ne
     se touchent que par une face ou un sommet restent distinctes. Deux pièces
     collées le long d'une arête commune, elles, resteront confondues — c'est
     une limite du format, que le STEP et le 3MF ne présentent pas. */
  function splitConnected(tris, maxTris) {
    const n = tris.length / 9;
    if (n < 2 || n > (maxTris || 400000)) return null;
    let size = 0;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) {
      if (tris[i + k] < min[k]) min[k] = tris[i + k];
      if (tris[i + k] > max[k]) max[k] = tris[i + k];
    }
    for (let k = 0; k < 3; k++) size = Math.max(size, max[k] - min[k]);
    const q = (size || 1) * 1e-6;
    const vid = new Map();
    const idOf = (o) => {
      const k = `${Math.round(tris[o] / q)},${Math.round(tris[o + 1] / q)},${Math.round(tris[o + 2] / q)}`;
      let i = vid.get(k);
      if (i === undefined) { i = vid.size; vid.set(k, i); }
      return i;
    };
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (x, y) => { const a = find(x), b = find(y); if (a !== b) parent[a] = b; };
    const owner = new Map();
    for (let t = 0; t < n; t++) {
      const v = [idOf(t * 9), idOf(t * 9 + 3), idOf(t * 9 + 6)];
      for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3];
        const key = a < b ? a * 1e7 + b : b * 1e7 + a;
        const prev = owner.get(key);
        if (prev === undefined) owner.set(key, t); else union(prev, t);
      }
    }
    const groups = new Map();
    for (let t = 0; t < n; t++) {
      const r = find(t);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(t);
    }
    if (groups.size < 2) return null;
    return [...groups.values()]
      .filter(g => g.length >= 4)
      .sort((a, b) => b.length - a.length)
      .map((g) => {
        const out = new Float32Array(g.length * 9);
        g.forEach((t, i) => out.set(tris.subarray(t * 9, t * 9 + 9), i * 9));
        return out;
      });
  }

  function withSplit(res) {
    if (res.actors.length > 1) return res;
    const parts = splitConnected(res.actors[0].tris);
    if (!parts || parts.length < 2) return res;
    const base = res.actors[0].name;
    res.actors = parts.map((tris, i) => ({ name: `${base} — corps ${i + 1}`, tris }));
    res.warnings = (res.warnings || []).concat(
      `Le fichier ne décrivait qu'un bloc : il a été découpé en ${parts.length} corps distincts (composantes connexes).`);
    return res;
  }

  /* ================= Aiguillage ================= */
  async function load(file) {
    const name = (file.name || '').toLowerCase();
    const ext = name.slice(name.lastIndexOf('.') + 1);
    if (ext === 'stl') return withSplit(importSTL(await file.arrayBuffer()));
    if (ext === 'obj') return withSplit(importOBJ(await file.text()));
    if (ext === '3mf') return import3MF(await file.arrayBuffer());
    if (ext === 'step' || ext === 'stp') return root.Step.importSTEP(await file.text());
    throw new Error(`Format « .${ext} » non géré. Formats acceptés : STL, OBJ, 3MF, STEP.`);
  }

  root.Import = { load, importSTL, importOBJ, import3MF, readZip, looksBinarySTL, splitConnected };
})(typeof window !== 'undefined' ? (window.SWC = window.SWC || {}) : (module.exports = {}));
