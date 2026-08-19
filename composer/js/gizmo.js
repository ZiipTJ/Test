/* Manipulateur de déplacement et de rotation.

   Le manipulateur est dessiné en surimpression, à taille constante à l'écran.
   Le pointage se fait dans le plan de l'écran (distance en pixels aux traits du
   manipulateur), ce qui reste fiable quel que soit l'angle de vue ; le calcul du
   déplacement, lui, se fait en 3D sur l'axe ou le plan concerné. */
(function (root) {
  'use strict';
  const { M, V, Q, closestBetweenLines, rayPlane } = root.M3D;

  const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const COLORS = {
    x: [0.85, 0.26, 0.26], y: [0.30, 0.68, 0.32], z: [0.24, 0.48, 0.86],
    hot: [0.98, 0.76, 0.12], free: [0.45, 0.45, 0.50]
  };
  const PX = 92;                       // rayon du manipulateur, en pixels
  const GRAB = 9;                      // tolérance de pointage, en pixels

  function createGizmo(view, scene) {
    const buffers = new Map();
    const gz = {
      mode: 'translate',               // 'translate' | 'rotate'
      hot: null,                       // poignée survolée
      drag: null,
      visible: false,
      pivot: [0, 0, 0],

      scale() { return PX * view.pixelSize(gz.pivot); },

      update() {
        const sel = scene.selected();
        gz.visible = sel.length > 0;
        if (!gz.visible) return;
        /* Pivot : centre des acteurs sélectionnés, dans leur position courante. */
        const acc = [0, 0, 0];
        for (const a of sel) {
          const c = scene.currentCenter(a);
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
        }
        gz.pivot = acc.map(v => v / sel.length);
      },

      /* ---------- Géométrie ---------- */
      handles() {
        const s = gz.scale();
        const out = [];
        if (gz.mode === 'translate') {
          AXES.forEach((ax, i) => {
            const key = 'xyz'[i];
            const tip = V.add(gz.pivot, V.mul(ax, s));
            const pts = [gz.pivot, tip];
            /* Pointe de flèche : deux traits dans un plan de face. */
            const u = V.mul(V.perp(ax), s * 0.06);
            const back = V.add(gz.pivot, V.mul(ax, s * 0.86));
            const seg = [gz.pivot, tip, V.add(back, u), tip, V.sub(back, u), tip];
            out.push({ id: 'T' + key, color: COLORS[key], seg, path: pts });
          });
          AXES.forEach((ax, i) => {
            const a1 = AXES[(i + 1) % 3], a2 = AXES[(i + 2) % 3];
            const o = 0.30 * s, w = 0.22 * s;
            const p = (u, v) => V.add(gz.pivot, V.add(V.mul(a1, o + u * w), V.mul(a2, o + v * w)));
            const c = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
            const seg = [c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]];
            out.push({ id: 'P' + 'xyz'[i], color: COLORS['xyz'[i]], seg, path: c.concat([c[0]]), plane: ax });
          });
        } else {
          AXES.forEach((ax, i) => {
            const key = 'xyz'[i];
            const u = V.perp(ax), w = V.cross(ax, u);
            const path = [];
            for (let k = 0; k <= 72; k++) {
              const t = k / 72 * Math.PI * 2;
              path.push(V.add(gz.pivot, V.add(V.mul(u, s * Math.cos(t)), V.mul(w, s * Math.sin(t)))));
            }
            const seg = [];
            for (let k = 0; k + 1 < path.length; k++) seg.push(path[k], path[k + 1]);
            out.push({ id: 'R' + key, color: COLORS[key], seg, path, axis: ax });
          });
        }
        return out;
      },

      draw() {
        if (!gz.visible) return;
        for (const h of gz.handles()) {
          const flat = [];
          for (const p of h.seg) flat.push(p[0], p[1], p[2]);
          let bo = buffers.get(h.id);
          if (!bo) { bo = view.dynamicBuffer(); buffers.set(h.id, bo); }
          view.update(bo, Float32Array.from(flat));
          const hot = (gz.drag ? gz.drag.id : gz.hot) === h.id;
          view.drawLines(bo, M.identity(), hot ? COLORS.hot : h.color, 1, true);
        }
      },

      /* ---------- Pointage ---------- */
      hitTest(px, py) {
        if (!gz.visible) return null;
        let best = null, bestD = GRAB;
        for (const h of gz.handles()) {
          const scr = h.path.map(p => view.project(p));
          for (let i = 0; i + 1 < scr.length; i++) {
            const d = distToSegment([px, py], scr[i], scr[i + 1]);
            if (d < bestD) { bestD = d; best = h; }
          }
        }
        return best;
      },

      /* ---------- Déplacement ---------- */
      begin(handle, px, py) {
        const sel = scene.selected();
        if (!sel.length) return false;
        const ray = view.ray(px, py);
        const st = {
          id: handle.id, kind: handle.id[0], axis: AXES['xyz'.indexOf(handle.id[1])],
          pivot: gz.pivot.slice(),
          start: sel.map(a => ({ a, offset: a.offset.slice(), quat: a.quat.slice() }))
        };
        if (st.kind === 'T') {
          const r = closestBetweenLines(ray.o, ray.d, gz.pivot, st.axis);
          if (!r) return false;
          st.s0 = r.s;
        } else if (st.kind === 'P') {
          const p = rayPlane(ray.o, ray.d, gz.pivot, st.axis);
          if (!p) return false;
          st.p0 = p;
        } else {
          const p = rayPlane(ray.o, ray.d, gz.pivot, st.axis);
          if (!p) return false;
          st.u = V.perp(st.axis);
          st.w = V.cross(st.axis, st.u);
          const d = V.sub(p, gz.pivot);
          st.a0 = Math.atan2(V.dot(d, st.w), V.dot(d, st.u));
        }
        gz.drag = st;
        return true;
      },

      /* snap : pas de déplacement (mm) ou d'angle (degrés), 0 pour aucun. */
      move(px, py, snapStep, snapAngle) {
        const st = gz.drag;
        if (!st) return null;
        const ray = view.ray(px, py);
        if (st.kind === 'T') {
          const r = closestBetweenLines(ray.o, ray.d, st.pivot, st.axis);
          if (!r) return null;
          let d = r.s - st.s0;
          if (snapStep) d = Math.round(d / snapStep) * snapStep;
          const delta = V.mul(st.axis, d);
          for (const s of st.start) s.a.offset = V.add(s.offset, delta);
          return { type: 'translation', value: delta };
        }
        if (st.kind === 'P') {
          const p = rayPlane(ray.o, ray.d, st.pivot, st.axis);
          if (!p) return null;
          let delta = V.sub(p, st.p0);
          if (snapStep) delta = delta.map(v => Math.round(v / snapStep) * snapStep);
          for (const s of st.start) s.a.offset = V.add(s.offset, delta);
          return { type: 'translation', value: delta };
        }
        const p = rayPlane(ray.o, ray.d, st.pivot, st.axis);
        if (!p) return null;
        const d = V.sub(p, st.pivot);
        let ang = Math.atan2(V.dot(d, st.w), V.dot(d, st.u)) - st.a0;
        while (ang > Math.PI) ang -= 2 * Math.PI;
        while (ang < -Math.PI) ang += 2 * Math.PI;
        if (snapAngle) {
          const step = snapAngle * Math.PI / 180;
          ang = Math.round(ang / step) * step;
        }
        const rot = Q.fromAxisAngle(st.axis, ang);
        for (const s of st.start) {
          /* Rotation du monde autour du pivot, reportée sur (décalage, quaternion). */
          s.a.quat = Q.unit(Q.mul(rot, s.quat));
          const c = s.a.mesh.center;
          const rel = V.sub(V.add(s.offset, c), st.pivot);
          s.a.offset = V.sub(V.add(st.pivot, Q.rotate(rot, rel)), c);
        }
        return { type: 'rotation', value: ang * 180 / Math.PI, axis: st.id[1] };
      },

      end() { gz.drag = null; },
      cancel() {
        if (!gz.drag) return;
        for (const s of gz.drag.start) { s.a.offset = s.offset; s.a.quat = s.quat; }
        gz.drag = null;
      },
      dispose() { for (const b of buffers.values()) view.dispose(b); buffers.clear(); }
    };
    return gz;
  }

  function distToSegment(p, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const L = vx * vx + vy * vy;
    let t = L > 0 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vy * t));
  }

  root.Gizmo = { createGizmo };
})(window.SWC = window.SWC || {});
