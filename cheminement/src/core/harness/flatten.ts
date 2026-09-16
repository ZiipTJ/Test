/** Mise à plat du faisceau : la « planche de fabrication ».
 *
 *  On déplie le graphe dans le plan en conservant la longueur réelle de chaque
 *  segment. L'arbre couvrant est déployé en éventail (chaque sous-arbre reçoit un
 *  secteur angulaire proportionnel à son nombre de feuilles) ; les arêtes hors
 *  arbre — les boucles — sont signalées comme telles puisqu'elles ne peuvent pas
 *  être mises à plat sans déformer une longueur. */
import type { Adjacency } from './graph';
import type { HarnessComputation } from './routing';
import type { HarnessProject, Id } from './types';

export interface FlatNode {
  id: Id;
  name: string;
  kind: string;
  x: number;
  y: number;
  /** Nombre de segments incidents. */
  degree: number;
}

export interface FlatEdge {
  segmentId: Id;
  a: Id;
  b: Id;
  length: number;
  bundleDiameter: number;
  wireCount: number;
  sleeve?: { name: string; kind: string; color: string };
  /** Faux pour une arête de boucle : sa longueur n'est pas respectée au dessin. */
  inTree: boolean;
}

export interface FlatLayout {
  nodes: FlatNode[];
  edges: FlatEdge[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Nœuds de départ retenus, un par îlot du graphe. */
  roots: Id[];
}

function countLeaves(children: Map<Id, Id[]>, root: Id): Map<Id, number> {
  const leaves = new Map<Id, number>();
  const order: Id[] = [];
  const stack: Id[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    order.push(node);
    for (const child of children.get(node) ?? []) stack.push(child);
  }
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const node = order[i]!;
    const kids = children.get(node) ?? [];
    if (kids.length === 0) leaves.set(node, 1);
    else leaves.set(node, kids.reduce((sum, k) => sum + (leaves.get(k) ?? 1), 0));
  }
  return leaves;
}

export function flattenHarness(
  project: HarnessProject,
  computation: HarnessComputation,
  options: { spread?: number } = {},
): FlatLayout {
  const adjacency: Adjacency = computation.adjacency;
  const spread = options.spread ?? Math.PI * 0.8;

  const positions = new Map<Id, { x: number; y: number }>();
  const visited = new Set<Id>();
  const treeEdges = new Set<Id>();
  const roots: Id[] = [];

  // Îlots traités l'un après l'autre, empilés verticalement.
  let islandOffsetY = 0;

  const allNodes = Object.keys(project.nodes).sort((a, b) => {
    const da = adjacency.get(b)?.length ?? 0;
    const db = adjacency.get(a)?.length ?? 0;
    return da - db;
  });

  for (const candidate of allNodes) {
    if (visited.has(candidate)) continue;

    // Racine : le connecteur de plus fort degré, à défaut le nœud de plus fort degré.
    let root = candidate;
    let bestScore = -1;
    const island: Id[] = [];
    const queue = [candidate];
    const seen = new Set<Id>([candidate]);
    while (queue.length > 0) {
      const node = queue.shift()!;
      island.push(node);
      const degree = adjacency.get(node)?.length ?? 0;
      const score = degree + (project.nodes[node]?.kind === 'connecteur' ? 10 : 0);
      if (score > bestScore) { bestScore = score; root = node; }
      for (const edge of adjacency.get(node) ?? []) {
        if (!seen.has(edge.other)) { seen.add(edge.other); queue.push(edge.other); }
      }
    }
    roots.push(root);

    // Arbre couvrant en largeur, puis déploiement en éventail.
    const parent = new Map<Id, Id>();
    const children = new Map<Id, Id[]>();
    const bfs = [root];
    const inTree = new Set<Id>([root]);
    while (bfs.length > 0) {
      const node = bfs.shift()!;
      for (const edge of adjacency.get(node) ?? []) {
        if (inTree.has(edge.other)) continue;
        inTree.add(edge.other);
        parent.set(edge.other, node);
        treeEdges.add(edge.segmentId);
        const list = children.get(node) ?? [];
        list.push(edge.other);
        children.set(node, list);
        bfs.push(edge.other);
      }
    }

    const leaves = countLeaves(children, root);
    positions.set(root, { x: 0, y: islandOffsetY });
    const walk: Array<{ node: Id; angle: number; wedge: number }> = [
      { node: root, angle: 0, wedge: Math.PI * 2 },
    ];
    while (walk.length > 0) {
      const current = walk.pop()!;
      const kids = children.get(current.node) ?? [];
      if (kids.length === 0) continue;
      const total = kids.reduce((sum, k) => sum + (leaves.get(k) ?? 1), 0) || 1;
      const wedge = Math.min(current.wedge, spread);
      let cursor = current.angle - wedge / 2;
      const origin = positions.get(current.node)!;
      for (const kid of kids) {
        const share = (leaves.get(kid) ?? 1) / total;
        const childWedge = wedge * share;
        const angle = kids.length === 1 ? current.angle : cursor + childWedge / 2;
        cursor += childWedge;
        const segmentId = (adjacency.get(current.node) ?? []).find((e) => e.other === kid)?.segmentId;
        const length = segmentId ? computation.geometry.get(segmentId)?.length ?? 50 : 50;
        positions.set(kid, {
          x: origin.x + Math.cos(angle) * length,
          y: origin.y + Math.sin(angle) * length,
        });
        walk.push({ node: kid, angle, wedge: Math.max(childWedge, 0.35) });
      }
    }

    for (const node of island) visited.add(node);
    let maxY = islandOffsetY;
    for (const node of island) maxY = Math.max(maxY, positions.get(node)?.y ?? islandOffsetY);
    islandOffsetY = maxY + 200;
  }

  const nodes: FlatNode[] = Object.values(project.nodes).map((node) => {
    const p = positions.get(node.id) ?? { x: 0, y: 0 };
    return {
      id: node.id,
      name: node.name,
      kind: node.kind,
      x: p.x,
      y: p.y,
      degree: adjacency.get(node.id)?.length ?? 0,
    };
  });

  const edges: FlatEdge[] = Object.values(project.segments).map((segment) => {
    const load = computation.loads.get(segment.id);
    const sleeve = segment.sleeveId ? project.sleeves[segment.sleeveId] : undefined;
    return {
      segmentId: segment.id,
      a: segment.a,
      b: segment.b,
      length: computation.geometry.get(segment.id)?.length ?? 0,
      bundleDiameter: load?.bundleDiameter ?? 0,
      wireCount: load?.wireIds.length ?? 0,
      ...(sleeve ? { sleeve: { name: sleeve.name, kind: sleeve.kind, color: sleeve.color } } : {}),
      inTree: treeEdges.has(segment.id),
    };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 1; maxY = 1; }

  return { nodes, edges, bbox: { minX, minY, maxX, maxY }, roots };
}
