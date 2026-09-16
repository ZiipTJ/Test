import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { parseModelXml, parseThreeMf } from '../src/io/formats/threemf';

/** Tétraèdre minimal, écrit comme le ferait un exporteur 3MF. */
function objectXml(id: string, name: string, extra = ''): string {
  return `<object id="${id}" type="model" name="${name}"${extra}>
    <mesh>
      <vertices>
        <vertex x="0" y="0" z="0" />
        <vertex x="10" y="0" z="0" />
        <vertex x="0" y="10" z="0" />
        <vertex x="0" y="0" z="10" />
      </vertices>
      <triangles>
        <triangle v1="0" v2="2" v3="1" />
        <triangle v1="0" v2="1" v3="3" />
        <triangle v1="1" v2="2" v3="3" />
        <triangle v1="0" v2="3" v3="2" />
      </triangles>
    </mesh>
  </object>`;
}

const model = (unit: string, body: string, build: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>${body}</resources>
  <build>${build}</build>
</model>`;

describe('parseModelXml', () => {
  it('lit un objet simple placé sur le plateau', () => {
    const doc = parseModelXml(model('millimeter', objectXml('1', 'Platine'), '<item objectid="1" />'));
    expect(doc.warnings).toHaveLength(0);
    expect(doc.meshes).toHaveLength(1);
    expect(doc.meshes[0]!.name).toBe('Platine');
    expect(doc.meshes[0]!.positions.length).toBe(12);
    expect(doc.meshes[0]!.indices.length).toBe(12);
    expect(Array.from(doc.meshes[0]!.positions.slice(3, 6))).toEqual([10, 0, 0]);
  });

  it('convertit les unités vers le millimètre', () => {
    const doc = parseModelXml(model('centimeter', objectXml('1', 'Platine'), '<item objectid="1" />'));
    expect(doc.scale).toBe(10);
    expect(Array.from(doc.meshes[0]!.positions.slice(3, 6))).toEqual([100, 0, 0]);
  });

  it('applique la transformation du plateau', () => {
    const doc = parseModelXml(
      model('millimeter', objectXml('1', 'Platine'), '<item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 20 5" />'),
    );
    expect(Array.from(doc.meshes[0]!.positions.slice(0, 3))).toEqual([100, 20, 5]);
    expect(Array.from(doc.meshes[0]!.positions.slice(3, 6))).toEqual([110, 20, 5]);
  });

  it('compose les transformations d’un assemblage de composants', () => {
    // L'objet 2 assemble deux fois l'objet 1, décalé ; le plateau décale le tout.
    const assembly = `<object id="2" type="model" name="Assemblage">
      <components>
        <component objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0" />
        <component objectid="1" transform="1 0 0 0 1 0 0 0 1 50 0 0" />
      </components>
    </object>`;
    const doc = parseModelXml(
      model('millimeter', objectXml('1', 'Pièce') + assembly, '<item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 7" />'),
    );
    expect(doc.meshes).toHaveLength(2);
    expect(Array.from(doc.meshes[0]!.positions.slice(0, 3))).toEqual([0, 0, 7]);
    expect(Array.from(doc.meshes[1]!.positions.slice(0, 3))).toEqual([50, 0, 7]);
  });

  it('compose correctement une rotation suivie d’une translation', () => {
    // Rotation de 90° autour de Z, puis translation de 100 en X par le plateau.
    const assembly = `<object id="2" type="model" name="Tourné">
      <components><component objectid="1" transform="0 1 0 -1 0 0 0 0 1 0 0 0" /></components>
    </object>`;
    const doc = parseModelXml(
      model('millimeter', objectXml('1', 'Pièce') + assembly, '<item objectid="2" transform="1 0 0 0 1 0 0 0 1 100 0 0" />'),
    );
    // Le sommet (10,0,0) passe en (0,10,0) puis en (100,10,0).
    const p = doc.meshes[0]!.positions;
    expect(Array.from(p.slice(3, 6)).map((v) => Math.round(v))).toEqual([100, 10, 0]);
  });

  it('récupère la couleur des matériaux de base', () => {
    const materials = '<basematerials id="5"><base name="Alu" displaycolor="#8899AAFF" /><base name="Rouge" displaycolor="#FF0000FF" /></basematerials>';
    const doc = parseModelXml(
      model('millimeter', materials + objectXml('1', 'Pièce', ' pid="5" pindex="1"'), '<item objectid="1" />'),
    );
    expect(doc.meshes[0]!.color).toEqual([1, 0, 0]);
  });

  it('accepte un ordre d’attributs inhabituel', () => {
    const odd = `<object id="1" type="model" name="Bizarre"><mesh>
      <vertices><vertex z="3" x="1" y="2" /><vertex y="0" z="0" x="0" /><vertex x="5" z="0" y="5" /></vertices>
      <triangles><triangle v3="2" v1="0" v2="1" /></triangles>
    </mesh></object>`;
    const doc = parseModelXml(model('millimeter', odd, '<item objectid="1" />'));
    expect(Array.from(doc.meshes[0]!.positions.slice(0, 3))).toEqual([1, 2, 3]);
    expect(Array.from(doc.meshes[0]!.indices)).toEqual([0, 1, 2]);
  });

  it('affiche les objets même sans plateau, et le signale', () => {
    const doc = parseModelXml(
      `<model unit="millimeter"><resources>${objectXml('1', 'Seule')}</resources></model>`,
    );
    expect(doc.meshes).toHaveLength(1);
    expect(doc.warnings.join(' ')).toContain('plateau');
  });

  it('signale un objet référencé mais absent', () => {
    const doc = parseModelXml(model('millimeter', objectXml('1', 'Pièce'), '<item objectid="99" />'));
    expect(doc.meshes).toHaveLength(0);
    expect(doc.warnings.join(' ')).toContain('99');
  });
});

describe('parseThreeMf', () => {
  it('ouvre une archive 3MF complète', () => {
    const xml = model('millimeter', objectXml('1', 'Support'), '<item objectid="1" />');
    const archive = zipSync({
      '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types />'),
      '3D/3dmodel.model': strToU8(xml),
    });
    const doc = parseThreeMf(archive.buffer as ArrayBuffer);
    expect(doc.meshes).toHaveLength(1);
    expect(doc.meshes[0]!.name).toBe('Support');
  });

  it('refuse une archive sans modèle', () => {
    const archive = zipSync({ 'lisezmoi.txt': strToU8('rien ici') });
    expect(() => parseThreeMf(archive.buffer as ArrayBuffer)).toThrow(/mod[eè]le/i);
  });
});
