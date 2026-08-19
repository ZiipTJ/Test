/* La scène : les acteurs, leur position neutre, les lignes de repère et la
   sélection au clic.

   Vocabulaire repris de SolidWorks Composer :
   - « acteur » : un corps importé, déplaçable indépendamment ;
   - « position neutre » : la position d'origine, celle de l'assemblage tel
     qu'importé. Un acteur y revient à tout moment ;
   - « ligne de position neutre » : le trait pointillé qui relie l'acteur
     déplacé à sa position neutre — le trait d'éclaté d'une vue technique. */
(function (root) {
  'use strict';
  const { M, V, Q, rayTriangle } = root.M3D;

  const PALETTE = [
    [0.55, 0.62, 0.70], [0.72, 0.60, 0.45], [0.50, 0.66, 0.62], [0.68, 0.55, 0.60],
    [0.58, 0.64, 0.48], [0.62, 0.58, 0.72], [0.75, 0.68, 0.45], [0.48, 0.58, 0.68]
  ];

  function createScene(view) {
    let nextId = 1;
    const scene = {
      actors: [],
      selection: [],
      settings: {
        showEdges: true,
        showNeutralLines: true,
        showNeutralGhosts: false,
        lineStyle: 'coude',            // 'droite' | 'coude'
        lineColor: [0.10, 0.35, 0.60],
        dashLength: 6,                 // en pixels écran
        showGrid: true
      },
      lineBuf: null,
      gridBuf: null,

      /* ---------- Acteurs ---------- */
      addActor(name, mesh) {
        const a = {
          id: nextId++,
          name: name || `Acteur ${nextId}`,
          mesh,
          pos: view.buffer(mesh.position),
          nor: view.buffer(mesh.normal),
          edge: view.buffer(mesh.edges),
          offset: [0, 0, 0],
          quat: Q.id(),
          visible: true,
          color: PALETTE[(nextId - 2) % PALETTE.length].slice(),
          showLine: true                // ligne tracée dès que l'acteur bouge
        };
        scene.actors.push(a);
        return a;
      },
      clear() {
        for (const a of scene.actors) { view.dispose(a.pos); view.dispose(a.nor); view.dispose(a.edge); }
        scene.actors.length = 0;
        scene.selection.length = 0;
        nextId = 1;
      },
      matrix: (a) => M.compose(a.offset, a.quat, a.mesh.center),
      /* Centre de l'acteur : neutre (position d'origine) et courant. */
      neutralCenter: (a) => a.mesh.center,
      currentCenter: (a) => M.apply(scene.matrix(a), a.mesh.center),
      moved: (a) => V.len(a.offset) > 1e-9 || Math.abs(a.quat[3]) < 1 - 1e-12,
      resetActor(a) { a.offset = [0, 0, 0]; a.quat = Q.id(); },

      bbox(onlyVisible) {
        const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        for (const a of scene.actors) {
          if (onlyVisible && !a.visible) continue;
          const m = scene.matrix(a);
          const b = a.mesh.bbox;
          for (let i = 0; i < 8; i++) {
            const p = M.apply(m, [
              i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]);
            for (let k = 0; k < 3; k++) {
              if (p[k] < bb.min[k]) bb.min[k] = p[k];
              if (p[k] > bb.max[k]) bb.max[k] = p[k];
            }
          }
        }
        if (!isFinite(bb.min[0])) return { min: [-50, -50, -50], max: [50, 50, 50] };
        return bb;
      },

      /* ---------- Sélection ---------- */
      isSelected: (a) => scene.selection.indexOf(a.id) >= 0,
      select(a, additive) {
        if (!a) { if (!additive) scene.selection.length = 0; return; }
        const i = scene.selection.indexOf(a.id);
        if (additive) {
          if (i >= 0) scene.selection.splice(i, 1); else scene.selection.push(a.id);
        } else {
          scene.selection.length = 0;
          scene.selection.push(a.id);
        }
      },
      selected: () => scene.actors.filter(a => scene.selection.indexOf(a.id) >= 0),

      /* Acteur visible sous le curseur, par lancer de rayon sur les triangles. */
      pick(px, py) {
        const { o, d } = view.ray(px, py);
        let best = null, bestT = Infinity;
        for (const a of scene.actors) {
          if (!a.visible) continue;
          const inv = M.invert(scene.matrix(a));
          const lo = M.apply(inv, o), ld = M.applyDir(inv, d);
          if (!rayBox(lo, ld, a.mesh.bbox)) continue;
          const t = a.mesh.position;
          for (let i = 0; i < t.length; i += 9) {
            const hit = rayTriangle(lo, ld,
              [t[i], t[i + 1], t[i + 2]], [t[i + 3], t[i + 4], t[i + 5]], [t[i + 6], t[i + 7], t[i + 8]]);
            if (hit !== null && hit < bestT) { bestT = hit; best = a; }
          }
        }
        return best ? { actor: best, point: V.add(o, V.mul(d, bestT)), t: bestT } : null;
      },

      /* ---------- Lignes de position neutre ---------- */
      /* Tracé pointillé : les tirets sont calculés dans l'espace du monde à
         partir d'une longueur exprimée en pixels, pour rester lisibles au zoom. */
      buildLines() {
        const seg = [];
        if (scene.settings.showNeutralLines) {
          for (const a of scene.actors) {
            if (!a.visible || !a.showLine || !scene.moved(a)) continue;
            const from = scene.neutralCenter(a), to = scene.currentCenter(a);
            const pts = scene.settings.lineStyle === 'coude' ? elbow(from, to) : [from, to];
            const dash = Math.max(scene.settings.dashLength * view.pixelSize(to), 1e-6);
            for (let i = 0; i + 1 < pts.length; i++) dashed(seg, pts[i], pts[i + 1], dash);
            marker(seg, from, dash * 0.8);
          }
        }
        if (!scene.lineBuf) scene.lineBuf = view.dynamicBuffer();
        view.update(scene.lineBuf, Float32Array.from(seg));
      },

      /* ---------- Éclatement radial ---------- */
      /* Chaque acteur s'écarte du centre de l'assemblage : la façon la plus
         directe de produire une vue éclatée, à retoucher ensuite acteur par
         acteur. */
      explode(factor, actors) {
        const list = actors && actors.length ? actors : scene.actors;
        const bb = scene.bbox(false);
        const c = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
        for (const a of list) {
          const d = V.sub(a.mesh.center, c);
          const n = V.len(d);
          a.offset = n < 1e-6 ? [0, 0, 0] : V.mul(d, factor);
        }
      },

      /* ---------- Grille de sol ---------- */
      buildGrid() {
        const bb = scene.bbox(false);
        const diag = V.dist(bb.min, bb.max) || 100;
        const step = Math.pow(10, Math.round(Math.log10(diag / 10)));
        const n = 12;
        const z = bb.min[2];
        const cx = Math.round((bb.min[0] + bb.max[0]) / 2 / step) * step;
        const cy = Math.round((bb.min[1] + bb.max[1]) / 2 / step) * step;
        const seg = [];
        for (let i = -n; i <= n; i++) {
          seg.push(cx + i * step, cy - n * step, z, cx + i * step, cy + n * step, z);
          seg.push(cx - n * step, cy + i * step, z, cx + n * step, cy + i * step, z);
        }
        if (!scene.gridBuf) scene.gridBuf = view.dynamicBuffer();
        view.update(scene.gridBuf, Float32Array.from(seg));
        scene.gridStep = step;
      },

      /* ---------- Sauvegarde ---------- */
      toJSON() {
        return {
          format: 'composer-like/1',
          settings: scene.settings,
          camera: { target: view.cam.target, dist: view.cam.dist, yaw: view.cam.yaw, pitch: view.cam.pitch, ortho: view.cam.ortho },
          actors: scene.actors.map(a => ({
            name: a.name, offset: a.offset, quat: a.quat,
            visible: a.visible, color: a.color, showLine: a.showLine
          }))
        };
      },
      /* Les positions sont réappliquées par nom, puis par ordre d'apparition :
         la géométrie, elle, est rechargée depuis le fichier CAO d'origine. */
      applyJSON(data) {
        if (!data || !Array.isArray(data.actors)) throw new Error('Fichier de vue illisible.');
        Object.assign(scene.settings, data.settings || {});
        if (data.camera) Object.assign(view.cam, data.camera);
        const byName = new Map();
        scene.actors.forEach(a => { if (!byName.has(a.name)) byName.set(a.name, []); byName.get(a.name).push(a); });
        let missed = 0;
        data.actors.forEach((s, i) => {
          const pool = byName.get(s.name);
          const a = (pool && pool.length) ? pool.shift() : scene.actors[i];
          if (!a) { missed++; return; }
          a.offset = s.offset || [0, 0, 0];
          a.quat = s.quat || Q.id();
          a.visible = s.visible !== false;
          if (s.color) a.color = s.color;
          a.showLine = s.showLine !== false;
        });
        return missed;
      }
    };
    return scene;
  }

  /* Coude en L : on sort d'abord suivant l'axe dominant du déplacement. */
  function elbow(from, to) {
    const d = V.sub(to, from);
    const k = Math.abs(d[0]) >= Math.abs(d[1]) && Math.abs(d[0]) >= Math.abs(d[2]) ? 0
      : Math.abs(d[1]) >= Math.abs(d[2]) ? 1 : 2;
    const mid = from.slice();
    mid[k] = to[k];
    if (V.dist(mid, from) < 1e-9 || V.dist(mid, to) < 1e-9) return [from, to];
    return [from, mid, to];
  }

  function dashed(out, a, b, dash) {
    const L = V.dist(a, b);
    if (L < 1e-9) return;
    const n = Math.max(1, Math.min(4000, Math.round(L / (dash * 2))));
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = t0 + 0.5 / n;
      const p = V.lerp(a, b, t0), q = V.lerp(a, b, t1);
      out.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    }
  }

  /* Petite croix 3D marquant la position neutre. */
  function marker(out, p, r) {
    for (let k = 0; k < 3; k++) {
      const a = p.slice(), b = p.slice();
      a[k] -= r; b[k] += r;
      out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
  }

  function rayBox(o, d, bb) {
    let t0 = -Infinity, t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-12) {
        if (o[k] < bb.min[k] || o[k] > bb.max[k]) return false;
        continue;
      }
      let a = (bb.min[k] - o[k]) / d[k], b = (bb.max[k] - o[k]) / d[k];
      if (a > b) { const t = a; a = b; b = t; }
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
    return t1 >= 0;
  }

  root.Scene = { createScene, PALETTE };
})(window.SWC = window.SWC || {});
