// Export STEP AP214 d'un prisme droit (contour + trous, extrudé sur l'épaisseur).
// Géométrie exacte : plans et droites, pas de facettes — c'est ce qui rend le
// fichier réellement exploitable en CAO, contrairement à un STL.

import { signedArea } from './triangulate.js';

class StepFile {
  constructor() {
    this.lines = [];
    this.next = 1;
  }

  add(body) {
    const id = this.next++;
    this.lines.push(`#${id}=${body};`);
    return id;
  }

  toString(name) {
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, '');
    return [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION(('Modele reconstruit depuis photo'),'2;1');`,
      `FILE_NAME('${name}','${stamp}',('mesure-photo'),(''),'mesure-photo','','');`,
      `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }'));`,
      'ENDSEC;',
      'DATA;',
      ...this.lines,
      'ENDSEC;',
      'END-ISO-10303-21;',
    ].join('\n');
  }
}

const num = (v) => {
  if (!isFinite(v)) return '0.';
  const s = Number(v.toFixed(9)).toString();
  return s.includes('.') || s.includes('E') || s.includes('e') ? s : `${s}.`;
};

/**
 * Écrit un prisme droit en STEP.
 * @param outer contour extérieur [{x, y}] en mm, sens trigonométrique
 * @param holes contours des trous, sens horaire
 * @param thickness épaisseur en mm (extrusion selon +Z)
 */
export function prismToStep(outer, holes = [], thickness = 1, name = 'piece') {
  const f = new StepFile();

  const dir = (x, y, z, label = '') => f.add(`DIRECTION('${label}',(${num(x)},${num(y)},${num(z)}))`);
  const pt = (x, y, z) => f.add(`CARTESIAN_POINT('',(${num(x)},${num(y)},${num(z)}))`);
  const placement = (origin, axis, ref) => f.add(`AXIS2_PLACEMENT_3D('',#${origin},#${axis},#${ref})`);

  // --- Contexte et unités ---------------------------------------------------
  const lengthUnit = f.add('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
  const angleUnit = f.add('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
  const solidUnit = f.add('( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )');
  const uncertainty = f.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${lengthUnit},'distance_accuracy_value','confusion accuracy')`);
  const context = f.add(
    `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty}))`
    + ` GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angleUnit},#${solidUnit})) REPRESENTATION_CONTEXT('','3D') )`,
  );

  // --- Anneaux : orientation imposée ---------------------------------------
  const rings = [];
  const ext = signedArea(outer) < 0 ? outer.slice().reverse() : outer.slice();
  rings.push({ pts: dedupe(ext), outer: true });
  for (const h of holes || []) {
    if (!h || h.length < 3) continue;
    const ring = signedArea(h) > 0 ? h.slice().reverse() : h.slice();
    rings.push({ pts: dedupe(ring), outer: false });
  }

  // --- Sommets et arêtes ----------------------------------------------------
  const zDir = dir(0, 0, 1, 'z');
  const zNeg = dir(0, 0, -1, 'z-');
  const xDir = dir(1, 0, 0, 'x');

  const built = rings.map(({ pts, outer: isOuter }) => {
    const n = pts.length;
    const vBottom = pts.map((p) => f.add(`VERTEX_POINT('',#${pt(p.x, p.y, 0)})`));
    const vTop = pts.map((p) => f.add(`VERTEX_POINT('',#${pt(p.x, p.y, thickness)})`));

    const lineEdge = (v0, v1, p0, p1) => {
      const d = { x: p1.x - p0.x, y: p1.y - p0.y, z: (p1.z || 0) - (p0.z || 0) };
      const len = Math.hypot(d.x, d.y, d.z) || 1;
      const dirId = dir(d.x / len, d.y / len, d.z / len);
      const originId = pt(p0.x, p0.y, p0.z || 0);
      const vec = f.add(`VECTOR('',#${dirId},${num(len)})`);
      const line = f.add(`LINE('',#${originId},#${vec})`);
      return f.add(`EDGE_CURVE('',#${v0},#${v1},#${line},.T.)`);
    };

    const eBottom = [];
    const eTop = [];
    const eSide = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      eBottom.push(lineEdge(vBottom[i], vBottom[j], { ...pts[i], z: 0 }, { ...pts[j], z: 0 }));
      eTop.push(lineEdge(vTop[i], vTop[j], { ...pts[i], z: thickness }, { ...pts[j], z: thickness }));
      eSide.push(lineEdge(vBottom[i], vTop[i], { ...pts[i], z: 0 }, { ...pts[i], z: thickness }));
    }
    return { pts, n, isOuter, eBottom, eTop, eSide };
  });

  const oriented = (edge, sense) => f.add(`ORIENTED_EDGE('',*,*,#${edge},${sense ? '.T.' : '.F.'})`);
  const loopForward = (edges) => f.add(`EDGE_LOOP('',(${edges.map((e) => `#${oriented(e, true)}`).join(',')}))`);
  const loopBackward = (edges) => {
    const ids = [];
    for (let i = edges.length - 1; i >= 0; i--) ids.push(`#${oriented(edges[i], false)}`);
    return f.add(`EDGE_LOOP('',(${ids.join(',')}))`);
  };

  const faces = [];

  // --- Parois latérales -----------------------------------------------------
  for (const ring of built) {
    for (let i = 0; i < ring.n; i++) {
      const j = (i + 1) % ring.n;
      const a = ring.pts[i];
      const b = ring.pts[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) continue;
      // Anneau extérieur en sens trigonométrique : la normale sortante est la
      // direction de parcours tournée de -90°. Les trous, en sens horaire,
      // donnent naturellement une normale tournée vers le vide.
      const nx = dy / len;
      const ny = -dx / len;

      const loop = f.add(`EDGE_LOOP('',(${[
        `#${oriented(ring.eBottom[i], true)}`,
        `#${oriented(ring.eSide[j], true)}`,
        `#${oriented(ring.eTop[i], false)}`,
        `#${oriented(ring.eSide[i], false)}`,
      ].join(',')}))`);
      const bound = f.add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
      const plane = f.add(`PLANE('',#${placement(pt(a.x, a.y, 0), dir(nx, ny, 0), dir(dx / len, dy / len, 0))})`);
      faces.push(f.add(`ADVANCED_FACE('',(#${bound}),#${plane},.T.)`));
    }
  }

  // --- Dessus (normale +Z) et dessous (normale -Z) --------------------------
  const outerRing = built.find((r) => r.isOuter);
  const holeRings = built.filter((r) => !r.isOuter);

  const topPlane = f.add(`PLANE('',#${placement(pt(0, 0, thickness), zDir, xDir)})`);
  const topBounds = [`#${f.add(`FACE_OUTER_BOUND('',#${loopForward(outerRing.eTop)},.T.)`)}`];
  for (const h of holeRings) topBounds.push(`#${f.add(`FACE_BOUND('',#${loopForward(h.eTop)},.T.)`)}`);
  faces.push(f.add(`ADVANCED_FACE('',(${topBounds.join(',')}),#${topPlane},.T.)`));

  const bottomPlane = f.add(`PLANE('',#${placement(pt(0, 0, 0), zNeg, xDir)})`);
  const bottomBounds = [`#${f.add(`FACE_OUTER_BOUND('',#${loopBackward(outerRing.eBottom)},.T.)`)}`];
  for (const h of holeRings) bottomBounds.push(`#${f.add(`FACE_BOUND('',#${loopBackward(h.eBottom)},.T.)`)}`);
  faces.push(f.add(`ADVANCED_FACE('',(${bottomBounds.join(',')}),#${bottomPlane},.T.)`));

  // --- Solide et rattachement produit --------------------------------------
  const shell = f.add(`CLOSED_SHELL('',(${faces.map((x) => `#${x}`).join(',')}))`);
  const origin = placement(pt(0, 0, 0), zDir, xDir);
  const brep = f.add(`MANIFOLD_SOLID_BREP('${name}',#${shell})`);
  const shapeRep = f.add(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(#${origin},#${brep}),#${context})`);

  const appContext = f.add(`APPLICATION_CONTEXT('automotive design')`);
  f.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${appContext})`);
  const prodContext = f.add(`PRODUCT_CONTEXT('',#${appContext},'mechanical')`);
  const defContext = f.add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appContext},'design')`);
  const product = f.add(`PRODUCT('${name}','${name}','',(#${prodContext}))`);
  f.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#${product}))`);
  const formation = f.add(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
  const definition = f.add(`PRODUCT_DEFINITION('design','',#${formation},#${defContext})`);
  const defShape = f.add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);
  f.add(`SHAPE_DEFINITION_REPRESENTATION(#${defShape},#${shapeRep})`);

  return f.toString(`${name}.step`);
}

/** Supprime les points confondus consécutifs (et le doublon de fermeture). */
function dedupe(ring, epsilon = 1e-7) {
  const out = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < epsilon && Math.abs(last.y - p.y) < epsilon) continue;
    out.push(p);
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon) out.pop();
    else break;
  }
  return out;
}
