/** Vue 3D : caméra Z vers le haut (convention CAO), accrochage à la volée,
 *  et cadrage automatique sur le modèle importé. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, Html, OrbitControls } from '@react-three/drei';
import { boxFromPoints, type Box3 } from '../core/math/vec';
import type { ImportedMesh } from '../io/types';
import { deriveAll } from '../state/derived';
import { useProject } from '../state/project';
import { useSession } from '../state/session';
import { ModelScene } from './ModelScene';
import { RouteScene } from './RouteScene';
import { findSnap, type SnapCandidate } from './snapping';
import { cancelCurrentTool, pickOnModel } from './tools';

/* ------------------------------------------------------------ cadrage auto */

function modelBounds(meshes: ImportedMesh[]): Box3 | null {
  if (meshes.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const mesh of meshes) {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i]!, y = mesh.positions[i + 1]!, z = mesh.positions[i + 2]!;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
  }
  return Number.isFinite(minX) ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } : null;
}

function CameraRig({ onFit }: { onFit: (fit: { diagonal: number; floorZ: number }) => void }) {
  const model = useSession((state) => state.model);
  const fitRequest = useSession((state) => state.fitRequest);
  const project = useProject((state) => state.project);
  const { camera, controls } = useThree();
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    const meshes = model?.meshes ?? [];
    const fromModel = modelBounds(meshes);
    const nodePositions = Object.values(project.nodes).map((node) => node.position);
    const harnessBox = nodePositions.length > 0 ? boxFromPoints(nodePositions) : null;
    const box = fitRequest.target === 'faisceau' ? harnessBox ?? fromModel : fromModel ?? harnessBox;
    if (!box) return;

    const key = `${fitRequest.nonce}:${fitRequest.target}:${model?.name ?? ''}:${nodePositions.length}`;
    const center = new THREE.Vector3(
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    );
    const diagonal = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) || 100;
    const modelBox = fromModel ?? box;
    onFit({
      diagonal: Math.hypot(modelBox.max[0] - modelBox.min[0], modelBox.max[1] - modelBox.min[1], modelBox.max[2] - modelBox.min[2]) || 100,
      floorZ: modelBox.min[2],
    });
    if (fitted.current === key) return;
    fitted.current = key;

    camera.position.set(center.x + diagonal * 0.7, center.y - diagonal * 0.9, center.z + diagonal * 0.65);
    camera.near = diagonal / 500;
    camera.far = diagonal * 40;
    camera.updateProjectionMatrix();
    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (orbit?.target) {
      orbit.target.copy(center);
      orbit.update?.();
    }
  }, [model, project.nodes, camera, controls, onFit, fitRequest]);

  return null;
}

/* ------------------------------------------------- indicateur d'accrochage */

function SnapIndicator({ candidate }: { candidate: SnapCandidate | null }) {
  if (!candidate) return null;
  return (
    <group position={candidate.position}>
      <mesh>
        <sphereGeometry args={[1, 12, 10]} />
        <meshBasicMaterial color="#f0a03c" depthTest={false} transparent opacity={0.95} />
      </mesh>
      <Html center distanceFactor={700} zIndexRange={[40, 0]}>
        <div className="tag tag-snap">{candidate.label}</div>
      </Html>
    </group>
  );
}

function MeasureOverlay() {
  const measure = useSession((state) => state.measure);
  const geometry = useMemo(() => {
    if (!measure.from || !measure.to) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from([...measure.from, ...measure.to]), 3));
    return g;
  }, [measure]);
  if (!measure.from || !measure.to || !geometry) return null;

  const distance = Math.hypot(
    measure.to[0] - measure.from[0],
    measure.to[1] - measure.from[1],
    measure.to[2] - measure.from[2],
  );
  const middle: [number, number, number] = [
    (measure.from[0] + measure.to[0]) / 2,
    (measure.from[1] + measure.to[1]) / 2,
    (measure.from[2] + measure.to[2]) / 2,
  ];

  return (
    <group>
      <line>
        <primitive object={geometry} attach="geometry" />
        <lineBasicMaterial color="#f0a03c" depthTest={false} />
      </line>
      <Html position={middle} center distanceFactor={800} zIndexRange={[40, 0]}>
        <div className="tag tag-measure">{distance.toFixed(1)} mm</div>
      </Html>
    </group>
  );
}

/* --------------------------------------------------------------- la scène */

function Scene({ fit, setFit }: { fit: { diagonal: number; floorZ: number }; setFit: (value: { diagonal: number; floorZ: number }) => void }) {
  const { diagonal, floorZ } = fit;
  const { camera, size } = useThree();
  const snapRadius = useProject((state) => state.project.settings.snapPixelRadius);
  const snapModes = useSession((state) => state.view.snap);
  const tool = useSession((state) => state.tool);
  const [snap, setSnap] = useState<SnapCandidate | null>(null);
  const pointer = useRef(new THREE.Vector2());

  const handleMove = useCallback(
    (event: ThreeEvent<PointerEvent>, mesh: ImportedMesh) => {
      pointer.current.set(
        (event.nativeEvent.offsetX / size.width) * 2 - 1,
        -(event.nativeEvent.offsetY / size.height) * 2 + 1,
      );
      const candidate = findSnap(
        { point: event.point, face: event.face ?? null, meshId: mesh.id, mesh },
        { camera, size, pointer: pointer.current, pixelRadius: snapRadius, modes: snapModes, diagonal },
      );
      setSnap(candidate);
    },
    [camera, size, snapRadius, snapModes, diagonal],
  );

  const handleDown = useCallback(
    (event: ThreeEvent<PointerEvent>, mesh: ImportedMesh) => {
      if (event.nativeEvent.button !== 0) return;
      pointer.current.set(
        (event.nativeEvent.offsetX / size.width) * 2 - 1,
        -(event.nativeEvent.offsetY / size.height) * 2 + 1,
      );
      const candidate = findSnap(
        { point: event.point, face: event.face ?? null, meshId: mesh.id, mesh },
        { camera, size, pointer: pointer.current, pixelRadius: snapRadius, modes: snapModes, diagonal },
      );
      event.stopPropagation();
      pickOnModel(candidate, { shift: event.shiftKey, alt: event.altKey || event.metaKey });
    },
    [camera, size, snapRadius, snapModes, diagonal],
  );

  const showGrid = useSession((state) => state.view.showGrid);

  return (
    <>
      <CameraRig onFit={setFit} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[diagonal, -diagonal, diagonal * 1.5]} intensity={1.6} />
      <directionalLight position={[-diagonal, diagonal * 0.6, diagonal]} intensity={0.5} />
      <hemisphereLight args={['#dfe6f2', '#2a2f38', 0.5]} />

      {showGrid && (
        <Grid
          args={[diagonal * 4, diagonal * 4]}
          cellSize={Math.max(10, diagonal / 40)}
          sectionSize={Math.max(50, diagonal / 8)}
          cellColor="#3a4049"
          sectionColor="#4c5663"
          fadeDistance={diagonal * 6}
          infiniteGrid
          rotation={[Math.PI / 2, 0, 0]}
          // Sous la pièce : posée au même niveau, la grille se battrait en
          // profondeur avec la face inférieure du modèle.
          position={[0, 0, floorZ - diagonal * 0.004]}
        />
      )}

      <ModelScene onPointerMove={handleMove} onPointerDown={handleDown} onPointerLeave={() => setSnap(null)} />
      <RouteScene />
      {tool !== 'select' && <SnapIndicator candidate={snap} />}
      <MeasureOverlay />

      <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
      <GizmoHelper alignment="bottom-right" margin={[70, 70]}>
        <GizmoViewport axisColors={['#c0554a', '#5aa469', '#3f7fb0']} labelColor="#e8eaee" />
      </GizmoHelper>
    </>
  );
}

export function Viewer() {
  const [fit, setFit] = useState({ diagonal: 500, floorZ: 0 });
  const project = useProject((state) => state.project);
  const derived = deriveAll(project);
  const tool = useSession((state) => state.tool);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelCurrentTool();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`viewer tool-${tool}`}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        camera={{ fov: 45, up: [0, 0, 1], position: [600, -700, 500], near: 1, far: 50000 }}
        onCreated={({ scene, camera }) => {
          scene.background = new THREE.Color('#171a20');
          camera.up.set(0, 0, 1);
        }}
      >
        <Scene fit={fit} setFit={setFit} />
      </Canvas>

      <div className="viewer-readout">
        <span>{Object.keys(project.nodes).length} nœuds</span>
        <span>{Object.keys(project.segments).length} segments</span>
        <span>{Object.keys(project.wires).length} fils</span>
        <span>{(derived.computation.totals.routeLength / 1000).toFixed(2)} m de cheminement</span>
        <span>{(derived.computation.totals.wireLength / 1000).toFixed(2)} m de fil</span>
      </div>
    </div>
  );
}
