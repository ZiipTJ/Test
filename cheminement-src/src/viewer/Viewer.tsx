/** Vue 3D, fond clair, repère Z vers le haut comme en CAO.
 *  Un seul geste : quand un tracé est en cours, cliquer sur la pièce ajoute un
 *  point — accroché au centre d'un perçage, à un sommet ou à une arête. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { GizmoHelper, GizmoViewport, Grid, OrbitControls } from '@react-three/drei';
import { boxFromPoints, type Box3 } from '../core/math/vec';
import type { ImportedMesh } from '../io/types';
import { useProject } from '../state/project';
import { useSession } from '../state/session';
import { ModelScene } from './ModelScene';
import { WireScene } from './WireScene';
import { usePathEditing } from './editing';
import { findSnap, type SnapCandidate } from './snapping';

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

/** Repère d'accrochage : un simple point, insensible au pointeur — tout élément
 *  posé sous le curseur intercepterait le clic qu'il est censé guider. Son
 *  libellé est affiché dans le bandeau de tracé, hors de la scène. */
const IGNORE_POINTER = () => null;

function SnapMarker({ candidate, diagonal }: { candidate: SnapCandidate | null; diagonal: number }) {
  if (!candidate) return null;
  return (
    <mesh position={candidate.position} raycast={IGNORE_POINTER}>
      <sphereGeometry args={[diagonal / 220, 14, 12]} />
      <meshBasicMaterial color="#e0801f" depthTest={false} transparent opacity={0.9} />
    </mesh>
  );
}

function Scene({ fit, setFit }: { fit: Fit; setFit: (value: Fit) => void }) {
  const { camera, size } = useThree();
  const drawing = useSession((state) => state.drawing);
  const setSnapLabel = useSession((state) => state.setSnapLabel);
  const addPoint = useProject((state) => state.addPoint);
  const [snap, setSnap] = useState<SnapCandidate | null>(null);
  const pointer = useRef(new THREE.Vector2());
  // Le groupe du modèle sert de cible de lancer de rayon pendant qu'on tire un point.
  const modelGroup = useRef<THREE.Group>(null);
  const editing = usePathEditing(modelGroup, fit.diagonal);

  const snapAt = useCallback(
    (event: ThreeEvent<PointerEvent>, mesh: ImportedMesh): SnapCandidate => {
      pointer.current.set(
        (event.nativeEvent.offsetX / size.width) * 2 - 1,
        -(event.nativeEvent.offsetY / size.height) * 2 + 1,
      );
      return findSnap(
        { point: event.point, face: event.face ?? null, meshId: mesh.id, mesh },
        { camera, size, pointer: pointer.current, pixelRadius: 12, diagonal: fit.diagonal },
      );
    },
    [camera, size, fit.diagonal],
  );

  const handleMove = useCallback(
    (event: ThreeEvent<PointerEvent>, mesh: ImportedMesh) => {
      if (!drawing) { if (snap) setSnap(null); return; }
      const candidate = snapAt(event, mesh);
      setSnap(candidate);
      setSnapLabel(candidate.label);
    },
    [drawing, snap, snapAt, setSnapLabel],
  );

  const handleDown = useCallback(
    (event: ThreeEvent<PointerEvent>, mesh: ImportedMesh) => {
      if (!drawing || event.nativeEvent.button !== 0) return;
      const candidate = snapAt(event, mesh);
      event.stopPropagation();
      addPoint(drawing, [candidate.position.x, candidate.position.y, candidate.position.z]);
    },
    [drawing, snapAt, addPoint],
  );

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
        <ModelScene
          onPointerMove={handleMove}
          onPointerDown={handleDown}
          onPointerLeave={() => { setSnap(null); setSnapLabel(null); }}
        />
      </group>
      <WireScene diagonal={fit.diagonal} editing={editing} />
      {drawing && <SnapMarker candidate={snap} diagonal={fit.diagonal} />}

      {/* Commandes à la mode CAO : molette pressée pour tourner, Ctrl + molette
          pour translater (OrbitControls traite déjà Ctrl comme modificateur),
          molette pour zoomer. Le bouton gauche reste libre pour le tracé. */}
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

  const camera = useMemo(() => ({ fov: 45, up: [0, 0, 1] as [number, number, number], position: [600, -700, 500] as [number, number, number], near: 1, far: 50000 }), []);

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
