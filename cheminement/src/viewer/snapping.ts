/** Accrochage : transformer un clic en un point qui a un sens mécanique.
 *
 *  Un cheminement ne se pose pas « quelque part sur une face » : il se pose au
 *  centre d'un perçage, sur un sommet, au milieu d'une arête. On indexe donc,
 *  pour chaque corps importé, ses sommets soudés, ses arêtes et ses cercles dans
 *  une grille spatiale, puis on cherche le meilleur candidat dans un rayon exprimé
 *  en pixels — la tolérance doit être constante à l'écran, pas dans le modèle.
 */
import * as THREE from 'three';
import { detectCircles, type CircleFeature } from '../core/geometry/features';
import type { ImportedMesh } from '../io/types';
import type { SnapModes } from '../state/session';
import type { SnapOrigin } from '../core/harness/types';

export interface SnapCandidate {
  position: THREE.Vector3;
  kind: SnapOrigin['kind'];
  label: string;
  meshId: string;
  radius?: number;
  axis?: THREE.Vector3;
  /** Distance à l'écran, en pixels, utilisée pour départager les candidats. */
  pixelDistance: number;
}

/** Grille spatiale régulière : suffisante et bien plus légère qu'un arbre. */
class PointGrid {
  private readonly cells = new Map<string, number[]>();

  constructor(private readonly points: Float32Array, private readonly cellSize: number) {
    for (let i = 0; i < points.length / 3; i += 1) {
      const key = this.keyOf(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!);
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(i);
      else this.cells.set(key, [i]);
    }
  }

  private keyOf(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  /** Indices des points situés dans les cellules voisines du point donné. */
  near(x: number, y: number, z: number, radius: number): number[] {
    const span = Math.max(1, Math.ceil(radius / this.cellSize));
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const out: number[] = [];
    for (let i = -span; i <= span; i += 1) {
      for (let j = -span; j <= span; j += 1) {
        for (let k = -span; k <= span; k += 1) {
          const bucket = this.cells.get(`${cx + i},${cy + j},${cz + k}`);
          if (bucket) out.push(...bucket);
        }
      }
    }
    return out;
  }
}

export class MeshIndex {
  readonly vertices: Float32Array;
  readonly edgeSegments: Uint32Array;
  readonly circles: CircleFeature[];
  private readonly vertexGrid: PointGrid;
  private readonly edgeGrid: PointGrid;
  private readonly edgeMidpoints: Float32Array;

  constructor(mesh: ImportedMesh, diagonal: number) {
    this.vertices = mesh.weldedVertices;
    this.edgeSegments = mesh.edgeSegments;
    this.circles = detectCircles(mesh.weldedVertices, mesh.edgeSegments);

    const cell = Math.max(diagonal / 64, 1e-3);
    this.vertexGrid = new PointGrid(mesh.weldedVertices, cell);

    const count = mesh.edgeSegments.length / 2;
    this.edgeMidpoints = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const a = mesh.edgeSegments[i * 2]!;
      const b = mesh.edgeSegments[i * 2 + 1]!;
      for (let k = 0; k < 3; k += 1) {
        this.edgeMidpoints[i * 3 + k] = (mesh.weldedVertices[a * 3 + k]! + mesh.weldedVertices[b * 3 + k]!) / 2;
      }
    }
    this.edgeGrid = new PointGrid(this.edgeMidpoints, cell);
  }

  nearVertices(point: THREE.Vector3, radius: number): number[] {
    return this.vertexGrid.near(point.x, point.y, point.z, radius);
  }

  nearEdges(point: THREE.Vector3, radius: number): number[] {
    return this.edgeGrid.near(point.x, point.y, point.z, radius);
  }

  vertexAt(index: number): THREE.Vector3 {
    return new THREE.Vector3(this.vertices[index * 3], this.vertices[index * 3 + 1], this.vertices[index * 3 + 2]);
  }

  edgeMidpointAt(index: number): THREE.Vector3 {
    return new THREE.Vector3(this.edgeMidpoints[index * 3], this.edgeMidpoints[index * 3 + 1], this.edgeMidpoints[index * 3 + 2]);
  }
}

const indexCache = new Map<string, MeshIndex>();

export function getMeshIndex(mesh: ImportedMesh, diagonal: number): MeshIndex {
  const cached = indexCache.get(mesh.id);
  if (cached) return cached;
  const index = new MeshIndex(mesh, diagonal);
  indexCache.set(mesh.id, index);
  return index;
}

export function clearMeshIndexes(): void {
  indexCache.clear();
}

/** Taille d'un pixel, exprimée dans le modèle, à la distance donnée. */
export function worldPerPixel(camera: THREE.Camera, point: THREE.Vector3, viewportHeight: number): number {
  if (camera instanceof THREE.PerspectiveCamera) {
    const distance = camera.position.distanceTo(point);
    return (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(viewportHeight, 1);
  }
  if (camera instanceof THREE.OrthographicCamera) {
    return (camera.top - camera.bottom) / camera.zoom / Math.max(viewportHeight, 1);
  }
  return 1;
}

const projected = new THREE.Vector3();

function pixelDistance(
  point: THREE.Vector3,
  pointer: THREE.Vector2,
  camera: THREE.Camera,
  size: { width: number; height: number },
): number {
  projected.copy(point).project(camera);
  const dx = ((projected.x - pointer.x) * size.width) / 2;
  const dy = ((projected.y - pointer.y) * size.height) / 2;
  return Math.hypot(dx, dy);
}

export interface SnapContext {
  camera: THREE.Camera;
  size: { width: number; height: number };
  pointer: THREE.Vector2;
  pixelRadius: number;
  modes: SnapModes;
  diagonal: number;
}

/** Meilleur accrochage pour une intersection donnée. L'ordre de priorité suit
 *  l'utilité mécanique : un centre de perçage prime sur un sommet, qui prime sur
 *  un milieu d'arête, puis sur l'arête, puis sur la face. */
export function findSnap(
  hit: { point: THREE.Vector3; face: THREE.Face | null; meshId: string; mesh: ImportedMesh },
  context: SnapContext,
): SnapCandidate {
  const index = getMeshIndex(hit.mesh, context.diagonal);
  const unit = worldPerPixel(context.camera, hit.point, context.size.height);
  const searchRadius = unit * context.pixelRadius * 2;

  const candidates: SnapCandidate[] = [];

  if (context.modes.cercle) {
    for (const circle of index.circles) {
      const center = new THREE.Vector3(...circle.center);
      const distance = pixelDistance(center, context.pointer, context.camera, context.size);
      if (distance <= context.pixelRadius * 1.6) {
        candidates.push({
          position: center,
          kind: 'centre-cercle',
          label: `Centre de perçage Ø${(circle.radius * 2).toFixed(1)}`,
          meshId: hit.meshId,
          radius: circle.radius,
          axis: new THREE.Vector3(...circle.axis),
          pixelDistance: distance - 6, // léger avantage : c'est presque toujours la cible visée
        });
      }
    }
  }

  if (context.modes.sommet) {
    for (const vertexIndex of index.nearVertices(hit.point, searchRadius)) {
      const vertex = index.vertexAt(vertexIndex);
      const distance = pixelDistance(vertex, context.pointer, context.camera, context.size);
      if (distance <= context.pixelRadius) {
        candidates.push({ position: vertex, kind: 'sommet', label: 'Sommet', meshId: hit.meshId, pixelDistance: distance });
      }
    }
  }

  if (context.modes.milieu || context.modes.arete) {
    const line = new THREE.Line3();
    const closest = new THREE.Vector3();
    for (const edgeIndex of index.nearEdges(hit.point, searchRadius)) {
      if (context.modes.milieu) {
        const midpoint = index.edgeMidpointAt(edgeIndex);
        const distance = pixelDistance(midpoint, context.pointer, context.camera, context.size);
        if (distance <= context.pixelRadius) {
          candidates.push({ position: midpoint, kind: 'milieu-arete', label: 'Milieu d’arête', meshId: hit.meshId, pixelDistance: distance + 2 });
        }
      }
      if (context.modes.arete) {
        const a = index.edgeSegments[edgeIndex * 2]!;
        const b = index.edgeSegments[edgeIndex * 2 + 1]!;
        line.set(index.vertexAt(a), index.vertexAt(b));
        line.closestPointToPoint(hit.point, true, closest);
        const distance = pixelDistance(closest, context.pointer, context.camera, context.size);
        if (distance <= context.pixelRadius) {
          candidates.push({
            position: closest.clone(),
            kind: 'arete',
            label: 'Sur arête',
            meshId: hit.meshId,
            axis: index.vertexAt(b).sub(index.vertexAt(a)).normalize(),
            pixelDistance: distance + 4,
          });
        }
      }
    }
  }

  if (candidates.length === 0 || !context.modes.face) {
    if (candidates.length === 0) {
      return {
        position: hit.point.clone(),
        kind: 'face',
        label: 'Sur face',
        meshId: hit.meshId,
        ...(hit.face ? { axis: hit.face.normal.clone() } : {}),
        pixelDistance: 0,
      };
    }
  }

  candidates.sort((a, b) => a.pixelDistance - b.pixelDistance);
  return candidates[0]!;
}

export function toSnapOrigin(candidate: SnapCandidate, partId: string): SnapOrigin {
  return {
    kind: candidate.kind,
    partId,
    ...(candidate.radius != null ? { radius: candidate.radius } : {}),
    ...(candidate.axis ? { axis: [candidate.axis.x, candidate.axis.y, candidate.axis.z] } : {}),
  };
}
