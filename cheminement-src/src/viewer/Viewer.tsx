/** Vue 3D, fond clair, repère Z vers le haut comme en CAO.
 *
 *  Commandes : molette pressée pour tourner, Ctrl + molette pour translater,
 *  molette pour zoomer. Le bouton gauche reste au tracé et à la sélection.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei';
import { planeThrough, projectOnPlane, type Plane } from '../core/curve/plane';
import { boxFromPoints, type Box3, type Vec3 } from '../core/math/vec';
import type { ImportedMesh } from '../io/types';
import { useProject } from '../state/project';
import { useSession } from '../state/session';
import { ModelScene } from './ModelScene';
import { WireScene } from './WireScene';
import { usePathEditing } from './editing';
import { usePicking, type PickResult } from './picking';

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

interface Fit { diagonal: number; floorZ: number }

function CameraRig({ onFit }: { onFit: (fit: Fit) => void }) {
  const model = useSession((state) => state.model);
  const project = useProject((state) => state.project);
  const { camera, controls } = useThree();
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    const fromModel = modelBounds(model?.meshes ?? []);
    const points = project.wires.flatMap((wire) => wire.points).concat(project.torons.flatMap((toron) => toron.points));
    const box = fromModel ?? (points.length > 0 ? boxFromPoints(points) : null);
    if (!box) return;

    const diagonal = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) || 100;
    onFit({ diagonal, floorZ: box.min[2] });

    const key = model?.name ?? `projet:${points.length}`;
    if (fitted.current === key) return;
    fitted.current = key;

    const center = new THREE.Vector3(
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2,
    );
    camera.position.set(center.x + diagonal * 0.6, center.y - diagonal * 0.8, center.z + diagonal * 0.55);
    camera.near = diagonal / 500;
    camera.far = diagonal * 40;
    camera.updateProjectionMatrix();
    const orbit = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (orbit?.target) {
      orbit.target.copy(center);
      orbit.update?.();
    }
  }, [model, project.wires, project.torons, camera, controls, onFit]);

  return null;
}

/** Rien de ce qui guide le geste ne doit intercepter le clic qu'il guide. */
const IGNORE_POINTER = () => null;

function SnapMarker({ position, diagonal }: { position: Vec3 | null; diagonal: number }) {
  if (!position) return null;
  return (
    <mesh position={position} raycast={IGNORE_POINTER}>
      <sphereGeometry args={[diagonal / 220, 14, 12]} />
      <meshBasicMaterial color="#e0801f" depthTest={false} transparent opacity={0.9} />
    </mesh>
  );
}

/** Matérialise le plan de travail : c'est lui qui répond à « sur quelle face
 *  suis-je en train de travailler ? ». */
function WorkPlaneView({ plane, anchor, size }: { plane: Plane; anchor: Vec3; size: number }) {
  const quaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(...plane.normal).normalize(),
    ),
    [plane.normal],
  );
  const center = useMemo(() => projectOnPlane(anchor, plane), [anchor, plane]);
  const outline = useMemo(() => new THREE.EdgesGeometry(new THREE.PlaneGeometry(size, size)), [size]);

  return (
    <group position={center} quaternion={quaternion}>
      <mesh raycast={IGNORE_POINTER}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color="#1f6f9c" transparent opacity={0.07} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <lineSegments geometry={outline} raycast={IGNORE_POINTER}>
        <lineBasicMaterial color="#1f6f9c" transparent opacity={0.45} />
      </lineSegments>
    </group>
  );
}

function Scene({ fit, setFit }: { fit: Fit; setFit: (value: Fit) => void }) {
  const gl = useThree((state) => state.gl);
  const modelGroup = useRef<THREE.Group>(null);
  const picking = usePicking(modelGroup, fit.diagonal);
  const editing = usePathEditing(picking);

  const drawing = useSession((state) => state.drawing);
  const drag = useSession((state) => state.drag);
  const workPlane = useSession((state) => state.workPlane);
  const setWorkPlane = useSession((state) => state.setWorkPlane);
  const setSnapLabel = useSession((state) => state.setSnapLabel);
  const addPoint = useProject((state) => state.addPoint);
  const [preview, setPreview] = useState<PickResult | null>(null);

  /** Points déjà posés sur le tracé en cours. */
  const drawnPoints = useProject((state) => {
    if (!drawing) return null;
    const holder = drawing.kind === 'fil'
      ? state.project.wires.find((wire) => wire.id === drawing.id)
      : state.project.torons.find((toron) => toron.id === drawing.id);
    return holder?.points ?? null;
  });

  /** Le tracé se poursuit dans un plan parallèle passant par le dernier point. */
  const drawingPlane: Plane = useMemo(() => {
    const last = drawnPoints?.[drawnPoints.length - 1];
    return last ? planeThrough(last, workPlane) : workPlane;
  }, [drawnPoints, workPlane]);

  useEffect(() => {
    if (!drawing) { setPreview(null); return; }
    const canvas = gl.domElement;

    const onMove = (event: PointerEvent) => {
      const result = picking.pick(event.clientX, event.clientY, { plane: drawingPlane });
      setPreview(result);
      setSnapLabel(result?.label ?? null);
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const result = picking.pick(event.clientX, event.clientY, { plane: drawingPlane });
      if (!result) return;
      // Toucher une face en fait le nouveau plan de travail : les points suivants
      // s'y poseront, y compris hors de la matière.
      if (result.face) setWorkPlane({ ...result.face.plane, source: result.face.meshName });
      addPoint(drawing, result.position);
    };

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
    };
  }, [drawing, drawingPlane, gl, picking, addPoint, setWorkPlane, setSnapLabel]);

  const planeAnchor: Vec3 | null = drag
    ? drag.position
    : drawing
      ? preview?.position ?? drawnPoints?.[drawnPoints.length - 1] ?? null
      : null;
  const activePlane: Plane = drag ? planeThrough(drag.position, workPlane) : drawingPlane;

  return (
    <>
      <CameraRig onFit={setFit} />
      <ambientLight intensity={1.05} />
      <directionalLight position={[fit.diagonal, -fit.diagonal, fit.diagonal * 1.6]} intensity={1.5} />
      <directionalLight position={[-fit.diagonal, fit.diagonal * 0.7, fit.diagonal]} intensity={0.55} />
      <hemisphereLight args={['#ffffff', '#c3cad4', 0.6]} />

      <Grid
        args={[fit.diagonal * 4, fit.diagonal * 4]}
        cellSize={Math.max(10, fit.diagonal / 40)}
        sectionSize={Math.max(50, fit.diagonal / 8)}
        cellColor="#d5dae1"
        sectionColor="#bcc4ce"
        fadeDistance={fit.diagonal * 6}
        infiniteGrid
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, fit.floorZ - fit.diagonal * 0.004]}
      />

      <group ref={modelGroup}>
        <ModelScene />
      </group>
      <WireScene diagonal={fit.diagonal} editing={editing} />

      {planeAnchor && <WorkPlaneView plane={activePlane} anchor={planeAnchor} size={fit.diagonal * 0.55} />}
      {drawing && <SnapMarker position={preview?.position ?? null} diagonal={fit.diagonal} />}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        mouseButtons={{ MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }}
      />
      <GizmoHelper alignment="bottom-right" margin={[64, 64]}>
        <GizmoViewport axisColors={['#c0554a', '#5aa469', '#3f7fb0']} labelColor="#2b313a" />
      </GizmoHelper>
    </>
  );
}

export function Viewer() {
  const [fit, setFit] = useState<Fit>({ diagonal: 500, floorZ: 0 });
  const drawing = useSession((state) => state.drawing);
  const setDrawing = useSession((state) => state.setDrawing);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Enter') setDrawing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDrawing]);

  const camera = useMemo(() => ({
    fov: 45,
    up: [0, 0, 1] as [number, number, number],
    position: [600, -700, 500] as [number, number, number],
    near: 1,
    far: 50000,
  }), []);

  // Le clic molette déclenche le défilement automatique du navigateur : on le
  // neutralise, sinon la rotation démarre avec un curseur de défilement collé.
  const blockMiddleClick = useCallback((event: React.MouseEvent) => {
    if (event.button === 1) event.preventDefault();
  }, []);

  return (
    <div className={`viewer${drawing ? ' is-drawing' : ''}`} onMouseDown={blockMiddleClick}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={camera}
        onCreated={({ scene, camera: cam }) => {
          scene.background = new THREE.Color('#eef1f5');
          cam.up.set(0, 0, 1);
        }}
      >
        <Scene fit={fit} setFit={setFit} />
      </Canvas>
    </div>
  );
}
