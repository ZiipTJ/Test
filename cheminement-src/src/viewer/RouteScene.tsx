/** Affichage du faisceau : torons, fils individuels, gaines, nœuds et étiquettes. */
import { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { parallelFrames, resampleUniform, type SampledPath } from '../core/curve/path';
import { buildHelixTube, buildTube, corrugatedRadius, type MeshData } from '../core/geometry/tube';
import type { SegmentLoad } from '../core/harness/routing';
import type { HarnessProject, RouteNode, Sleeve } from '../core/harness/types';
import type { Vec3 } from '../core/math/vec';
import { deriveAll } from '../state/derived';
import { useProject } from '../state/project';
import { isSelected, useSession } from '../state/session';
import { pickNode } from './tools';

function toGeometry(data: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Décale une fibre neutre dans le repère parallèle : c'est ainsi qu'un fil
 *  occupe sa place dans le toron, au lieu d'être confondu avec l'axe. */
function offsetPath(path: SampledPath, x: number, y: number): { points: Vec3[]; tangents: Vec3[] } {
  const frames = parallelFrames(path.points, path.tangents);
  const points = path.points.map((p, i): Vec3 => {
    const frame = frames[i]!;
    return [
      p[0] + frame.u[0] * x + frame.v[0] * y,
      p[1] + frame.u[1] * x + frame.v[1] * y,
      p[2] + frame.u[2] * x + frame.v[2] * y,
    ];
  });
  return { points, tangents: path.tangents.slice() };
}

/* ------------------------------------------------------------------ gaines */

function sleeveGeometry(sleeve: Sleeve, path: SampledPath, bundleRadius: number): THREE.BufferGeometry | null {
  const outer = Math.max(bundleRadius + 0.3, sleeve.innerDiameter / 2);
  const step = Math.max(2, path.length / 400);
  const { points, tangents } = resampleUniform(path, step);
  if (points.length < 2) return null;

  switch (sleeve.kind) {
    case 'spiralee':
      return toGeometry(buildHelixTube(points, tangents, outer, sleeve.pitch, Math.max(0.6, sleeve.bandWidth / 2), { radialSegments: 6 }));
    case 'ruban':
      return toGeometry(buildHelixTube(points, tangents, outer + 0.2, Math.max(2, sleeve.pitch), Math.max(1.5, sleeve.bandWidth / 2), { radialSegments: 4 }));
    case 'annelee':
      return toGeometry(buildTube(points, tangents, corrugatedRadius(outer, sleeve.wallThickness * 1.6, sleeve.pitch), 16, { caps: false }));
    case 'tressee':
      return toGeometry(buildTube(points, tangents, corrugatedRadius(outer, 0.35, 6), 14, { caps: false }));
    case 'thermo':
    default:
      return toGeometry(buildTube(points, tangents, outer + sleeve.wallThickness, 16, { caps: false }));
  }
}

/* ---------------------------------------------------------------- segments */

interface SegmentViewProps {
  segmentId: string;
  path: SampledPath;
  load: SegmentLoad;
  project: HarnessProject;
}

function SegmentView({ segmentId, path, load, project }: SegmentViewProps) {
  const view = useSession((state) => state.view);
  const selection = useSession((state) => state.selection);
  const select = useSession((state) => state.select);
  const setHovered = useSession((state) => state.setHovered);
  const inspect = useSession((state) => state.inspectSegment);
  const selected = isSelected(selection, 'segment', segmentId);

  const segment = project.segments[segmentId];
  const sleeve = segment?.sleeveId ? project.sleeves[segment.sleeveId] : undefined;
  const bundleRadius = Math.max(load.bundleDiameter / 2, 0.75);

  const bundleGeometry = useMemo(() => {
    if (view.bundleDisplay !== 'toron') return null;
    const step = Math.max(2, path.length / 300);
    const { points, tangents } = resampleUniform(path, step);
    return toGeometry(buildTube(points, tangents, bundleRadius, 16));
  }, [path, bundleRadius, view.bundleDisplay]);

  const wireGeometries = useMemo(() => {
    if (view.bundleDisplay !== 'fils') return [];
    return load.wireIds.flatMap((wireId) => {
      const wire = project.wires[wireId];
      const circle = load.positions.get(wireId);
      if (!wire || !circle) return [];
      const { points, tangents } = offsetPath(path, circle.x, circle.y);
      return [{ wireId, color: wire.color, geometry: toGeometry(buildTube(points, tangents, Math.max(circle.r, 0.35), 8)) }];
    });
  }, [path, load, project.wires, view.bundleDisplay]);

  const axisGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(path.points.flat()), 3));
    return geometry;
  }, [path]);

  const sleeveGeom = useMemo(
    () => (view.showSleeves && sleeve ? sleeveGeometry(sleeve, path, bundleRadius) : null),
    [sleeve, path, bundleRadius, view.showSleeves],
  );

  const middle = path.points[Math.floor(path.points.length / 2)] ?? [0, 0, 0];

  return (
    <group
      onPointerOver={(event) => {
        event.stopPropagation();
        setHovered({ kind: 'segment', id: segmentId });
      }}
      onPointerOut={() => setHovered(null)}
      onClick={(event) => {
        event.stopPropagation();
        select({ kind: 'segment', id: segmentId }, event.shiftKey);
        inspect(segmentId);
      }}
    >
      {bundleGeometry && (
        <mesh geometry={bundleGeometry}>
          <meshStandardMaterial color={selected ? '#f0a03c' : '#454b57'} roughness={0.55} metalness={0.05} />
        </mesh>
      )}

      {wireGeometries.map((entry) => (
        <mesh key={entry.wireId} geometry={entry.geometry}>
          <meshStandardMaterial color={entry.color} roughness={0.42} metalness={0.02} />
        </mesh>
      ))}

      {view.bundleDisplay === 'axe' && (
        <line>
          <primitive object={axisGeometry} attach="geometry" />
          <lineBasicMaterial color={selected ? '#f0a03c' : '#d7dbe2'} linewidth={2} />
        </line>
      )}

      {sleeveGeom && (
        <mesh geometry={sleeveGeom}>
          <meshStandardMaterial
            color={sleeve!.color}
            roughness={0.75}
            metalness={0.05}
            transparent={view.sleeveOpacity < 1}
            opacity={view.sleeveOpacity}
          />
        </mesh>
      )}

      {(view.showSegmentLabels || selected) && (
        <Html position={middle as unknown as [number, number, number]} center distanceFactor={620} zIndexRange={[20, 0]}>
          <div className={`tag tag-segment${selected ? ' is-selected' : ''}`}>
            <strong>{segment?.name}</strong>
            <span>{Math.round(path.length)} mm · {load.wireIds.length} fils · Ø{load.bundleDiameter.toFixed(1)}</span>
            {sleeve && <span className="tag-sleeve">{sleeve.name}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------- nœuds */

const NODE_COLORS: Record<RouteNode['kind'], string> = {
  connecteur: '#3f7fb0',
  derivation: '#d98324',
  collier: '#5aa469',
  epissure: '#b05a9e',
  passage: '#8d94a3',
};

function NodeView({ node, scale }: { node: RouteNode; scale: number }) {
  const selection = useSession((state) => state.selection);
  const setHovered = useSession((state) => state.setHovered);
  const view = useSession((state) => state.view);
  const selected = isSelected(selection, 'node', node.id);

  const quaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    if (node.exitDirection) {
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...node.exitDirection).normalize());
    }
    return q;
  }, [node.exitDirection]);

  const color = selected ? '#f0a03c' : NODE_COLORS[node.kind];

  return (
    <group
      position={node.position}
      onPointerOver={(event) => { event.stopPropagation(); setHovered({ kind: 'node', id: node.id }); }}
      onPointerOut={() => setHovered(null)}
      onClick={(event) => { event.stopPropagation(); pickNode(node.id, { shift: event.shiftKey }); }}
    >
      <group quaternion={quaternion}>
        {node.kind === 'connecteur' ? (
          <mesh position={[0, 0, scale * 0.6]}>
            <boxGeometry args={[scale * 1.6, scale * 1.2, scale * 1.4]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
        ) : node.kind === 'collier' ? (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[scale * 0.9, scale * 0.22, 8, 20]} />
            <meshStandardMaterial color={color} roughness={0.6} />
          </mesh>
        ) : node.kind === 'epissure' ? (
          <mesh>
            <octahedronGeometry args={[scale * 0.85]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
        ) : (
          <mesh>
            <sphereGeometry args={[node.kind === 'derivation' ? scale * 0.8 : scale * 0.5, 16, 12]} />
            <meshStandardMaterial color={color} roughness={0.5} />
          </mesh>
        )}
      </group>

      {view.showLabels && (
        <Html position={[0, 0, scale * 2]} center distanceFactor={620} zIndexRange={[30, 0]}>
          <div className={`tag tag-node${selected ? ' is-selected' : ''}`}>{node.name}</div>
        </Html>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------- scène */

export function RouteScene() {
  const project = useProject((state) => state.project);
  const view = useSession((state) => state.view);
  const derived = deriveAll(project);

  const scale = useMemo(() => {
    const diameters = [...derived.computation.loads.values()].map((load) => load.bundleDiameter);
    return Math.max(4, (diameters.length ? Math.max(...diameters) : 8) * 0.8);
  }, [derived]);

  return (
    <group>
      {Object.values(project.segments).map((segment) => {
        const geometry = derived.computation.geometry.get(segment.id);
        const load = derived.computation.loads.get(segment.id);
        if (!geometry || !load) return null;
        return (
          <SegmentView key={segment.id} segmentId={segment.id} path={geometry.path} load={load} project={project} />
        );
      })}

      {view.showNodes &&
        Object.values(project.nodes).map((node) => <NodeView key={node.id} node={node} scale={scale} />)}
    </group>
  );
}
