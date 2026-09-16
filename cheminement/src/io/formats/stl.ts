/** Lecture STL binaire et ASCII.
 *  Le STL ne porte ni unité ni topologie : on suppose le millimètre et les
 *  normales sont recalculées ensuite avec détection des arêtes vives. */

export interface StlMesh {
  positions: Float32Array;
  indices: Uint32Array;
  /** Nom du solide déclaré dans un STL ASCII. */
  name: string;
}

function isBinary(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);
  if (84 + triangles * 50 === buffer.byteLength) return true;
  // Un STL ASCII commence par « solid », mais certains binaires aussi :
  // la taille annoncée reste le critère décisif.
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength)));
  return head.trim().toLowerCase() !== 'solid';
}

function parseBinary(buffer: ArrayBuffer): StlMesh {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  let offset = 84;
  for (let t = 0; t < count; t += 1) {
    offset += 12; // normale du fichier, ignorée
    for (let v = 0; v < 3; v += 1) {
      positions[t * 9 + v * 3] = view.getFloat32(offset, true);
      positions[t * 9 + v * 3 + 1] = view.getFloat32(offset + 4, true);
      positions[t * 9 + v * 3 + 2] = view.getFloat32(offset + 8, true);
      offset += 12;
    }
    offset += 2; // attribut
  }
  const indices = new Uint32Array(count * 3);
  for (let i = 0; i < indices.length; i += 1) indices[i] = i;
  return { positions, indices, name: 'Solide STL' };
}

function parseAscii(text: string): StlMesh {
  const values: number[] = [];
  const vertex = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
  let match: RegExpExecArray | null;
  while ((match = vertex.exec(text)) !== null) {
    values.push(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  const positions = Float32Array.from(values);
  const indices = new Uint32Array(positions.length / 3);
  for (let i = 0; i < indices.length; i += 1) indices[i] = i;
  const name = /solid\s+([^\r\n]*)/.exec(text)?.[1]?.trim() || 'Solide STL';
  return { positions, indices, name };
}

export function parseStl(buffer: ArrayBuffer): StlMesh {
  const mesh = isBinary(buffer) ? parseBinary(buffer) : parseAscii(new TextDecoder().decode(buffer));
  if (mesh.indices.length === 0) throw new Error('Fichier STL sans triangle exploitable.');
  return mesh;
}
