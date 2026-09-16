/** Le modèle CAO importé : corps tessellés et arêtes du B-rep. */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Bvh } from '@react-three/drei';
import { buildGeometry, buildLineGeometry } from './bvh';
import type { ImportedMesh } from '../io/types';
import { useSession } from '../state/session';

/** Rien d'autre que la matière ne doit répondre au pointeur. */
const IGNORE_POINTER = () => null;

/** Le pointeur est traité par un lancer de rayon manuel (voir picking.ts) : les
 *  corps n'ont donc pas de gestionnaire d'événement, seulement un identifiant. */
function Body({ mesh }: { mesh: ImportedMesh }) {
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
      <mesh geometry={geometry} userData={{ meshId: mesh.id }}>
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
        // Décoratives : sans cela, une arête intercepte le lancer de rayon et
        // renvoie un point sans face — donc sans plan de travail ni accrochage.
        <lineSegments geometry={edgeGeometry} renderOrder={2} raycast={IGNORE_POINTER}>
          <lineBasicMaterial color="#5a6270" transparent opacity={0.85} />
        </lineSegments>
      )}
    </group>
  );
}

export function ModelScene() {
  const model = useSession((state) => state.model);
  if (!model) return null;
  return (
    <Bvh key={model.name} firstHitOnly>
      {model.meshes.map((mesh) => <Body key={mesh.id} mesh={mesh} />)}
    </Bvh>
  );
}
