/** Transformer la position du curseur en un point de l'espace.
 *
 *  Deux cas, et un seul principe : si le rayon touche la pièce, on prend le point
 *  accroché (perçage, sommet, arête, face) ; sinon on le pose dans le **plan de
 *  travail**, ce qui permet de placer un point hors matière. Un déplacement
 *  contraint n'accepte, lui, que ce qui appartient au plan — sans quoi tourner la
 *  caméra ferait sauter le point d'une face à l'autre.
 */
import { useCallback, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { describePlane, distanceToPlane, intersectRayPlane, type Plane } from '../core/curve/plane';
import type { Vec3 } from '../core/math/vec';
import { useSession } from '../state/session';
import { findSnap } from './snapping';

export interface PickResult {
  position: Vec3;
  label: string;
  /** Renseigné quand le rayon a touché la pièce : le plan de la face touchée. */
  face?: { plane: Plane; meshName: string };
}

export interface PickOptions {
  /** Plan de repli, et de contrainte le cas échéant. */
  plane: Plane;
  /** Vrai : le point ne quitte jamais le plan. */
  constrain?: boolean;
}

export interface Picking {
  pick(clientX: number, clientY: number, options: PickOptions): PickResult | null;
  ray(clientX: number, clientY: number): { origin: Vec3; direction: Vec3 } | null;
}

export function usePicking(modelGroup: React.RefObject<THREE.Group | null>, diagonal: number): Picking {
  const { camera, gl, size } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const pointer = useRef(new THREE.Vector2());
  const normalMatrix = useRef(new THREE.Matrix3());

  const ray = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.current.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(pointer.current, camera);
      const { origin, direction } = raycaster.current.ray;
      return {
        origin: [origin.x, origin.y, origin.z] as Vec3,
        direction: [direction.x, direction.y, direction.z] as Vec3,
      };
    },
    [camera, gl],
  );

  const pick = useCallback(
    (clientX: number, clientY: number, options: PickOptions): PickResult | null => {
      const current = ray(clientX, clientY);
      if (!current) return null;
      const inPlane = intersectRayPlane(current.origin, current.direction, options.plane);
      const group = modelGroup.current;
      const hit = group ? raycaster.current.intersectObject(group, true)[0] : undefined;

      if (!hit) {
        if (!inPlane) return null;
        return { position: inPlane, label: `dans le ${describePlane(options.plane)}` };
      }

      const meshId = hit.object.userData['meshId'] as string | undefined;
      const mesh = useSession.getState().model?.meshes.find((item) => item.id === meshId);

      let faceNormal: Vec3 = [0, 0, 1];
      if (hit.face) {
        const normal = hit.face.normal.clone()
          .applyNormalMatrix(normalMatrix.current.getNormalMatrix(hit.object.matrixWorld))
          .normalize();
        faceNormal = [normal.x, normal.y, normal.z];
      }
      const face = {
        plane: { origin: [hit.point.x, hit.point.y, hit.point.z] as Vec3, normal: faceNormal },
        meshName: mesh?.name ?? 'la pièce',
      };

      const candidate = mesh
        ? findSnap(
            { point: hit.point, face: hit.face ?? null, meshId: mesh.id, mesh },
            { camera, size, pointer: pointer.current, pixelRadius: 12, diagonal },
          )
        : null;
      const surface: Vec3 = candidate
        ? [candidate.position.x, candidate.position.y, candidate.position.z]
        : [hit.point.x, hit.point.y, hit.point.z];

      if (!options.constrain) {
        return { position: surface, label: candidate?.label ?? 'sur face', face };
      }

      // Contraint : on n'accepte l'accrochage que s'il appartient déjà au plan.
      const tolerance = Math.max(diagonal * 0.002, 0.05);
      if (Math.abs(distanceToPlane(surface, options.plane)) <= tolerance) {
        return { position: surface, label: candidate?.label ?? 'sur face', face };
      }
      if (!inPlane) return null;
      return { position: inPlane, label: `dans le ${describePlane(options.plane)}`, face };
    },
    [ray, camera, size, diagonal, modelGroup],
  );

  return { pick, ray };
}
