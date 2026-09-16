/** Modèle de données.
 *
 *  Un seul objet principal : **le fil**. Il porte son nom, sa section, son
 *  chemin tracé sur la pièce et ses deux extrémités. Plusieurs fils réunis
 *  forment un **toron** : ils suivent alors un chemin commun, et c'est le toron
 *  qui porte la gaine.
 */
import type { Vec3 } from '../math/vec';

export type Id = string;

export type SleeveKind = 'aucune' | 'spiralee' | 'annelee' | 'tressee';

export const SLEEVE_LABEL: Record<SleeveKind, string> = {
  aucune: 'Sans gaine',
  spiralee: 'Gaine spiralée',
  annelee: 'Gaine annelée',
  tressee: 'Gaine tressée',
};

export interface Wire {
  id: Id;
  /** Repère du fil, porté au plan et sur le marquage. */
  name: string;
  sectionMm2: number;
  color: string;
  /** Diamètre extérieur, isolant compris : c'est lui qui fait le toron. */
  outerDiameter: number;
  /** Masse linéique (g/m), pré-remplie d'après la section et modifiable. */
  massPerMeter: number;
  /** Résistance linéique (mΩ/m). */
  resistancePerMeter: number;
  /** Points cliqués sur la pièce. Ignorés tant que le fil est dans un toron. */
  points: Vec3[];
  /** Extrémités : tenant G (départ) et tenant D (arrivée), en clair. */
  from: string;
  to: string;
  /** Rayon des coudes (mm). */
  bendRadius: number;
  /** Mou : rallonge relative appliquée à la longueur (0,03 = +3 %). */
  slack: number;
  /** Longueur libre ajoutée à chaque extrémité (mm). */
  tails: number;
  toronId?: Id;
  note?: string;
}

export interface Toron {
  id: Id;
  name: string;
  wireIds: Id[];
  /** Chemin commun, repris du premier fil groupé puis modifiable. */
  points: Vec3[];
  sleeve: SleeveKind;
  bendRadius: number;
  color: string;
}

export const PROJECT_VERSION = 2 as const;

export interface Project {
  version: number;
  name: string;
  /** Unité interne : toujours le millimètre. */
  units: 'mm';
  wires: Wire[];
  torons: Toron[];
}

export function emptyProject(name = 'Nouveau faisceau'): Project {
  return { version: PROJECT_VERSION, name, units: 'mm', wires: [], torons: [] };
}

let counter = 0;
export function newId(prefix: string): Id {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
