/** Affichage des fils et des torons dans la vue 3D. */
import { useMemo } from 'react';
import * as THREE from 'three';
import { parallelFrames, resampleUniform, type SampledPath } from '../core/curve/path';
import { buildHelixTube, buildTube, corrugatedRadius, type MeshData } from '../core/geometry/tube';
import type { Toron, Wire } from '../core/harness/types';
import type { Vec3 } from '../core/math/vec';
import { useComputation, useProject } from '../state/project';
import { useSession } from '../state/session';

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

/** Rend un objet insensible au pointeur : il ne doit pas voler le clic destiné
 *  à la pièce pendant un tracé. */
const IGNORE_POINTER = () => null;

function WireTube({ wire, path, offsetX, offsetY, radius, highlight }: {
  wire: Wire;
  path: SampledPath;
  offsetX: number;
  offsetY: number;
  radius: number;
  highlight: boolean;
}) {
  const select = useSession((state) => state.select);
  const drawing = useSession((state) => state.drawing);
  const geometry = useMemo(() => {
    const moved = offsetPath(path, offsetX, offsetY);
    const step = Math.max(2, path.length / 240);
    const dense = resampleUniform(
      { ...path, points: moved.points, tangents: moved.tangents },
      step,
    );
    return toGeometry(buildTube(dense.points, dense.tangents, radius, 10));
  }, [path, offsetX, offsetY, radius]);

  return (
    <mesh
      geometry={geometry}
      {...(drawing ? { raycast: IGNORE_POINTER } : {})}
      onClick={(event) => { event.stopPropagation(); select({ kind: 'fil', id: wire.id }); }}
    >
      <meshStandardMaterial
        color={wire.color}
        roughness={0.45}
        metalness={0.02}
        emissive={highlight ? new THREE.Color(wire.color) : new THREE.Color('#000000')}
        emissiveIntensity={highlight ? 0.35 : 0}
      />
    </mesh>
  );
}

function SleeveMesh({ toron, path, radius }: { toron: Toron; path: SampledPath; radius: number }) {
  const drawing = useSession((state) => state.drawing);
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
    <mesh geometry={geometry} {...(drawing ? { raycast: IGNORE_POINTER } : {})}>
      <meshStandardMaterial color={color} roughness={0.8} transparent opacity={0.85} />
    </mesh>
  );
}

/** Points cliqués : repères visibles pendant et après le tracé. */
function PathPoints({ points, color }: { points: readonly Vec3[]; color: string }) {
  const radius = useMemo(() => {
    let span = 0;
    for (let i = 1; i < points.length; i += 1) {
      span = Math.max(span, Math.hypot(
        points[i]![0] - points[i - 1]![0],
        points[i]![1] - points[i - 1]![1],
        points[i]![2] - points[i - 1]![2],
      ));
    }
    return Math.max(2, span * 0.02);
  }, [points]);

  return (
    <group>
      {points.map((point, index) => (
        <mesh key={index} position={point} raycast={IGNORE_POINTER}>
          <sphereGeometry args={[radius, 12, 10]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  );
}

export function WireScene({ diagonal }: { diagonal: number }) {
  const project = useProject((state) => state.project);
  const computation = useComputation();
  const selected = useSession((state) => state.selected);
  const drawing = useSession((state) => state.drawing);

  // Un fil de 2 mm sur une pièce d'un mètre serait invisible : on lui garantit
  // une épaisseur minimale à l'écran. Les torons, eux, sont à leur taille réelle.
  const minRadius = diagonal / 550;

  return (
    <group>
      {project.torons.map((toron) => {
        const result = computation.torons.get(toron.id);
        if (!result?.path) return null;
        const radius = Math.max(result.diameter / 2, minRadius);
        const isSelected = selected?.kind === 'toron' && selected.id === toron.id;
        return (
          <group key={toron.id}>
            {toron.wireIds.map((wireId) => {
              const wire = project.wires.find((item) => item.id === wireId);
              const circle = result.offsets.get(wireId);
              if (!wire || !circle) return null;
              const scale = radius / Math.max(result.diameter / 2, 1e-6);
              return (
                <WireTube
                  key={wireId}
                  wire={wire}
                  path={result.path!}
                  offsetX={circle.x * scale}
                  offsetY={circle.y * scale}
                  radius={Math.max(circle.r * scale, minRadius * 0.4)}
                  highlight={isSelected || (selected?.kind === 'fil' && selected.id === wireId)}
                />
              );
            })}
            <SleeveMesh toron={toron} path={result.path} radius={radius} />
            {(isSelected || drawing?.id === toron.id) && (
              <PathPoints points={toron.points} color="#e0801f" />
            )}
          </group>
        );
      })}

      {project.wires.map((wire) => {
        if (wire.toronId) return null;
        const result = computation.wires.get(wire.id);
        if (!result?.path) return null;
        const isSelected = selected?.kind === 'fil' && selected.id === wire.id;
        return (
          <group key={wire.id}>
            <WireTube
              wire={wire}
              path={result.path}
              offsetX={0}
              offsetY={0}
              radius={Math.max(wire.outerDiameter / 2, minRadius)}
              highlight={isSelected}
            />
            {(isSelected || drawing?.id === wire.id) && <PathPoints points={wire.points} color="#e0801f" />}
          </group>
        );
      })}

      {/* Un fil en cours de tracé n'a pas encore deux points : on montre quand même ses repères. */}
      {drawing && (() => {
        const holder = drawing.kind === 'fil'
          ? project.wires.find((wire) => wire.id === drawing.id)
          : project.torons.find((toron) => toron.id === drawing.id);
        if (!holder || holder.points.length >= 2) return null;
        return <PathPoints points={holder.points} color="#e0801f" />;
      })()}
    </group>
  );
}
