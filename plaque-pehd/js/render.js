/* Rendu : vue 2D d'édition (plan) et déformée 3D (canvas 2D, tri en profondeur). */
(function (root) {
  'use strict';

  /* Palette séquentielle perceptuellement uniforme (viridis), sûre en daltonisme. */
  const VIRIDIS = [
    [68, 1, 84], [72, 33, 115], [67, 62, 133], [56, 88, 140], [45, 112, 142],
    [37, 133, 142], [30, 155, 138], [42, 176, 127], [82, 197, 105], [134, 213, 73],
    [194, 223, 35], [253, 231, 37]
  ];
  function colormap(t) {
    t = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const x = t * (VIRIDIS.length - 1);
    const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
    const f = x - i;
    const a = VIRIDIS[i], b = VIRIDIS[i + 1];
    return [Math.round(a[0] + (b[0] - a[0]) * f),
            Math.round(a[1] + (b[1] - a[1]) * f),
            Math.round(a[2] + (b[2] - a[2]) * f)];
  }
  const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

  /* ---------------- Vue 2D ---------------- */
  function makeView(canvas, region, pad) {
    const G = root.Geom;
    const bb = G.bbox(region.outer);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    pad = pad === undefined ? 40 : pad;
    const s = Math.min((W - 2 * pad) / (bb.w || 1), (H - 2 * pad) / (bb.h || 1));
    const cx = (bb.xmin + bb.xmax) / 2, cy = (bb.ymin + bb.ymax) / 2;
    return {
      scale: s, W, H,
      toScreen: (x, y) => [W / 2 + (x - cx) * s, H / 2 - (y - cy) * s],
      toWorld: (px, py) => [cx + (px - W / 2) / s, cy - (py - H / 2) / s],
      bbox: bb
    };
  }

  function drawPlan(canvas, state, view) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = getComputedStyle(document.documentElement);
    const colLine = s.getPropertyValue('--line').trim() || '#8a8f98';
    const colText = s.getPropertyValue('--fg').trim() || '#111';
    ctx.clearRect(0, 0, view.W, view.H);
    if (!state.region) return;

    const P = (x, y) => view.toScreen(x, y);

    // Bande d'appui
    if (state.support.width > 0) {
      ctx.save();
      ctx.beginPath();
      pathRegion(ctx, state.region, P);
      ctx.clip('evenodd');
      ctx.lineWidth = state.support.width * 2 * view.scale;
      ctx.strokeStyle = 'rgba(45,112,142,0.35)';
      ctx.beginPath();
      ringPath(ctx, state.region.outer, P);
      if (state.support.holesSupported) for (const h of state.region.holes) ringPath(ctx, h, P);
      ctx.stroke();
      ctx.restore();
    }

    // Contour plaque
    ctx.beginPath();
    pathRegion(ctx, state.region, P);
    ctx.fillStyle = 'rgba(125,135,150,0.10)';
    ctx.fill('evenodd');
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = colLine;
    ctx.stroke();

    // Hachures d'appui sur le contour
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(37,133,142,0.9)';
    ctx.beginPath();
    ringPath(ctx, state.region.outer, P);
    ctx.stroke();

    // Zones de charge
    for (const l of state.loads) {
      const sel = l === state.selected;
      ctx.save();
      ctx.lineWidth = sel ? 2.5 : 1.5;
      if (l.type === 'point') {
        const [px, py] = P(l.x, l.y);
        ctx.fillStyle = sel ? '#d9480f' : '#e8590c';
        ctx.beginPath(); ctx.arc(px, py, sel ? 8 : 6, 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = colText;
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(`${fmt(l.force)} N`, px + 10, py - 8);
      } else {
        ctx.fillStyle = sel ? 'rgba(232,89,12,0.30)' : 'rgba(232,89,12,0.18)';
        ctx.strokeStyle = sel ? '#d9480f' : 'rgba(232,89,12,0.85)';
        ctx.beginPath();
        if (l.shape === 'circle') {
          const [px, py] = P(l.x, l.y);
          ctx.arc(px, py, l.r * view.scale, 0, 2 * Math.PI);
        } else {
          const a = (l.angle || 0) * Math.PI / 180;
          const c = Math.cos(a), sn = Math.sin(a);
          const corners = [[-l.w / 2, -l.h / 2], [l.w / 2, -l.h / 2], [l.w / 2, l.h / 2], [-l.w / 2, l.h / 2]]
            .map(([dx, dy]) => P(l.x + dx * c - dy * sn, l.y + dx * sn + dy * c));
          ctx.moveTo(corners[0][0], corners[0][1]);
          for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1]);
          ctx.closePath();
        }
        ctx.fill(); ctx.stroke();
        const [px, py] = P(l.x, l.y);
        ctx.fillStyle = colText;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        const area = root.Model.zoneArea(l);
        ctx.fillText(`${fmt(l.force)} N`, px, py - 2);
        ctx.fillText(`${(l.force / area * 1000).toFixed(1)} kPa`, px, py + 12);
      }
      ctx.restore();
    }

    // Échelle
    drawScaleBar(ctx, view, colText);
  }

  function fmt(v) {
    if (Math.abs(v) >= 10000) return (v / 1000).toFixed(1) + 'k';
    return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);
  }

  function ringPath(ctx, ring, P) {
    const p0 = P(ring[0][0], ring[0][1]);
    ctx.moveTo(p0[0], p0[1]);
    for (let i = 1; i < ring.length; i++) { const p = P(ring[i][0], ring[i][1]); ctx.lineTo(p[0], p[1]); }
    ctx.closePath();
  }
  function pathRegion(ctx, region, P) {
    ringPath(ctx, region.outer, P);
    for (const h of region.holes) ringPath(ctx, h, P);
  }

  function drawScaleBar(ctx, view, col) {
    const targetPx = 120;
    const raw = targetPx / view.scale;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const nice = [1, 2, 5, 10].map(k => k * pow).find(v => v >= raw / 2) || pow;
    const px = nice * view.scale;
    const x0 = 16, y0 = view.H - 20;
    ctx.save();
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x0 + px, y0);
    ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0 + 4);
    ctx.moveTo(x0 + px, y0 - 4); ctx.lineTo(x0 + px, y0 + 4);
    ctx.stroke();
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`${nice >= 1000 ? (nice / 1000) + ' m' : nice + ' mm'}`, x0 + px + 8, y0 + 4);
    ctx.restore();
  }

  /* ---------------- Vue 3D ---------------- */
  function drawDeformed(canvas, res, view3d, opts) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!res) return;

    const mesh = res.mesh, u = res.u;
    const field = opts.field === 'sigma' ? res.vonMises : null;
    const nN = mesh.nodes.length;

    // Valeurs nodales du champ affiché
    const val = new Float64Array(nN);
    let vmin = Infinity, vmax = -Infinity;
    for (let n = 0; n < nN; n++) {
      val[n] = field ? field[n] : Math.abs(u[3 * n]);
      if (val[n] < vmin) vmin = val[n];
      if (val[n] > vmax) vmax = val[n];
    }
    if (!(vmax > vmin)) { vmax = vmin + 1e-9; }

    // Centrage / échelle
    const G = root.Geom;
    const bb = G.bbox(mesh.nodes);
    const cx = (bb.xmin + bb.xmax) / 2, cy = (bb.ymin + bb.ymax) / 2;
    const diag = Math.hypot(bb.w, bb.h) || 1;
    const amp = opts.amp;
    const yaw = view3d.yaw, pitch = view3d.pitch;
    const cy1 = Math.cos(yaw), sy1 = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const scale = Math.min(W, H) / diag * 0.76 * view3d.zoom;

    function proj(x, y, z) {
      const X = x - cx, Y = y - cy;
      const x1 = X * cy1 - Y * sy1;
      const y1 = X * sy1 + Y * cy1;
      const y2 = y1 * cp - z * sp;
      const z2 = y1 * sp + z * cp;
      return [W / 2 + x1 * scale + view3d.panX, H / 2 - y2 * scale + view3d.panY, z2];
    }

    // Sommets projetés (z déformé vers le bas = -w)
    const sx = new Float64Array(nN), sy = new Float64Array(nN), sz = new Float64Array(nN);
    for (let n = 0; n < nN; n++) {
      const p = proj(mesh.nodes[n][0], mesh.nodes[n][1], -u[3 * n] * amp);
      sx[n] = p[0]; sy[n] = p[1]; sz[n] = p[2];
    }

    // Contour non déformé (référence)
    if (opts.showUndeformed) {
      ctx.save();
      ctx.strokeStyle = 'rgba(140,145,155,0.55)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1;
      for (const ring of [opts.region.outer].concat(opts.region.holes)) {
        ctx.beginPath();
        const p0 = proj(ring[0][0], ring[0][1], 0);
        ctx.moveTo(p0[0], p0[1]);
        for (let i = 1; i < ring.length; i++) { const p = proj(ring[i][0], ring[i][1], 0); ctx.lineTo(p[0], p[1]); }
        ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
    }

    // Tri en profondeur (algorithme du peintre)
    const nE = mesh.elems.length;
    const order = new Int32Array(nE);
    const depth = new Float64Array(nE);
    for (let e = 0; e < nE; e++) {
      const t = mesh.elems[e];
      order[e] = e;
      depth[e] = (sz[t[0]] + sz[t[1]] + sz[t[2]]) / 3;
    }
    const idx = Array.from(order).sort((a, b) => depth[a] - depth[b]);

    // Éclairage diffus simple
    const lightDir = [0.35, 0.45, 0.82];
    ctx.lineJoin = 'round';
    for (const e of idx) {
      const t = mesh.elems[e];
      const a = t[0], b = t[1], c = t[2];
      // normale en repère déformé (pour l'ombrage)
      const p1 = [mesh.nodes[a][0], mesh.nodes[a][1], -u[3 * a] * amp];
      const p2 = [mesh.nodes[b][0], mesh.nodes[b][1], -u[3 * b] * amp];
      const p3 = [mesh.nodes[c][0], mesh.nodes[c][1], -u[3 * c] * amp];
      const ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2];
      const vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const lam = Math.abs(nx * lightDir[0] + ny * lightDir[1] + nz * lightDir[2]);
      const shade = 0.72 + 0.28 * lam;

      const vm = (val[a] + val[b] + val[c]) / 3;
      const col = colormap((vm - vmin) / (vmax - vmin));
      ctx.fillStyle = `rgb(${Math.round(col[0] * shade)},${Math.round(col[1] * shade)},${Math.round(col[2] * shade)})`;
      ctx.beginPath();
      ctx.moveTo(sx[a], sy[a]); ctx.lineTo(sx[b], sy[b]); ctx.lineTo(sx[c], sy[c]);
      ctx.closePath();
      ctx.fill();
      if (opts.wireframe) {
        ctx.strokeStyle = 'rgba(0,0,0,0.22)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      } else {
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.stroke();
      }
    }

    // Appuis
    if (opts.showSupports) {
      ctx.fillStyle = 'rgba(20,110,140,0.85)';
      for (let n = 0; n < nN; n++) {
        if (!res.supported[n]) continue;
        ctx.beginPath(); ctx.arc(sx[n], sy[n], 1.8, 0, 2 * Math.PI); ctx.fill();
      }
    }

    // Point le plus déformé
    const wn = res.wmaxNode;
    ctx.save();
    ctx.strokeStyle = '#e8590c'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx[wn], sy[wn], 6, 0, 2 * Math.PI); ctx.stroke();
    ctx.restore();

    drawColorbar(ctx, W, H, vmin, vmax, opts.field === 'sigma' ? 'MPa (von Mises, peau)' : 'mm (flèche)');
    return { vmin, vmax };
  }

  function drawColorbar(ctx, W, H, vmin, vmax, unit) {
    const s = getComputedStyle(document.documentElement);
    const col = s.getPropertyValue('--fg').trim() || '#111';
    const x = W - 74, y = 24, w = 14, h = Math.min(220, H - 90);
    for (let i = 0; i < h; i++) {
      const t = 1 - i / h;
      ctx.fillStyle = css(colormap(t));
      ctx.fillRect(x, y + i, w, 1);
    }
    ctx.strokeStyle = 'rgba(128,128,128,0.6)'; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = col;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    const nTicks = 5;
    for (let i = 0; i <= nTicks; i++) {
      const t = i / nTicks;
      const v = vmin + (vmax - vmin) * (1 - t);
      ctx.fillText(v.toFixed(Math.abs(vmax) < 10 ? 2 : 1), x + w + 5, y + t * h + 4);
    }
    ctx.save();
    ctx.translate(x - 6, y + h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(unit, 0, 0);
    ctx.restore();
  }

  root.Render = { drawPlan, drawDeformed, makeView, colormap, cssColor: css };
})(typeof window !== 'undefined' ? (window.PP = window.PP || {}) : (module.exports = {}));
