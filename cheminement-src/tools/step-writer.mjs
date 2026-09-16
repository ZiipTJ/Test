/** Écriture de fichiers STEP AP214 conformes (produit + représentation de forme),
 *  utilisée pour fabriquer les modèles de démonstration et les fixtures de test.
 *
 *  Le jeu d'entités est volontairement réduit à ce dont on a besoin : plans,
 *  surfaces cylindriques, droites et cercles — de quoi produire une platine
 *  percée, c'est-à-dire exactement le genre de pièce sur laquelle on fait passer
 *  un faisceau. Les arêtes sont mutualisées entre faces adjacentes, sans quoi la
 *  coque ne serait pas cousue par le lecteur.
 */

const fmt = (x) => {
  const v = Math.abs(x) < 1e-12 ? 0 : x;
  return Number.isInteger(v) ? `${v}.` : String(Number(v.toFixed(9)));
};

export class StepWriter {
  constructor() {
    this.lines = [];
    this.counter = 0;
    this.cache = new Map();
  }

  raw(text) {
    this.counter += 1;
    this.lines.push(`#${this.counter} = ${text};`);
    return this.counter;
  }

  /** Mutualise les entités identiques (points, directions, arêtes). */
  shared(key, build) {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const id = build();
    this.cache.set(key, id);
    return id;
  }

  point(p) {
    return this.shared(`p:${p.map(fmt)}`, () =>
      this.raw(`CARTESIAN_POINT('',(${p.map(fmt).join(',')}))`));
  }

  direction(d) {
    return this.shared(`d:${d.map(fmt)}`, () =>
      this.raw(`DIRECTION('',(${d.map(fmt).join(',')}))`));
  }

  axis2(origin, axis, ref) {
    return this.raw(`AXIS2_PLACEMENT_3D('',#${this.point(origin)},#${this.direction(axis)},#${this.direction(ref)})`);
  }

  vertex(p) {
    return this.shared(`v:${p.map(fmt)}`, () => this.raw(`VERTEX_POINT('',#${this.point(p)})`));
  }

  /** Arête droite, partagée entre les deux faces qui la bordent. */
  lineEdge(a, b) {
    const key = `e:l:${[a.map(fmt).join(','), b.map(fmt).join(',')].sort().join('|')}`;
    return this.shared(key, () => {
      const dir = normalize(sub(b, a));
      const vector = this.raw(`VECTOR('',#${this.direction(dir)},1.)`);
      const line = this.raw(`LINE('',#${this.point(a)},#${vector})`);
      return this.raw(`EDGE_CURVE('',#${this.vertex(a)},#${this.vertex(b)},#${line},.T.)`);
    });
  }

  /** Arc de cercle, décrit par son support et ses deux extrémités. */
  arcEdge(center, axis, ref, radius, a, b) {
    // Le sens fait partie de l'identité : les deux moitiés d'un cercle partagent
    // leurs extrémités mais ne décrivent pas le même arc.
    const key = `e:a:${center.map(fmt)}|${radius}|${a.map(fmt).join(',')}>${b.map(fmt).join(',')}`;
    return this.shared(key, () => {
      const placement = this.axis2(center, axis, ref);
      const circle = this.raw(`CIRCLE('',#${placement},${fmt(radius)})`);
      return this.raw(`EDGE_CURVE('',#${this.vertex(a)},#${this.vertex(b)},#${circle},.T.)`);
    });
  }

  orientedEdge(edgeId, sense) {
    return this.raw(`ORIENTED_EDGE('',*,*,#${edgeId},${sense ? '.T.' : '.F.'})`);
  }

  edgeLoop(orientedEdges) {
    return this.raw(`EDGE_LOOP('',(${orientedEdges.map((id) => `#${id}`).join(',')}))`);
  }

  planeFace(origin, normal, ref, loops) {
    const surface = this.raw(`PLANE('',#${this.axis2(origin, normal, ref)})`);
    return this.face(surface, loops);
  }

  cylinderFace(origin, axis, ref, radius, loops) {
    const surface = this.raw(`CYLINDRICAL_SURFACE('',#${this.axis2(origin, axis, ref)},${fmt(radius)})`);
    return this.face(surface, loops);
  }

  face(surfaceId, loops) {
    const bounds = loops.map((loop, index) =>
      this.raw(`${index === 0 ? 'FACE_OUTER_BOUND' : 'FACE_BOUND'}('',#${loop},.T.)`));
    return this.raw(`ADVANCED_FACE('',(${bounds.map((id) => `#${id}`).join(',')}),#${surfaceId},.T.)`);
  }

  /** Assemble le fichier : en-tête, contexte d'unités, puis un produit par solide. */
  build(parts, { description = 'Modèle de démonstration cheminement' } = {}) {
    const body = this.lines.slice();
    this.lines = [];
    this.counter = Math.max(this.counter, 0);

    const context = this.raw('APPLICATION_CONTEXT(\'automotive design\')');
    this.raw(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,#${context})`);
    const productContext = this.raw(`PRODUCT_CONTEXT('',#${context},'mechanical')`);
    const definitionContext = this.raw(`PRODUCT_DEFINITION_CONTEXT('part definition',#${context},'design')`);

    const lengthUnit = this.raw('( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )');
    const angleUnit = this.raw('( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )');
    const solidUnit = this.raw('( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )');
    const uncertainty = this.raw(
      `UNCERTAINTY_MEASUREMENT_WITH_UNIT(LENGTH_MEASURE(1.E-07),#${lengthUnit},'distance_accuracy_value','confusion accuracy')`);
    const geometricContext = this.raw(
      `( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty})) ` +
      `GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lengthUnit},#${angleUnit},#${solidUnit})) REPRESENTATION_CONTEXT('',''))`);

    const header = this.lines.slice();
    this.lines = [];

    // Les identifiants des faces déjà écrites doivent rester valides : on remet
    // le corps du fichier après l'en-tête, les numéros étant absolus.
    const parted = [];
    for (const part of parts) {
      const shell = this.raw(`CLOSED_SHELL('',(${part.faces.map((id) => `#${id}`).join(',')}))`);
      const solid = this.raw(`MANIFOLD_SOLID_BREP('${part.name}',#${shell})`);
      const origin = this.axis2([0, 0, 0], [0, 0, 1], [1, 0, 0]);
      const shape = this.raw(
        `ADVANCED_BREP_SHAPE_REPRESENTATION('${part.name}',(#${origin},#${solid}),#${geometricContext})`);
      const product = this.raw(`PRODUCT('${part.name}','${part.name}','',(#${productContext}))`);
      const formation = this.raw(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
      const definition = this.raw(`PRODUCT_DEFINITION('design','',#${formation},#${definitionContext})`);
      const definitionShape = this.raw(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);
      this.raw(`SHAPE_DEFINITION_REPRESENTATION(#${definitionShape},#${shape})`);
      parted.push(part.name);
    }

    const tail = this.lines;
    const stamp = '2026-01-01T00:00:00';
    return [
      'ISO-10303-21;',
      'HEADER;',
      `FILE_DESCRIPTION(('${description}'),'2;1');`,
      `FILE_NAME('${description}','${stamp}',('cheminement'),('cheminement'),'','','');`,
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
      'ENDSEC;',
      'DATA;',
      ...header,
      ...body,
      ...tail,
      'ENDSEC;',
      'END-ISO-10303-21;',
      '',
    ].join('\n');
  }
}

/* ---------------------------------------------------------------- géométrie */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const normalize = (a) => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Pavé droit aligné sur les axes. */
export function box(writer, [x0, y0, z0], [dx, dy, dz]) {
  const x1 = x0 + dx, y1 = y0 + dy, z1 = z0 + dz;
  const c = {
    a: [x0, y0, z0], b: [x1, y0, z0], c: [x1, y1, z0], d: [x0, y1, z0],
    e: [x0, y0, z1], f: [x1, y0, z1], g: [x1, y1, z1], h: [x0, y1, z1],
  };
  const quad = (p, q, r, s) => [
    writer.orientedEdge(writer.lineEdge(p, q), true),
    writer.orientedEdge(writer.lineEdge(q, r), true),
    writer.orientedEdge(writer.lineEdge(r, s), true),
    writer.orientedEdge(writer.lineEdge(s, p), true),
  ];
  return [
    writer.planeFace(c.a, [0, 0, -1], [1, 0, 0], [writer.edgeLoop(quad(c.a, c.d, c.c, c.b))]),
    writer.planeFace(c.e, [0, 0, 1], [1, 0, 0], [writer.edgeLoop(quad(c.e, c.f, c.g, c.h))]),
    writer.planeFace(c.a, [0, -1, 0], [1, 0, 0], [writer.edgeLoop(quad(c.a, c.b, c.f, c.e))]),
    writer.planeFace(c.b, [1, 0, 0], [0, 1, 0], [writer.edgeLoop(quad(c.b, c.c, c.g, c.f))]),
    writer.planeFace(c.d, [0, 1, 0], [-1, 0, 0], [writer.edgeLoop(quad(c.c, c.d, c.h, c.g))]),
    writer.planeFace(c.a, [-1, 0, 0], [0, -1, 0], [writer.edgeLoop(quad(c.d, c.a, c.e, c.h))]),
  ];
}

/** Platine percée : la face supérieure et la face inférieure portent les contours
 *  intérieurs, chaque perçage étant fermé par deux demi-cylindres. */
export function plateWithHoles(writer, [x0, y0, z0], [dx, dy, dz], holes) {
  const z1 = z0 + dz;
  const faces = [];

  /** Les deux moitiés d'un perçage, décrites sur le même support : la première
   *  balaie θ de 0 à π, la seconde de π à 2π. Elles sont partagées entre la face
   *  plane et la paroi cylindrique, comme l'exige une coque cousue. */
  const halves = (x, y, z, r) => {
    const right = [x + r, y, z];
    const left = [x - r, y, z];
    return {
      right,
      left,
      upper: writer.arcEdge([x, y, z], [0, 0, 1], [1, 0, 0], r, right, left),
      lower: writer.arcEdge([x, y, z], [0, 0, 1], [1, 0, 0], r, left, right),
    };
  };

  /** Contour intérieur d'un perçage. Il tourne à l'envers du contour extérieur,
   *  vu depuis la normale de la face : d'où le sens inversé côté dessus. */
  const holeLoops = (z, reverse) => holes.map(({ x, y, r }) => {
    const { upper, lower } = halves(x, y, z, r);
    return writer.edgeLoop(reverse
      ? [writer.orientedEdge(lower, false), writer.orientedEdge(upper, false)]
      : [writer.orientedEdge(upper, true), writer.orientedEdge(lower, true)]);
  });

  const rectangle = (z, corners) => writer.edgeLoop([
    writer.orientedEdge(writer.lineEdge(corners[0], corners[1]), true),
    writer.orientedEdge(writer.lineEdge(corners[1], corners[2]), true),
    writer.orientedEdge(writer.lineEdge(corners[2], corners[3]), true),
    writer.orientedEdge(writer.lineEdge(corners[3], corners[0]), true),
  ]);

  const x1 = x0 + dx, y1 = y0 + dy;
  const bottom = [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]];
  const top = [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];

  faces.push(writer.planeFace([x0, y0, z0], [0, 0, -1], [1, 0, 0], [rectangle(z0, bottom), ...holeLoops(z0, false)]));
  faces.push(writer.planeFace([x0, y0, z1], [0, 0, 1], [1, 0, 0], [rectangle(z1, top), ...holeLoops(z1, true)]));

  const side = (a, b) => writer.planeFace(a, normalize([-(b[1] - a[1]), b[0] - a[0], 0]), [0, 0, 1], [
    writer.edgeLoop([
      writer.orientedEdge(writer.lineEdge(a, b), true),
      writer.orientedEdge(writer.lineEdge(b, [b[0], b[1], z1]), true),
      writer.orientedEdge(writer.lineEdge([b[0], b[1], z1], [a[0], a[1], z1]), true),
      writer.orientedEdge(writer.lineEdge([a[0], a[1], z1], a), true),
    ]),
  ]);
  faces.push(side([x0, y0, z0], [x1, y0, z0]));
  faces.push(side([x1, y0, z0], [x1, y1, z0]));
  faces.push(side([x1, y1, z0], [x0, y1, z0]));
  faces.push(side([x0, y1, z0], [x0, y0, z0]));

  // Paroi de chaque perçage : deux demi-cylindres refermés sur les mêmes génératrices.
  for (const { x, y, r } of holes) {
    const low = halves(x, y, z0, r);
    const high = halves(x, y, z1, r);
    const seamRight = writer.lineEdge(low.right, high.right);
    const seamLeft = writer.lineEdge(low.left, high.left);

    faces.push(writer.cylinderFace([x, y, z0], [0, 0, 1], [1, 0, 0], r, [
      writer.edgeLoop([
        writer.orientedEdge(low.upper, true),
        writer.orientedEdge(seamLeft, true),
        writer.orientedEdge(high.upper, false),
        writer.orientedEdge(seamRight, false),
      ]),
    ]));
    faces.push(writer.cylinderFace([x, y, z0], [0, 0, 1], [1, 0, 0], r, [
      writer.edgeLoop([
        writer.orientedEdge(low.lower, true),
        writer.orientedEdge(seamRight, true),
        writer.orientedEdge(high.lower, false),
        writer.orientedEdge(seamLeft, false),
      ]),
    ]));
  }

  return faces;
}
