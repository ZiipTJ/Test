/** Graphe de cheminement : voisinage, plus court chemin, connexité, contrôles. */
import type { HarnessProject, Id } from './types';
import type { SegmentGeometry } from './evaluate';

export interface AdjacencyEntry {
  segmentId: Id;
  other: Id;
  weight: number;
}

export type Adjacency = Map<Id, AdjacencyEntry[]>;

export function buildAdjacency(project: HarnessProject, geometry: Map<Id, SegmentGeometry>): Adjacency {
  const adjacency: Adjacency = new Map();
  for (const nodeId of Object.keys(project.nodes)) adjacency.set(nodeId, []);
  for (const segment of Object.values(project.segments)) {
    const weight = geometry.get(segment.id)?.length ?? 0;
    adjacency.get(segment.a)?.push({ segmentId: segment.id, other: segment.b, weight });
    adjacency.get(segment.b)?.push({ segmentId: segment.id, other: segment.a, weight });
  }
  return adjacency;
}

/** Tas binaire minimal : le graphe d'un faisceau reste petit, mais un tri
 *  linéaire à chaque extraction devient sensible dès quelques milliers de nœuds. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly values: Id[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: Id): void {
    this.keys.push(key);
    this.values.push(value);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { key: number; value: Id } | undefined {
    if (this.keys.length === 0) return undefined;
    const key = this.keys[0]!;
    const value = this.values[0]!;
    const lastKey = this.keys.pop()!;
    const lastValue = this.values.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.keys.length && this.keys[l]! < this.keys[smallest]!) smallest = l;
        if (r < this.keys.length && this.keys[r]! < this.keys[smallest]!) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return { key, value };
  }

  private swap(i: number, j: number): void {
    [this.keys[i], this.keys[j]] = [this.keys[j]!, this.keys[i]!];
    [this.values[i], this.values[j]] = [this.values[j]!, this.values[i]!];
  }
}

export interface PathResult {
  nodes: Id[];
  segments: Id[];
  length: number;
}

/** Plus court chemin entre deux nœuds, pondéré par la longueur réelle des segments. */
export function shortestPath(adjacency: Adjacency, from: Id, to: Id): PathResult | null {
  if (from === to) return { nodes: [from], segments: [], length: 0 };
  if (!adjacency.has(from) || !adjacency.has(to)) return null;

  const dist = new Map<Id, number>([[from, 0]]);
  const prev = new Map<Id, { node: Id; segment: Id }>();
  const settled = new Set<Id>();
  const heap = new MinHeap();
  heap.push(0, from);

  while (heap.size > 0) {
    const top = heap.pop()!;
    if (settled.has(top.value)) continue;
    settled.add(top.value);
    if (top.value === to) break;
    for (const edge of adjacency.get(top.value) ?? []) {
      if (settled.has(edge.other)) continue;
      const candidate = top.key + edge.weight;
      if (candidate < (dist.get(edge.other) ?? Infinity)) {
        dist.set(edge.other, candidate);
        prev.set(edge.other, { node: top.value, segment: edge.segmentId });
        heap.push(candidate, edge.other);
      }
    }
  }

  if (!settled.has(to)) return null;

  const nodes: Id[] = [to];
  const segments: Id[] = [];
  let cursor = to;
  while (cursor !== from) {
    const step = prev.get(cursor);
    if (!step) return null;
    segments.push(step.segment);
    nodes.push(step.node);
    cursor = step.node;
  }
  nodes.reverse();
  segments.reverse();
  return { nodes, segments, length: dist.get(to) ?? 0 };
}

/** Segments empruntés par une suite de nœuds imposée (cheminement manuel). */
export function segmentsForNodePath(project: HarnessProject, nodes: readonly Id[]): Id[] | null {
  const index = new Map<string, Id>();
  for (const segment of Object.values(project.segments)) {
    index.set(`${segment.a}|${segment.b}`, segment.id);
    index.set(`${segment.b}|${segment.a}`, segment.id);
  }
  const out: Id[] = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const found = index.get(`${nodes[i - 1]}|${nodes[i]}`);
    if (!found) return null;
    out.push(found);
  }
  return out;
}

export function connectedComponents(adjacency: Adjacency): Id[][] {
  const seen = new Set<Id>();
  const components: Id[][] = [];
  for (const start of adjacency.keys()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const component: Id[] = [];
    seen.add(start);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const edge of adjacency.get(current) ?? []) {
        if (!seen.has(edge.other)) {
          seen.add(edge.other);
          stack.push(edge.other);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Degré de chaque nœud : un degré ≥ 3 est une dérivation (patte d'oie). */
export function nodeDegrees(adjacency: Adjacency): Map<Id, number> {
  const degrees = new Map<Id, number>();
  for (const [node, edges] of adjacency) degrees.set(node, edges.length);
  return degrees;
}
