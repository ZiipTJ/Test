/** Lecture 3MF sans DOM.
 *
 *  Les workers n'ont pas de `DOMParser` : on analyse donc le XML directement.
 *  Le format reste simple (objets maillés, composants transformés, plateau de
 *  construction), et l'analyse à la main permet d'aller chercher exactement ce qui
 *  nous intéresse — géométrie, unité, noms et couleurs — sans construire d'arbre.
 */
import { strFromU8, unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

export interface RawMesh {
  id: string;
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  color: [number, number, number] | null;
}

export interface ThreeMfDocument {
  meshes: RawMesh[];
  unit: string;
  /** Facteur de conversion vers le millimètre. */
  scale: number;
  warnings: string[];
}

const UNIT_SCALE: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

type Matrix = [number, number, number, number, number, number, number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** 3MF stocke une matrice 4×3 en ligne ; la translation occupe le dernier triplet. */
function parseMatrix(value: string | null): Matrix {
  if (!value) return IDENTITY;
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 12 || parts.some((n) => !Number.isFinite(n))) return IDENTITY;
  return parts as Matrix;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  // Application de a puis b, en convention ligne : (p · A) · B.
  const out = new Array<number>(12).fill(0) as Matrix;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!;
    }
  }
  for (let col = 0; col < 3; col += 1) {
    out[9 + col] =
      a[9]! * b[col]! + a[10]! * b[3 + col]! + a[11]! * b[6 + col]! + b[9 + col]!;
  }
  return out;
}

const isIdentity = (m: Matrix): boolean => m.every((v, i) => v === IDENTITY[i]);

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return match ? match[1]! : null;
}

interface ObjectEntry {
  id: string;
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  components: Array<{ objectId: string; matrix: Matrix }>;
  color: [number, number, number] | null;
}

/** Positions : chemin rapide sur l'ordre d'attributs usuel, repli générique sinon. */
function parseVertices(block: string): Float32Array {
  const expected = (block.match(/<vertex\b/g) ?? []).length;
  if (expected === 0) return new Float32Array(0);
  const out = new Float32Array(expected * 3);

  const fast = /<vertex\s+x="([^"]*)"\s+y="([^"]*)"\s+z="([^"]*)"\s*\/?>/g;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = fast.exec(block)) !== null && index < expected) {
    out[index * 3] = Number(match[1]);
    out[index * 3 + 1] = Number(match[2]);
    out[index * 3 + 2] = Number(match[3]);
    index += 1;
  }
  if (index === expected) return out;

  index = 0;
  const generic = /<vertex\b([^>]*)>/g;
  while ((match = generic.exec(block)) !== null && index < expected) {
    out[index * 3] = Number(attribute(match[1]!, 'x') ?? 0);
    out[index * 3 + 1] = Number(attribute(match[1]!, 'y') ?? 0);
    out[index * 3 + 2] = Number(attribute(match[1]!, 'z') ?? 0);
    index += 1;
  }
  return out;
}

function parseTriangles(block: string): Uint32Array {
  const expected = (block.match(/<triangle\b/g) ?? []).length;
  if (expected === 0) return new Uint32Array(0);
  const out = new Uint32Array(expected * 3);

  const fast = /<triangle\s+v1="([^"]*)"\s+v2="([^"]*)"\s+v3="([^"]*)"/g;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = fast.exec(block)) !== null && index < expected) {
    out[index * 3] = Number(match[1]);
    out[index * 3 + 1] = Number(match[2]);
    out[index * 3 + 2] = Number(match[3]);
    index += 1;
  }
  if (index === expected) return out;

  index = 0;
  const generic = /<triangle\b([^>]*)>/g;
  while ((match = generic.exec(block)) !== null && index < expected) {
    out[index * 3] = Number(attribute(match[1]!, 'v1') ?? 0);
    out[index * 3 + 1] = Number(attribute(match[1]!, 'v2') ?? 0);
    out[index * 3 + 2] = Number(attribute(match[1]!, 'v3') ?? 0);
    index += 1;
  }
  return out;
}

function parseColor(hex: string | null): [number, number, number] | null {
  if (!hex) return null;
  const clean = hex.replace('#', '');
  if (clean.length < 6) return null;
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255,
  ];
}

/** Analyse le XML du modèle (`3D/3dmodel.model`). */
export function parseModelXml(xml: string): ThreeMfDocument {
  const warnings: string[] = [];

  const modelTag = /<model\b[^>]*>/.exec(xml)?.[0] ?? '';
  const unit = attribute(modelTag, 'unit') ?? 'millimeter';
  const scale = UNIT_SCALE[unit] ?? 1;
  if (!(unit in UNIT_SCALE)) warnings.push(`Unité « ${unit} » inconnue : millimètre supposé.`);

  /* Matériaux de base : une palette par identifiant de groupe. */
  const palettes = new Map<string, Array<[number, number, number] | null>>();
  const materialBlock = /<basematerials\b[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/basematerials>/g;
  let materialMatch: RegExpExecArray | null;
  while ((materialMatch = materialBlock.exec(xml)) !== null) {
    const colors: Array<[number, number, number] | null> = [];
    const baseTag = /<base\b([^>]*)>/g;
    let baseMatch: RegExpExecArray | null;
    while ((baseMatch = baseTag.exec(materialMatch[2]!)) !== null) {
      colors.push(parseColor(attribute(baseMatch[1]!, 'displaycolor')));
    }
    palettes.set(materialMatch[1]!, colors);
  }

  /* Objets : maillage direct ou assemblage de composants. */
  const objects = new Map<string, ObjectEntry>();
  const objectBlock = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let objectMatch: RegExpExecArray | null;
  while ((objectMatch = objectBlock.exec(xml)) !== null) {
    const attributes = objectMatch[1]!;
    const body = objectMatch[2]!;
    const id = attribute(attributes, 'id');
    if (!id) continue;

    const components: ObjectEntry['components'] = [];
    const componentTag = /<component\b([^>]*)>/g;
    let componentMatch: RegExpExecArray | null;
    while ((componentMatch = componentTag.exec(body)) !== null) {
      const objectId = attribute(componentMatch[1]!, 'objectid');
      if (objectId) components.push({ objectId, matrix: parseMatrix(attribute(componentMatch[1]!, 'transform')) });
    }

    const pid = attribute(attributes, 'pid');
    const pindex = Number(attribute(attributes, 'pindex') ?? '0');
    const color = pid ? palettes.get(pid)?.[pindex] ?? null : null;

    objects.set(id, {
      id,
      name: attribute(attributes, 'name') ?? `Objet ${id}`,
      positions: parseVertices(body),
      indices: parseTriangles(body),
      components,
      color,
    });
  }

  /* Plateau de construction : chaque item instancie un objet. */
  const items: Array<{ objectId: string; matrix: Matrix }> = [];
  const buildBlock = /<build\b[^>]*>([\s\S]*?)<\/build>/.exec(xml);
  if (buildBlock) {
    const itemTag = /<item\b([^>]*)>/g;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemTag.exec(buildBlock[1]!)) !== null) {
      const objectId = attribute(itemMatch[1]!, 'objectid');
      if (objectId) items.push({ objectId, matrix: parseMatrix(attribute(itemMatch[1]!, 'transform')) });
    }
  }
  if (items.length === 0) {
    // Fichier sans plateau : on affiche tous les objets maillés.
    for (const entry of objects.values()) {
      if (entry.indices.length > 0) items.push({ objectId: entry.id, matrix: IDENTITY });
    }
    if (items.length > 0) warnings.push('Aucun plateau de construction : tous les objets sont affichés.');
  }

  const meshes: RawMesh[] = [];
  const emit = (objectId: string, matrix: Matrix, depth: number, path: string): void => {
    if (depth > 12) {
      warnings.push('Composants imbriqués trop profondément : branche ignorée.');
      return;
    }
    const entry = objects.get(objectId);
    if (!entry) {
      warnings.push(`Objet ${objectId} référencé mais absent du fichier.`);
      return;
    }
    if (entry.indices.length > 0) {
      const positions = new Float32Array(entry.positions.length);
      if (isIdentity(matrix)) {
        positions.set(entry.positions);
        for (let i = 0; i < positions.length; i += 1) positions[i] = positions[i]! * scale;
      } else {
        for (let v = 0; v < entry.positions.length; v += 3) {
          const x = entry.positions[v]!, y = entry.positions[v + 1]!, z = entry.positions[v + 2]!;
          positions[v] = (x * matrix[0]! + y * matrix[3]! + z * matrix[6]! + matrix[9]!) * scale;
          positions[v + 1] = (x * matrix[1]! + y * matrix[4]! + z * matrix[7]! + matrix[10]!) * scale;
          positions[v + 2] = (x * matrix[2]! + y * matrix[5]! + z * matrix[8]! + matrix[11]!) * scale;
        }
      }
      meshes.push({
        id: `${path}#${meshes.length}`,
        name: entry.name,
        positions,
        indices: entry.indices.slice(),
        color: entry.color,
      });
    }
    for (const component of entry.components) {
      emit(component.objectId, multiply(component.matrix, matrix), depth + 1, `${path}/${component.objectId}`);
    }
  };

  for (const item of items) emit(item.objectId, item.matrix, 0, item.objectId);

  return { meshes, unit, scale, warnings };
}

/** Ouvre l'archive 3MF et analyse le modèle qu'elle contient. */
export function parseThreeMf(buffer: ArrayBuffer): ThreeMfDocument {
  const entries = unzipSync(new Uint8Array(buffer));
  const names = Object.keys(entries);
  const modelName =
    names.find((n) => n.toLowerCase() === '3d/3dmodel.model') ??
    names.find((n) => n.toLowerCase().endsWith('.model'));
  if (!modelName) throw new Error('Archive 3MF sans fichier modèle (.model).');
  const document = parseModelXml(strFromU8(entries[modelName]!));
  if (names.length > 1 && document.meshes.length === 0) {
    document.warnings.push('Le fichier ne contient aucun maillage exploitable.');
  }
  return document;
}
