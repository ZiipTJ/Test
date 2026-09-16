/** Faisceau de démonstration, tracé sur la platine livrée dans public/demo :
 *  un toron de quatre fils sous gaine spiralée le long de la platine, et deux
 *  fils libres qui partent vers la traverse. */
import { gradeForSection } from '../core/harness/library';
import { emptyProject, newId, type Project, type Wire } from '../core/harness/types';
import type { Vec3 } from '../core/math/vec';

interface Seed {
  name: string;
  section: number;
  color: string;
  from: string;
  to: string;
  points?: Vec3[];
}

/** Le long de la platine : sortie du support gauche, deux perçages, support droit. */
const TRUNK: Vec3[] = [
  [100, 200, 60],
  [300, 200, 10],
  [600, 200, 10],
  [700, 200, 60],
];

/** Dérivation vers la traverse. */
const BRANCH: Vec3[] = [
  [100, 200, 60],
  [300, 200, 10],
  [400, 60, 10],
  [400, 60, 60],
];

const TRUNK_WIRES: Seed[] = [
  { name: 'ALIM+', section: 4, color: '#d0342c', from: 'Bornier A / 1', to: 'Bornier C / 1' },
  { name: 'ALIM-', section: 4, color: '#1c1c1c', from: 'Bornier A / 2', to: 'Bornier C / 2' },
  { name: 'MASSE', section: 2.5, color: '#7a4a21', from: 'Bornier A / 3', to: 'Masse châssis' },
  { name: 'CMD-VENT', section: 1, color: '#2f6fd0', from: 'Bornier A / 4', to: 'Bornier C / 4' },
];

/** Le second fil libre longe le premier sans le recouvrir : deux fils distincts
 *  se voient, alors que deux chemins identiques se confondraient à l'écran. */
const BRANCH_BIS: Vec3[] = BRANCH.map(([x, y, z]) => [x, y + 10, z] as Vec3);

const FREE_WIRES: Seed[] = [
  { name: 'CAN-H', section: 0.5, color: '#e0b62a', from: 'Bornier A / 5', to: 'Capteur B / 1', points: BRANCH },
  { name: 'CAN-L', section: 0.5, color: '#2f9e51', from: 'Bornier A / 6', to: 'Capteur B / 2', points: BRANCH_BIS },
];

function makeWire(seed: Seed, points: Vec3[]): Wire {
  const grade = gradeForSection(seed.section);
  return {
    id: newId('f'),
    name: seed.name,
    sectionMm2: grade.sectionMm2,
    color: seed.color,
    outerDiameter: grade.outerDiameter,
    massPerMeter: grade.massPerMeter,
    resistancePerMeter: grade.resistancePerMeter,
    points: points.map((point) => [...point] as Vec3),
    from: seed.from,
    to: seed.to,
    bendRadius: 60,
    slack: 0.03,
    tails: 40,
  };
}

export function buildDemoProject(): Project {
  const project = emptyProject('Platine — démonstration');

  const trunkWires = TRUNK_WIRES.map((seed) => makeWire(seed, TRUNK));
  const freeWires = FREE_WIRES.map((seed) => makeWire(seed, seed.points ?? BRANCH));
  project.wires = [...trunkWires, ...freeWires];

  const toronId = newId('t');
  project.torons = [{
    id: toronId,
    name: 'Toron 1',
    wireIds: trunkWires.map((wire) => wire.id),
    points: TRUNK.map((point) => [...point] as Vec3),
    sleeve: 'spiralee',
    bendRadius: 60,
    color: '#9aa2ae',
  }];
  for (const wire of trunkWires) wire.toronId = toronId;

  return project;
}
