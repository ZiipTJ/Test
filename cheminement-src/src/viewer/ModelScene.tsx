/** Le modèle CAO importé : corps tessellés et arêtes du B-rep. */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Bvh } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { buildGeometry, buildLineGeometry } from './bvh';
import type { ImportedMesh } from '../io/types';
import { useSession } from '../state/session';

interface BodyProps {
  mesh: ImportedMesh;
  onPointerMove: (event: ThreeEvent<PointerEvent>, mesh: ImportedMesh) => void;
  onPointerDown: (event: ThreeEvent<PointerEvent>, mesh: ImportedMesh) => void;
  onPointerLeave: () => void;
}

function Body({ mesh, onPointerMove, onPointerDown, onPointerLeave }: BodyProps) {
  const showEdges = useSession((state) => state.showEdges);
  const geometry = useMemo(() => buildGeometry(mesh), [mesh]);
  const edgeGeometry = useMemo(() => buildLineGeometry(mesh.edgePositions), [mesh]);

  useEffect(() => () => {
    geometry.dispose();
    edgeGeometry.dispose();
  }, [geometry, edgeGeometry]);

  const color = useMemo(
    () => (mesh.color ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]) : new THREE.Color('#c9cfd8')),
    [mesh],
  );

  return (
    <group>
      <mesh
        geometry={geometry}
        userData={{ meshId: mesh.id }}
        onPointerMove={(event) => onPointerMove(event, mesh)}
        onPointerDown={(event) => onPointerDown(event, mesh)}
        onPointerOut={onPointerLeave}
      >
        <meshStandardMaterial
          color={color}
          roughness={0.7}
          metalness={0.05}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>
      {showEdges && (
        <lineSegments geometry={edgeGeometry} renderOrder={2}>
          <lineBasicMaterial color="#5a6270" transparent opacity={0.85} />
        </lineSegments>
      )}
    </group>
  );
}

export function ModelScene(props: Omit<BodyProps, 'mesh'>) {
  const model = useSession((state) => state.model);
  if (!model) return null;
  return (
    <Bvh key={model.name} firstHitOnly>
      {model.meshes.map((mesh) => <Body key={mesh.id} mesh={mesh} {...props} />)}
    </Bvh>
  );
}
