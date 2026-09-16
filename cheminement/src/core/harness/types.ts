/** Modèle de données du faisceau électrique.
 *
 *  Vocabulaire retenu (métier câblage FR) :
 *   - « nœud »    : point remarquable du cheminement (connecteur, collier, épissure, dérivation) ;
 *   - « segment » : tronçon de cheminement entre deux nœuds — c'est lui qui porte la gaine ;
 *   - « toron »   : ensemble des fils qui empruntent un même segment (calculé, jamais saisi) ;
 *   - « tenant »  : extrémité d'un fil. Un fil a un tenant G et un tenant D, chacun repéré par
 *                   son connecteur, sa cavité, son contact et son joint.
 */
import type { Vec3 } from '../math/vec';

export type Id = string;

/* ------------------------------------------------------------------ nœuds */

export type NodeKind =
  | 'connecteur'   // embase, prise : point d'entrée/sortie des fils
  | 'derivation'   // point de branchement du cheminement (patte d'oie)
  | 'collier'      // collier, clip, passe-fil : contraint le passage
  | 'epissure'     // épissure / nœud de raccordement de fils entre eux
  | 'passage'      // simple point de passage libre
  ;

/** Origine géométrique d'un point : on garde la trace de l'accrochage pour
 *  pouvoir requalifier le cheminement si le modèle CAO est réimporté. */
export interface SnapOrigin {
  kind: 'sommet' | 'arete' | 'face' | 'centre-cercle' | 'axe-cylindre' | 'libre' | 'milieu-arete';
  partId?: Id;
  faceIndex?: number;
  /** Rayon du perçage lorsque l'accrochage vient d'un cercle ou d'un cylindre. */
  radius?: number;
  /** Axe local (normale de face, axe de cylindre, direction d'arête). */
  axis?: Vec3;
}

export interface RouteNode {
  id: Id;
  name: string;
  kind: NodeKind;
  position: Vec3;
  /** Direction de sortie imposée (connecteur, collier orienté), unitaire. */
  exitDirection?: Vec3;
  /** Longueur du brin rectiligne imposé en sortie, avant tout coude. */
  exitLength: number;
  /** Connecteur monté sur ce nœud (nœuds de type « connecteur »). */
  connectorId?: Id;
  /** Collier : référence et diamètre intérieur admissible. */
  clamp?: { ref: string; innerDiameter: number };
  snap?: SnapOrigin;
  locked: boolean;
}

/* --------------------------------------------------------------- segments */

export interface RouteSegment {
  id: Id;
  name: string;
  a: Id;
  b: Id;
  /** Points de passage intermédiaires, en plus des deux nœuds. */
  vias: Vec3[];
  /** Rayon de coude appliqué aux angles de la polyligne (mm). */
  bendRadius: number;
  /** Mou : rallonge relative appliquée aux fils du segment (0.02 = +2 %). */
  slack: number;
  sleeveId?: Id;
  /** Longueur imposée manuellement (mm) ; sinon longueur géométrique. */
  overrideLength?: number;
  locked: boolean;
}

/* ------------------------------------------------------ fils et connecteurs */

export interface ConnectorCavity {
  code: string;
  label?: string;
}

export interface ConnectorDef {
  id: Id;
  ref: string;
  name: string;
  gender: 'male' | 'femelle' | 'mixte';
  cavities: ConnectorCavity[];
  color: string;
  /** Diamètre d'entrée de câble, sert au contrôle de remplissage. */
  entryDiameter?: number;
}

/** Extrémité de fil : le « tenant ». */
export interface Tenant {
  nodeId: Id | null;
  cavity: string;
  /** Référence du contact serti (cosse, clip). */
  terminalRef?: string;
  /** Référence du joint d'étanchéité. */
  sealRef?: string;
  /** Longueur de dénudage (mm). */
  stripLength: number;
  /** Longueur libre au-delà du dernier nœud du cheminement (mm). */
  tailLength: number;
  /** Marquage / bague posée à cette extrémité. */
  marking?: string;
}

export type TenantSide = 'G' | 'D';

export interface WireSpec {
  id: Id;
  ref: string;
  /** Section cuivre (mm²). */
  sectionMm2: number;
  /** Diamètre extérieur isolant compris (mm) : c'est lui qui fait le toron. */
  outerDiameter: number;
  awg?: string;
  /** Masse linéique (g/m). */
  massPerMeter: number;
  /** Résistance linéique (mΩ/m) à 20 °C. */
  resistancePerMeter: number;
  /** Courant admissible (A). */
  currentRating: number;
  /** Rayon de courbure minimal, exprimé en multiples du diamètre extérieur. */
  minBendFactor: number;
  material: string;
}

export interface Wire {
  id: Id;
  /** Repère fil porté au plan et sur le marquage. */
  name: string;
  specId: Id;
  /** Section recopiée : autorise un fil hors catalogue sans casser le calcul. */
  sectionMm2: number;
  outerDiameter: number;
  color: string;
  tenantG: Tenant;
  tenantD: Tenant;
  /** Cheminement : suite de nœuds. Recalculé si `pathMode === 'auto'`. */
  path: Id[];
  pathMode: 'auto' | 'manuel';
  /** Réseau / fonction (alimentation, CAN, masse…), sert aux filtres et couleurs. */
  network?: string;
  /** Courant de service déclaré (A), confronté au courant admissible du catalogue. */
  currentA?: number;
  note?: string;
}

/* ------------------------------------------------------------------ gaines */

export type SleeveKind =
  | 'spiralee'   // gaine spiralée, enroulée en hélice autour du toron
  | 'annelee'    // gaine annelée fendue (type ICTA/TPC)
  | 'tressee'    // gaine tressée extensible
  | 'thermo'     // gaine thermorétractable
  | 'ruban'      // ruban de câblage, enroulé à recouvrement
  ;

export interface Sleeve {
  id: Id;
  name: string;
  kind: SleeveKind;
  ref?: string;
  color: string;
  /** Diamètre intérieur nominal (mm). */
  innerDiameter: number;
  /** Épaisseur de paroi (mm). */
  wallThickness: number;
  /** Pas de l'hélice pour une spiralée / un ruban (mm par tour). */
  pitch: number;
  /** Largeur de la bande enroulée (mm). */
  bandWidth: number;
  /** Taux de recouvrement visé pour un ruban (0..1). */
  overlap: number;
  segmentIds: Id[];
}

/* ------------------------------------------------------------- géométrie CAO */

export interface PartRef {
  id: Id;
  name: string;
  visible: boolean;
  /** Nombre de triangles, pour l'affichage d'infos. */
  triangleCount: number;
}

/* --------------------------------------------------------------- réglages */

export interface HarnessSettings {
  /** Coefficient de foisonnement appliqué au diamètre de toron calculé. */
  packingFactor: number;
  /** Taux de remplissage maximal admis dans une gaine (0..1). */
  maxFillRatio: number;
  /** Rayon de coude par défaut des nouveaux segments (mm). */
  defaultBendRadius: number;
  /** Mou par défaut (0.02 = 2 %). */
  defaultSlack: number;
  /** Rayon de courbure mini du toron, en multiples de son diamètre. */
  bundleMinBendFactor: number;
  /** Corrige la longueur de chaque fil selon sa position dans le toron. */
  correctLengthByPosition: boolean;
  /** Tolérance d'accrochage, en pixels écran. */
  snapPixelRadius: number;
}

export const DEFAULT_SETTINGS: HarnessSettings = {
  packingFactor: 1.15,
  maxFillRatio: 0.7,
  defaultBendRadius: 25,
  defaultSlack: 0.03,
  bundleMinBendFactor: 4,
  correctLengthByPosition: false,
  snapPixelRadius: 12,
};

/* ----------------------------------------------------------------- projet */

export const PROJECT_FORMAT_VERSION = 1 as const;

export interface HarnessProject {
  formatVersion: number;
  name: string;
  /** Unité interne : toujours le millimètre. */
  units: 'mm';
  createdAt: string;
  nodes: Record<Id, RouteNode>;
  segments: Record<Id, RouteSegment>;
  wires: Record<Id, Wire>;
  sleeves: Record<Id, Sleeve>;
  connectors: Record<Id, ConnectorDef>;
  specs: Record<Id, WireSpec>;
  settings: HarnessSettings;
}

export function emptyProject(name = 'Nouveau faisceau'): HarnessProject {
  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    name,
    units: 'mm',
    createdAt: new Date().toISOString(),
    nodes: {},
    segments: {},
    wires: {},
    sleeves: {},
    connectors: {},
    specs: {},
    settings: { ...DEFAULT_SETTINGS },
  };
}

let counter = 0;
export function newId(prefix: string): Id {
  counter += 1;
  return `${prefix}_${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
