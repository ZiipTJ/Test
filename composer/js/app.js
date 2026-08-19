/* Assemblage de l'interface : import, arborescence des acteurs, navigation,
   manipulateur, lignes de position neutre. */
(function (root) {
  'use strict';
  const { M, V, Q } = root.M3D;

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const fmt = (v) => (Math.abs(v) < 1e-9 ? 0 : v).toFixed(1);
  const hex = (c) => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
  const unhex = (s) => [1, 3, 5].map(i => parseInt(s.substr(i, 2), 16) / 255);

  document.addEventListener('DOMContentLoaded', () => {
    const canvas = $('#vue');
    let view, scene, gizmo;
    try {
      view = root.View.createView(canvas);
      scene = root.Scene.createScene(view);
      gizmo = root.Gizmo.createGizmo(view, scene);
    } catch (e) {
      $('#etat').textContent = e.message;
      return;
    }

    /* Point d'entrée pour les tests automatisés et le débogage en console. */
    root.debug = { view, scene, gizmo };

    let dirty = true;
    const redraw = () => { dirty = true; };
    const undoStack = [];

    function snapshot() {
      undoStack.push(scene.actors.map(a => ({ id: a.id, offset: a.offset.slice(), quat: a.quat.slice(), visible: a.visible })));
      if (undoStack.length > 40) undoStack.shift();
    }
    function undo() {
      const s = undoStack.pop();
      if (!s) return;
      for (const rec of s) {
        const a = scene.actors.find(x => x.id === rec.id);
        if (!a) continue;
        a.offset = rec.offset; a.quat = rec.quat; a.visible = rec.visible;
      }
      refresh();
    }

    /* ================= Rendu ================= */
    function draw() {
      view.begin();
      if (scene.settings.showGrid && scene.gridBuf) view.drawLines(scene.gridBuf, M.identity(), [0.78, 0.80, 0.84], 0.55);
      /* Fantômes de position neutre, en transparence. */
      if (scene.settings.showNeutralGhosts) {
        for (const a of scene.actors) {
          if (!a.visible || !scene.moved(a)) continue;
          view.drawMesh(a.pos, a.nor, M.identity(), [0.62, 0.66, 0.72], 0.18);
        }
      }
      for (const a of scene.actors) {
        if (!a.visible) continue;
        const m = scene.matrix(a);
        const sel = scene.isSelected(a);
        const col = sel ? a.color.map((c, i) => Math.min(1, c * 0.55 + [0.45, 0.32, 0.10][i])) : a.color;
        view.drawMesh(a.pos, a.nor, m, col, 1);
        if (scene.settings.showEdges) view.drawLines(a.edge, m, sel ? [0.55, 0.32, 0.02] : [0.18, 0.20, 0.24], 0.85);
      }
      scene.buildLines();
      view.drawLines(scene.lineBuf, M.identity(), scene.settings.lineColor, 1, true);
      gizmo.update();
      gizmo.draw();
    }
    (function loop() {
      if (dirty) { dirty = false; draw(); }
      requestAnimationFrame(loop);
    })();
    window.addEventListener('resize', redraw);

    /* ================= Import ================= */
    async function loadFiles(files) {
      const warn = [];
      let loaded = 0;
      for (const f of files) {
        status(`Lecture de ${f.name}…`);
        try {
          const res = await root.Import.load(f);
          for (const act of res.actors) {
            if (!act.tris || act.tris.length < 9) continue;
            scene.addActor(act.name, root.Mesh.build(act.tris));
            loaded++;
          }
          warn.push(...(res.warnings || []));
        } catch (e) {
          warn.push(`${f.name} : ${e.message}`);
        }
      }
      if (loaded) {
        view.frame(scene.bbox(false));
        scene.buildGrid();
      }
      refresh();
      const n = scene.actors.reduce((s, a) => s + a.mesh.nTri, 0);
      status(loaded
        ? `${scene.actors.length} acteur(s), ${n.toLocaleString('fr-FR')} triangles.`
        : 'Aucun corps chargé.');
      showWarnings(warn);
    }

    function showWarnings(list) {
      const box = $('#avertissements');
      box.innerHTML = '';
      if (!list.length) { box.hidden = true; return; }
      box.hidden = false;
      for (const w of list) box.appendChild(el('p', null, w));
    }
    const status = (t) => { $('#etat').textContent = t; };

    $('#fichier').addEventListener('change', (e) => { loadFiles([...e.target.files]); e.target.value = ''; });
    $('#btn-ouvrir').addEventListener('click', () => $('#fichier').click());
    ['dragenter', 'dragover'].forEach(t => canvas.addEventListener(t, (e) => { e.preventDefault(); canvas.classList.add('survol'); }));
    ['dragleave', 'drop'].forEach(t => canvas.addEventListener(t, () => canvas.classList.remove('survol')));
    canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files.length) loadFiles([...e.dataTransfer.files]);
    });

    /* ================= Arborescence ================= */
    function refresh() {
      const list = $('#arbre');
      list.innerHTML = '';
      for (const a of scene.actors) {
        const row = el('div', 'acteur' + (scene.isSelected(a) ? ' sel' : ''));
        const eye = el('button', 'oeil', a.visible ? '◉' : '○');
        eye.title = a.visible ? 'Masquer' : 'Afficher';
        eye.addEventListener('click', (e) => { e.stopPropagation(); snapshot(); a.visible = !a.visible; refresh(); });
        const swatch = el('span', 'pastille');
        swatch.style.background = hex(a.color);
        const name = el('span', 'nom', a.name);
        name.title = a.name;
        const badge = el('span', 'badge', scene.moved(a) ? 'déplacé' : '');
        row.append(eye, swatch, name, badge);
        row.addEventListener('click', (e) => { scene.select(a, e.ctrlKey || e.metaKey || e.shiftKey); refresh(); });
        row.addEventListener('dblclick', () => {
          const b = a.mesh.bbox, m = scene.matrix(a);
          const pts = [];
          for (let i = 0; i < 8; i++) pts.push(M.apply(m, [i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]));
          const bb = { min: [0, 1, 2].map(k => Math.min(...pts.map(p => p[k]))), max: [0, 1, 2].map(k => Math.max(...pts.map(p => p[k]))) };
          view.frame(bb, 1.8);
          redraw();
        });
        list.appendChild(row);
      }
      $('#compte').textContent = scene.actors.length ? `${scene.actors.length} acteurs` : '';
      refreshProps();
      redraw();
    }

    /* ================= Propriétés de la sélection ================= */
    function refreshProps() {
      const sel = scene.selected();
      $('#props').hidden = sel.length === 0;
      $('#aide-selection').hidden = sel.length !== 0;
      if (!sel.length) return;
      $('#props-titre').textContent = sel.length === 1 ? sel[0].name : `${sel.length} acteurs sélectionnés`;
      const a = sel[0];
      const e = Q.toEulerDeg(a.quat);
      ['x', 'y', 'z'].forEach((k, i) => {
        const t = $('#t' + k), r = $('#r' + k);
        if (document.activeElement !== t) t.value = fmt(a.offset[i]);
        if (document.activeElement !== r) r.value = fmt(e[i]);
      });
      $('#couleur').value = hex(a.color);
      $('#ligne-acteur').checked = sel.every(s => s.showLine);
    }

    ['x', 'y', 'z'].forEach((k, i) => {
      $('#t' + k).addEventListener('change', () => {
        const sel = scene.selected();
        if (!sel.length) return;
        snapshot();
        const v = parseFloat($('#t' + k).value) || 0;
        for (const a of sel) a.offset[i] = v;
        refresh();
      });
      $('#r' + k).addEventListener('change', () => {
        const sel = scene.selected();
        if (!sel.length) return;
        snapshot();
        const e = [0, 1, 2].map(j => parseFloat($('#r' + 'xyz'[j]).value) || 0);
        for (const a of sel) a.quat = Q.fromEulerDeg(e);
        refresh();
      });
    });
    $('#couleur').addEventListener('input', () => {
      const c = unhex($('#couleur').value);
      for (const a of scene.selected()) a.color = c.slice();
      refresh();
    });
    $('#ligne-acteur').addEventListener('change', () => {
      const on = $('#ligne-acteur').checked;
      for (const a of scene.selected()) a.showLine = on;
      redraw();
    });
    $('#btn-neutre').addEventListener('click', () => {
      const sel = scene.selected();
      if (!sel.length) return;
      snapshot();
      for (const a of sel) scene.resetActor(a);
      refresh();
    });
    $('#btn-masquer').addEventListener('click', () => {
      snapshot();
      for (const a of scene.selected()) a.visible = false;
      refresh();
    });
    $('#btn-isoler').addEventListener('click', () => {
      const sel = scene.selected();
      if (!sel.length) return;
      snapshot();
      for (const a of scene.actors) a.visible = sel.indexOf(a) >= 0;
      refresh();
    });
    $('#btn-tout-afficher').addEventListener('click', () => {
      snapshot();
      for (const a of scene.actors) a.visible = true;
      refresh();
    });
    $('#btn-tout-neutre').addEventListener('click', () => {
      snapshot();
      for (const a of scene.actors) scene.resetActor(a);
      $('#eclate').value = 0;
      refresh();
    });

    /* ================= Réglages des lignes ================= */
    const bind = (sel, key, kind) => {
      const e = $(sel);
      const set = () => {
        scene.settings[key] = kind === 'bool' ? e.checked : kind === 'num' ? parseFloat(e.value) : e.value;
        if (key === 'showGrid' && e.checked) scene.buildGrid();
        redraw();
      };
      e.addEventListener('change', set);
      if (kind === 'num') e.addEventListener('input', set);
    };
    bind('#opt-lignes', 'showNeutralLines', 'bool');
    bind('#opt-fantomes', 'showNeutralGhosts', 'bool');
    bind('#opt-aretes', 'showEdges', 'bool');
    bind('#opt-grille', 'showGrid', 'bool');
    bind('#opt-style', 'lineStyle', 'str');
    bind('#opt-tiret', 'dashLength', 'num');
    $('#opt-couleur-ligne').addEventListener('input', () => {
      scene.settings.lineColor = unhex($('#opt-couleur-ligne').value);
      redraw();
    });

    $('#eclate').addEventListener('input', () => {
      const f = parseFloat($('#eclate').value) / 100;
      scene.explode(f, null);
      $('#eclate-val').textContent = Math.round(f * 100) + ' %';
      refresh();
    });
    $('#eclate').addEventListener('pointerdown', snapshot);

    /* ================= Vues normalisées ================= */
    const setView = (yaw, pitch) => {
      view.cam.yaw = yaw; view.cam.pitch = pitch;
      redraw();
    };
    $('#v-iso').addEventListener('click', () => setView(-0.9, 0.55));
    $('#v-face').addEventListener('click', () => setView(-Math.PI / 2, 0));
    $('#v-droite').addEventListener('click', () => setView(0, 0));
    $('#v-dessus').addEventListener('click', () => setView(-Math.PI / 2, Math.PI / 2 - 1e-3));
    $('#v-ajuster').addEventListener('click', () => { view.frame(scene.bbox(true)); redraw(); });
    $('#v-projection').addEventListener('click', (e) => {
      view.cam.ortho = !view.cam.ortho;
      e.target.textContent = view.cam.ortho ? 'Orthographique' : 'Perspective';
      redraw();
    });

    /* ================= Modes ================= */
    function setMode(m) {
      gizmo.mode = m === 'rotate' ? 'rotate' : 'translate';
      $('#m-select').classList.toggle('actif', m === 'select');
      $('#m-move').classList.toggle('actif', m === 'translate');
      $('#m-rot').classList.toggle('actif', m === 'rotate');
      mode = m;
      redraw();
    }
    let mode = 'translate';
    $('#m-select').addEventListener('click', () => setMode('select'));
    $('#m-move').addEventListener('click', () => setMode('translate'));
    $('#m-rot').addEventListener('click', () => setMode('rotate'));
    setMode('translate');

    /* ================= Souris ================= */
    let nav = null;
    const local = (e) => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    canvas.addEventListener('pointerdown', (e) => {
      const [px, py] = local(e);
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 0 && mode !== 'select') {
        const h = gizmo.hitTest(px, py);
        if (h) {
          snapshot();
          if (gizmo.begin(h, px, py)) { redraw(); return; }
        }
      }
      if (e.button === 0 && !e.altKey) {
        nav = { type: 'pick', x: px, y: py, sx: px, sy: py, add: e.ctrlKey || e.metaKey || e.shiftKey };
        return;
      }
      nav = { type: (e.button === 1 || e.altKey || e.shiftKey) ? 'pan' : 'orbit', x: px, y: py };
    });

    canvas.addEventListener('pointermove', (e) => {
      const [px, py] = local(e);
      if (gizmo.drag) {
        const r = gizmo.move(px, py, e.shiftKey ? snapStep() : 0, e.shiftKey ? 15 : 0);
        if (r) {
          status(r.type === 'rotation'
            ? `Rotation autour de ${r.axis.toUpperCase()} : ${r.value.toFixed(1)}°`
            : `Déplacement : ${r.value.map(fmt).join(' / ')} mm`);
          refreshProps();
          redraw();
        }
        return;
      }
      if (nav) {
        const dx = px - nav.x, dy = py - nav.y;
        if (nav.type === 'pick' && Math.hypot(px - nav.sx, py - nav.sy) > 4) nav.type = 'orbit';
        if (nav.type === 'orbit') {
          view.cam.yaw -= dx * 0.008;
          view.cam.pitch = Math.max(-1.55, Math.min(1.55, view.cam.pitch + dy * 0.008));
          redraw();
        } else if (nav.type === 'pan') {
          const s = view.pixelSize(view.cam.target);
          const eye = view.eye();
          const fwd = V.unit(V.sub(view.cam.target, eye));
          const right = V.unit(V.cross(fwd, [0, 0, 1]));
          const up = V.cross(right, fwd);
          view.cam.target = V.add(view.cam.target, V.add(V.mul(right, -dx * s), V.mul(up, dy * s)));
          redraw();
        }
        nav.x = px; nav.y = py;
        return;
      }
      const h = gizmo.hitTest(px, py);
      const id = h ? h.id : null;
      if (id !== gizmo.hot) { gizmo.hot = id; redraw(); }
    });

    canvas.addEventListener('pointerup', (e) => {
      const [px, py] = local(e);
      if (gizmo.drag) { gizmo.end(); refresh(); }
      else if (nav && nav.type === 'pick') {
        const hit = scene.pick(px, py);
        scene.select(hit ? hit.actor : null, nav.add);
        refresh();
      }
      nav = null;
      canvas.releasePointerCapture(e.pointerId);
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      view.cam.dist *= Math.exp(Math.sign(e.deltaY) * 0.12);
      view.cam.dist = Math.max(1e-3, view.cam.dist);
      redraw();
    }, { passive: false });

    const snapStep = () => scene.gridStep ? scene.gridStep / 10 : 1;

    /* ================= Clavier ================= */
    window.addEventListener('keydown', (e) => {
      if (/input|select|textarea/i.test((e.target.tagName || ''))) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') { if (gizmo.drag) { gizmo.cancel(); refresh(); } else { scene.select(null); refresh(); } }
      else if (k === 'g') setMode('translate');
      else if (k === 'r') setMode('rotate');
      else if (k === 'q') setMode('select');
      else if (k === 'f') { view.frame(scene.bbox(true)); redraw(); }
      else if (k === 'h') { snapshot(); for (const a of scene.selected()) a.visible = false; refresh(); }
      else if (k === 'n') { snapshot(); for (const a of scene.selected()) scene.resetActor(a); refresh(); }
      else if (k === 'a' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        scene.selection = scene.actors.filter(a => a.visible).map(a => a.id);
        refresh();
      } else if (k === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); undo(); }
    });

    /* ================= Vue enregistrée ================= */
    $('#btn-enregistrer').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(scene.toJSON(), null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'vue-composer.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    $('#btn-charger').addEventListener('click', () => $('#fichier-vue').click());
    $('#fichier-vue').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        snapshot();
        const missed = scene.applyJSON(JSON.parse(await f.text()));
        syncSettingsUI();
        refresh();
        status(missed ? `Vue appliquée ; ${missed} acteur(s) du fichier sans correspondance.` : 'Vue appliquée.');
      } catch (err) {
        status('Vue illisible : ' + err.message);
      }
    });

    function syncSettingsUI() {
      const s = scene.settings;
      $('#opt-lignes').checked = s.showNeutralLines;
      $('#opt-fantomes').checked = s.showNeutralGhosts;
      $('#opt-aretes').checked = s.showEdges;
      $('#opt-grille').checked = s.showGrid;
      $('#opt-style').value = s.lineStyle;
      $('#opt-tiret').value = s.dashLength;
      $('#opt-couleur-ligne').value = hex(s.lineColor);
    }
    syncSettingsUI();

    /* ================= Démonstration ================= */
    $('#btn-demo').addEventListener('click', () => {
      scene.clear();
      for (const d of demoActors()) scene.addActor(d.name, root.Mesh.build(d.tris));
      view.frame(scene.bbox(false));
      scene.buildGrid();
      refresh();
      status('Assemblage de démonstration chargé. Sélectionnez un acteur et déplacez-le.');
      showWarnings([]);
    });

    status('Ouvrez un fichier STL, OBJ, 3MF ou STEP — ou glissez-le dans la vue.');
  });

  /* Petit assemblage intégré : socle, entretoises, capot. Il évite d'avoir à
     trouver un fichier CAO pour essayer l'outil. */
  function demoActors() {
    const box = (x0, y0, z0, dx, dy, dz) => {
      const P = [[x0, y0, z0], [x0 + dx, y0, z0], [x0 + dx, y0 + dy, z0], [x0, y0 + dy, z0],
      [x0, y0, z0 + dz], [x0 + dx, y0, z0 + dz], [x0 + dx, y0 + dy, z0 + dz], [x0, y0 + dy, z0 + dz]];
      const T = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
      [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
      const out = [];
      for (const t of T) for (const i of t) out.push(...P[i]);
      return Float32Array.from(out);
    };
    const tube = (cx, cy, z0, r, h, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const a0 = 2 * Math.PI * i / n, a1 = 2 * Math.PI * (i + 1) / n;
        const p = (a, z) => [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
        const A = p(a0, z0), B = p(a1, z0), C = p(a1, z0 + h), D = p(a0, z0 + h);
        out.push(...A, ...B, ...C, ...A, ...C, ...D);
        out.push(cx, cy, z0 + h, ...D, ...C);
        out.push(cx, cy, z0, ...B, ...A);
      }
      return Float32Array.from(out);
    };
    return [
      { name: 'Socle', tris: box(0, 0, 0, 200, 120, 12) },
      { name: 'Entretoise avant gauche', tris: tube(25, 25, 12, 8, 60, 24) },
      { name: 'Entretoise avant droite', tris: tube(175, 25, 12, 8, 60, 24) },
      { name: 'Entretoise arrière gauche', tris: tube(25, 95, 12, 8, 60, 24) },
      { name: 'Entretoise arrière droite', tris: tube(175, 95, 12, 8, 60, 24) },
      { name: 'Platine', tris: box(10, 10, 72, 180, 100, 8) },
      { name: 'Capot', tris: box(30, 25, 80, 140, 70, 45) }
    ];
  }
})(window.SWC = window.SWC || {});
