// Export DXF (AutoCAD R12) : le format que SolidWorks, Fusion, FreeCAD et les
// découpeuses lisent directement comme esquisse 2D.
//
// Deux points de méthode :
//
// 1. On exporte les primitives ajustées — LINE et ARC — et non le nuage de
//    points du contour. Une esquisse faite de vrais arcs se cote, se contraint
//    et se reprend en CAO ; une polyligne de trois mille sommets ne se reprend
//    pas.
// 2. Le repère image a son Y vers le bas, celui du DXF vers le haut. Le
//    retournement inverse le sens de parcours : un arc horaire à l'écran
//    devient trigonométrique dans le fichier. Or DXF impose de décrire un arc
//    dans le sens trigonométrique de son angle de départ à son angle d'arrivée.
//    Les bornes sont donc recalculées après retournement, et échangées quand il
//    le faut.

const DEG = 180 / Math.PI;

function pair(code, value) {
  return `${code}\n${value}\n`;
}

const num = (v) => (Math.abs(v) < 1e-10 ? '0.0' : Number(v.toFixed(6)).toString());

/** Repère image (Y vers le bas, pixels) -> repère DXF (Y vers le haut, mm). */
function makeTransform({ mmPerPx = 1, originY = 0 } = {}) {
  return (p) => ({ x: p.x * mmPerPx, y: (originY - p.y) * mmPerPx });
}

function lineEntity(a, b, layer) {
  return pair(0, 'LINE') + pair(8, layer)
    + pair(10, num(a.x)) + pair(20, num(a.y)) + pair(30, '0.0')
    + pair(11, num(b.x)) + pair(21, num(b.y)) + pair(31, '0.0');
}

function arcEntity(center, radius, startDeg, endDeg, layer) {
  return pair(0, 'ARC') + pair(8, layer)
    + pair(10, num(center.x)) + pair(20, num(center.y)) + pair(30, '0.0')
    + pair(40, num(radius))
    + pair(50, num(startDeg)) + pair(51, num(endDeg));
}

function polylineEntity(points, layer, closed = true) {
  let out = pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1)
    + pair(10, '0.0') + pair(20, '0.0') + pair(30, '0.0')
    + pair(70, closed ? 1 : 0);
  for (const p of points) {
    out += pair(0, 'VERTEX') + pair(8, layer)
      + pair(10, num(p.x)) + pair(20, num(p.y)) + pair(30, '0.0');
  }
  out += pair(0, 'SEQEND') + pair(8, layer);
  return out;
}

function wrap(entities) {
  return pair(0, 'SECTION') + pair(2, 'HEADER')
    + pair(9, '$ACADVER') + pair(1, 'AC1009')
    + pair(9, '$INSUNITS') + pair(70, 4)          // 4 = millimètres
    + pair(0, 'ENDSEC')
    + pair(0, 'SECTION') + pair(2, 'ENTITIES')
    + entities
    + pair(0, 'ENDSEC')
    + pair(0, 'EOF');
}

/**
 * Esquisse DXF à partir des primitives ajustées.
 * @param primitives sortie de fitPrimitives (droites et arcs, en pixels image)
 * @param options.mmPerPx échelle ; 1 laisse le dessin en pixels
 * @param options.originY ordonnée servant de zéro (hauteur de l'image en général)
 */
export function primitivesToDxf(primitives, options = {}) {
  const layer = options.layer || 'CONTOUR';
  const to = makeTransform(options);
  const mmPerPx = options.mmPerPx || 1;
  let entities = '';

  for (const p of primitives) {
    if (p.type === 'line') {
      entities += lineEntity(to(p.a), to(p.b), layer);
      continue;
    }

    const center = to(p.center);
    const radius = p.radius * mmPerPx;

    if (p.full) {
      entities += pair(0, 'CIRCLE') + pair(8, layer)
        + pair(10, num(center.x)) + pair(20, num(center.y)) + pair(30, '0.0')
        + pair(40, num(radius));
      continue;
    }

    // Bornes exprimées dans le repère DXF, après retournement de Y.
    const startPt = to({
      x: p.center.x + p.radius * Math.cos(p.startAngle),
      y: p.center.y + p.radius * Math.sin(p.startAngle),
    });
    const endPt = to({
      x: p.center.x + p.radius * Math.cos(p.endAngle),
      y: p.center.y + p.radius * Math.sin(p.endAngle),
    });
    const angleOf = (q) => {
      const a = Math.atan2(q.y - center.y, q.x - center.x) * DEG;
      return a < 0 ? a + 360 : a;
    };
    const aStart = angleOf(startPt);
    const aEnd = angleOf(endPt);

    // Le retournement inverse le sens : un arc horaire à l'image se décrit
    // dans le fichier de l'arrivée vers le départ.
    const clockwiseInImage = p.sweep < 0;
    entities += clockwiseInImage
      ? arcEntity(center, radius, aStart, aEnd, layer)
      : arcEntity(center, radius, aEnd, aStart, layer);
  }

  return wrap(entities);
}

/** Esquisse DXF sous forme de polyligne fermée — fidèle au pixel, non cotable. */
export function contourToDxf(contour, options = {}) {
  const layer = options.layer || 'CONTOUR';
  const to = makeTransform(options);
  return wrap(polylineEntity(contour.map(to), layer, true));
}

/**
 * Esquisse complète : contour extérieur et trous, chacun sur son calque.
 * `holes` est une liste de contours (nuages de points).
 */
export function sketchToDxf({ primitives, contour, holes = [] }, options = {}) {
  const to = makeTransform(options);
  let entities = '';

  if (primitives && primitives.length) {
    entities += primitivesToDxf(primitives, { ...options, layer: 'CONTOUR' })
      .split(pair(2, 'ENTITIES'))[1]
      .split(pair(0, 'ENDSEC'))[0];
  } else if (contour && contour.length) {
    entities += polylineEntity(contour.map(to), 'CONTOUR', true);
  }

  for (const hole of holes) {
    if (hole && hole.length >= 3) entities += polylineEntity(hole.map(to), 'TROUS', true);
  }

  return wrap(entities);
}
