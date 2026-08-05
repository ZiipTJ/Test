// Détection de l'objet sur fond blanc et extraction de ses dimensions en pixels.
// Entrée : un objet de type ImageData ({ data: RGBA, width, height }).
// Aucune dépendance au DOM : ce module tourne aussi bien dans le navigateur que sous Node.

import { convexHull, minAreaRect, feretMax, polygonPerimeter, simplifyClosed } from './geometry.js';

export const DEFAULT_OPTIONS = {
  tolerance: 32,        // écart de luminance sous le fond à partir duquel un pixel est "objet"
  saturation: 0.18,     // un pixel coloré est un objet même s'il est clair
  morph: 1,             // itérations de fermeture/ouverture (nettoyage du bruit)
  minAreaRatio: 0.0008, // taches plus petites que ça (fraction de l'image) = bruit
  autoThreshold: true,  // combine le fond mesuré et le seuil d'Otsu
  maxBlobs: 6,
};

/** Luminance perçue + saturation HSV, normalisées 0..255 et 0..1. */
function computeChannels(data, count) {
  const lum = new Float32Array(count);
  const sat = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    sat[i] = max === 0 ? 0 : (max - min) / max;
  }
  return { lum, sat };
}

/** Luminance médiane de l'anneau de bordure : c'est le fond blanc de référence. */
function backgroundLuminance(lum, width, height) {
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  const samples = [];
  for (let y = 0; y < height; y++) {
    const edgeRow = y < band || y >= height - band;
    for (let x = 0; x < width; x++) {
      if (edgeRow || x < band || x >= width - band) samples.push(lum[y * width + x]);
    }
  }
  samples.sort((a, b) => a - b);
  return samples.length ? samples[Math.floor(samples.length / 2)] : 255;
}

/** Seuil d'Otsu sur l'histogramme de luminance. */
function otsuThreshold(lum) {
  const hist = new Float64Array(256);
  for (let i = 0; i < lum.length; i++) hist[Math.min(255, Math.max(0, Math.round(lum[i])))]++;

  const total = lum.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0, wB = 0, firstBest = 0, lastBest = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      firstBest = t;
      lastBest = t;
    } else if (between === bestVar) {
      lastBest = t;
    }
  }
  // Sur une image franchement bimodale la variance est constante dans le creux
  // de l'histogramme : on se place au milieu de ce plateau.
  return Math.round((firstBest + lastBest) / 2);
}

function dilate(src, width, height) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          if (src[yy * width + xx]) { on = 1; break; }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

function erode(src, width, height) {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 1;
      for (let dy = -1; dy <= 1 && on; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          // Hors image = fond : on érode les objets qui touchent le bord.
          if (yy < 0 || yy >= height || xx < 0 || xx >= width || !src[yy * width + xx]) { on = 0; break; }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
}

/** Masque binaire objet/fond. */
export function buildMask(image, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { width, height } = image;
  const count = width * height;
  const { lum, sat } = computeChannels(image.data, count);

  const bgLum = backgroundLuminance(lum, width, height);
  let threshold = bgLum - opts.tolerance;
  if (opts.autoThreshold) {
    const otsu = otsuThreshold(lum);
    // Otsu sépare bien quand l'objet est franc ; on garde le seuil le plus prudent
    // des deux pour ne pas avaler l'ombre portée.
    if (otsu > 0 && otsu < bgLum) threshold = Math.min(threshold, otsu);
  }
  threshold = Math.max(0, Math.min(254, threshold));

  let mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    mask[i] = (lum[i] < threshold || sat[i] > opts.saturation) ? 1 : 0;
  }

  for (let i = 0; i < opts.morph; i++) mask = erode(dilate(mask, width, height), width, height); // fermeture
  for (let i = 0; i < opts.morph; i++) mask = dilate(erode(mask, width, height), width, height); // ouverture

  return { mask, width, height, threshold, backgroundLuminance: bgLum };
}

/** Composantes connexes 8-voisins, triées par aire décroissante. */
export function connectedComponents(mask, width, height, minArea = 1) {
  const labels = new Int32Array(mask.length).fill(-1);
  const blobs = [];
  const stack = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = blobs.length;
    let area = 0;
    let minX = width, maxX = -1, minY = height, maxY = -1;
    let touchesBorder = false;

    stack.push(start);
    labels[start] = id;
    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = (idx - x) / width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const n = yy * width + xx;
          if (mask[n] && labels[n] === -1) {
            labels[n] = id;
            stack.push(n);
          }
        }
      }
    }
    blobs.push({ id, area, minX, maxX, minY, maxY, touchesBorder, seed: start });
  }

  return {
    labels,
    blobs: blobs.filter((b) => b.area >= minArea).sort((a, b) => b.area - a.area),
  };
}

/**
 * Remplit les trous d'une composante : tout pixel hors composante que l'on ne peut
 * pas atteindre depuis le bord de l'image est un trou (perçage, découpe intérieure).
 */
export function fillHoles(compMask, width, height) {
  const outside = new Uint8Array(compMask.length);
  const stack = [];
  const push = (x, y) => {
    const i = y * width + x;
    if (!compMask[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }

  while (stack.length) {
    const idx = stack.pop();
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }

  const filled = new Uint8Array(compMask.length);
  let holeArea = 0;
  for (let i = 0; i < filled.length; i++) {
    filled[i] = (compMask[i] || !outside[i]) ? 1 : 0;
    if (!compMask[i] && !outside[i]) holeArea++;
  }
  return { filled, holeArea };
}

/** Suivi de contour de Moore, sens horaire, sur un masque plein. */
export function traceContour(mask, width, height, startIndex) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  const sx = startIndex % width;
  const sy = (startIndex - sx) / width;
  const contour = [{ x: sx, y: sy }];

  let cx = sx, cy = sy;
  let bx = sx - 1, by = sy;        // le voisin de gauche est forcément du fond (scan ligne à ligne)
  const startBx = bx, startBy = by;
  const guard = width * height * 4;

  for (let step = 0; step < guard; step++) {
    let from = 0;
    for (let i = 0; i < 8; i++) {
      if (cx + dx[i] === bx && cy + dy[i] === by) { from = i; break; }
    }
    let moved = false;
    for (let k = 1; k <= 8; k++) {
      const i = (from + k) % 8;
      const nx = cx + dx[i];
      const ny = cy + dy[i];
      if (inside(nx, ny)) {
        const prev = (i + 7) % 8;   // dernière case testée = nouveau point de recul
        bx = cx + dx[prev];
        by = cy + dy[prev];
        cx = nx;
        cy = ny;
        moved = true;
        break;
      }
    }
    if (!moved) break;              // pixel isolé
    if (cx === sx && cy === sy && bx === startBx && by === startBy) break; // critère de Jacob
    contour.push({ x: cx, y: cy });
  }
  return contour;
}

/** Mesures en pixels d'une composante. */
function describeBlob(blob, labels, width, height, opts) {
  const compMask = new Uint8Array(labels.length);
  for (let i = 0; i < labels.length; i++) compMask[i] = labels[i] === blob.id ? 1 : 0;

  const { filled, holeArea } = fillHoles(compMask, width, height);
  const contour = traceContour(filled, width, height, blob.seed);
  const outline = simplifyClosed(contour, 1.0);
  const hull = convexHull(contour);
  const rect = minAreaRect(contour.length ? contour : [{ x: blob.minX, y: blob.minY }]);
  const feret = feretMax(contour);
  const perimeter = polygonPerimeter(outline.length >= 3 ? outline : contour);

  const netArea = blob.area;                    // matière réelle (trous exclus)
  const grossArea = netArea + holeArea;         // silhouette pleine
  const rectArea = rect ? rect.width * rect.height : 0;

  return {
    id: blob.id,
    contour,
    outline,
    hull,
    rect,
    feret,
    touchesBorder: blob.touchesBorder,
    px: {
      length: rect ? rect.width : 0,
      width: rect ? rect.height : 0,
      angle: rect ? rect.angle : 0,
      bboxWidth: blob.maxX - blob.minX + 1,
      bboxHeight: blob.maxY - blob.minY + 1,
      diagonal: feret.length,
      perimeter,
      areaNet: netArea,
      areaGross: grossArea,
      holeArea,
      equivalentDiameter: Math.sqrt((4 * grossArea) / Math.PI),
    },
    ratios: {
      fill: rectArea ? grossArea / rectArea : 0,
      circularity: perimeter ? (4 * Math.PI * grossArea) / (perimeter * perimeter) : 0,
      holes: grossArea ? holeArea / grossArea : 0,
    },
    _opts: opts,
  };
}

/** Analyse complète : masque -> composantes -> mesures pixel. */
export function analyzeImage(image, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { mask, width, height, threshold, backgroundLuminance: bgLum } = buildMask(image, opts);
  const minArea = Math.max(12, Math.round(width * height * opts.minAreaRatio));
  const { labels, blobs } = connectedComponents(mask, width, height, minArea);

  const objects = blobs.slice(0, opts.maxBlobs).map((b) => describeBlob(b, labels, width, height, opts));

  return {
    width,
    height,
    threshold,
    backgroundLuminance: bgLum,
    mask,
    labels,
    objects,
    main: objects[0] || null,
  };
}

/** Convertit les mesures pixel en unités réelles. */
export function toRealUnits(px, mmPerPx) {
  const k = mmPerPx;
  return {
    length: px.length * k,
    width: px.width * k,
    bboxWidth: px.bboxWidth * k,
    bboxHeight: px.bboxHeight * k,
    diagonal: px.diagonal * k,
    perimeter: px.perimeter * k,
    equivalentDiameter: px.equivalentDiameter * k,
    areaNet: px.areaNet * k * k,
    areaGross: px.areaGross * k * k,
    holeArea: px.holeArea * k * k,
  };
}
