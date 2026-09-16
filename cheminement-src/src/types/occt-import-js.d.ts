/* occt-import-js n'embarque pas de typages : on décrit ici le strict nécessaire,
   validé contre la sortie réelle de la 0.0.23. */
declare module 'occt-import-js' {
  export interface OcctArray<T> { array: T }
  export interface OcctBrepFace { first: number; last: number; color: [number, number, number] | null }
  export interface OcctMesh {
    name: string;
    color: [number, number, number] | null;
    brep_faces?: OcctBrepFace[];
    attributes: {
      position: OcctArray<number[]>;
      normal?: OcctArray<number[]>;
    };
    index: OcctArray<number[]>;
  }
  export interface OcctNode {
    name: string;
    meshes: number[];
    children: OcctNode[];
  }
  export interface OcctResult {
    success: boolean;
    root?: OcctNode;
    meshes?: OcctMesh[];
  }
  export interface OcctReadParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }
  export interface OcctModule {
    ReadStepFile(buffer: Uint8Array, params: OcctReadParams | null): OcctResult;
    ReadIgesFile(buffer: Uint8Array, params: OcctReadParams | null): OcctResult;
    ReadBrepFile(buffer: Uint8Array, params: OcctReadParams | null): OcctResult;
  }
  export default function occtimportjs(options?: { locateFile?: (path: string) => string }): Promise<OcctModule>;
}

declare module 'occt-import-js/dist/occt-import-js.wasm?url' {
  const url: string;
  export default url;
}
