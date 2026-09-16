/** Sauvegarde du projet et export du tableau de fils. */
import type { Computation } from '../core/harness/compute';
import { emptyProject, PROJECT_VERSION, SLEEVE_LABEL, type Project } from '../core/harness/types';

export function serializeProject(project: Project): string {
  return JSON.stringify({ ...project, version: PROJECT_VERSION }, null, 2);
}

export function parseProject(text: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Fichier illisible : ce n’est pas du JSON.');
  }
  const record = data as Partial<Project> | null;
  if (!record || !Array.isArray(record.wires)) throw new Error('Ce fichier n’est pas un projet de cheminement.');
  return {
    ...emptyProject(),
    ...record,
    version: PROJECT_VERSION,
    units: 'mm',
    torons: Array.isArray(record.torons) ? record.torons : [],
  };
}

function download(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

const slug = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'faisceau';

export function downloadProject(project: Project): void {
  download(serializeProject(project), `${slug(project.name)}.json`, 'application/json');
}

/** CSV à points-virgules et virgule décimale : ce qu'attend un tableur français. */
export function downloadWireTable(project: Project, computation: Computation): void {
  const cell = (value: string | number): string => {
    const text = typeof value === 'number' ? value.toFixed(1).replace('.', ',') : value;
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = project.wires.map((wire) => {
    const result = computation.wires.get(wire.id);
    const toron = project.torons.find((item) => item.id === wire.toronId);
    return [
      wire.name,
      wire.sectionMm2,
      wire.outerDiameter,
      wire.from || '—',
      wire.to || '—',
      result?.ready ? Math.round(result.length) : '',
      result?.ready ? Math.round(result.massGram) : '',
      result?.ready ? result.resistanceMilliOhm : '',
      toron ? `${toron.name} (${SLEEVE_LABEL[toron.sleeve]})` : '',
      wire.note ?? '',
    ].map(cell).join(';');
  });
  const header = ['Repère', 'Section mm²', 'Ø ext mm', 'De', 'Vers', 'Longueur mm', 'Poids g', 'Résistance mΩ', 'Toron', 'Note']
    .map(cell)
    .join(';');
  download('﻿' + [header, ...rows].join('\r\n'), `${slug(project.name)}-fils.csv`, 'text/csv');
}
