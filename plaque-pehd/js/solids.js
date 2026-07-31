/* Solides d'un assemblage : segmentation, mesure d'épaisseur réelle et
   détection des contacts, dans le repère du panneau.

   Un solide expose la même interface quelle que soit son origine :
     bbox      étendue dans le repère (u, v, h) du panneau
     intervals(u,v)   segments [h0,h1] où il y a de la matière le long de la normale
     thickness(u,v)   longueur totale de matière traversée

   - Solide maillé (STL)  : lancer de rayon sur les triangles.
   - Solide B-Rep (STEP)  : empilement des faces planes perpendiculaires à la
     normale du panneau. Une face dont la normale sortante s'oppose au rayon fait
     entrer dans la matière, une face dont la normale l'accompagne en fait sortir.
     Les faces obliques ou courbes (chanfreins, congés) sont ignorées : sur des
     pièces d'ossature (plats, tubes, platines) l'écart est négligeable, mais un
     solide sans aucune face perpendiculaire est signalé comme non mesurable. */
(function (root) {
  'use strict';
  const G = root.Geom;

  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

  /* ---------- Repère lié au panneau ---------- */
  function frameFor(rawSolid) {
    const pts = solidPoints(rawSolid);
    const N = root.Importers.smallestPrincipalDirection(pts);
    const basis = root.Importers.planeBasis(N);
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    const n = pts.length || 1;
    return { N: basis.N, U: basis.U, V: basis.V, origin: [cx / n, cy / n, cz / n] };
  }

  function solidPoints(raw) {
    const pts = [];
    if (raw.tris) for (const t of raw.tris) for (const v of t.v) pts.push(v);
    if (raw.faces) for (const f of raw.faces) for (const l of f.loops) for (const p of l) pts.push(p);
    return pts;
  }

  const toFrame = (p, fr) => {
    const d = sub(p, fr.origin);
    return [dot(d, fr.U), dot(d, fr.V), dot(d, fr.N)];
  };

  /* ---------- Grille de rangement 2D ---------- */
  function Bucket(bb, targetCells) {
    const w = Math.max(bb.umax - bb.umin, 1e-6), h = Math.max(bb.vmax - bb.vmin, 1e-6);
    const cs = Math.max(Math.sqrt(w * h / Math.max(1, targetCells)), 1e-6);
    this.u0 = bb.umin; this.v0 = bb.vmin; this.cs = cs;
    this.nu = Math.max(1, Math.ceil(w / cs) + 1);
    this.nv = Math.max(1, Math.ceil(h / cs) + 1);
    this.cells = new Array(this.nu * this.nv);
  }
  Bucket.prototype.idx = function (iu, iv) { return iv * this.nu + iu; };
  Bucket.prototype.insert = function (umin, vmin, umax, vmax, item) {
    const i0 = Math.max(0, Math.floor((umin - this.u0) / this.cs));
    const i1 = Math.min(this.nu - 1, Math.floor((umax - this.u0) / this.cs));
    const j0 = Math.max(0, Math.floor((vmin - this.v0) / this.cs));
    const j1 = Math.min(this.nv - 1, Math.floor((vmax - this.v0) / this.cs));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = this.idx(i, j);
        (this.cells[k] || (this.cells[k] = [])).push(item);
      }
  };
  Bucket.prototype.at = function (u, v) {
    const i = Math.floor((u - this.u0) / this.cs), j = Math.floor((v - this.v0) / this.cs);
    if (i < 0 || j < 0 || i >= this.nu || j >= this.nv) return null;
    return this.cells[this.idx(i, j)] || null;
  };

  /* ---------- Assemblage des intersections en segments de matière ---------- */
  /* Un rayon qui passe exactement par une arête partagée est compté une fois par
     triangle voisin : on fusionne les intersections identiques avant tout calcul. */
  function dedupeHits(hits, eps) {
    if (hits.length < 2) return hits;
    hits.sort((a, b) => a.h - b.h || (a.enter === b.enter ? 0 : a.enter ? -1 : 1));
    const out = [hits[0]];
    for (let i = 1; i < hits.length; i++) {
      const p = out[out.length - 1];
      if (hits[i].enter === p.enter && Math.abs(hits[i].h - p.h) <= eps) continue;
      out.push(hits[i]);
    }
    return out;
  }

  function hitsToIntervals(hits) {
    if (hits.length < 2) return [];
    hits.sort((a, b) => a.h - b.h);
    const out = [];
    let depth = 0, start = 0;
    for (const hit of hits) {
      const prev = depth;
      depth += hit.enter ? 1 : -1;
      if (depth < 0) depth = 0;
      if (prev === 0 && depth > 0) start = hit.h;
      else if (prev > 0 && depth === 0 && hit.h > start) out.push([start, hit.h]);
    }
    return out;
  }

  /* ---------- Solide maillé ---------- */
  function prepareMesh(raw, fr) {
    const tris = [];
    for (const t of raw.tris) {
      const a = toFrame(t.v[0], fr), b = toFrame(t.v[1], fr), c = toFrame(t.v[2], fr);
      const n = cross(sub(b, a), sub(c, a));
      if (Math.abs(n[2]) < 1e-12) continue;      // triangle vu par la tranche
      tris.push({ a, b, c, up: n[2] > 0 });
    }
    const bb = bboxOf(raw, fr);
    const bucket = new Bucket(bb, Math.max(64, tris.length / 3));
    for (const t of tris) {
      bucket.insert(
        Math.min(t.a[0], t.b[0], t.c[0]), Math.min(t.a[1], t.b[1], t.c[1]),
        Math.max(t.a[0], t.b[0], t.c[0]), Math.max(t.a[1], t.b[1], t.c[1]), t);
    }
    const eps = Math.max(1e-6, (bb.hmax - bb.hmin) * 1e-5);
    function hitsAt(u, v) {
      const cell = bucket.at(u, v);
      const hits = [];
      if (!cell) return hits;
      for (const t of cell) {
        const d = (t.b[1] - t.c[1]) * (t.a[0] - t.c[0]) + (t.c[0] - t.b[0]) * (t.a[1] - t.c[1]);
        if (Math.abs(d) < 1e-14) continue;
        const l1 = ((t.b[1] - t.c[1]) * (u - t.c[0]) + (t.c[0] - t.b[0]) * (v - t.c[1])) / d;
        const l2 = ((t.c[1] - t.a[1]) * (u - t.c[0]) + (t.a[0] - t.c[0]) * (v - t.c[1])) / d;
        const l3 = 1 - l1 - l2;
        const tolBary = -1e-9;
        if (l1 < tolBary || l2 < tolBary || l3 < tolBary) continue;
        hits.push({ h: l1 * t.a[2] + l2 * t.b[2] + l3 * t.c[2], enter: !t.up });
      }
      return dedupeHits(hits, eps);
    }
    return {
      kind: 'mesh', bbox: bb, measurable: tris.length > 0,
      intervals: (u, v) => hitsToIntervals(hitsAt(u, v)),
      thickness: (u, v) => {
        // Somme des segments de matière : le compteur de profondeur se recale de
        // lui-même, contrairement à une somme signée des intersections.
        let s = 0;
        for (const it of hitsToIntervals(hitsAt(u, v))) s += it[1] - it[0];
        return s;
      }
    };
  }

  /* ---------- Solide B-Rep : faces planes perpendiculaires à la normale ---------- */
  function prepareBrep(raw, fr) {
    const flats = [];
    for (const f of raw.faces) {
      const nf = unit(f.normal);
      const d = dot(nf, fr.N);
      if (Math.abs(d) < 0.999) continue;          // face non perpendiculaire au rayon
      const loops = f.loops.map(l => l.map(p => toFrame(p, fr)));
      if (!loops.length || loops[0].length < 3) continue;
      let h = 0, np = 0;
      for (const l of loops) for (const p of l) { h += p[2]; np++; }
      const rings = loops.map(l => l.map(p => [p[0], p[1]]));
      const region = G.ringsToRegion(rings);
      if (!region) continue;
      flats.push({ h: h / np, enter: d < 0, region });
    }
    const bb = bboxOf(raw, fr);
    const bucket = new Bucket(bb, Math.max(16, flats.length * 2));
    for (const f of flats) {
      const b = G.bbox(f.region.outer);
      bucket.insert(b.xmin, b.ymin, b.xmax, b.ymax, f);
    }
    function hitsAt(u, v) {
      const cell = bucket.at(u, v);
      const hits = [];
      if (!cell) return hits;
      for (const f of cell) if (G.pointInRegion(u, v, f.region)) hits.push({ h: f.h, enter: f.enter });
      return hits;
    }
    return {
      kind: 'brep', bbox: bb, measurable: flats.length >= 2, nFlats: flats.length,
      intervals: (u, v) => hitsToIntervals(hitsAt(u, v)),
      thickness: (u, v) => {
        let s = 0;
        for (const it of hitsToIntervals(hitsAt(u, v))) s += it[1] - it[0];
        return s;
      }
    };
  }

  function bboxOf(raw, fr) {
    const bb = { umin: Infinity, umax: -Infinity, vmin: Infinity, vmax: -Infinity, hmin: Infinity, hmax: -Infinity };
    for (const p of solidPoints(raw)) {
      const q = toFrame(p, fr);
      if (q[0] < bb.umin) bb.umin = q[0]; if (q[0] > bb.umax) bb.umax = q[0];
      if (q[1] < bb.vmin) bb.vmin = q[1]; if (q[1] > bb.vmax) bb.vmax = q[1];
      if (q[2] < bb.hmin) bb.hmin = q[2]; if (q[2] > bb.hmax) bb.hmax = q[2];
    }
    return bb;
  }

  /* Un rayon qui longe exactement une arête ou une paroi verticale peut compter
     une intersection de trop ou de moins. On tire cinq rayons très légèrement
     décalés et on retient la médiane : les artefacts de tangence disparaissent
     sans lisser les variations réelles d'épaisseur. */
  function robustThickness(raw1) {
    const d = Math.max(
      (raw1.bbox.umax - raw1.bbox.umin), (raw1.bbox.vmax - raw1.bbox.vmin)) * 3e-4 + 1e-3;
    const single = raw1.thickness;
    return (u, v) => {
      const s = [single(u, v), single(u + d, v), single(u - d, v), single(u, v + d), single(u, v - d)];
      s.sort((a, b) => a - b);
      return s[2];
    };
  }

  function prepare(raw, fr) {
    const s = raw.tris ? prepareMesh(raw, fr) : prepareBrep(raw, fr);
    s.name = raw.name;
    s.raw = raw;
    s.thicknessRaw = s.thickness;
    s.thickness = robustThickness(s);
    return s;
  }

  /* ---------- Empreinte du panneau (union des surfaces vues de dessus) ----------
     Les sommets sont soudés dans le plan : une paroi verticale de poche fait
     coïncider le bord du fond de poche et le bord de l'ouverture, les deux
     arêtes s'annulent, et il ne reste que le contour extérieur réel et les
     trous débouchants. */
  function footprint(raw, fr, tol) {
    const pts = [], key = new Map();
    tol = tol || 1e-3;
    const idOf = (u, v) => {
      const k = Math.round(u / tol) + '_' + Math.round(v / tol);
      if (key.has(k)) return key.get(k);
      key.set(k, pts.length); pts.push([u, v]);
      return pts.length - 1;
    };
    const edges = new Map();
    const addEdge = (i, j) => {
      if (i === j) return;
      const k = i < j ? i + ',' + j : j + ',' + i;
      edges.set(k, (edges.get(k) || 0) + 1);
    };
    const addRing = (ring2d) => {
      const ids = ring2d.map(p => idOf(p[0], p[1]));
      for (let i = 0; i < ids.length; i++) addEdge(ids[i], ids[(i + 1) % ids.length]);
    };

    if (raw.tris) {
      for (const t of raw.tris) {
        const a = toFrame(t.v[0], fr), b = toFrame(t.v[1], fr), c = toFrame(t.v[2], fr);
        const n = cross(sub(b, a), sub(c, a));
        if (n[2] <= 1e-12) continue;              // ne garde que les faces vues de dessus
        addRing([a, b, c].map(p => [p[0], p[1]]));
      }
    } else {
      for (const f of raw.faces) {
        if (dot(unit(f.normal), fr.N) < 0.7) continue;
        for (const l of f.loops) addRing(l.map(p => { const q = toFrame(p, fr); return [q[0], q[1]]; }));
      }
    }
    const boundary = [];
    for (const [k, c] of edges) if (c === 1) { const [i, j] = k.split(',').map(Number); boundary.push([i, j]); }
    if (!boundary.length) return null;
    const loops = G.chainEdges(boundary, pts);
    if (!loops.length) return null;
    const bb0 = G.bbox(loops[0]);
    const simp = Math.max(0.05, Math.max(bb0.w, bb0.h) * 2e-4);
    return G.ringsToRegion(loops.map(l => G.simplifyRing(l, simp)));
  }

  /* ---------- Champ d'épaisseur échantillonné ---------- */
  function thicknessField(panel, region, nSamples) {
    const bb = G.bbox(region.outer);
    const target = nSamples || 200;
    const cs = Math.max(Math.max(bb.w, bb.h) / target, 0.5);
    const nu = Math.ceil(bb.w / cs) + 1, nv = Math.ceil(bb.h / cs) + 1;
    const val = new Float32Array(nu * nv);
    let tmin = Infinity, tmax = 0, sum = 0, cnt = 0;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const u = bb.xmin + i * cs, v = bb.ymin + j * cs;
        let t = 0;
        if (G.pointInRegion(u, v, region)) t = panel.thickness(u, v);
        val[j * nu + i] = t;
        // Les points au ras du contour donnent des rayons rasants : ils servent au
        // champ mais pas aux extremums affichés.
        if (t > 1e-6 && G.distToBoundary(u, v, region) > cs) {
          if (t < tmin) tmin = t;
          if (t > tmax) tmax = t;
          sum += t; cnt++;
        }
      }
    }
    if (!cnt) { tmin = 0; }
    return makeField({
      u0: bb.xmin, v0: bb.ymin, cs, nu, nv, val,
      min: cnt ? tmin : 0, max: tmax, mean: cnt ? sum / cnt : 0,
      variable: cnt > 0 && (tmax - tmin) > Math.max(0.15, 0.02 * tmax)
    });
  }

  /* Rattache la méthode de lecture à un champ d'épaisseur (utile à la relecture
     d'un projet enregistré, où seules les données brutes sont conservées). */
  function makeField(d) {
    return Object.assign(d, {
      /* Épaisseur en un point : moyenne des cases voisines non nulles, pour ne pas
         hériter d'un zéro situé hors matière juste à côté du bord. */
      at(u, v) {
        const fi = (u - this.u0) / this.cs, fj = (v - this.v0) / this.cs;
        const i0 = Math.max(0, Math.min(this.nu - 1, Math.round(fi)));
        const j0 = Math.max(0, Math.min(this.nv - 1, Math.round(fj)));
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const i = i0 + di, j = j0 + dj;
            if (i < 0 || j < 0 || i >= this.nu || j >= this.nv) continue;
            const t = this.val[j * this.nu + i];
            if (t > 1e-6) { s += t; n++; }
          }
        return n ? s / n : 0;
      }
    });
  }

  /* ---------- Contacts entre le panneau et les autres solides ---------- */
  /* Renvoie pour chaque solide un masque des zones où il touche le panneau,
     avec le côté du contact (dessous = appui, dessus = objet posé). */
  function detectContacts(panel, others, region, opts) {
    opts = opts || {};
    const tol = opts.tol === undefined ? 0.5 : opts.tol;      // jeu accepté (mm)
    const bb = G.bbox(region.outer);
    const cs = Math.max(opts.cellSize || Math.max(bb.w, bb.h) / 220, 0.5);
    const nu = Math.ceil(bb.w / cs) + 1, nv = Math.ceil(bb.h / cs) + 1;

    // Faces inférieure et supérieure du panneau, échantillonnées
    const pBot = new Float32Array(nu * nv), pTop = new Float32Array(nu * nv);
    const inside = new Uint8Array(nu * nv);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const u = bb.xmin + i * cs, v = bb.ymin + j * cs;
      if (!G.pointInRegion(u, v, region)) continue;
      const iv = panel.intervals(u, v);
      if (!iv.length) continue;
      inside[j * nu + i] = 1;
      pBot[j * nu + i] = iv[0][0];
      pTop[j * nu + i] = iv[iv.length - 1][1];
    }

    const results = [];
    for (const o of others) {
      const mask = new Uint8Array(nu * nv);
      let nBelow = 0, nAbove = 0, cells = 0;
      if (o.bbox.umax < bb.xmin - tol || o.bbox.umin > bb.xmax + tol ||
          o.bbox.vmax < bb.ymin - tol || o.bbox.vmin > bb.ymax + tol) {
        results.push({ solid: o, cells: 0, area: 0, side: null, mask: null, nu, nv, cs, u0: bb.xmin, v0: bb.ymin });
        continue;
      }
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const k = j * nu + i;
        if (!inside[k]) continue;
        const u = bb.xmin + i * cs, v = bb.ymin + j * cs;
        if (u < o.bbox.umin - tol || u > o.bbox.umax + tol || v < o.bbox.vmin - tol || v > o.bbox.vmax + tol) continue;
        const iv = o.intervals(u, v);
        if (!iv.length) continue;
        let touch = 0;
        for (const [h0, h1] of iv) {
          if (Math.abs(h1 - pBot[k]) <= tol || (h0 < pBot[k] - tol && h1 > pBot[k] + tol)) touch |= 1; // dessous
          if (Math.abs(h0 - pTop[k]) <= tol || (h0 < pTop[k] - tol && h1 > pTop[k] + tol)) touch |= 2; // dessus
        }
        if (touch) {
          mask[k] = touch;
          cells++;
          if (touch & 1) nBelow++;
          if (touch & 2) nAbove++;
        }
      }
      results.push({
        solid: o, cells, area: cells * cs * cs,
        side: cells === 0 ? null : (nBelow >= nAbove ? 'dessous' : 'dessus'),
        nBelow, nAbove,
        mask: cells ? mask : null, nu, nv, cs, u0: bb.xmin, v0: bb.ymin
      });
    }
    return results;
  }

  /* Test d'appartenance à un masque de contact (case la plus proche). */
  function maskAt(c, x, y, side) {
    if (!c.mask) return false;
    const i = Math.round((x - c.u0) / c.cs), j = Math.round((y - c.v0) / c.cs);
    if (i < 0 || j < 0 || i >= c.nu || j >= c.nv) return false;
    const m = c.mask[j * c.nu + i];
    if (!m) return false;
    if (side === 'dessous') return !!(m & 1);
    if (side === 'dessus') return !!(m & 2);
    return true;
  }

  /* Contour approché d'un masque, pour le dessin (segments des cases de bord). */
  function maskOutline(c, side) {
    const segs = [];
    if (!c.mask) return segs;
    const bit = side === 'dessus' ? 2 : 1;
    const on = (i, j) => (i >= 0 && j >= 0 && i < c.nu && j < c.nv) && !!(c.mask[j * c.nu + i] & bit);
    for (let j = 0; j < c.nv; j++) for (let i = 0; i < c.nu; i++) {
      if (!on(i, j)) continue;
      const x = c.u0 + (i - 0.5) * c.cs, y = c.v0 + (j - 0.5) * c.cs, s = c.cs;
      if (!on(i - 1, j)) segs.push([x, y, x, y + s]);
      if (!on(i + 1, j)) segs.push([x + s, y, x + s, y + s]);
      if (!on(i, j - 1)) segs.push([x, y, x + s, y]);
      if (!on(i, j + 1)) segs.push([x, y + s, x + s, y + s]);
    }
    return segs;
  }

  /* Indice de « ressemblance à une plaque » : sert à proposer le panneau par défaut. */
  function plateScore(raw) {
    const fr = frameFor(raw);
    const bb = bboxOf(raw, fr);
    const e = bb.hmax - bb.hmin;
    const d = Math.max(bb.umax - bb.umin, bb.vmax - bb.vmin);
    if (e <= 1e-9) return 0;
    const area = (bb.umax - bb.umin) * (bb.vmax - bb.vmin);
    return area * Math.min(d / e / 10, 1);
  }

  root.Solids = {
    dedupeHits, frameFor, prepare, footprint, thicknessField, makeField, detectContacts,
    maskAt, maskOutline, plateScore, bboxOf, toFrame, hitsToIntervals
  };
})(typeof window !== 'undefined' ? (window.PP = window.PP || {}) : (module.exports = {}));
