/** Contrat d'échange entre les workers d'import et l'application. */

export interface ImportedMesh {
  id: string;
  name: string;
  /** Positions en millimètres, repère Z vers le haut. */
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Numéro de face B-rep par triangle ; vide si le format n'en porte pas. */
  faceIds: Int32Array | null;
  color: [number, number, number] | null;
  /** Arêtes prêtes pour un rendu en LINES (paires de points). */
  edgePositions: Float32Array;
  /** Sommets dédupliqués, pour l'accrochage. */
  weldedVertices: Float32Array;
  /** Arêtes en paires d'indices dans `weldedVertices` : sert à reconstruire les
   *  contours, donc à retrouver les perçages. */
  edgeSegments: Uint32Array;
}

export interface ImportStats {
  meshes: number;
  triangles: number;
  edges: number;
  durationMs: number;
}

export interface ImportedModel {
  name: string;
  format: 'step' | '3mf' | 'stl' | 'iges';
  meshes: ImportedMesh[];
  stats: ImportStats;
  warnings: string[];
}

export interface ImportOptions {
  /** Qualité de tessellation STEP : fraction de la boîte englobante. */
  linearDeflection: number;
  angularDeflection: number;
  /** Angle dièdre de détection des arêtes vives (degrés). */
  creaseAngle: number;
  /** Axe « haut » du fichier source ; 'Y' déclenche une rotation vers le Z-up interne. */
  upAxis: 'Z' | 'Y';
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  linearDeflection: 0.002,
  angularDeflection: 0.4,
  creaseAngle: 25,
  upAxis: 'Z',
};

/* ---- Protocole des workers ---- */

export interface ImportRequest {
  kind: 'import';
  format: ImportedModel['format'];
  fileName: string;
  buffer: ArrayBuffer;
  options: ImportOptions;
  /** URL de base où le worker trouve le moteur OpenCascade (glue + WASM). */
  wasmBase: string;
}

export type ImportResponse =
  | { kind: 'progress'; step: string; ratio: number }
  | { kind: 'done'; model: ImportedModel }
  | { kind: 'error'; message: string };
