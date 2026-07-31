/* Interface : import d'assemblage, choix du panneau, appuis par contact,
   édition des charges, lancement du calcul et affichage des résultats. */
(function (PP) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const G = PP.Geom, Mat = PP.Material, Imp = PP.Importers, R = PP.Render, So = PP.Solids;

  const state = {
    imported: null, fileName: null, source: null,
    panelIdx: 0, oneBody: false,
    frame: null, panel: null, others: [], region: null,
    thicknessField: null, thicknessMode: 'auto', thickness: 20,
    contacts: [], contactByIndex: new Map(), contactTol: 0.5,
    supportMode: 'contour', unilateral: true,
    support: { width: 30, type: 'simple', holesSupported: false },
    duree: '1j', temp: '23', selfWeight: true,
    loads: [], selected: null, tool: 'select',
    criteria: { deflectionRatio: 200, safetyFactor: 2 },
    meshSize: null, meshAuto: true,
    result: null, view: 'plan',
    view3d: { yaw: -0.55, pitch: 1.0, zoom: 1, panX: 0, panY: 0 },
    viewAsm: { yaw: -0.6, pitch: 0.45, zoom: 1, panX: 0, panY: 0 },
    ampSlider: 50, field: 'w', wire: false, undef: true, showSup: true,
    warnings: []
  };
  let planView = null;

  /* ==================== Import et reconstruction ==================== */
  function busy(on, txt) {
    $('busy').hidden = !on;
    if (txt) $('busy').textContent = txt;
  }

  async function loadFile(file) {
    $('geo-error').textContent = '';
    const lower = file.name.toLowerCase();
    busy(true, 'Lecture du fichier…');
    try {
      if (lower.endsWith('.json')) { loadProject(JSON.parse(await file.text())); busy(false); return; }
      const imp = lower.endsWith('.stl')
        ? Imp.importSTL(await file.arrayBuffer())
        : (lower.endsWith('.step') || lower.endsWith('.stp'))
          ? Imp.importSTEP(await file.text())
          : null;
      if (!imp) throw new Error('Format non reconnu : utilisez .stl, .step ou .stp.');
      applyImport(imp, file.name);
    } catch (e) {
      busy(false);
      $('geo-error').textContent = e.message || String(e);
      console.error(e);
    }
  }

  function applyImport(imp, fileName) {
    state.imported = imp;
    state.fileName = fileName || null;
    state.source = imp.source;
    state.warnings = (imp.warnings || []).slice();
    state.loads = [];
    state.selected = null;
    state.result = null;
    // Le panneau proposé par défaut est le corps le plus « plaque »
    let best = 0, bs = -1;
    imp.solids.forEach((s, i) => { const sc = So.plateScore(s); if (sc > bs) { bs = sc; best = i; } });
    state.panelIdx = best;
    state.oneBody = false;
    rebuild();
  }

  function mergedSolid(solids) {
    const tris = [], faces = [];
    for (const s of solids) {
      if (s.tris) tris.push(...s.tris);
      if (s.faces) faces.push(...s.faces);
    }
    const out = { name: 'Ensemble du fichier' };
    if (tris.length) out.tris = tris;
    if (faces.length) out.faces = faces;
    return out;
  }

  /* Reconstruit repère, empreinte, épaisseur et contacts après tout changement
     de géométrie ou de corps sélectionné. */
  function rebuild() {
    busy(true, 'Analyse de la géométrie…');
    setTimeout(() => {
      try {
        const imp = state.imported;
        const raw = state.oneBody ? mergedSolid(imp.solids) : imp.solids[state.panelIdx];
        const frame = So.frameFor(raw);
        const panel = So.prepare(raw, frame);
        const region0 = So.footprint(raw, frame);
        if (!region0) throw new Error(
          "Impossible d'extraire le contour de ce corps. Choisissez un autre corps, ou " +
          "vérifiez que le fichier contient bien un panneau.");

        const field = So.thicknessField(panel, region0, 180);
        const others = state.oneBody ? []
          : imp.solids.filter((_, i) => i !== state.panelIdx).map(s => So.prepare(s, frame));
        const raw2 = So.detectContacts(panel, others, region0, { tol: state.contactTol });

        // Repère utilisateur : origine au coin inférieur gauche de l'empreinte
        const bb = G.bbox(region0.outer);
        const dx = -bb.xmin, dy = -bb.ymin;
        const shift = (ring) => ring.map(p => [p[0] + dx, p[1] + dy]);
        state.region = { outer: shift(region0.outer), holes: region0.holes.map(shift) };
        field.u0 += dx; field.v0 += dy;
        state.thicknessField = field;

        state.contacts = [];
        state.contactByIndex = new Map();
        const otherIdx = state.oneBody ? [] : imp.solids.map((_, i) => i).filter(i => i !== state.panelIdx);
        raw2.forEach((c, k) => {
          c.u0 += dx; c.v0 += dy;
          if (!c.cells) return;
          const entry = { contact: c, enabled: true, type: 'simple', name: c.solid.name, solidIdx: otherIdx[k] };
          state.contacts.push(entry);
          state.contactByIndex.set(otherIdx[k], entry);
        });

        state.frame = frame;
        state.panel = panel;
        state.others = others;
        state.supportMode = state.contacts.length ? 'contacts' : 'contour';
        state.thicknessMode = field.max > 0 ? 'auto' : 'impose';
        if (field.max > 0 && !field.variable) state.thickness = Math.round(field.mean * 10) / 10;

        autoMesh();
        syncInputs();
        updateGeoInfo();
        renderSolidList();
        renderContacts();
        renderLoads();
        setView('plan');
      } catch (e) {
        $('geo-error').textContent = e.message || String(e);
        console.error(e);
      } finally {
        busy(false);
      }
    }, 20);
  }

  function recomputeContacts() {
    if (!state.panel || !state.others.length) return;
    busy(true, 'Recherche des contacts…');
    setTimeout(() => {
      const res = So.detectContacts(state.panel, state.others, state.region, { tol: state.contactTol });
      const prev = new Map(state.contacts.map(c => [c.name, c]));
      state.contacts = [];
      state.contactByIndex = new Map();
      const otherIdx = state.imported.solids.map((_, i) => i).filter(i => i !== state.panelIdx);
      res.forEach((c, k) => {
        if (!c.cells) return;
        const old = prev.get(c.solid.name);
        const entry = {
          contact: c, enabled: old ? old.enabled : true, type: old ? old.type : 'simple',
          name: c.solid.name, solidIdx: otherIdx[k]
        };
        state.contacts.push(entry);
        state.contactByIndex.set(otherIdx[k], entry);
      });
      invalidate(); renderContacts(); draw(); busy(false);
    }, 20);
  }

  /* ==================== Affichages du panneau gauche ==================== */
  function renderSolidList() {
    const imp = state.imported;
    const box = $('solid-block');
    if (!imp || imp.solids.length < 2) { box.hidden = true; return; }
    box.hidden = false;
    const ul = $('solid-list');
    ul.innerHTML = '';
    imp.solids.forEach((s, i) => {
      const fr = So.frameFor(s);
      const bb = So.bboxOf(s, fr);
      const d = [bb.umax - bb.umin, bb.vmax - bb.vmin, bb.hmax - bb.hmin].sort((a, b) => b - a);
      const c = state.contactByIndex.get(i);
      const li = document.createElement('li');
      if (i === state.panelIdx) li.className = 'on';
      li.innerHTML =
        `<label><input type="radio" name="solid" value="${i}" ${i === state.panelIdx ? 'checked' : ''}>
           <span><span class="nm">${escapeHtml(s.name)}</span><br>
           <span class="dim">${d[0].toFixed(0)} × ${d[1].toFixed(0)} × ${d[2].toFixed(1)} mm` +
        (i === state.panelIdx ? ' — panneau étudié' : (c ? ` — en contact (${(c.contact.area / 100).toFixed(0)} cm²)` : '')) +
        `</span></span></label>`;
      li.querySelector('input').addEventListener('change', () => {
        state.panelIdx = i; state.result = null; state.loads = []; rebuild();
      });
      ul.appendChild(li);
    });
  }

  function renderContacts() {
    const ul = $('contact-list');
    ul.innerHTML = '';
    if (!state.contacts.length) {
      ul.innerHTML = '<li class="hint" style="border:none;background:none;padding:0">' +
        (state.imported && state.imported.solids.length > 1
          ? "Aucune pièce ne touche le panneau avec le jeu de détection actuel. Augmentez-le, ou passez en appui sur le contour."
          : "Le fichier ne contient qu'un corps : utilisez l'appui sur le contour.") + '</li>';
      return;
    }
    state.contacts.forEach((c, i) => {
      const li = document.createElement('li');
      li.innerHTML =
        `<div class="hd">
           <input type="checkbox" data-i="${i}" data-k="enabled" ${c.enabled ? 'checked' : ''} style="width:auto">
           <span>${escapeHtml(c.name)}</span></div>
         <div class="grid" style="grid-template-columns:1fr">
           <select data-i="${i}" data-k="type">
             <option value="simple" ${c.type === 'simple' ? 'selected' : ''}>Appui simple (posé dessus)</option>
             <option value="encastre" ${c.type === 'encastre' ? 'selected' : ''}>Encastrement (vissé / bridé)</option>
           </select>
         </div>
         <div class="det" style="color:var(--muted);font-size:11px;margin-top:4px">
           contact ${c.contact.side} · ${(c.contact.area / 100).toFixed(0)} cm²</div>`;
      ul.appendChild(li);
    });
    ul.querySelectorAll('[data-k]').forEach(el => {
      el.addEventListener('change', () => {
        const c = state.contacts[+el.dataset.i];
        c[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
        invalidate(); draw();
      });
    });
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function updateGeoInfo() {
    const el = $('geo-info');
    if (!state.region) { el.innerHTML = ''; return; }
    const bb = G.bbox(state.region.outer);
    const A = G.regionArea(state.region);
    const tf = state.thicknessField;
    const tMean = state.thicknessMode === 'auto' && tf ? tf.mean : state.thickness;
    const mass = A * tMean * Mat.PEHD500.rho * 1000;
    const rows = [
      ['Source', state.fileName || state.source],
      ['Corps étudié', state.imported ? (state.oneBody ? 'ensemble du fichier'
        : state.imported.solids[state.panelIdx].name) : '—'],
      ['Encombrement', `${bb.w.toFixed(1)} × ${bb.h.toFixed(1)} mm`],
      ['Surface', `${(A / 1e6).toFixed(3)} m²`],
      ['Trous', String(state.region.holes.length)],
      ['Masse estimée', mass.toFixed(1) + ' kg']
    ];
    el.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
    updateThicknessInfo();
    renderWarnings();
  }

  function renderWarnings() {
    const w = state.warnings;
    $('geo-warn').innerHTML = w.length
      ? '<ul class="warn-list" style="margin-top:6px">' + w.map(x => `<li>${escapeHtml(x)}</li>`).join('') + '</ul>'
      : '';
  }

  function updateThicknessInfo() {
    const tf = state.thicknessField;
    const el = $('thick-measured');
    $('thick-impose').hidden = state.thicknessMode !== 'auto' ? false : true;
    el.hidden = state.thicknessMode !== 'auto';
    if (!tf || state.thicknessMode !== 'auto') { el.innerHTML = ''; return; }
    if (tf.variable) {
      el.innerHTML = `Épaisseur <b>variable</b> mesurée sur le modèle : de <b>${tf.min.toFixed(1)}</b> ` +
        `à <b>${tf.max.toFixed(1)} mm</b> (moyenne ${tf.mean.toFixed(1)} mm). ` +
        `Chaque élément du maillage reçoit son épaisseur locale : les zones fraisées sont ` +
        `bien prises en compte comme plus souples. Champ visible dans l'onglet Déformée 3D.`;
    } else {
      el.innerHTML = `Épaisseur <b>constante</b> mesurée sur le modèle : <b>${tf.mean.toFixed(1)} mm</b>.`;
    }
  }

  /* ==================== Maillage ==================== */
  function autoMesh() {
    if (!state.region) return;
    const A = G.regionArea(state.region);
    const bb = G.bbox(state.region.outer);
    const diag = Math.hypot(bb.w, bb.h);
    let h = Math.sqrt(A / (1400 * 0.43));
    // Une épaisseur variable demande un maillage plus fin pour bien placer les marches
    if (state.thicknessMode === 'auto' && state.thicknessField && state.thicknessField.variable) h *= 0.72;
    h = Math.max(diag / 160, Math.min(diag / 14, h));
    for (const l of state.loads) {
      if (l.type !== 'zone') continue;
      const d = l.shape === 'circle' ? 2 * l.r : Math.min(l.w, l.h);
      h = Math.min(h, d / 2.5);
    }
    if (state.supportMode === 'contour' && state.support.width > 0)
      h = Math.min(h, Math.max(state.support.width, diag / 160));
    if (state.supportMode === 'contacts' && state.contacts.length) {
      // assez fin pour décrire la largeur des zones portantes
      let wmin = Infinity;
      for (const c of state.contacts) {
        if (!c.enabled) continue;
        const s = Math.sqrt(c.contact.area);
        if (s < wmin) wmin = s;
      }
      if (isFinite(wmin)) h = Math.min(h, Math.max(wmin / 2.5, diag / 200));
    }
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
      ? { type: 'zone', shape: 'circle', x, y, r: d * 0.12, force: 1000, unit: 'N' }
      : { type: 'zone', shape: 'rect', x, y, w: d * 0.25, h: d * 0.25, angle: 0, force: 1000, unit: 'N' };
  }

  const round = (v) => Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;

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

  function renderLoads() {
    const ul = $('load-list');
    ul.innerHTML = '';
    state.loads.forEach((l, i) => {
      const li = document.createElement('li');
      if (l === state.selected) li.className = 'sel';
      const title = l.type === 'point' ? 'Force ponctuelle'
        : (l.shape === 'circle' ? 'Zone ronde' : 'Zone rectangulaire');
      const unit = l.unit || 'N';
      const units = l.type === 'point' ? ['N', 'kg'] : ['N', 'kg', 'kPa'];
      const fields = [['x', 'X', l.x], ['y', 'Y', l.y]];
      if (l.type === 'zone' && l.shape === 'circle') fields.push(['r', 'R', l.r]);
      if (l.type === 'zone' && l.shape === 'rect') fields.push(['w', 'L', l.w], ['h', 'l', l.h], ['angle', '° ', l.angle || 0]);
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
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
        state.selected = l; renderLoads(); draw();
      });
      ul.appendChild(li);
    });
    ul.querySelectorAll('input[data-k]').forEach(inp => {
      inp.addEventListener('input', () => {
        const l = state.loads[+inp.dataset.i];
        const v = parseFloat(inp.value);
        if (!isFinite(v)) return;
        if (inp.dataset.k === '__force') l.force = fromUnit(l, l.unit || 'N', v);
        else l[inp.dataset.k] = v;
        invalidate(); draw(); updateTotals();
        const d = inp.closest('li').querySelector('.det');
        if (d) d.textContent = loadSummary(l);
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
        const l = { type: 'point', x: round(x), y: round(y), force: 1000, unit: 'N' };
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
        if (l.shape === 'circle') l.r = Math.max(1, round(Math.hypot(x - drag.x0, y - drag.y0)));
        else {
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
  function setup3DEvents(cv, getView) {
    let last = null, btn = 0;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      last = [e.clientX, e.clientY]; btn = e.button;
    });
    cv.addEventListener('pointermove', (e) => {
      if (!last) return;
      const v = getView();
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      if (btn === 2 || e.shiftKey) { v.panX += dx; v.panY += dy; }
      else {
        v.yaw += dx * 0.008;
        v.pitch = Math.max(0.02, Math.min(Math.PI / 2, v.pitch - dy * 0.008));
      }
      draw();
    });
    cv.addEventListener('pointerup', () => { last = null; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const v = getView();
      v.zoom = Math.max(0.2, Math.min(12, v.zoom * Math.exp(-e.deltaY * 0.0012)));
      draw();
    }, { passive: false });
  }

  /* ==================== Dessin ==================== */
  function draw() {
    if (state.view === 'plan') {
      if (!state.region) return;
      planView = R.makeView($('cv-plan'), state.region);
      R.drawPlan($('cv-plan'), state, planView);
    } else if (state.view === 'asm') {
      R.drawAssembly($('cv-asm'), state, state.viewAsm);
    } else if (state.result) {
      const amp = autoAmp() * (state.ampSlider / 50);
      $('amp-val').textContent = '× ' + (amp < 10 ? amp.toFixed(1) : Math.round(amp));
      R.drawDeformed($('cv-def'), state.result, state.view3d, {
        amp: state.field === 'ep' ? amp : amp, field: state.field, wireframe: state.wire,
        showUndeformed: state.undef, showSupports: state.showSup, region: state.region
      });
    }
  }

  function autoAmp() {
    if (!state.result) return 1;
    const bb = G.bbox(state.region.outer);
    const target = Math.max(bb.w, bb.h) * 0.12;
    return Math.max(0.2, Math.min(5000, target / (Math.abs(state.result.wmax) || 1e-6)));
  }

  function setView(v) {
    state.view = v;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.view === v));
    $('cv-plan').hidden = v !== 'plan';
    $('cv-asm').hidden = v !== 'asm';
    $('cv-def').hidden = v !== 'def';
    $('viewbar-plan').hidden = v !== 'plan';
    $('viewbar-asm').hidden = v !== 'asm';
    $('viewbar-def').hidden = v !== 'def';
    draw();
  }

  function invalidate() { state.result = null; }

  /* ==================== Calcul ==================== */
  function run() {
    if (!state.region) { $('geo-error').textContent = "Importez d'abord une géométrie."; return; }
    busy(true, 'Calcul en cours…');
    setTimeout(() => {
      try {
        const mat = Mat.properties(state.duree, state.temp);
        const useField = state.thicknessMode === 'auto' && state.thicknessField && state.thicknessField.max > 0;
        const res = PP.Model.run({
          region: state.region,
          thickness: state.thickness,
          thicknessField: useField ? state.thicknessField : null,
          meshSize: state.meshSize,
          support: {
            mode: state.supportMode,
            contacts: state.contacts,
            width: state.support.width, type: state.support.type,
            holesSupported: state.support.holesSupported
          },
          loads: state.loads,
          material: { E: mat.E, nu: mat.nu, rho: mat.rho, sigmaY: mat.sigmaY },
          selfWeight: state.selfWeight,
          unilateral: state.unilateral,
          criteria: state.criteria
        });
        res.mat = mat;
        state.result = res;
        showResults(res, mat);
        setView('def');
      } catch (e) {
        $('geo-error').textContent = 'Erreur de calcul : ' + (e.message || e);
        console.error(e);
      } finally { busy(false); }
    }, 30);
  }

  const fmtCoef = (c) => isFinite(c) ? c.toFixed(2) : '∞';

  function showResults(res, mat) {
    const v = $('verdict');
    const cls = res.verdict === 'OK' ? 'ok' : (res.verdict === 'LIMITE' ? 'limite' : 'bad');
    v.className = 'verdict ' + cls;
    const msg = res.verdict === 'OK' ? 'Panneau conforme aux deux critères'
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
    const mass = A * res.tMean * Mat.PEHD500.rho * 1000;
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
      ['Contact unilatéral', res.released > 0
        ? `${res.released} nœud(s) décollés (${res.iterations} itérations)` : 'aucun décollement'],
      ['Temps de résolution', res.solveMs + ' ms']
    ];
    $('res-kv').innerHTML = kv.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('');

    const supTxt = state.supportMode === 'contacts'
      ? `${state.contacts.filter(c => c.enabled).length} pièce(s) en contact` +
        ` (${state.contacts.filter(c => c.enabled && c.type === 'encastre').length} encastrée(s))`
      : (state.support.type === 'simple' ? 'Appui simple' : 'Encastrement') + ' sur ' + state.support.width + ' mm de contour';
    const hyp = [
      ['Matériau', Mat.PEHD500.nom],
      ['Épaisseur', res.variableThickness
        ? `variable, ${res.tMin.toFixed(1)} à ${res.tMax.toFixed(1)} mm (moy. ${res.tMean.toFixed(1)})`
        : res.tMean.toFixed(1) + ' mm'],
      ['Origine de l\'épaisseur', state.thicknessMode === 'auto' ? 'mesurée sur le modèle' : 'imposée'],
      ['Module E retenu', mat.E.toFixed(0) + ' MPa'],
      ['Coef. de Poisson', mat.nu.toFixed(2)],
      ['Durée de charge', mat.dureeLabel + ' (k=' + mat.kFluage.toFixed(2) + ')'],
      ['Température', mat.tempLabel],
      ['Seuil d\'écoulement', mat.sigmaY.toFixed(1) + ' MPa'],
      ['Appuis', supTxt + (state.unilateral ? ', contact unilatéral' : ', liaison bilatérale')],
      ['Poids propre', state.selfWeight ? 'inclus (' + mass.toFixed(1) + ' kg)' : 'non inclus'],
      ['Théorie', 'Plaque mince de Kirchhoff, petits déplacements, élasticité linéaire']
    ];
    $('hyp-kv').innerHTML = hyp.map(([k, val]) => `<dt>${k}</dt><dd>${escapeHtml(val)}</dd>`).join('');

    const all = res.warnings.concat(state.warnings);
    $('warnings').innerHTML = all.length
      ? '<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 6px">Points de vigilance</h3><ul class="warn-list">'
        + all.map(w => `<li>${escapeHtml(w)}</li>`).join('') + '</ul>'
      : '';
  }

  /* ==================== Projet ==================== */
  const b64 = {
    enc: (arr) => { let s = ''; for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]); return btoa(s); },
    dec: (str) => { const s = atob(str); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  };

  function saveProject() {
    if (!state.region) return;
    const tf = state.thicknessField;
    const data = {
      format: 'plaque-pehd-v2',
      fileName: state.fileName, source: state.source,
      region: state.region,
      thicknessMode: state.thicknessMode, thickness: state.thickness,
      thicknessField: tf ? {
        u0: tf.u0, v0: tf.v0, cs: tf.cs, nu: tf.nu, nv: tf.nv,
        val: Array.from(tf.val).map(x => Math.round(x * 100) / 100),
        min: tf.min, max: tf.max, mean: tf.mean, variable: tf.variable
      } : null,
      supportMode: state.supportMode, support: state.support, contactTol: state.contactTol,
      contacts: state.contacts.map(c => ({
        name: c.name, enabled: c.enabled, type: c.type,
        mask: b64.enc(c.contact.mask), side: c.contact.side, area: c.contact.area,
        u0: c.contact.u0, v0: c.contact.v0, cs: c.contact.cs, nu: c.contact.nu, nv: c.contact.nv
      })),
      duree: state.duree, temp: state.temp, selfWeight: state.selfWeight, unilateral: state.unilateral,
      loads: state.loads, criteria: state.criteria,
      meshSize: state.meshSize, meshAuto: state.meshAuto, warnings: state.warnings
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (state.fileName || 'panneau-pehd').replace(/\.[^.]+$/, '') + '.plaque.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadProject(d) {
    if (!d || (d.format !== 'plaque-pehd-v2' && d.format !== 'plaque-pehd-v1'))
      throw new Error('Fichier projet non reconnu.');
    state.imported = null; state.frame = null; state.panel = null; state.others = [];
    state.fileName = d.fileName; state.source = d.source || 'projet enregistré';
    state.region = d.region;
    state.thicknessMode = d.thicknessMode || 'impose';
    state.thickness = d.thickness || 20;
    state.thicknessField = d.thicknessField
      ? So.makeField(Object.assign({}, d.thicknessField, { val: Float32Array.from(d.thicknessField.val) }))
      : null;
    state.supportMode = d.supportMode || 'contour';
    state.support = d.support || state.support;
    state.contactTol = d.contactTol !== undefined ? d.contactTol : 0.5;
    state.contacts = (d.contacts || []).map(c => ({
      name: c.name, enabled: c.enabled, type: c.type,
      contact: {
        mask: b64.dec(c.mask), side: c.side, area: c.area, cells: 1,
        u0: c.u0, v0: c.v0, cs: c.cs, nu: c.nu, nv: c.nv
      }
    }));
    state.contactByIndex = new Map();
    state.duree = d.duree; state.temp = d.temp; state.selfWeight = d.selfWeight;
    state.unilateral = d.unilateral !== false;
    state.loads = d.loads || []; state.criteria = d.criteria;
    state.meshSize = d.meshSize; state.meshAuto = d.meshAuto;
    state.warnings = d.warnings || [];
    state.result = null; state.selected = null;
    syncInputs(); updateGeoInfo(); renderSolidList(); renderContacts(); renderLoads();
    updateMeshInfo(); setView('plan');
  }

  function syncInputs() {
    $('thick-mode').value = state.thicknessMode;
    $('thickness').value = state.thickness;
    $('duree').value = state.duree;
    $('temp').value = state.temp;
    $('selfweight').checked = state.selfWeight;
    $('sup-mode').value = state.supportMode;
    $('sup-contacts').hidden = state.supportMode !== 'contacts';
    $('sup-contour').hidden = state.supportMode === 'contacts';
    $('contact-tol').value = state.contactTol;
    $('sup-uni').checked = state.unilateral;
    $('sup-width').value = state.support.width;
    $('sup-type').value = state.support.type;
    $('sup-holes').checked = state.support.holesSupported;
    $('crit-defl').value = state.criteria.deflectionRatio;
    $('crit-sf').value = state.criteria.safetyFactor;
    $('mesh-size').value = state.meshSize || '';
    $('mesh-auto').checked = state.meshAuto;
    $('one-body').checked = state.oneBody;
    $('field').querySelector('option[value=ep]').hidden =
      !(state.thicknessMode === 'auto' && state.thicknessField && state.thicknessField.variable);
    updateMatInfo();
    updateThicknessInfo();
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
    $('duree').innerHTML = Mat.DUREES.map(d => `<option value="${d.id}">${d.label}</option>`).join('');
    $('temp').innerHTML = Mat.TEMPERATURES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
    $('thick-chips').innerHTML = [5, 8, 10, 12, 15, 20, 25, 30, 40, 50]
      .map(t => `<button class="chip" data-t="${t}">${t}</button>`).join('');

    const drop = $('drop'), file = $('file');
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { if (file.files[0]) loadFile(file.files[0]); file.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());

    $('geo-rect').addEventListener('click', () => geoParams('rect'));
    $('geo-disc').addEventListener('click', () => geoParams('disc'));
    $('one-body').addEventListener('change', e => {
      state.oneBody = e.target.checked; state.result = null; rebuild();
    });

    $('thick-mode').addEventListener('change', e => {
      state.thicknessMode = e.target.value; invalidate(); syncInputs(); updateGeoInfo();
    });
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

    $('sup-mode').addEventListener('change', e => {
      state.supportMode = e.target.value; invalidate(); syncInputs(); autoMesh(); draw();
    });
    $('contact-tol').addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && v >= 0) { state.contactTol = v; recomputeContacts(); }
    });
    $('sup-width').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && v >= 0) { state.support.width = v; invalidate(); autoMesh(); draw(); }
    });
    $('sup-uni').addEventListener('change', e => { state.unilateral = e.target.checked; invalidate(); });
    $('sup-type').addEventListener('change', e => { state.support.type = e.target.value; invalidate(); });
    $('sup-holes').addEventListener('change', e => { state.support.holesSupported = e.target.checked; invalidate(); draw(); });

    $('tools').addEventListener('click', e => { if (e.target.dataset.tool) setTool(e.target.dataset.tool); });
    $('load-clear').addEventListener('click', () => {
      state.loads = []; state.selected = null; invalidate(); renderLoads(); draw();
    });

    $('crit-defl').addEventListener('change', e => {
      state.criteria.deflectionRatio = +e.target.value; invalidate(); updateMatInfo();
    });
    $('crit-sf').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && v >= 1) { state.criteria.safetyFactor = v; invalidate(); updateMatInfo(); }
    });

    $('mesh-auto').addEventListener('change', e => {
      state.meshAuto = e.target.checked; $('mesh-size').disabled = state.meshAuto; autoMesh();
    });
    $('mesh-size').disabled = true;
    $('mesh-size').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      if (isFinite(v) && v > 0) { state.meshSize = v; invalidate(); updateMeshInfo(); }
    });

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
    $('asm-reset').addEventListener('click', () => {
      state.viewAsm = { yaw: -0.6, pitch: 0.45, zoom: 1, panX: 0, panY: 0 }; draw();
    });
    $('view-png').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = (state.view === 'asm' ? $('cv-asm') : $('cv-def')).toDataURL('image/png');
      a.download = 'panneau-pehd.png';
      a.click();
    });

    $('btn-save').addEventListener('click', saveProject);
    $('btn-load').addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json';
      inp.onchange = () => { if (inp.files[0]) loadFile(inp.files[0]); };
      inp.click();
    });
    $('btn-print').addEventListener('click', () => window.print());

    setupPlanEvents($('cv-plan'));
    setup3DEvents($('cv-def'), () => state.view3d);
    setup3DEvents($('cv-asm'), () => state.viewAsm);
    window.addEventListener('resize', draw);
    setTool('select');

    applyImport(Imp.rectangle(1000, 700, 20), null);
    state.source = 'exemple (rectangle 1000 × 700, ép. 20)';
  }

  function geoParams(kind) {
    const el = $('geo-params');
    el.hidden = false;
    if (kind === 'rect') {
      el.innerHTML = `<label class="field" style="flex:1"><span>Long.</span><input type="number" id="gp-a" value="1000"></label>
                      <label class="field" style="flex:1"><span>Larg.</span><input type="number" id="gp-b" value="700"></label>
                      <label class="field" style="flex:1"><span>Ép.</span><input type="number" id="gp-t" value="20"></label>
                      <button class="ghost" id="gp-ok">Créer</button>`;
      $('gp-ok').onclick = () => {
        const a = parseFloat($('gp-a').value), b = parseFloat($('gp-b').value), t = parseFloat($('gp-t').value);
        if (a > 0 && b > 0 && t > 0) {
          applyImport(Imp.rectangle(a, b, t), null);
          state.source = `rectangle ${a} × ${b} × ${t}`;
          updateGeoInfo(); el.hidden = true;
        }
      };
    } else {
      el.innerHTML = `<label class="field" style="flex:1"><span>Diam.</span><input type="number" id="gp-d" value="800"></label>
                      <label class="field" style="flex:1"><span>Ép.</span><input type="number" id="gp-t" value="20"></label>
                      <button class="ghost" id="gp-ok">Créer</button>`;
      $('gp-ok').onclick = () => {
        const d = parseFloat($('gp-d').value), t = parseFloat($('gp-t').value);
        if (d > 0 && t > 0) {
          applyImport(Imp.disc(d / 2, t), null);
          state.source = `disque Ø${d} × ${t}`;
          updateGeoInfo(); el.hidden = true;
        }
      };
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.PP);
