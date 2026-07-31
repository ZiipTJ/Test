/* Interface : édition du modèle, lancement du calcul, affichage des résultats. */
(function (PP) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const G = PP.Geom, Mat = PP.Material, Imp = PP.Importers, R = PP.Render;

  const state = {
    region: null, detectedThickness: 0, source: null, fileName: null,
    thickness: 20, duree: '1j', temp: '23', selfWeight: true,
    support: { width: 30, type: 'simple', holesSupported: false },
    loads: [], selected: null, tool: 'select',
    criteria: { deflectionRatio: 200, safetyFactor: 2 },
    meshSize: null, meshAuto: true,
    result: null, view: 'plan',
    view3d: { yaw: -0.55, pitch: 1.0, zoom: 1, panX: 0, panY: 0 },
    ampSlider: 50, field: 'w', wire: false, undef: true, showSup: true
  };
  let planView = null;

  /* ==================== Géométrie ==================== */
  function setGeometry(res, name) {
    state.region = res.region;
    state.detectedThickness = res.thickness || 0;
    state.source = res.source;
    state.fileName = name || null;
    state.result = null;
    state.loads = [];
    state.selected = null;
    // Recentre le repère sur la plaque
    const bb = G.bbox(state.region.outer);
    const dx = -bb.xmin, dy = -bb.ymin;
    const shift = (ring) => ring.map(p => [p[0] + dx, p[1] + dy]);
    state.region = { outer: shift(state.region.outer), holes: state.region.holes.map(shift) };
    if (res.thickness > 0.5 && res.thickness < 200) {
      state.thickness = Math.round(res.thickness * 10) / 10;
      $('thickness').value = state.thickness;
    }
    autoMesh();
    setView('plan');
    updateGeoInfo();
    renderLoads();
    draw();
  }

  function updateGeoInfo() {
    const el = $('geo-info');
    if (!state.region) { el.innerHTML = ''; return; }
    const bb = G.bbox(state.region.outer);
    const A = G.regionArea(state.region);
    const mass = A * state.thickness * Mat.PEHD500.rho * 1000; // kg
    const rows = [
      ['Source', state.fileName ? state.fileName : state.source],
      ['Encombrement', `${bb.w.toFixed(1)} × ${bb.h.toFixed(1)} mm`],
      ['Surface', `${(A / 1e6).toFixed(3)} m²`],
      ['Trous détectés', String(state.region.holes.length)],
      ['Épaisseur détectée', state.detectedThickness ? state.detectedThickness.toFixed(1) + ' mm' : '—'],
      ['Masse plaque', mass.toFixed(1) + ' kg']
    ];
    el.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  }

  async function loadFile(file) {
    $('geo-error').textContent = '';
    const name = file.name, lower = name.toLowerCase();
    try {
      if (lower.endsWith('.stl')) {
        setGeometry(Imp.importSTL(await file.arrayBuffer()), name);
      } else if (lower.endsWith('.step') || lower.endsWith('.stp')) {
        setGeometry(Imp.importSTEP(await file.text()), name);
      } else if (lower.endsWith('.json')) {
        loadProject(JSON.parse(await file.text()));
      } else {
        throw new Error('Format non reconnu : utilisez .stl, .step ou .stp.');
      }
    } catch (e) {
      $('geo-error').textContent = e.message || String(e);
      console.error(e);
    }
  }

  /* ==================== Maillage automatique ==================== */
  function autoMesh() {
    if (!state.region) return;
    const A = G.regionArea(state.region);
    const bb = G.bbox(state.region.outer);
    const diag = Math.hypot(bb.w, bb.h);
    let h = Math.sqrt(A / (1400 * 0.43));           // ~1400 nœuds visés
    h = Math.max(diag / 160, Math.min(diag / 14, h));
    // Assez fin pour décrire les zones de charge et la bande d'appui
    for (const l of state.loads) {
      if (l.type !== 'zone') continue;
      const d = l.shape === 'circle' ? 2 * l.r : Math.min(l.w, l.h);
      h = Math.min(h, d / 2.5);
    }
    if (state.support.width > 0) h = Math.min(h, Math.max(state.support.width, diag / 160));
    h = Math.max(h, diag / 220);
    if (state.meshAuto) {
      state.meshSize = Math.round(h * 10) / 10;
      $('mesh-size').value = state.meshSize;
    }
    updateMeshInfo();
  }

  function updateMeshInfo() {
    if (!state.region || !state.meshSize) { $('mesh-info').textContent = ''; return; }
    const n = Math.round(G.regionArea(state.region) / (state.meshSize * state.meshSize) * 0.43);
    $('mesh-info').textContent =
      `Environ ${n} nœuds. Maille plus fine = résultat plus précis mais calcul plus long ` +
      `(au-delà de ~4000 nœuds, comptez plusieurs secondes).`;
  }

  /* ==================== Charges ==================== */
  function defaultZone(shape, x, y) {
    const bb = G.bbox(state.region.outer);
    const d = Math.min(bb.w, bb.h);
    return shape === 'circle'
      ? { type: 'zone', shape: 'circle', x, y, r: d * 0.12, force: 1000 }
      : { type: 'zone', shape: 'rect', x, y, w: d * 0.25, h: d * 0.25, angle: 0, force: 1000 };
  }

  function renderLoads() {
    const ul = $('load-list');
    ul.innerHTML = '';
    let total = 0;
    state.loads.forEach((l, i) => {
      total += l.force;
      const li = document.createElement('li');
      if (l === state.selected) li.className = 'sel';
      const title = l.type === 'point' ? 'Force ponctuelle'
        : (l.shape === 'circle' ? 'Zone ronde' : 'Zone rectangulaire');
      const unit = l.unit || 'N';
      const units = l.type === 'point' ? ['N', 'kg'] : ['N', 'kg', 'kPa'];
      const fields = [['x', 'X', l.x], ['y', 'Y', l.y]];
      if (l.type === 'zone' && l.shape === 'circle') fields.push(['r', 'R', l.r]);
      if (l.type === 'zone' && l.shape === 'rect') {
        fields.push(['w', 'L', l.w], ['h', 'l', l.h], ['angle', '° ', l.angle || 0]);
      }
      li.innerHTML =
        `<div class="hd"><span class="sw"></span>${i + 1}. ${title}
           <span style="flex:1"></span>
           <button class="ghost" data-del="${i}" title="Supprimer">✕</button></div>
         <div class="grid" style="grid-template-columns:1fr 1fr">
           <label style="grid-template-columns:20px 1fr"><span>F</span>
             <input type="number" step="any" data-i="${i}" data-k="__force" value="${round(toUnit(l, unit))}"></label>
           <label style="grid-template-columns:20px 1fr"><span></span>
             <select data-i="${i}" data-unit="1">` +
        units.map(u => `<option value="${u}" ${u === unit ? 'selected' : ''}>${u}</option>`).join('') +
        `   </select></label>
         </div>
         <div class="grid">` +
        fields.map(([k, lab, v]) =>
          `<label><span>${lab}</span><input type="number" step="any" data-i="${i}" data-k="${k}" value="${round(v)}"></label>`).join('') +
        `</div>
         <div class="det" style="color:var(--muted);font-size:11px;margin-top:4px">${loadSummary(l)}</div>`;
      li.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        state.selected = l; renderLoads(); draw();
      });
      ul.appendChild(li);
    });
    ul.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', () => {
        const l = state.loads[+inp.dataset.i];
        const v = parseFloat(inp.value);
        if (!isFinite(v)) return;
        if (inp.dataset.k === '__force') l.force = fromUnit(l, l.unit || 'N', v);
        else l[inp.dataset.k] = v;
        invalidate(); draw(); updateTotals();
        li_refreshSummary(inp, l);
      });
    });
    ul.querySelectorAll('select[data-unit]').forEach(sel => {
      sel.addEventListener('change', () => {
        state.loads[+sel.dataset.i].unit = sel.value;
        renderLoads();
      });
    });
    ul.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', () => {
        const l = state.loads[+b.dataset.del];
        state.loads.splice(+b.dataset.del, 1);
        if (state.selected === l) state.selected = null;
        invalidate(); renderLoads(); draw();
      });
    });
    updateTotals();
  }

  function updateTotals() {
    const total = state.loads.reduce((s, l) => s + (l.force || 0), 0);
    $('load-total').textContent = state.loads.length
      ? `Total : ${total.toFixed(0)} N (${(total / 9.81).toFixed(0)} kg)` : '';
  }

  const round = (v) => Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;

  /* Conversion force <-> unité de saisie. kPa = kN/m² sur l'aire de la zone. */
  function unitFactor(l, unit) {
    if (unit === 'kg') return 9.81;
    if (unit === 'kPa') return PP.Model.zoneArea(l) * 1e-3;
    return 1;
  }
  const toUnit = (l, u) => l.force / unitFactor(l, u);
  const fromUnit = (l, u, v) => v * unitFactor(l, u);

  function loadSummary(l) {
    const kg = (l.force / 9.81).toFixed(0);
    if (l.type === 'point') return `${l.force.toFixed(0)} N — soit ${kg} kg posés en un point`;
    const A = PP.Model.zoneArea(l);
    return `${l.force.toFixed(0)} N (${kg} kg) sur ${(A / 1e6).toFixed(3)} m² — ` +
      `pression ${(l.force / A * 1000).toFixed(1)} kPa`;
  }

  function li_refreshSummary(inp, l) {
    const li = inp.closest('li');
    const d = li && li.querySelector('.det');
    if (d) d.textContent = loadSummary(l);
  }

  /* ==================== Interaction vue plan ==================== */
  function hitLoad(x, y) {
    for (let i = state.loads.length - 1; i >= 0; i--) {
      const l = state.loads[i];
      if (l.type === 'point') {
        if (Math.hypot(x - l.x, y - l.y) < 10 / planView.scale) return l;
      } else if (PP.Model.inZone(x, y, l)) return l;
    }
    return null;
  }

  function setupPlanEvents(cv) {
    let drag = null;
    cv.addEventListener('pointerdown', (e) => {
      if (!state.region || !planView) return;
      cv.setPointerCapture(e.pointerId);
      const r = cv.getBoundingClientRect();
      const [x, y] = planView.toWorld(e.clientX - r.left, e.clientY - r.top);
      if (state.tool === 'select') {
        const l = hitLoad(x, y);
        state.selected = l;
        if (l) drag = { kind: 'move', l, dx: l.x - x, dy: l.y - y };
        renderLoads(); draw();
        return;
      }
      if (state.tool === 'point') {
        const l = { type: 'point', x: round(x), y: round(y), force: 1000 };
        state.loads.push(l); state.selected = l;
        setTool('select'); invalidate(); renderLoads(); draw();
        return;
      }
      const l = defaultZone(state.tool === 'circle' ? 'circle' : 'rect', x, y);
      state.loads.push(l); state.selected = l;
      drag = { kind: 'create', l, x0: x, y0: y };
      renderLoads(); draw();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || !planView) return;
      const r = cv.getBoundingClientRect();
      const [x, y] = planView.toWorld(e.clientX - r.left, e.clientY - r.top);
      if (drag.kind === 'move') {
        drag.l.x = round(x + drag.dx); drag.l.y = round(y + drag.dy);
      } else {
        const l = drag.l;
        if (l.shape === 'circle') {
          l.r = Math.max(1, round(Math.hypot(x - drag.x0, y - drag.y0)));
        } else {
          l.w = Math.max(1, round(Math.abs(x - drag.x0)));
          l.h = Math.max(1, round(Math.abs(y - drag.y0)));
          l.x = round((x + drag.x0) / 2); l.y = round((y + drag.y0) / 2);
        }
      }
      invalidate(); draw();
    });
    cv.addEventListener('pointerup', () => {
      if (drag) { setTool('select'); renderLoads(); autoMesh(); }
      drag = null;
    });
  }

  function setTool(t) {
    state.tool = t;
    document.querySelectorAll('#tools .chip').forEach(c => c.classList.toggle('on', c.dataset.tool === t));
    $('tool-hint').textContent = t === 'select'
      ? 'Cliquez une charge pour la sélectionner, glissez-la pour la déplacer.'
      : (t === 'point' ? 'Cliquez sur la plaque pour poser la force ponctuelle.'
        : 'Cliquez-glissez sur la plaque pour tracer la zone chargée.');
  }

  /* ==================== Interaction 3D ==================== */
  function setup3DEvents(cv) {
    let last = null, btn = 0;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      last = [e.clientX, e.clientY]; btn = e.button;
    });
    cv.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      if (btn === 2 || e.shiftKey) {
        state.view3d.panX += dx; state.view3d.panY += dy;
      } else {
        state.view3d.yaw += dx * 0.008;
        state.view3d.pitch = Math.max(0.02, Math.min(Math.PI / 2, state.view3d.pitch - dy * 0.008));
      }
      draw();
    });
    cv.addEventListener('pointerup', () => { last = null; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      state.view3d.zoom *= Math.exp(-e.deltaY * 0.0012);
      state.view3d.zoom = Math.max(0.2, Math.min(12, state.view3d.zoom));
      draw();
    }, { passive: false });
  }

  /* ==================== Dessin ==================== */
  function draw() {
    if (state.view === 'plan') {
      if (!state.region) { const c = $('cv-plan').getContext('2d'); c.clearRect(0, 0, 9999, 9999); return; }
      planView = R.makeView($('cv-plan'), state.region);
      R.drawPlan($('cv-plan'), state, planView);
    } else if (state.result) {
      const amp = autoAmp() * (state.ampSlider / 50);
      $('amp-val').textContent = '× ' + (amp < 10 ? amp.toFixed(1) : Math.round(amp));
      R.drawDeformed($('cv-def'), state.result, state.view3d, {
        amp, field: state.field, wireframe: state.wire,
        showUndeformed: state.undef, showSupports: state.showSup, region: state.region
      });
    }
  }

  function autoAmp() {
    if (!state.result) return 1;
    const bb = G.bbox(state.region.outer);
    const target = Math.max(bb.w, bb.h) * 0.12;
    const w = Math.abs(state.result.wmax) || 1e-6;
    return Math.max(0.2, Math.min(5000, target / w));
  }

  function setView(v) {
    state.view = v;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === v));
    $('cv-plan').hidden = v !== 'plan';
    $('cv-def').hidden = v !== 'def';
    $('viewbar-plan').hidden = v !== 'plan';
    $('viewbar-def').hidden = v !== 'def';
    draw();
  }

  function invalidate() { state.result = null; }

  /* ==================== Calcul ==================== */
  function run() {
    if (!state.region) { $('geo-error').textContent = "Importez d'abord une géométrie."; return; }
    $('busy').hidden = false;
    setTimeout(() => {
      try {
        const mat = Mat.properties(state.duree, state.temp);
        const res = PP.Model.run({
          region: state.region,
          thickness: state.thickness,
          meshSize: state.meshSize,
          support: state.support,
          loads: state.loads,
          material: { E: mat.E, nu: mat.nu, rho: mat.rho, sigmaY: mat.sigmaY },
          selfWeight: state.selfWeight,
          criteria: state.criteria
        });
        res.mat = mat;
        state.result = res;
        showResults(res, mat);
        setView('def');
      } catch (e) {
        $('geo-error').textContent = 'Erreur de calcul : ' + (e.message || e);
        console.error(e);
      } finally {
        $('busy').hidden = true;
      }
    }, 30);
  }

  function showResults(res, mat) {
    const v = $('verdict');
    const cls = res.verdict === 'OK' ? 'ok' : (res.verdict === 'LIMITE' ? 'limite' : 'bad');
    v.className = 'verdict ' + cls;
    const msg = res.verdict === 'OK' ? 'Plaque conforme aux deux critères'
      : res.verdict === 'LIMITE' ? 'Juste acceptable — peu de marge'
      : 'Critère dépassé — épaissir, réduire la portée ou la charge';
    v.innerHTML =
      `<div class="badge">${res.verdict}</div>
       <div class="coef">Coefficient de sécurité global <b>${res.safety.toFixed(2)}</b></div>
       <div class="coef">${msg}</div>`;

    const bar = (label, val, adm, unit, ratio, det) => {
      const p = Math.min(100, ratio * 100);
      const col = ratio <= 0.87 ? 'var(--ok)' : (ratio <= 1 ? 'var(--warn)' : 'var(--bad)');
      return `<div class="crit">
        <div class="top"><span>${label}</span><b>${val} / ${adm} ${unit}</b></div>
        <div class="bar"><i style="width:${p}%;background:${col}"></i></div>
        <div class="det">${det}</div></div>`;
    };
    const wAbs = Math.abs(res.wmax);
    $('criteria').innerHTML =
      bar('Flèche', wAbs.toFixed(2), res.fAdm.toFixed(2), 'mm', wAbs / res.fAdm,
        `taux ${(wAbs / res.fAdm * 100).toFixed(0)} % · critère L/${state.criteria.deflectionRatio} · portée L = ${res.Lref.toFixed(0)} mm`) +
      bar('Contrainte', res.sigmaMax.toFixed(2), res.sigmaAdm.toFixed(2), 'MPa', res.sigmaMax / res.sigmaAdm,
        `taux ${(res.sigmaMax / res.sigmaAdm * 100).toFixed(0)} % · seuil d'écoulement ${mat.sigmaY.toFixed(1)} MPa / ${state.criteria.safetyFactor}`);

    const A = G.regionArea(state.region);
    const mass = A * state.thickness * Mat.PEHD500.rho * 1000;
    const kv = [
      ['Flèche maximale', wAbs.toFixed(2) + ' mm'],
      ['Flèche admissible', res.fAdm.toFixed(2) + ' mm'],
      ['Coef. sécurité flèche', fmtCoef(res.safetyDefl)],
      ['Contrainte max (peau)', res.sigmaMax.toFixed(2) + ' MPa'],
      ['Contrainte admissible', res.sigmaAdm.toFixed(2) + ' MPa'],
      ['Coef. sécurité contrainte', fmtCoef(res.safetyStress)],
      ['Portée de référence L', res.Lref.toFixed(0) + ' mm'],
      ['Rapport flèche / portée', 'L/' + Math.round(res.Lref / Math.max(wAbs, 1e-9))],
      ['Charge totale appliquée', res.appliedTotal.toFixed(0) + ' N (' + (res.appliedTotal / 9.81).toFixed(0) + ' kg)'],
      ['Réaction totale d\'appui', res.reactionTotal.toFixed(0) + ' N'],
      ['Nœuds / éléments', `${res.mesh.nodes.length} / ${res.mesh.elems.length}`],
      ['Temps de résolution', res.solveMs + ' ms']
    ];
    $('res-kv').innerHTML = kv.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('');

    const hyp = [
      ['Matériau', Mat.PEHD500.nom],
      ['Épaisseur', state.thickness + ' mm'],
      ['Module E retenu', mat.E.toFixed(0) + ' MPa'],
      ['Coef. de Poisson', mat.nu.toFixed(2)],
      ['Durée de charge', mat.dureeLabel + ' (k=' + mat.kFluage.toFixed(2) + ')'],
      ['Température', mat.tempLabel],
      ['Seuil d\'écoulement', mat.sigmaY.toFixed(1) + ' MPa'],
      ['Appui', (state.support.type === 'simple' ? 'Appui simple' : 'Encastrement') + ' sur ' + state.support.width + ' mm'],
      ['Poids propre', state.selfWeight ? 'inclus (' + mass.toFixed(1) + ' kg)' : 'non inclus'],
      ['Théorie', 'Plaque mince de Kirchhoff, petits déplacements, élasticité linéaire']
    ];
    $('hyp-kv').innerHTML = hyp.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('');

    $('warnings').innerHTML = res.warnings.length
      ? '<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 6px">Points de vigilance</h3><ul class="warn-list">'
        + res.warnings.map(w => `<li>${w}</li>`).join('') + '</ul>'
      : '';
  }

  const fmtCoef = (c) => isFinite(c) ? c.toFixed(2) : '∞';

  /* ==================== Projet : sauvegarde / ouverture ==================== */
  function saveProject() {
    const data = {
      format: 'plaque-pehd-v1',
      region: state.region, detectedThickness: state.detectedThickness,
      source: state.source, fileName: state.fileName,
      thickness: state.thickness, duree: state.duree, temp: state.temp,
      selfWeight: state.selfWeight, support: state.support, loads: state.loads,
      criteria: state.criteria, meshSize: state.meshSize, meshAuto: state.meshAuto
    };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.fileName || 'plaque-pehd').replace(/\.[^.]+$/, '') + '.plaque.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadProject(d) {
    if (!d || d.format !== 'plaque-pehd-v1') throw new Error('Fichier projet non reconnu.');
    Object.assign(state, {
      region: d.region, detectedThickness: d.detectedThickness || 0, source: d.source,
      fileName: d.fileName, thickness: d.thickness, duree: d.duree, temp: d.temp,
      selfWeight: d.selfWeight, support: d.support, loads: d.loads || [],
      criteria: d.criteria, meshSize: d.meshSize, meshAuto: d.meshAuto, result: null, selected: null
    });
    syncInputs();
    updateGeoInfo(); renderLoads(); updateMeshInfo(); setView('plan');
  }

  function syncInputs() {
    $('thickness').value = state.thickness;
    $('duree').value = state.duree;
    $('temp').value = state.temp;
    $('selfweight').checked = state.selfWeight;
    $('sup-width').value = state.support.width;
    $('sup-type').value = state.support.type;
    $('sup-holes').checked = state.support.holesSupported;
    $('crit-defl').value = state.criteria.deflectionRatio;
    $('crit-sf').value = state.criteria.safetyFactor;
    $('mesh-size').value = state.meshSize || '';
    $('mesh-auto').checked = state.meshAuto;
    updateMatInfo();
  }

  function updateMatInfo() {
    const m = Mat.properties(state.duree, state.temp);
    $('mat-info').innerHTML =
      `PEHD 500 : E<sub>0</sub> = ${Mat.PEHD500.E0} MPa à 23 °C sous charge courte. ` +
      `Compte tenu du fluage (×${m.kFluage.toFixed(2)}) et de la température (×${m.kTemp.toFixed(2)}), ` +
      `le calcul utilise <b>E = ${m.E.toFixed(0)} MPa</b> et σ<sub>seuil</sub> = ${m.sigmaY.toFixed(1)} MPa. ` +
      `Le PEHD flue fortement : une charge permanente peut tripler la flèche par rapport à une charge brève.`;
    $('crit-info').textContent =
      `Contrainte admissible = ${(m.sigmaY / state.criteria.safetyFactor).toFixed(1)} MPa. ` +
      `La portée L est estimée automatiquement (2 × distance maximale à un appui).`;
  }

  /* ==================== Initialisation ==================== */
  function init() {
    // Matériau : listes déroulantes
    $('duree').innerHTML = Mat.DUREES.map(d => `<option value="${d.id}">${d.label}</option>`).join('');
    $('temp').innerHTML = Mat.TEMPERATURES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
    $('thick-chips').innerHTML = [5, 8, 10, 12, 15, 20, 25, 30, 40, 50]
      .map(t => `<button class="chip" data-t="${t}">${t}</button>`).join('');
    syncInputs();

    // Fichiers
    const drop = $('drop'), file = $('file');
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { if (file.files[0]) loadFile(file.files[0]); file.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => {
      e.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());

    // Géométries simples
    $('geo-rect').addEventListener('click', () => geoParams('rect'));
    $('geo-disc').addEventListener('click', () => geoParams('disc'));

    // Épaisseur / matériau
    $('thickness').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && v > 0) { state.thickness = v; invalidate(); updateGeoInfo(); }
    });
    $('thick-chips').addEventListener('click', e => {
      if (!e.target.dataset.t) return;
      state.thickness = +e.target.dataset.t;
      $('thickness').value = state.thickness;
      invalidate(); updateGeoInfo();
    });
    $('duree').addEventListener('change', e => { state.duree = e.target.value; invalidate(); updateMatInfo(); });
    $('temp').addEventListener('change', e => { state.temp = e.target.value; invalidate(); updateMatInfo(); });
    $('selfweight').addEventListener('change', e => { state.selfWeight = e.target.checked; invalidate(); });

    // Appuis
    $('sup-width').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && v >= 0) { state.support.width = v; invalidate(); autoMesh(); draw(); }
    });
    $('sup-type').addEventListener('change', e => { state.support.type = e.target.value; invalidate(); });
    $('sup-holes').addEventListener('change', e => { state.support.holesSupported = e.target.checked; invalidate(); draw(); });

    // Outils de charge
    $('tools').addEventListener('click', e => { if (e.target.dataset.tool) setTool(e.target.dataset.tool); });
    $('load-clear').addEventListener('click', () => {
      state.loads = []; state.selected = null; invalidate(); renderLoads(); draw();
    });

    // Critères
    $('crit-defl').addEventListener('change', e => {
      state.criteria.deflectionRatio = +e.target.value; invalidate(); updateMatInfo();
    });
    $('crit-sf').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && v >= 1) { state.criteria.safetyFactor = v; invalidate(); updateMatInfo(); }
    });

    // Maillage
    $('mesh-auto').addEventListener('change', e => {
      state.meshAuto = e.target.checked; $('mesh-size').disabled = state.meshAuto; autoMesh();
    });
    $('mesh-size').disabled = true;
    $('mesh-size').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && v > 0) { state.meshSize = v; invalidate(); updateMeshInfo(); }
    });

    // Calcul, vues
    $('btn-run').addEventListener('click', run);
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
    $('field').addEventListener('change', e => { state.field = e.target.value; draw(); });
    $('amp').addEventListener('input', e => { state.ampSlider = Math.max(1, +e.target.value); draw(); });
    $('wire').addEventListener('change', e => { state.wire = e.target.checked; draw(); });
    $('undef').addEventListener('change', e => { state.undef = e.target.checked; draw(); });
    $('sup-show').addEventListener('change', e => { state.showSup = e.target.checked; draw(); });
    $('view-reset').addEventListener('click', () => {
      state.view3d = { yaw: -0.55, pitch: 1.0, zoom: 1, panX: 0, panY: 0 }; draw();
    });
    $('view-png').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = $('cv-def').toDataURL('image/png');
      a.download = 'deformee-plaque-pehd.png';
      a.click();
    });

    // Projet
    $('btn-save').addEventListener('click', saveProject);
    $('btn-load').addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json';
      inp.onchange = () => { if (inp.files[0]) loadFile(inp.files[0]); };
      inp.click();
    });
    $('btn-print').addEventListener('click', () => window.print());

    setupPlanEvents($('cv-plan'));
    setup3DEvents($('cv-def'));
    window.addEventListener('resize', draw);
    setTool('select');

    // Démarrage sur un exemple : plaque 1000 × 700 posée sur un cadre
    setGeometry(Imp.rectangle(1000, 700), null);
    state.source = 'exemple (rectangle 1000 × 700)';
    updateGeoInfo();
  }

  function geoParams(kind) {
    const el = $('geo-params');
    el.hidden = false;
    if (kind === 'rect') {
      el.innerHTML = `<label class="field" style="flex:1"><span>Longueur</span><input type="number" id="gp-a" value="1000"></label>
                      <label class="field" style="flex:1"><span>Largeur</span><input type="number" id="gp-b" value="700"></label>
                      <button class="ghost" id="gp-ok">Créer</button>`;
      $('gp-ok').onclick = () => {
        const a = parseFloat($('gp-a').value), b = parseFloat($('gp-b').value);
        if (a > 0 && b > 0) { setGeometry(Imp.rectangle(a, b), null); state.source = `rectangle ${a} × ${b}`; updateGeoInfo(); el.hidden = true; }
      };
    } else {
      el.innerHTML = `<label class="field" style="flex:1"><span>Diamètre</span><input type="number" id="gp-d" value="800"></label>
                      <button class="ghost" id="gp-ok">Créer</button>`;
      $('gp-ok').onclick = () => {
        const d = parseFloat($('gp-d').value);
        if (d > 0) { setGeometry(Imp.disc(d / 2), null); state.source = `disque Ø${d}`; updateGeoInfo(); el.hidden = true; }
      };
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.PP);
