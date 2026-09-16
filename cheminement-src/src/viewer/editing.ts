/** Édition du tracé à la souris : attraper un point et le tirer, ou tirer la
 *  courbe elle-même pour y ajouter un point.
 *
 *  Le déplacement vit dans l'état de session, pas dans le projet : on ne consigne
 *  dans l'historique que la position finale, une fois le point relâché — sans quoi
 *  un seul geste remplirait la pile d'annulation.
 */
import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { insertIndexFor } from '../core/curve/edit';
import type { Vec3 } from '../core/math/vec';
import { useProject, type PathTarget } from '../state/project';
import { useSession } from '../state/session';
import { findSnap } from './snapping';

/** Déplacement en pixels à partir duquel on considère que l'utilisateur tire
 *  la courbe, et non qu'il clique dessus pour la sélectionner. */
const DRAG_THRESHOLD = 4;

export interface PathEditing {
  onHandleDown(target: PathTarget, index: number, event: ThreeEvent<PointerEvent>): void;
  onCurveDown(target: PathTarget, event: ThreeEvent<PointerEvent>): void;
}

interface Gesture {
  target: PathTarget;
  mode: 'deplace' | 'insere';
  index: number;
  startX: number;
  startY: number;
  engaged: boolean;
}

function pointsOf(target: PathTarget): Vec3[] {
  const project = useProject.getState().project;
  const holder = target.kind === 'fil'
    ? project.wires.find((wire) => wire.id === target.id)
    : project.torons.find((toron) => toron.id === target.id);
  return holder?.points ?? [];
}

export function usePathEditing(modelGroup: React.RefObject<THREE.Group | null>, diagonal: number): PathEditing {
  const { camera, gl, size } = useThree();
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const gesture = useRef<Gesture | null>(null);
  const raycaster = useRef(new THREE.Raycaster());
  const pointer = useRef(new THREE.Vector2());

  /** Position accrochée sous le curseur, ou null si le pointeur quitte la pièce. */
  const snappedAt = useCallback(
    (clientX: number, clientY: number): { position: Vec3; label: string } | null => {
      const group = modelGroup.current;
      if (!group) return null;
      const rect = gl.domElement.getBoundingClientRect();
      pointer.current.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(pointer.current, camera);
      const hit = raycaster.current.intersectObject(group, true)[0];
      if (!hit) return null;

      const meshId = hit.object.userData['meshId'] as string | undefined;
      const mesh = useSession.getState().model?.meshes.find((item) => item.id === meshId);
      if (!mesh) return { position: [hit.point.x, hit.point.y, hit.point.z], label: 'Sur face' };

      const candidate = findSnap(
        { point: hit.point, face: hit.face ?? null, meshId: mesh.id, mesh },
        { camera, size, pointer: pointer.current, pixelRadius: 12, diagonal },
      );
      return {
        position: [candidate.position.x, candidate.position.y, candidate.position.z],
        label: candidate.label,
      };
    },
    [camera, gl, size, diagonal, modelGroup],
  );

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
      const snapped = snappedAt(event.clientX, event.clientY);
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
  }, [snappedAt, finish]);

  const start = useCallback(
    (target: PathTarget, mode: Gesture['mode'], index: number, event: ThreeEvent<PointerEvent>) => {
      if (event.nativeEvent.button !== 0) return;
      event.stopPropagation();
      // La vue ne doit pas tourner pendant qu'on tire un point.
      if (controls) controls.enabled = false;
      gesture.current = {
        target,
        mode,
        index,
        startX: event.nativeEvent.clientX,
        startY: event.nativeEvent.clientY,
        // Un point attrapé se déplace tout de suite ; la courbe attend un vrai geste.
        engaged: mode === 'deplace',
      };
      if (mode === 'deplace') {
        const points = pointsOf(target);
        const position = points[index];
        if (position) {
          useSession.getState().setDrag({ kind: target.kind, id: target.id, index, position, mode });
        }
      }
    },
    [controls],
  );

  return {
    onHandleDown: (target, index, event) => start(target, 'deplace', index, event),
    onCurveDown: (target, event) => {
      const position: Vec3 = [event.point.x, event.point.y, event.point.z];
      start(target, 'insere', insertIndexFor(pointsOf(target), position), event);
    },
  };
}
