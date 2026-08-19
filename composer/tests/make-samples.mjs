/* Génère des échantillons STEP à surfaces courbes (cylindre, sphère) et un 3MF,
   afin de vérifier la facettisation sur des cas dont la géométrie exacte est connue. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'samples');
mkdirSync(dir, { recursive: true });

function header(name) {
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('${name}','2026-01-01T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }'));
ENDSEC;
DATA;
`;
}
const footer = `ENDSEC;
END-ISO-10303-21;
`;

/* ---- Cylindre plein Ø2R x H, axe Z, base en z=0 ---- */
function cylinderStep(R, H, name) {
  let n = 100;
  const L = [];
  const id = () => `#${n++}`;
  const put = (s) => { const i = id(); L.push(`${i} = ${s};`); return i; };

  const dirZ = put(`DIRECTION('',(0.,0.,1.))`);
  const dirX = put(`DIRECTION('',(1.,0.,0.))`);
  const p0 = put(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const pTop = put(`CARTESIAN_POINT('',(0.,0.,${H}.))`);
  const ax0 = put(`AXIS2_PLACEMENT_3D('',${p0},${dirZ},${dirX})`);
  const axT = put(`AXIS2_PLACEMENT_3D('',${pTop},${dirZ},${dirX})`);

  const cyl = put(`CYLINDRICAL_SURFACE('',${ax0},${R}.)`);
  const plBot = put(`PLANE('',${ax0})`);
  const plTop = put(`PLANE('',${axT})`);
  const cirBot = put(`CIRCLE('',${ax0},${R}.)`);
  const cirTop = put(`CIRCLE('',${axT},${R}.)`);

  const v1p = put(`CARTESIAN_POINT('',(${R}.,0.,0.))`);
  const v2p = put(`CARTESIAN_POINT('',(${R}.,0.,${H}.))`);
  const v1 = put(`VERTEX_POINT('',${v1p})`);
  const v2 = put(`VERTEX_POINT('',${v2p})`);
  const vec = put(`VECTOR('',${dirZ},1.)`);
  const lin = put(`LINE('',${v1p},${vec})`);

  const eBot = put(`EDGE_CURVE('',${v1},${v1},${cirBot},.T.)`);
  const eTop = put(`EDGE_CURVE('',${v2},${v2},${cirTop},.T.)`);
  const eSeam = put(`EDGE_CURVE('',${v1},${v2},${lin},.T.)`);

  const oBot = put(`ORIENTED_EDGE('',*,*,${eBot},.T.)`);
  const oSeamUp = put(`ORIENTED_EDGE('',*,*,${eSeam},.T.)`);
  const oTopRev = put(`ORIENTED_EDGE('',*,*,${eTop},.F.)`);
  const oSeamDn = put(`ORIENTED_EDGE('',*,*,${eSeam},.F.)`);
  const loopSide = put(`EDGE_LOOP('',(${oBot},${oSeamUp},${oTopRev},${oSeamDn}))`);
  const fbSide = put(`FACE_OUTER_BOUND('',${loopSide},.T.)`);
  const fSide = put(`ADVANCED_FACE('',(${fbSide}),${cyl},.T.)`);

  const oBot2 = put(`ORIENTED_EDGE('',*,*,${eBot},.T.)`);
  const loopBot = put(`EDGE_LOOP('',(${oBot2}))`);
  const fbBot = put(`FACE_OUTER_BOUND('',${loopBot},.T.)`);
  const fBot = put(`ADVANCED_FACE('',(${fbBot}),${plBot},.F.)`);

  const oTop2 = put(`ORIENTED_EDGE('',*,*,${eTop},.T.)`);
  const loopTop = put(`EDGE_LOOP('',(${oTop2}))`);
  const fbTop = put(`FACE_OUTER_BOUND('',${loopTop},.T.)`);
  const fTop = put(`ADVANCED_FACE('',(${fbTop}),${plTop},.T.)`);

  const shell = put(`CLOSED_SHELL('',(${fSide},${fBot},${fTop}))`);
  put(`MANIFOLD_SOLID_BREP('${name}',${shell})`);
  L.push(`#9001 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );`);
  return header(name) + L.join('\n') + '\n' + footer;
}

/* ---- Sphère pleine : une seule face sphérique, refermée par une couture
   méridienne (c'est ainsi que la plupart des systèmes de CAO l'exportent) ---- */
function sphereStep(R, name) {
  let n = 100;
  const L = [];
  const put = (s) => { const i = `#${n++}`; L.push(`${i} = ${s};`); return i; };
  const dirZ = put(`DIRECTION('',(0.,0.,1.))`);
  const dirX = put(`DIRECTION('',(1.,0.,0.))`);
  const dirY = put(`DIRECTION('',(0.,1.,0.))`);
  const p0 = put(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const ax = put(`AXIS2_PLACEMENT_3D('',${p0},${dirZ},${dirX})`);
  const sph = put(`SPHERICAL_SURFACE('',${ax},${R}.)`);
  /* Couture : demi-grand cercle dans le plan XZ, du pôle sud au pôle nord. */
  const axMer = put(`AXIS2_PLACEMENT_3D('',${p0},${dirY},${dirZ})`);
  const cir = put(`CIRCLE('',${axMer},${R}.)`);
  const ps = put(`CARTESIAN_POINT('',(0.,0.,${-R}.))`);
  const pn = put(`CARTESIAN_POINT('',(0.,0.,${R}.))`);
  const vs = put(`VERTEX_POINT('',${ps})`);
  const vn = put(`VERTEX_POINT('',${pn})`);
  const eSeam = put(`EDGE_CURVE('',${vs},${vn},${cir},.T.)`);
  const o1 = put(`ORIENTED_EDGE('',*,*,${eSeam},.T.)`);
  const o2 = put(`ORIENTED_EDGE('',*,*,${eSeam},.F.)`);
  const loop = put(`EDGE_LOOP('',(${o1},${o2}))`);
  const fb = put(`FACE_OUTER_BOUND('',${loop},.T.)`);
  const f = put(`ADVANCED_FACE('',(${fb}),${sph},.T.)`);
  const shell = put(`CLOSED_SHELL('',(${f}))`);
  put(`MANIFOLD_SOLID_BREP('${name}',${shell})`);
  L.push(`#9001 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );`);
  return header(name) + L.join('\n') + '\n' + footer;
}

/* ---- 3MF : deux cubes, dont un placé par transformation ---- */
function boxMesh(a, b, c) {
  const V = [[0, 0, 0], [a, 0, 0], [a, b, 0], [0, b, 0], [0, 0, c], [a, 0, c], [a, b, c], [0, b, c]];
  const T = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
             [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  return `<mesh><vertices>${V.map(v => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join('')}</vertices>` +
    `<triangles>${T.map(t => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles></mesh>`;
}

function zip(entries) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c; }
    return t;
  })();
  const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  for (const [name, content] of entries) {
    const raw = enc.encode(content);
    const data = deflateRawSync(raw);
    const nameB = enc.encode(name);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0, true);
    head.setUint16(8, 8, true); head.setUint32(14, crc32(raw), true);
    head.setUint32(18, data.length, true); head.setUint32(22, raw.length, true);
    head.setUint16(26, nameB.length, true);
    locals.push(Buffer.concat([Buffer.from(head.buffer), Buffer.from(nameB), data]));
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint16(10, 8, true); cen.setUint32(16, crc32(raw), true);
    cen.setUint32(20, data.length, true); cen.setUint32(24, raw.length, true);
    cen.setUint16(28, nameB.length, true); cen.setUint32(42, offset, true);
    centrals.push(Buffer.concat([Buffer.from(cen.buffer), Buffer.from(nameB)]));
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cd.length, true); eocd.setUint32(16, offset, true);
  return Buffer.concat([...locals, cd, Buffer.from(eocd.buffer)]);
}

const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <object id="1" name="Socle" type="model">${boxMesh(100, 60, 10)}</object>
  <object id="2" name="Capot" type="model">${boxMesh(40, 40, 25)}</object>
 </resources>
 <build>
  <item objectid="1"/>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 30 10 10"/>
 </build>
</model>`;

writeFileSync(join(dir, 'cylindre-d60-h40.step'), cylinderStep(30, 40, 'CYLINDRE'));
writeFileSync(join(dir, 'sphere-r25.step'), sphereStep(25, 'SPHERE'));
writeFileSync(join(dir, 'deux-boites.3mf'), zip([
  ['[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],
  ['3D/3dmodel.model', model]
]));
console.log('Échantillons écrits dans', dir);
