/** Construction des géométries du modèle importé.
 *
 *  L'accélération du lancer de rayon est assurée par le composant `<Bvh>` de drei,
 *  qui installe three-mesh-bvh sur les maillages qu'il englobe : sans cela, viser
 *  une arête sur un assemblage de plusieurs centaines de milliers de triangles
 *  devient impraticable. */
import * as THREE from 'three';

export function buildGeometry(mesh: {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildLineGeometry(positions: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}
