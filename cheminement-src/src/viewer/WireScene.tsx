/** Affichage des fils et des torons, et édition de leur tracé à la souris. */
import { useMemo } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { manipulationAxes, tangentAt } from '../core/curve/edit';
import { buildPath, parallelFrames, resampleUniform, type SampledPath } from '../core/curve/path';
import { buildHelixTube, buildTube, corrugatedRadius, type MeshData } from '../core/geometry/tube';
import type { Toron, Wire } from '../core/harness/types';
import type { Vec3 } from '../core/math/vec';
import { useComputation, useProject, type PathTarget } from '../state/project';
import { useSession, type DragState } from '../state/session';
import type { PathEditing } from './editing';

/** Rend un objet insensible au pointeur : rien ne doit voler le clic destiné à
 *  la pièce pendant un tracé. */
const IGNORE_POINTER = () => null;

function toGeometry(data: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Décale une fibre neutre dans son repère parallèle : c'est ainsi qu'un fil
 *  occupe sa place dans la section du toron plutôt que son axe. */
function offsetPath(path: SampledPath, x: number, y: number): { points: Vec3[]; tangents: Vec3[] } {
  if (x === 0 && y === 0) return { points: path.points, tangents: path.tangents };
  const frames = parallelFrames(path.points, path.tangents);
  const points = path.points.map((p, i): Vec3 => {
    const frame = frames[i]!;
    return [
      p[0] + frame.u[0] * x + frame.v[0] * y,
      p[1] + frame.u[1] * x + frame.v[1] * y,
      p[2] + frame.u[2] * x + frame.v[2] * y,
    ];
  });
  return { points, tangents: path.tangents };
}

/** Points du tracé tels qu'on les voit pendant un déplacement. */
function previewPoints(points: readonly Vec3[], drag: DragState | null): Vec3[] {
  if (!drag) return points as Vec3[];
  const next = points.slice() as Vec3[];
  if (drag.mode === 'insere') next.splice(drag.index, 0, drag.position);
  else if (next[drag.index]) next[drag.index] = drag.position;
  return next;
}

/** Chemin affiché : celui du calcul, ou celui du geste en cours. */
function useLivePath(
  target: PathTarget,
  points: readonly Vec3[],
  bendRadius: number,
  settled: SampledPath | null,
): SampledPath | null {
  const drag = useSession((state) => state.drag);
  const active = drag && drag.kind === target.kind && drag.id === target.id ? drag : null;
  return useMemo(() => {
    if (!active) return settled;
    const moved = previewPoints(points, active);
    return moved.length >= 2 ? buildPath(moved, { bendRadius }) : null;
  }, [active, points, bendRadius, settled]);
}

function Tube({ path, offsetX, offsetY, radius, color, highlight, interactive, onPointerDown }: {
  path: SampledPath;
  offsetX: number;
  offsetY: number;
  radius: number;
  color: string;
  highlight: boolean;
  interactive: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const geometry = useMemo(() => {
    const moved = offsetPath(path, offsetX, offsetY);
    const step = Math.max(2, path.length / 240);
    const dense = resampleUniform({ ...path, points: moved.points, tangents: moved.tangents }, step);
    return toGeometry(buildTube(dense.points, dense.tangents, radius, 10));
  }, [path, offsetX, offsetY, radius]);

  return (
    <mesh
      geometry={geometry}
      {...(interactive ? {} : { raycast: IGNORE_POINTER })}
      {...(onPointerDown ? { onPointerDown } : {})}
    >
      <meshStandardMaterial
        color={color}
        roughness={0.45}
        metalness={0.02}
        emissive={highlight ? new THREE.Color(color) : new THREE.Color('#000000')}
        emissiveIntensity={highlight ? 0.35 : 0}
      />
    </mesh>
  );
}

function SleeveMesh({ toron, path, radius, interactive }: {
  toron: Toron;
  path: SampledPath;
  radius: number;
  interactive: boolean;
}) {
  const geometry = useMemo(() => {
    if (toron.sleeve === 'aucune') return null;
    const step = Math.max(2, path.length / 400);
    const { points, tangents } = resampleUniform(path, step);
    if (points.length < 2) return null;
    const outer = radius + 0.4;
    if (toron.sleeve === 'spiralee') {
      // Un profil réellement enroulé en hélice, au pas d'une spiralée courante.
      return toGeometry(buildHelixTube(points, tangents, outer, outer * 5, Math.max(0.8, outer * 0.22), { radialSegments: 6 }));
    }
    if (toron.sleeve === 'annelee') {
      return toGeometry(buildTube(points, tangents, corrugatedRadius(outer + 0.6, 1.2, Math.max(4, outer)), 16, { caps: false }));
    }
    return toGeometry(buildTube(points, tangents, corrugatedRadius(outer + 0.3, 0.35, 6), 14, { caps: false }));
  }, [toron.sleeve, path, radius]);

  if (!geometry) return null;
  const color = toron.sleeve === 'spiralee' ? '#b9bec7' : toron.sleeve === 'annelee' ? '#3a3f47' : '#565c66';
  return (
    <mesh geometry={geometry} {...(interactive ? {} : { raycast: IGNORE_POINTER })}>
      <meshStandardMaterial color={color} roughness={0.8} transparent opacity={0.85} />
    </mesh>
  );
}

const AXIS_COLORS = { along: '#e0801f', across: '#2f9e51', up: '#2f6fd0' } as const;

/** Une flèche du trièdre. Le cylindre de three pointe vers +Y : on l'oriente
 *  vers l'axe voulu. Une gaine transparente et plus large l'entoure : une flèche
 *  fine est jolie mais impossible à attraper, c'est elle qui reçoit le pointeur. */
function Arrow({ direction, length, radius, color, onPointerDown }: {
  direction: Vec3;
  length: number;
  radius: number;
  color: string;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(...direction).normalize(),
    ),
    [direction],
  );
  const gl = useThree((state) => state.gl);

  return (
    <group
      quaternion={quaternion}
      onPointerDown={onPointerDown}
      onPointerOver={() => { gl.domElement.style.cursor = 'grab'; }}
      onPointerOut={() => { gl.domElement.style.cursor = ''; }}
    >
      <mesh position={[0, length / 2, 0]} renderOrder={4}>
        <cylinderGeometry args={[radius, radius, length, 8]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      <mesh position={[0, length, 0]} renderOrder={4}>
        <coneGeometry args={[radius * 3, length * 0.24, 10]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      {/* Zone de préhension : invisible, mais bien plus large que la flèche. */}
      <mesh position={[0, length * 0.55, 0]}>
        <cylinderGeometry args={[radius * 6, radius * 6, length * 1.3, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} depthTest={false} />
      </mesh>
    </group>
  );
}

/** Trièdre de manipulation, posé sur le point désigné : un axe le long du fil,
 *  un latéral, un vertical. Tirer une flèche déplace le point sur cet axe seul. */
function AxisTriad({ target, points, index, size, editing }: {
  target: PathTarget;
  points: readonly Vec3[];
  index: number;
  size: number;
  editing: PathEditing;
}) {
  const drag = useSession((state) => state.drag);
  const active = drag && drag.kind === target.kind && drag.id === target.id && drag.index === index;
  const origin = (active ? drag.position : points[index]) ?? null;
  const axes = useMemo(() => manipulationAxes(tangentAt(points, index)), [points, index]);
  if (!origin) return null;

  return (
    <group position={origin}>
      {(['along', 'across', 'up'] as const).map((key) => (
        <Arrow
          key={key}
          direction={axes[key]}
          length={size}
          radius={size / 16}
          color={AXIS_COLORS[key]}
          onPointerDown={(event) => editing.onAxisDown(target, index, origin, axes[key], event)}
        />
      ))}
    </group>
  );
}

/** Poignées : un point par clic posé. On les tire pour ajuster, on double-clique
 *  pour les retirer. */
function Handles({ target, points, radius, editing, editable }: {
  target: PathTarget;
  points: readonly Vec3[];
  radius: number;
  editing: PathEditing;
  editable: boolean;
}) {
  const removePoint = useProject((state) => state.removePoint);
  const gl = useThree((state) => state.gl);
  const drag = useSession((state) => state.drag);
  const activeIndex = drag && drag.kind === target.kind && drag.id === target.id ? drag.index : -1;

  return (
    <group>
      {points.map((point, index) => (
        <mesh
          key={index}
          position={point}
          {...(editable ? {} : { raycast: IGNORE_POINTER })}
          onPointerDown={(event) => editing.onHandleDown(target, index, event)}
          onDoubleClick={(event) => { event.stopPropagation(); removePoint(target, index); }}
          onPointerOver={() => { gl.domElement.style.cursor = 'grab'; }}
          onPointerOut={() => { gl.domElement.style.cursor = ''; }}
        >
          <sphereGeometry args={[index === activeIndex ? radius * 1.4 : radius, 14, 12]} />
          <meshBasicMaterial color={index === activeIndex ? '#c0552a' : '#e0801f'} />
        </mesh>
      ))}
    </group>
  );
}

interface ItemProps {
  diagonal: number;
  editing: PathEditing;
}

function ToronView({ toron, diagonal, editing }: ItemProps & { toron: Toron }) {
  const project = useProject((state) => state.project);
  const computation = useComputation();
  const selected = useSession((state) => state.selected);
  const drawing = useSession((state) => state.drawing);
  const drag = useSession((state) => state.drag);
  const activePoint = useSession((state) => state.activePoint);
  const select = useSession((state) => state.select);

  const target: PathTarget = { kind: 'toron', id: toron.id };
  const result = computation.torons.get(toron.id);
  const path = useLivePath(target, toron.points, toron.bendRadius, result?.path ?? null);

  const isSelected = selected?.kind === 'toron' && selected.id === toron.id;
  const editable = isSelected && !drawing;
  const shown = previewPoints(toron.points, drag?.id === toron.id ? drag : null);

  const minRadius = diagonal / 550;
  const radius = Math.max((result?.diameter ?? 4) / 2, minRadius);
  const scale = radius / Math.max((result?.diameter ?? 4) / 2, 1e-6);

  return (
    <group>
      {path && toron.wireIds.map((wireId) => {
        const wire = project.wires.find((item) => item.id === wireId);
        const circle = result?.offsets.get(wireId);
        if (!wire || !circle) return null;
        return (
          <Tube
            key={wireId}
            path={path}
            offsetX={circle.x * scale}
            offsetY={circle.y * scale}
            radius={Math.max(circle.r * scale, minRadius * 0.4)}
            color={wire.color}
            highlight={isSelected || (selected?.kind === 'fil' && selected.id === wireId)}
            interactive={!drawing && !drag}
            onPointerDown={(event) => {
              if (editable) editing.onCurveDown(target, event);
              else { event.stopPropagation(); select({ kind: 'toron', id: toron.id }); }
            }}
          />
        );
      })}
      {path && <SleeveMesh toron={toron} path={path} radius={radius} interactive={false} />}
      {(isSelected || drawing?.id === toron.id) && (
        <Handles target={target} points={shown} radius={diagonal / 170} editing={editing} editable={editable} />
      )}
      {editable && activePoint?.id === toron.id && (
        <AxisTriad target={target} points={shown} index={activePoint.index} size={diagonal * 0.05} editing={editing} />
      )}
    </group>
  );
}

function WireView({ wire, diagonal, editing }: ItemProps & { wire: Wire }) {
  const computation = useComputation();
  const selected = useSession((state) => state.selected);
  const drawing = useSession((state) => state.drawing);
  const drag = useSession((state) => state.drag);
  const activePoint = useSession((state) => state.activePoint);
  const select = useSession((state) => state.select);

  const target: PathTarget = { kind: 'fil', id: wire.id };
  const result = computation.wires.get(wire.id);
  const path = useLivePath(target, wire.points, wire.bendRadius, result?.path ?? null);

  const isSelected = selected?.kind === 'fil' && selected.id === wire.id;
  const editable = isSelected && !drawing;
  const shown = previewPoints(wire.points, drag?.id === wire.id ? drag : null);
  const minRadius = diagonal / 550;

  return (
    <group>
      {path && (
        <Tube
          path={path}
          offsetX={0}
          offsetY={0}
          radius={Math.max(wire.outerDiameter / 2, minRadius)}
          color={wire.color}
          highlight={isSelected}
          interactive={!drawing && !drag}
          onPointerDown={(event) => {
            if (editable) editing.onCurveDown(target, event);
            else { event.stopPropagation(); select({ kind: 'fil', id: wire.id }); }
          }}
        />
      )}
      {(isSelected || drawing?.id === wire.id) && (
        <Handles target={target} points={shown} radius={diagonal / 170} editing={editing} editable={editable} />
      )}
      {editable && activePoint?.id === wire.id && (
        <AxisTriad target={target} points={shown} index={activePoint.index} size={diagonal * 0.05} editing={editing} />
      )}
    </group>
  );
}

export function WireScene({ diagonal, editing }: ItemProps) {
  const project = useProject((state) => state.project);
  return (
    <group>
      {project.torons.map((toron) => (
        <ToronView key={toron.id} toron={toron} diagonal={diagonal} editing={editing} />
      ))}
      {project.wires.map((wire) =>
        wire.toronId ? null : <WireView key={wire.id} wire={wire} diagonal={diagonal} editing={editing} />,
      )}
    </group>
  );
}
