/** Actions des outils de la barre : ce qui se passe quand on clique dans la scène.
 *  Les magasins sont lus en direct (getState) : ces fonctions ne sont pas des
 *  hooks et peuvent être appelées depuis n'importe quel gestionnaire. */
import type { Vec3 } from '../core/math/vec';
import { useProject } from '../state/project';
import { useSession } from '../state/session';
import { toSnapOrigin, type SnapCandidate } from './snapping';

const asVec3 = (candidate: SnapCandidate): Vec3 => [candidate.position.x, candidate.position.y, candidate.position.z];

/** Un clic dans le trou d'une platine pose naturellement un collier ; ailleurs,
 *  un simple point de passage. */
function nodeDefaults(candidate: SnapCandidate) {
  if (candidate.kind === 'centre-cercle' && candidate.radius) {
    const diameter = candidate.radius * 2;
    return {
      kind: 'collier' as const,
      clamp: { ref: `Collier Ø${Math.round(diameter)} embase`, innerDiameter: Math.max(6, diameter * 2) },
    };
  }
  return { kind: 'passage' as const };
}

export function pickOnModel(candidate: SnapCandidate, modifiers: { shift: boolean; alt: boolean }): void {
  const session = useSession.getState();
  const project = useProject.getState();
  const position = asVec3(candidate);

  switch (session.tool) {
    case 'node': {
      const defaults = nodeDefaults(candidate);
      const id = project.addNode({ position, ...defaults, snap: toSnapOrigin(candidate, candidate.meshId) });
      session.select({ kind: 'node', id });
      session.setStatus({ message: `Nœud posé (${candidate.label}).`, tone: 'succes' });
      break;
    }

    case 'route': {
      const defaults = nodeDefaults(candidate);
      const id = project.addNode({ position, ...defaults, snap: toSnapOrigin(candidate, candidate.meshId) });
      if (session.routeFrom) {
        project.addSegment(session.routeFrom, id);
        session.setStatus({ message: 'Segment créé. Cliquez pour continuer, Échap pour terminer.', tone: 'succes' });
      } else {
        session.setStatus({ message: 'Départ du cheminement. Cliquez le point suivant.', tone: 'info' });
      }
      session.setRouteFrom(id);
      session.select({ kind: 'node', id });
      break;
    }

    case 'via': {
      const target = session.selection.find((item) => item.kind === 'segment');
      if (!target) {
        session.setStatus({ message: 'Sélectionnez d’abord un segment, puis cliquez le point de passage.', tone: 'alerte' });
        return;
      }
      project.addVia(target.id, position);
      session.setStatus({ message: 'Point de passage ajouté.', tone: 'succes' });
      break;
    }

    case 'measure': {
      const measure = session.measure;
      if (!measure.from || measure.to) session.setMeasure({ from: position, to: null });
      else session.setMeasure({ from: measure.from, to: position });
      break;
    }

    case 'select':
    default: {
      // Alt + clic : déplacer le nœud sélectionné sur le point accroché.
      if (modifiers.alt) {
        const target = session.selection.find((item) => item.kind === 'node');
        if (target) {
          project.updateNode(target.id, { position, snap: toSnapOrigin(candidate, candidate.meshId) });
          session.setStatus({ message: `Nœud déplacé (${candidate.label}).`, tone: 'succes' });
          return;
        }
      }
      session.select({ kind: 'mesh', id: candidate.meshId }, modifiers.shift);
      break;
    }
  }
}

/** Clic sur un nœud existant : enchaîne le cheminement au lieu d'en créer un nouveau. */
export function pickNode(nodeId: string, modifiers: { shift: boolean }): void {
  const session = useSession.getState();
  const project = useProject.getState();

  if (session.tool === 'route') {
    if (session.routeFrom && session.routeFrom !== nodeId) {
      project.addSegment(session.routeFrom, nodeId);
      session.setStatus({ message: 'Segment créé entre deux nœuds existants.', tone: 'succes' });
    }
    session.setRouteFrom(nodeId);
  }
  session.select({ kind: 'node', id: nodeId }, modifiers.shift);
}

export function cancelCurrentTool(): void {
  const session = useSession.getState();
  session.setRouteFrom(null);
  session.setMeasure({ from: null, to: null });
}
