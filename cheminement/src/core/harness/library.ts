/** Catalogues par défaut : fils, gaines, connecteurs.
 *  Valeurs représentatives des câbles souples type FLRY-B / H07V-K ; elles sont
 *  toutes éditables dans l'application, le catalogue n'est qu'un point de départ. */
import type { ConnectorDef, Sleeve, SleeveKind, WireSpec } from './types';

export interface WireCatalogEntry extends Omit<WireSpec, 'id'> {
  id: string;
}

/** section (mm²), Ø extérieur (mm), AWG, masse (g/m), R (mΩ/m), I adm. (A) */
const RAW_WIRES: Array<[number, number, string, number, number, number]> = [
  [0.35, 1.4, '22', 4.7, 54.4, 8.75],
  [0.5, 1.6, '20', 6.3, 37.1, 11],
  [0.75, 1.9, '18', 9.0, 24.7, 13.5],
  [1.0, 2.1, '17', 11.7, 18.5, 16.5],
  [1.5, 2.4, '15', 17.0, 12.7, 21],
  [2.5, 3.1, '13', 27.0, 7.6, 30],
  [4.0, 3.7, '11', 42.0, 4.71, 40],
  [6.0, 4.5, '9', 62.0, 3.14, 51],
  [10.0, 6.0, '7', 103.0, 1.82, 70],
  [16.0, 7.4, '5', 162.0, 1.16, 94],
  [25.0, 9.3, '3', 250.0, 0.74, 121],
];

export const WIRE_CATALOG: WireCatalogEntry[] = RAW_WIRES.map(
  ([sectionMm2, outerDiameter, awg, massPerMeter, resistancePerMeter, currentRating]) => ({
    id: `flry-${String(sectionMm2).replace('.', 'p')}`,
    ref: `FLRY-B ${sectionMm2.toFixed(2)} mm²`,
    sectionMm2,
    outerDiameter,
    awg,
    massPerMeter,
    resistancePerMeter,
    currentRating,
    minBendFactor: 5,
    material: 'Cuivre étamé / PVC',
  }),
);

export function findSpecBySection(section: number): WireCatalogEntry {
  let best = WIRE_CATALOG[0]!;
  let bestDelta = Infinity;
  for (const entry of WIRE_CATALOG) {
    const delta = Math.abs(entry.sectionMm2 - section);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = entry;
    }
  }
  return best;
}

/** Couleurs normalisées de repérage, avec leur libellé métier. */
export const WIRE_COLORS: Array<{ code: string; label: string; hex: string }> = [
  { code: 'NO', label: 'Noir', hex: '#1c1c1c' },
  { code: 'MA', label: 'Marron', hex: '#7a4a21' },
  { code: 'RG', label: 'Rouge', hex: '#d0342c' },
  { code: 'OR', label: 'Orange', hex: '#e08028' },
  { code: 'JA', label: 'Jaune', hex: '#e8c22a' },
  { code: 'VE', label: 'Vert', hex: '#2f9e51' },
  { code: 'BL', label: 'Bleu', hex: '#2f6fd0' },
  { code: 'VI', label: 'Violet', hex: '#8455b5' },
  { code: 'GR', label: 'Gris', hex: '#9aa0aa' },
  { code: 'BC', label: 'Blanc', hex: '#eceff3' },
  { code: 'RS', label: 'Rose', hex: '#e08aa8' },
  { code: 'VJ', label: 'Vert/Jaune', hex: '#8fbf3f' },
];

/* -------------------------------------------------------------------- gaines */

export interface SleeveCatalogEntry {
  ref: string;
  kind: SleeveKind;
  innerDiameter: number;
  wallThickness: number;
  pitch: number;
  bandWidth: number;
  overlap: number;
  color: string;
}

const SPIRAL_SIZES = [4, 6, 8, 12, 16, 20, 25, 32];
const CORRUGATED_SIZES = [7, 10, 13, 17, 22, 29];
const BRAID_SIZES = [6, 10, 15, 20, 25];
const HEATSHRINK_SIZES = [3, 6, 9, 12, 19];

export const SLEEVE_CATALOG: SleeveCatalogEntry[] = [
  ...SPIRAL_SIZES.map((d) => ({
    ref: `Spiralée Ø${d}`,
    kind: 'spiralee' as const,
    innerDiameter: d,
    wallThickness: Math.max(0.5, d * 0.05),
    // Pas courant d'une spiralée : de l'ordre de 2,5 fois son diamètre.
    pitch: d * 2.5,
    bandWidth: Math.max(2, d * 0.45),
    overlap: 0,
    color: '#b9bec7',
  })),
  ...CORRUGATED_SIZES.map((d) => ({
    ref: `Annelée fendue Ø${d}`,
    kind: 'annelee' as const,
    innerDiameter: d,
    wallThickness: Math.max(0.8, d * 0.08),
    pitch: Math.max(3, d * 0.35),
    bandWidth: 0,
    overlap: 0,
    color: '#2b2f36',
  })),
  ...BRAID_SIZES.map((d) => ({
    ref: `Tressée PET Ø${d}`,
    kind: 'tressee' as const,
    innerDiameter: d,
    wallThickness: 0.5,
    pitch: d * 1.6,
    bandWidth: 0,
    overlap: 0,
    color: '#3a3f47',
  })),
  ...HEATSHRINK_SIZES.map((d) => ({
    ref: `Thermo 2:1 Ø${d}`,
    kind: 'thermo' as const,
    innerDiameter: d,
    wallThickness: 0.6,
    pitch: 0,
    bandWidth: 0,
    overlap: 0,
    color: '#15181d',
  })),
  {
    ref: 'Ruban câblage 19 mm',
    kind: 'ruban',
    innerDiameter: 0,
    wallThickness: 0.2,
    pitch: 9,
    bandWidth: 19,
    overlap: 0.5,
    color: '#23262c',
  },
];

export const SLEEVE_KIND_LABEL: Record<SleeveKind, string> = {
  spiralee: 'Gaine spiralée',
  annelee: 'Gaine annelée fendue',
  tressee: 'Gaine tressée',
  thermo: 'Gaine thermorétractable',
  ruban: 'Ruban de câblage',
};

/** Choisit la plus petite gaine du catalogue acceptant un toron de Ø donné,
 *  en respectant le taux de remplissage maximal. */
export function selectSleeve(
  kind: SleeveKind,
  bundleDiameter: number,
  maxFillRatio: number,
): SleeveCatalogEntry | null {
  const candidates = SLEEVE_CATALOG.filter((s) => s.kind === kind && s.innerDiameter > 0)
    .slice()
    .sort((a, b) => a.innerDiameter - b.innerDiameter);
  const needed = bundleDiameter / Math.sqrt(Math.max(0.05, maxFillRatio));
  return candidates.find((s) => s.innerDiameter >= needed) ?? candidates[candidates.length - 1] ?? null;
}

export function sleeveFromCatalog(entry: SleeveCatalogEntry, id: string, name: string): Sleeve {
  return {
    id,
    name,
    kind: entry.kind,
    ref: entry.ref,
    color: entry.color,
    innerDiameter: entry.innerDiameter,
    wallThickness: entry.wallThickness,
    pitch: entry.pitch,
    bandWidth: entry.bandWidth,
    overlap: entry.overlap,
    segmentIds: [],
  };
}

/* --------------------------------------------------------------- connecteurs */

export interface ConnectorCatalogEntry {
  ref: string;
  name: string;
  ways: number;
  gender: ConnectorDef['gender'];
  entryDiameter: number;
}

export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  { ref: 'MQS-02', name: 'Connecteur 2 voies', ways: 2, gender: 'femelle', entryDiameter: 6 },
  { ref: 'MQS-04', name: 'Connecteur 4 voies', ways: 4, gender: 'femelle', entryDiameter: 8 },
  { ref: 'MQS-06', name: 'Connecteur 6 voies', ways: 6, gender: 'femelle', entryDiameter: 10 },
  { ref: 'MQS-08', name: 'Connecteur 8 voies', ways: 8, gender: 'femelle', entryDiameter: 12 },
  { ref: 'MQS-12', name: 'Connecteur 12 voies', ways: 12, gender: 'femelle', entryDiameter: 14 },
  { ref: 'MQS-16', name: 'Connecteur 16 voies', ways: 16, gender: 'femelle', entryDiameter: 16 },
  { ref: 'PWR-M8', name: 'Cosse à œil M8', ways: 1, gender: 'male', entryDiameter: 10 },
  { ref: 'BORNIER-12', name: 'Bornier 12 points', ways: 12, gender: 'mixte', entryDiameter: 18 },
];

export function connectorFromCatalog(entry: ConnectorCatalogEntry, id: string, name?: string): ConnectorDef {
  return {
    id,
    ref: entry.ref,
    name: name ?? entry.name,
    gender: entry.gender,
    color: '#4a5260',
    entryDiameter: entry.entryDiameter,
    cavities: Array.from({ length: entry.ways }, (_, i) => ({ code: String(i + 1) })),
  };
}

/** Références de contacts proposées selon la section du fil. */
export function suggestTerminal(section: number): string {
  if (section <= 0.5) return 'MQS 0,35-0,5';
  if (section <= 1.0) return 'MQS 0,75-1,0';
  if (section <= 2.5) return 'MCP 1,5-2,5';
  if (section <= 6) return 'Cosse pré-isolée 4-6';
  return 'Cosse à œil sertie';
}
