// Reconstruction 3D par intersection de silhouettes (visual hull) :
// on part d'un pavé plein de voxels et on retire tout voxel qui tombe hors de
// la silhouette dans au moins une vue. Le maillage est ensuite extrait par
// « surface nets », qui ne demande aucune table de correspondance.
//
// Caméra orthographique : chaque vue porte sa propre projection affine
//   u = ux·X + uy·Y + uz·Z + u0
//   v = vx·X + vy·Y + vz·Z + v0
// exprimée en pixels. Le monde est en pixels de la vue de référence ; la mise
// à l'échelle en millimètres se fait au moment de l'export.

/** Vue de côté : objet tourné de `angle` autour de l'axe vertical Y. */
export function sideView(mask, width, height, angle, axisX, baseY) {
  return {
    mask, width, height, kind: 'side', angle,
    ux: Math.cos(angle), uy: 0, uz: Math.sin(angle), u0: axisX,
    vx: 0, vy: -1, vz: 0, v0: baseY,
  };
}

/** Vue de dessus : caméra dans l'axe Y, rotation `angle` dans le plan. */
export function topView(mask, width, height, angle, cx, cy) {
  return {
    mask, width, height, kind: 'top', angle,
    ux: Math.cos(angle), uy: 0, uz: Math.sin(angle), u0: cx,
    vx: -Math.sin(angle), vy: 0, vz: Math.cos(angle), v0: cy,
  };
}

const inMask = (view, u, v) => {
  const x = Math.round(u);
  const y = Math.round(v);
  if (x < 0 || y < 0 || x >= view.width || y >= view.height) return false;
  return view.mask[y * view.width + x] === 1;
};

/**
 * Boîte englobante du monde déduite des silhouettes.
 * Les vues de côté bornent Y et le rayon horizontal ; les vues de dessus
 * bornent directement X et Z.
 */
export function worldBounds(views, margin = 0.04) {
  let radius = 0, yMin = Infinity, yMax = -Infinity;
  let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  let hasSide = false, hasTop = false;

  for (const view of views) {
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let y = 0; y < view.height; y++) {
      for (let x = 0; x < view.width; x++) {
        if (!view.mask[y * view.width + x]) continue;
        if (x < minU) minU = x;
        if (x > maxU) maxU = x;
        if (y < minV) minV = y;
        if (y > maxV) maxV = y;
      }
    }
    if (maxU < minU) continue; // silhouette vide

    if (view.kind === 'side') {
      hasSide = true;
      // Un pixel couvre [n, n+1[ : on prend le bord extérieur de chaque côté.
      radius = Math.max(radius, Math.abs(maxU + 1 - view.u0), Math.abs(minU - view.u0));
      yMin = Math.min(yMin, view.v0 - (maxV + 1));
      yMax = Math.max(yMax, view.v0 - minV);
    } else {
      hasTop = true;
      // La vue de dessus est tournée de `angle` : on reste conservateur en
      // prenant le rayon de la boîte projetée.
      const r = Math.max(
        Math.abs(maxU - view.u0), Math.abs(minU - view.u0),
        Math.abs(maxV - view.v0), Math.abs(minV - view.v0),
      );
      xMin = Math.min(xMin, -r); xMax = Math.max(xMax, r);
      zMin = Math.min(zMin, -r); zMax = Math.max(zMax, r);
    }
  }

  if (!hasSide) { yMin = -1; yMax = 1; }          // épaisseur imposée par ailleurs
  if (hasSide && !hasTop) { xMin = -radius; xMax = radius; zMin = -radius; zMax = radius; }
  if (hasSide && hasTop) {
    xMin = Math.max(xMin, -radius); xMax = Math.min(xMax, radius);
    zMin = Math.max(zMin, -radius); zMax = Math.min(zMax, radius);
  }

  const pad = (a, b) => {
    const m = (b - a) * margin + 1e-6;
    return [a - m, b + m];
  };
  const [x0, x1] = pad(xMin, xMax);
  const [y0, y1] = pad(yMin, yMax);
  const [z0, z1] = pad(zMin, zMax);
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
}

/**
 * Sculpte la grille de voxels. `resolution` est le nombre de voxels sur la
 * plus grande dimension. Retourne l'occupation et la géométrie de la grille.
 */
export function carve(views, options = {}) {
  const resolution = Math.max(16, Math.min(320, options.resolution || 128));
  const bounds = options.bounds || worldBounds(views);
  const size = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
  const longest = Math.max(size.x, size.y, size.z);
  const step = longest / resolution;

  const dims = {
    x: Math.max(2, Math.ceil(size.x / step) + 1),
    y: Math.max(2, Math.ceil(size.y / step) + 1),
    z: Math.max(2, Math.ceil(size.z / step) + 1),
  };
  const occ = new Uint8Array(dims.x * dims.y * dims.z).fill(1);

  for (let k = 0; k < dims.z; k++) {
    const Z = bounds.min.z + k * step;
    for (let j = 0; j < dims.y; j++) {
      const Y = bounds.min.y + j * step;
      const rowBase = dims.x * (j + dims.y * k);
      for (let i = 0; i < dims.x; i++) {
        const X = bounds.min.x + i * step;
        let keep = 1;
        for (let v = 0; v < views.length; v++) {
          const view = views[v];
          const u = view.ux * X + view.uy * Y + view.uz * Z + view.u0;
          const vv = view.vx * X + view.vy * Y + view.vz * Z + view.v0;
          if (!inMask(view, u, vv)) { keep = 0; break; }
        }
        occ[rowBase + i] = keep;
      }
    }
  }

  let filled = 0;
  for (let i = 0; i < occ.length; i++) filled += occ[i];

  return { occ, dims, step, origin: bounds.min, bounds, filled };
}

/**
 * Extraction de surface par « naive surface nets » : un sommet par cellule
 * traversée, placé au barycentre des intersections d'arêtes, puis un quad par
 * arête de grille qui change d'état. Le maillage produit est fermé.
 */
export function surfaceNets(grid) {
  const { occ, dims, step, origin } = grid;
  const at = (x, y, z) => occ[x + dims.x * (y + dims.y * z)];

  const cells = { x: dims.x - 1, y: dims.y - 1, z: dims.z - 1 };
  const vertexIndex = new Int32Array(cells.x * cells.y * cells.z).fill(-1);
  const positions = [];

  // Les 12 arêtes du cube, comme paires d'indices de coins (bit 0 = x, 1 = y, 2 = z).
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cornerOffset = (c) => [c & 1, (c >> 1) & 1, (c >> 2) & 1];

  for (let z = 0; z < cells.z; z++) {
    for (let y = 0; y < cells.y; y++) {
      for (let x = 0; x < cells.x; x++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [dx, dy, dz] = cornerOffset(c);
          if (at(x + dx, y + dy, z + dz)) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;

        let sx = 0, sy = 0, sz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const ia = (mask >> a) & 1;
          const ib = (mask >> b) & 1;
          if (ia === ib) continue;
          const oa = cornerOffset(a);
          const ob = cornerOffset(b);
          sx += (oa[0] + ob[0]) / 2;
          sy += (oa[1] + ob[1]) / 2;
          sz += (oa[2] + ob[2]) / 2;
          n++;
        }
        vertexIndex[x + cells.x * (y + cells.y * z)] = positions.length;
        positions.push({
          x: origin.x + (x + sx / n) * step,
          y: origin.y + (y + sy / n) * step,
          z: origin.z + (z + sz / n) * step,
        });
      }
    }
  }

  const triangles = [];
  const cellVertex = (x, y, z) => vertexIndex[x + cells.x * (y + cells.y * z)];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) {
      triangles.push([a, d, c], [a, c, b]);
    } else {
      triangles.push([a, b, c], [a, c, d]);
    }
  };

  for (let z = 0; z < cells.z; z++) {
    for (let y = 0; y < cells.y; y++) {
      for (let x = 0; x < cells.x; x++) {
        const here = at(x, y, z);
        // Arête +X : quad dans le plan YZ
        if (y > 0 && z > 0 && here !== at(x + 1, y, z)) {
          quad(
            cellVertex(x, y, z), cellVertex(x, y - 1, z),
            cellVertex(x, y - 1, z - 1), cellVertex(x, y, z - 1),
            here !== 1,
          );
        }
        // Arête +Y : quad dans le plan XZ
        if (x > 0 && z > 0 && here !== at(x, y + 1, z)) {
          quad(
            cellVertex(x, y, z), cellVertex(x, y, z - 1),
            cellVertex(x - 1, y, z - 1), cellVertex(x - 1, y, z),
            here !== 1,
          );
        }
        // Arête +Z : quad dans le plan XY
        if (x > 0 && y > 0 && here !== at(x, y, z + 1)) {
          quad(
            cellVertex(x, y, z), cellVertex(x - 1, y, z),
            cellVertex(x - 1, y - 1, z), cellVertex(x, y - 1, z),
            here !== 1,
          );
        }
      }
    }
  }

  return { vertices: positions, triangles };
}

/** Lissage laplacien contraint : adoucit l'escalier des voxels sans fondre les arêtes. */
export function smoothMesh(mesh, iterations = 2, factor = 0.5) {
  if (iterations <= 0) return mesh;
  const { vertices, triangles } = mesh;
  const neighbors = vertices.map(() => new Set());
  for (const [a, b, c] of triangles) {
    neighbors[a].add(b); neighbors[a].add(c);
    neighbors[b].add(a); neighbors[b].add(c);
    neighbors[c].add(a); neighbors[c].add(b);
  }

  let pts = vertices.map((p) => ({ ...p }));
  for (let it = 0; it < iterations; it++) {
    const next = pts.map((p, i) => {
      const nb = neighbors[i];
      if (!nb.size) return { ...p };
      let sx = 0, sy = 0, sz = 0;
      for (const j of nb) { sx += pts[j].x; sy += pts[j].y; sz += pts[j].z; }
      const n = nb.size;
      return {
        x: p.x + factor * (sx / n - p.x),
        y: p.y + factor * (sy / n - p.y),
        z: p.z + factor * (sz / n - p.z),
      };
    });
    pts = next;
  }
  return { vertices: pts, triangles };
}
