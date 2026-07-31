/* Orchestration du calcul : maillage -> appuis -> chargements -> résolution -> critères. */
(function (root) {
  'use strict';
  const G = root.Geom, M = root.Mesh, F3 = root.Fem;

  function triArea(p1, p2, p3) {
    return Math.abs((p2[0] - p1[0]) * (p3[1] - p1[1]) - (p3[0] - p1[0]) * (p2[1] - p1[1])) / 2;
  }

  /* Appartenance d'un point à une zone de charge répartie. */
  function inZone(x, y, z) {
    if (z.shape === 'circle') {
      const dx = x - z.x, dy = y - z.y;
      return dx * dx + dy * dy <= z.r * z.r;
    }
    const a = (z.angle || 0) * Math.PI / 180;
    const c = Math.cos(-a), s = Math.sin(-a);
    const dx = x - z.x, dy = y - z.y;
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    return Math.abs(lx) <= z.w / 2 && Math.abs(ly) <= z.h / 2;
  }

  function zoneArea(z) {
    return z.shape === 'circle' ? Math.PI * z.r * z.r : z.w * z.h;
  }

  /* Sous-échantillonne un triangle : renvoie la fraction d'aire dans la zone. */
  const SUB = (function () {
    // 16 sous-triangles (subdivision 4x4 en coordonnées barycentriques) : centroïdes
    const pts = [];
    const n = 4;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        pts.push([(i + 1 / 3) / n, (j + 1 / 3) / n]);
        if (j < n - i - 1) pts.push([(i + 2 / 3) / n, (j + 2 / 3) / n]);
      }
    }
    return pts;
  })();

  function coveredFraction(p1, p2, p3, z) {
    let c = 0;
    for (const [l1, l2] of SUB) {
      const l0 = 1 - l1 - l2;
      const x = l0 * p1[0] + l1 * p2[0] + l2 * p3[0];
      const y = l0 * p1[1] + l1 * p2[1] + l2 * p3[1];
      if (inZone(x, y, z)) c++;
    }
    return c / SUB.length;
  }

  function locateElement(mesh, x, y) {
    let best = -1, bestD = Infinity, bary = null;
    for (let e = 0; e < mesh.elems.length; e++) {
      const [i, j, k] = mesh.elems[e];
      const p1 = mesh.nodes[i], p2 = mesh.nodes[j], p3 = mesh.nodes[k];
      const A = (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p3[0] - p1[0]) * (p2[1] - p1[1]);
      if (Math.abs(A) < 1e-12) continue;
      const l1 = ((p2[0] - x) * (p3[1] - y) - (p3[0] - x) * (p2[1] - y)) / A;
      const l2 = ((p3[0] - x) * (p1[1] - y) - (p1[0] - x) * (p3[1] - y)) / A;
      const l3 = 1 - l1 - l2;
      const d = Math.max(0, -l1) + Math.max(0, -l2) + Math.max(0, -l3);
      if (d < bestD) { bestD = d; best = e; bary = [l1, l2, l3]; }
      if (d === 0) break;
    }
    return { elem: best, bary, outside: bestD > 1e-9 };
  }

  /*
    opts = {
      region, thickness, meshSize,
      support : {width, type:'simple'|'encastre', holesSupported},
      loads   : [{type:'point',x,y,force} | {type:'zone',shape:'rect'|'circle',...,force}],
      material: {E, nu, rho, sigmaY},
      selfWeight : bool,
      criteria: {deflectionRatio, safetyFactor}
    }
  */
  function run(opts) {
    const t = opts.thickness;
    const mat = opts.material;
    const region = opts.region;

    const mesh = opts.mesh || M.meshRegion(region, opts.meshSize);
    const nN = mesh.nodes.length;
    const D = F3.bendingD(mat.E, mat.nu, t);

    /* ---- Appuis : bande de largeur `width` le long du contour ---- */
    const fixed = new Int8Array(3 * nN);
    const supportW = Math.max(0, opts.support.width || 0);
    const supported = new Uint8Array(nN);
    for (let n = 0; n < nN; n++) {
      const [x, y] = mesh.nodes[n];
      let d = Infinity;
      const rings = [region.outer].concat(opts.support.holesSupported ? region.holes : []);
      for (const ring of rings) {
        for (let i = 0, m = ring.length; i < m; i++) {
          const a = ring[i], b = ring[(i + 1) % m];
          const dd = G.distPointSegment(x, y, a[0], a[1], b[0], b[1]);
          if (dd < d) d = dd;
        }
      }
      if (d <= supportW + 1e-6 || (mesh.isBoundary[n] && supportW === 0 && isOnRings(x, y, rings))) {
        supported[n] = 1;
        fixed[3 * n] = 1;
        if (opts.support.type === 'encastre') { fixed[3 * n + 1] = 1; fixed[3 * n + 2] = 1; }
      }
    }
    let nSupported = 0;
    for (let n = 0; n < nN; n++) if (supported[n]) nSupported++;
    if (nSupported < 3) {
      // sécurité : au minimum le contour extérieur est appuyé
      for (let n = 0; n < nN; n++) if (mesh.isBoundary[n]) { supported[n] = 1; fixed[3 * n] = 1; nSupported++; }
    }

    /* ---- Chargements ---- */
    const F = new Float64Array(3 * nN);
    const zoneInfo = [];
    let appliedTotal = 0;

    // Poids propre
    if (opts.selfWeight) {
      const g = 9810; // mm/s²
      const q = mat.rho * t * g; // N/mm²
      for (const el of mesh.elems) {
        const p = el.map(i => mesh.nodes[i]);
        const A = triArea(p[0], p[1], p[2]);
        for (const n of el) F[3 * n] += q * A / 3;
        appliedTotal += q * A;
      }
    }

    for (const load of opts.loads || []) {
      if (load.type === 'point') {
        const loc = locateElement(mesh, load.x, load.y);
        if (loc.elem < 0) continue;
        const el = mesh.elems[loc.elem];
        const b = loc.bary.map(v => Math.max(0, v));
        const s = b[0] + b[1] + b[2] || 1;
        for (let i = 0; i < 3; i++) F[3 * el[i]] += load.force * b[i] / s;
        appliedTotal += load.force;
      } else {
        // Charge répartie sur une zone : pression = force / aire de la zone
        const parts = [];
        let coveredArea = 0;
        for (let e = 0; e < mesh.elems.length; e++) {
          const el = mesh.elems[e];
          const p = el.map(i => mesh.nodes[i]);
          const A = triArea(p[0], p[1], p[2]);
          const f = coveredFraction(p[0], p[1], p[2], load);
          if (f <= 0) continue;
          parts.push([e, A * f]);
          coveredArea += A * f;
        }
        if (coveredArea <= 0) {
          zoneInfo.push({ load, coveredArea: 0, pressure: 0, warning: 'zone hors plaque ou plus fine que la maille' });
          continue;
        }
        // Répartition proportionnelle à l'aire réellement couverte : résultante exacte.
        const q = load.force / coveredArea;
        for (const [e, Aeff] of parts) {
          const el = mesh.elems[e];
          for (const n of el) F[3 * n] += q * Aeff / 3;
        }
        appliedTotal += load.force;
        zoneInfo.push({
          load, coveredArea, pressure: q,
          warning: Math.abs(coveredArea - zoneArea(load)) / zoneArea(load) > 0.15
            ? 'la zone déborde du contour ou recouvre un trou : seule la partie réellement sur la matière est chargée' : null
        });
      }
    }

    /* ---- Résolution ---- */
    const t0 = Date.now();
    const u = F3.solve(mesh, D, F, fixed);
    const solveMs = Date.now() - t0;

    /* ---- Réactions (équilibre) ---- */
    const Fint = new Float64Array(3 * nN);
    for (const el of mesh.elems) {
      const p = el.map(i => mesh.nodes[i]);
      const Ke = F3.dktStiffness(p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1], D);
      const ue = new Float64Array(9);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) ue[3 * a + b] = u[3 * el[a] + b];
      for (let a = 0; a < 9; a++) {
        let s = 0;
        for (let b = 0; b < 9; b++) s += Ke[a * 9 + b] * ue[b];
        Fint[3 * el[(a / 3) | 0] + (a % 3)] += s;
      }
    }
    let reactionTotal = 0, reactionMax = 0;
    const reactions = new Float64Array(nN);
    for (let n = 0; n < nN; n++) {
      if (!fixed[3 * n]) continue;
      // Réaction d'appui comptée positive quand elle s'oppose à la charge.
      const R = F[3 * n] - Fint[3 * n];
      reactions[n] = R;
      reactionTotal += R;
      if (Math.abs(R) > Math.abs(reactionMax)) reactionMax = R;
    }

    /* ---- Post-traitement ---- */
    const post = F3.postprocess(mesh, D, u, t);
    let wmax = 0, wmaxNode = 0;
    for (let n = 0; n < nN; n++) {
      const w = u[3 * n];
      if (Math.abs(w) > Math.abs(wmax)) { wmax = w; wmaxNode = n; }
    }

    /* Contrainte max hors bande d'appui immédiate (les pics numériques
       au droit des blocages ne sont pas représentatifs). */
    let sigmaMax = 0, sigmaNode = 0;
    for (let n = 0; n < nN; n++) {
      if (post.vonMises[n] > sigmaMax) { sigmaMax = post.vonMises[n]; sigmaNode = n; }
    }

    /* ---- Portée de référence : 2 x distance max à un appui ---- */
    let Lref = 0;
    const supNodes = [];
    for (let n = 0; n < nN; n++) if (supported[n]) supNodes.push(mesh.nodes[n]);
    for (let n = 0; n < nN; n++) {
      let d = Infinity;
      for (const s of supNodes) {
        const dd = (mesh.nodes[n][0] - s[0]) ** 2 + (mesh.nodes[n][1] - s[1]) ** 2;
        if (dd < d) d = dd;
      }
      d = Math.sqrt(d);
      if (d > Lref) Lref = d;
    }
    Lref *= 2;

    /* ---- Critères ---- */
    const crit = opts.criteria || {};
    const ratio = crit.deflectionRatio || 200;
    const sf = crit.safetyFactor || 2;
    const fAdm = Lref / ratio;
    const sigmaAdm = mat.sigmaY / sf;
    const wAbs = Math.abs(wmax);
    const safetyDefl = wAbs > 1e-12 ? fAdm / wAbs : Infinity;
    const safetyStress = sigmaMax > 1e-12 ? sigmaAdm / sigmaMax : Infinity;
    const safety = Math.min(safetyDefl, safetyStress);
    const verdict = safety >= 1.15 ? 'OK' : (safety >= 1.0 ? 'LIMITE' : 'NON OK');

    const warnings = [];
    if (wAbs > t / 2) warnings.push(
      `Flèche (${wAbs.toFixed(1)} mm) supérieure à la demi-épaisseur (${(t / 2).toFixed(1)} mm) : ` +
      `la théorie des plaques minces en petits déplacements atteint sa limite, ` +
      `les effets de membrane deviennent significatifs (résultat conservatif sur la flèche).`);
    if (wAbs > Lref / 50 && Lref > 0) warnings.push(
      `Flèche supérieure à L/50 : vérifier l'acceptabilité fonctionnelle au-delà du seul critère de résistance.`);
    for (const zi of zoneInfo) if (zi.warning) warnings.push('Zone de charge : ' + zi.warning);
    const anyPoint = (opts.loads || []).some(l => l.type === 'point');
    if (anyPoint) warnings.push(
      `Charge ponctuelle : la contrainte locale au point d'application est théoriquement infinie ` +
      `(singularité). La valeur affichée dépend de la finesse du maillage — pour un contrôle de ` +
      `résistance locale, modéliser la surface réelle d'appui avec une zone répartie.`);
    if (opts.support.type === 'simple') {
      // Une plaque seulement posée ne peut pas être retenue vers le haut :
      // une réaction négative signale un décollement du bâti.
      let uplift = 0, upliftMax = 0;
      for (let n = 0; n < nN; n++) {
        if (!fixed[3 * n]) continue;
        if (reactions[n] < -1e-6 * Math.abs(reactionMax)) { uplift++; upliftMax = Math.min(upliftMax, reactions[n]); }
      }
      if (uplift > 0.02 * nSupported) warnings.push(
        `Décollement : sur ${uplift} nœuds d'appui la réaction est négative, ` +
        `c'est-à-dire que la plaque tendrait à se soulever du bâti. Avec un appui simple ` +
        `(sans fixation), ces zones se soulèveraient réellement et la flèche serait supérieure ` +
        `au calcul. Fixez la plaque dans ces zones, ou recentrez le chargement.`);
    }
    const q = M.meshQuality(mesh);
    if (q.minAngle < 12) warnings.push(`Maillage : angle minimal ${q.minAngle.toFixed(1)}° — géométrie à simplifier ou maille à affiner.`);
    if (t > 0 && Lref / t < 10) warnings.push(
      `Élancement portée/épaisseur = ${(Lref / t).toFixed(1)} (< 10) : plaque épaisse, ` +
      `le cisaillement transverse (non pris en compte par la théorie de Kirchhoff) majorerait la flèche.`);

    return {
      mesh, u, D, F, fixed, supported, reactions,
      wmax, wmaxNode, sigmaMax, sigmaNode, vonMises: post.vonMises, momentsNode: post.momentsNode,
      Lref, fAdm, sigmaAdm, safety, safetyDefl, safetyStress, verdict,
      reactionTotal, reactionMax, appliedTotal, zoneInfo, warnings, solveMs,
      area: G.regionArea(region), nSupported
    };
  }

  function isOnRings(x, y, rings) {
    for (const ring of rings) {
      for (let i = 0, m = ring.length; i < m; i++) {
        const a = ring[i], b = ring[(i + 1) % m];
        if (G.distPointSegment(x, y, a[0], a[1], b[0], b[1]) < 1e-6) return true;
      }
    }
    return false;
  }

  root.Model = { run, inZone, zoneArea, locateElement };
})(typeof window !== 'undefined' ? (window.PP = window.PP || {}) : (module.exports = {}));
