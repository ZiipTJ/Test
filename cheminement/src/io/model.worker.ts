/// <reference lib="webworker" />
/** Worker d'import : tessellation STEP par OpenCascade, lecture 3MF et STL,
 *  puis extraction des arêtes. Tout le travail lourd se fait ici, et les
 *  tableaux typés repartent en transfert de propriété (aucune recopie). */
import type { OcctModule } from 'occt-import-js';
import { occtResultToRaw } from './formats/step';
import { parseStl } from './formats/stl';
import { parseThreeMf } from './formats/threemf';
import { finalizeMeshes, type RawImportMesh } from './postprocess';
import type { ImportedModel, ImportRequest, ImportResponse } from './types';

const scope = self as unknown as DedicatedWorkerGlobalScope & {
  occtimportjs?: (options: { locateFile: (path: string) => string }) => Promise<OcctModule>;
  importScripts: (...urls: string[]) => void;
};

const post = (message: ImportResponse, transfer: Transferable[] = []): void => {
  scope.postMessage(message, transfer);
};

const progress = (step: string, ratio: number): void => post({ kind: 'progress', step, ratio });

let occtPromise: Promise<OcctModule> | null = null;

function loadOcct(base: string): Promise<OcctModule> {
  if (!occtPromise) {
    scope.importScripts(`${base}occt-import-js.js`);
    const factory = scope.occtimportjs;
    if (!factory) throw new Error('Moteur OpenCascade introuvable (public/wasm manquant ?).');
    occtPromise = factory({ locateFile: () => `${base}occt-import-js.wasm` });
  }
  return occtPromise;
}

async function readStep(request: ImportRequest): Promise<{ raw: RawImportMesh[]; warnings: string[] }> {
  progress('Chargement du moteur OpenCascade', 0.1);
  const occt = await loadOcct(request.wasmBase);

  progress('Lecture et tessellation du modèle', 0.3);
  const parameters = {
    linearUnit: 'millimeter' as const,
    linearDeflectionType: 'bounding_box_ratio' as const,
    linearDeflection: request.options.linearDeflection,
    angularDeflection: request.options.angularDeflection,
  };
  const buffer = new Uint8Array(request.buffer);
  const result =
    request.format === 'iges' ? occt.ReadIgesFile(buffer, parameters) : occt.ReadStepFile(buffer, parameters);

  return occtResultToRaw(result);
}

function readThreeMf(request: ImportRequest): { raw: RawImportMesh[]; warnings: string[] } {
  progress('Ouverture de l’archive 3MF', 0.2);
  const document = parseThreeMf(request.buffer);
  const raw: RawImportMesh[] = document.meshes.map((mesh, index) => ({
    id: `3mf-${index}`,
    name: mesh.name,
    positions: mesh.positions,
    indices: mesh.indices,
    normals: null,
    faceIds: null,
    color: mesh.color,
  }));
  return { raw, warnings: document.warnings };
}

function readStl(request: ImportRequest): { raw: RawImportMesh[]; warnings: string[] } {
  progress('Lecture du STL', 0.2);
  const mesh = parseStl(request.buffer);
  return {
    raw: [{ id: 'stl-0', name: mesh.name, positions: mesh.positions, indices: mesh.indices, normals: null, faceIds: null, color: null }],
    warnings: ['Le STL ne porte ni unité ni topologie : millimètre supposé, arêtes déduites de l’angle.'],
  };
}

scope.onmessage = async (event: MessageEvent<ImportRequest>) => {
  const request = event.data;
  if (request?.kind !== 'import') return;
  const started = Date.now();

  try {
    const { raw, warnings } =
      request.format === 'step' || request.format === 'iges'
        ? await readStep(request)
        : request.format === '3mf'
          ? readThreeMf(request)
          : readStl(request);

    if (raw.length === 0) throw new Error('Aucun corps exploitable dans ce fichier.');

    progress('Calcul des normales et des arêtes', 0.7);
    const { meshes, stats, transfer } = finalizeMeshes(raw, request.options);

    const model: ImportedModel = {
      name: request.fileName,
      format: request.format,
      meshes,
      stats: { ...stats, durationMs: Date.now() - started },
      warnings,
    };
    progress('Terminé', 1);
    post({ kind: 'done', model }, transfer);
  } catch (error) {
    post({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
