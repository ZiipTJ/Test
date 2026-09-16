/** Façade d'import : choisit le format, pilote le worker, rend un modèle prêt à afficher. */
import { DEFAULT_IMPORT_OPTIONS, type ImportedModel, type ImportOptions, type ImportRequest, type ImportResponse } from './types';

export type SupportedFormat = ImportedModel['format'];

const EXTENSIONS: Record<string, SupportedFormat> = {
  step: 'step',
  stp: 'step',
  '3mf': '3mf',
  stl: 'stl',
  iges: 'iges',
  igs: 'iges',
};

export function detectFormat(fileName: string): SupportedFormat | null {
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  return EXTENSIONS[extension] ?? null;
}

export const ACCEPTED_EXTENSIONS = '.step,.stp,.3mf,.stl,.iges,.igs';

export interface ImportProgress {
  step: string;
  ratio: number;
}

export async function importModel(
  file: File,
  options: Partial<ImportOptions> = {},
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportedModel> {
  const format = detectFormat(file.name);
  if (!format) {
    throw new Error(`Format non reconnu pour « ${file.name} ». Formats acceptés : STEP, 3MF, STL, IGES.`);
  }

  const buffer = await file.arrayBuffer();
  const worker = new Worker(new URL('./model.worker.ts', import.meta.url));

  try {
    return await new Promise<ImportedModel>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<ImportResponse>) => {
        const message = event.data;
        if (message.kind === 'progress') onProgress?.({ step: message.step, ratio: message.ratio });
        else if (message.kind === 'done') resolve(message.model);
        else reject(new Error(message.message));
      };
      worker.onerror = (event) => reject(new Error(event.message || 'Échec du worker d’import.'));

      const request: ImportRequest = {
        kind: 'import',
        format,
        fileName: file.name,
        buffer,
        options: { ...DEFAULT_IMPORT_OPTIONS, ...options },
        wasmBase: new URL('wasm/', new URL(import.meta.env.BASE_URL, self.location.href)).href,
      };
      worker.postMessage(request, [buffer]);
    });
  } finally {
    worker.terminate();
  }
}
