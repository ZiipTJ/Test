/** Sauvegarde et relecture d'un projet, plus les exports bureautiques.
 *  Le fichier est un JSON versionné : lisible, diffable, et migrable. */
import { DEFAULT_SETTINGS, PROJECT_FORMAT_VERSION, emptyProject, type HarnessProject } from '../core/harness/types';
import type { BomLine, CutListRow } from '../core/harness/bom';

export function serializeProject(project: HarnessProject): string {
  return JSON.stringify({ ...project, formatVersion: PROJECT_FORMAT_VERSION }, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Relit un projet en comblant les manques : un fichier d'une version antérieure
 *  doit s'ouvrir, quitte à retomber sur les réglages par défaut. */
export function parseProject(text: string): HarnessProject {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Fichier illisible : ce n’est pas du JSON.');
  }
  if (!isRecord(data)) throw new Error('Fichier de projet invalide.');

  const version = Number(data['formatVersion'] ?? 0);
  if (version > PROJECT_FORMAT_VERSION) {
    throw new Error(`Projet enregistré dans une version plus récente (${version}) que celle de l’application (${PROJECT_FORMAT_VERSION}).`);
  }
  for (const key of ['nodes', 'segments', 'wires'] as const) {
    if (!isRecord(data[key])) throw new Error(`Fichier de projet invalide : « ${key} » manquant.`);
  }

  const base = emptyProject();
  return {
    ...base,
    ...(data as Partial<HarnessProject>),
    formatVersion: PROJECT_FORMAT_VERSION,
    units: 'mm',
    sleeves: isRecord(data['sleeves']) ? (data['sleeves'] as HarnessProject['sleeves']) : {},
    connectors: isRecord(data['connectors']) ? (data['connectors'] as HarnessProject['connectors']) : {},
    specs: isRecord(data['specs']) ? (data['specs'] as HarnessProject['specs']) : {},
    settings: { ...DEFAULT_SETTINGS, ...(isRecord(data['settings']) ? data['settings'] : {}) },
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

export function downloadProject(project: HarnessProject): void {
  download(serializeProject(project), `${slug(project.name)}.cheminement.json`, 'application/json');
}

/** CSV séparé par points-virgules : c'est ce qu'attend un tableur en français. */
function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const escape = (value: string | number): string => {
    const text = typeof value === 'number' ? value.toString().replace('.', ',') : value;
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return ['﻿' + headers.map(escape).join(';'), ...rows.map((row) => row.map(escape).join(';'))].join('\r\n');
}

export function downloadCutList(project: HarnessProject, rows: CutListRow[]): void {
  const content = toCsv(
    [
      'Repère', 'Référence', 'Section mm²', 'Ø ext mm', 'Couleur', 'Réseau', 'Longueur mm',
      'Tenant G — connecteur', 'Tenant G — cavité', 'Tenant G — contact', 'Tenant G — joint', 'Tenant G — dénudage mm', 'Tenant G — marquage',
      'Tenant D — connecteur', 'Tenant D — cavité', 'Tenant D — contact', 'Tenant D — joint', 'Tenant D — dénudage mm', 'Tenant D — marquage',
      'Cheminement', 'Masse g', 'Résistance mΩ', 'État',
    ],
    rows.map((row) => [
      row.repere, row.reference, row.section, row.diametre, row.couleur, row.reseau, Math.round(row.longueur),
      row.tenantG.connecteur, row.tenantG.cavite, row.tenantG.contact, row.tenantG.joint, row.tenantG.denudage, row.tenantG.marquage,
      row.tenantD.connecteur, row.tenantD.cavite, row.tenantD.contact, row.tenantD.joint, row.tenantD.denudage, row.tenantD.marquage,
      row.cheminement, Math.round(row.masse), Math.round(row.resistance), row.statut,
    ]),
  );
  download(content, `${slug(project.name)}-liste-de-coupe.csv`, 'text/csv');
}

export function downloadBom(project: HarnessProject, lines: BomLine[]): void {
  const content = toCsv(
    ['Famille', 'Référence', 'Désignation', 'Quantité', 'Unité', 'Détail'],
    lines.map((line) => [line.famille, line.reference, line.designation, Number(line.quantite.toFixed(3)), line.unite, line.detail ?? '']),
  );
  download(content, `${slug(project.name)}-nomenclature.csv`, 'text/csv');
}

export function downloadSvg(project: HarnessProject, svg: string): void {
  download(svg, `${slug(project.name)}-mise-a-plat.svg`, 'image/svg+xml');
}
