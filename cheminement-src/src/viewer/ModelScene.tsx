/** Affichage du modèle CAO importé : corps tessellés et arêtes du B-rep. */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { Bvh } from '@react-three/drei';
import { buildGeometry, buildLineGeometry } from './bvh';
import type { ImportedMesh } from '../io/types';
import { isSelected, useSession } from '../state/session';

interface ModelScenePropsBase {
  onPointerMove: (event: ThreeEvent<PointerEvent>, mesh: ImportedMesh) => void;
  onPointerDown: (event: ThreeEvent<PointerEvent>, mesh: ImportedMesh) => void;
  onPointerLeave: () => void;
}

function Body({ mesh, onPointerMove, onPointerDown, onPointerLeave }: ModelScenePropsBase & { mesh: ImportedMesh }) {
  const view = useSession((state) => state.view);
  const selection = useSession((state) => state.selection);
  const selected = isSelected(selection, 'mesh', mesh.id);

  const geometry = useMemo(() => buildGeometry(mesh), [mesh]);
  const edgeGeometry = useMemo(() => buildLineGeometry(mesh.edgePositions), [mesh]);

  useEffect(() => () => {
    geometry.dispose();
    edgeGeometry.dispose();
  }, [geometry, edgeGeometry]);

  const color = useMemo(
    () => (mesh.color ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]) : new THREE.Color('#8d94a3')),
    [mesh],
  );

  return (
    <group>
      {view.showModel && (
        <mesh
          geometry={geometry}
          castShadow={false}
          receiveShadow={false}
          onPointerMove={(event) => onPointerMove(event, mesh)}
          onPointerDown={(event) => onPointerDown(event, mesh)}
          onPointerOut={onPointerLeave}
        >
          <meshStandardMaterial
            color={selected ? '#3f7fb0' : color}
            transparent={view.modelOpacity < 1}
            opacity={view.modelOpacity}
            roughness={0.62}
            metalness={0.08}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
      )}
      {view.showEdges && (
        <lineSegments geometry={edgeGeometry} renderOrder={2}>
          <lineBasicMaterial color={view.showModel ? '#20242b' : '#6b7382'} transparent opacity={0.9} depthTest />
        </lineSegments>
      )}
    </group>
  );
}

export function ModelScene(props: ModelScenePropsBase) {
  const model = useSession((state) => state.model);
  const visibility = useSession((state) => state.meshVisibility);
  if (!model) return null;
  // `<Bvh>` ne construit ses arbres qu'au montage : on le remonte quand la liste
  // des corps visibles change, sinon un corps réaffiché perdrait l'accélération.
  const visibleKey = model.meshes.filter((mesh) => visibility[mesh.id] !== false).map((mesh) => mesh.id).join('|');

  return (
    <Bvh key={`${model.name}:${visibleKey}`} firstHitOnly>
      {model.meshes.map((mesh) =>
        visibility[mesh.id] === false ? null : <Body key={mesh.id} mesh={mesh} {...props} />,
      )}
    </Bvh>
  );
}
