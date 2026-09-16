/** Édition du tracé à la souris : attraper un point et le tirer, ou tirer la
 *  courbe elle-même pour y ajouter un point.
 *
 *  Le déplacement vit dans l'état de session, pas dans le projet : on ne consigne
 *  dans l'historique que la position finale, une fois le point relâché — sans quoi
 *  un seul geste remplirait la pile d'annulation.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { closestPointOnAxis, insertIndexFor } from '../core/curve/edit';
import { planeThrough, type Plane } from '../core/curve/plane';
import type { Vec3 } from '../core/math/vec';
import { useProject, type PathTarget } from '../state/project';
import { useSession } from '../state/session';
import type { Picking } from './picking';

/** Déplacement en pixels à partir duquel on considère que l'utilisateur tire
 *  la courbe, et non qu'il clique dessus pour la sélectionner. */
const DRAG_THRESHOLD = 4;

export interface PathEditing {
  onHandleDown(target: PathTarget, index: number, event: ThreeEvent<PointerEvent>): void;
  onCurveDown(target: PathTarget, event: ThreeEvent<PointerEvent>): void;
  /** Déplacement contraint le long d'un axe du trièdre. */
  onAxisDown(target: PathTarget, index: number, origin: Vec3, axis: Vec3, event: ThreeEvent<PointerEvent>): void;
}

interface Gesture {
  target: PathTarget;
  mode: 'deplace' | 'insere';
  index: number;
  startX: number;
  startY: number;
  engaged: boolean;
  /** Renseigné pour un déplacement contraint : origine et direction de l'axe. */
  axis?: { origin: Vec3; direction: Vec3 };
  /** Plan dans lequel le point se déplace, à défaut de contrainte d'axe. */
  plane: Plane;
}

function pointsOf(target: PathTarget): Vec3[] {
  const project = useProject.getState().project;
  const holder = target.kind === 'fil'
    ? project.wires.find((wire) => wire.id === target.id)
    : project.torons.find((toron) => toron.id === target.id);
  return holder?.points ?? [];
}

export function usePathEditing(picking: Picking): PathEditing {
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const gesture = useRef<Gesture | null>(null);

  const finish = useCallback(() => {
    const current = gesture.current;
    const drag = useSession.getState().drag;
    gesture.current = null;
    if (controls) controls.enabled = true;
    useSession.getState().setDrag(null);
    useSession.getState().setSnapLabel(null);
    if (!current) return;

    if (!current.engaged || !drag) {
      // Simple clic sur la courbe : on se contente de sélectionner.
      useSession.getState().select({ kind: current.target.kind, id: current.target.id });
      return;
    }
    const store = useProject.getState();
    if (drag.mode === 'insere') store.insertPoint(current.target, drag.index, drag.position);
    else store.movePoint(current.target, drag.index, drag.position);
  }, [controls]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current) return;
      if (!current.engaged) {
        const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY);
        if (moved < DRAG_THRESHOLD) return;
        current.engaged = true;
      }
      if (current.axis) {
        // Contraint : le point suit le curseur sans quitter son axe, donc sans
        // s'accrocher à la géométrie.
        const ray = picking.ray(event.clientX, event.clientY);
        if (!ray) return;
        const position = closestPointOnAxis(current.axis.origin, current.axis.direction, ray.origin, ray.direction);
        useSession.getState().setDrag({
          kind: current.target.kind,
          id: current.target.id,
          index: current.index,
          position,
          mode: current.mode,
        });
        useSession.getState().setSnapLabel('Le long de l\u2019axe');
        return;
      }

      // Libre, mais dans le plan de travail : la caméra ne doit pas décider
      // d'où atterrit le point.
      const snapped = picking.pick(event.clientX, event.clientY, { plane: current.plane, constrain: true });
      if (!snapped) return;
      useSession.getState().setDrag({
        kind: current.target.kind,
        id: current.target.id,
        index: current.index,
        position: snapped.position,
        mode: current.mode,
      });
      useSession.getState().setSnapLabel(snapped.label);
    };

    const onUp = () => finish();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [picking, finish]);

  const start = useCallback(
    (
      target: PathTarget,
      mode: Gesture['mode'],
      index: number,
      event: ThreeEvent<PointerEvent>,
      axis?: { origin: Vec3; direction: Vec3 },
    ) => {
      if (event.nativeEvent.button !== 0) return;
      event.stopPropagation();
      // La vue ne doit pas tourner pendant qu'on tire un point.
      if (controls) controls.enabled = false;
      const points = pointsOf(target);
      // Le point se déplace dans un plan parallèle au plan de travail passant
      // par sa position de départ.
      const anchor = points[Math.max(0, Math.min(points.length - 1, index))] ?? [0, 0, 0];
      gesture.current = {
        target,
        mode,
        index,
        startX: event.nativeEvent.clientX,
        startY: event.nativeEvent.clientY,
        // Un point attrapé se déplace tout de suite ; la courbe attend un vrai geste.
        engaged: mode === 'deplace',
        plane: planeThrough(anchor, useSession.getState().workPlane),
        ...(axis ? { axis } : {}),
      };
      if (mode === 'deplace') {
        const position = points[index];
        if (position) {
          useSession.getState().setDrag({ kind: target.kind, id: target.id, index, position, mode });
        }
      }
    },
    [controls],
  );

  return {
    onHandleDown: (target, index, event) => {
      useSession.getState().setActivePoint({ kind: target.kind, id: target.id, index });
      start(target, 'deplace', index, event);
    },
    onAxisDown: (target, index, origin, direction, event) =>
      start(target, 'deplace', index, event, { origin, direction }),
    onCurveDown: (target, event) => {
      const position: Vec3 = [event.point.x, event.point.y, event.point.z];
      start(target, 'insere', insertIndexFor(pointsOf(target), position), event);
    },
  };
}
