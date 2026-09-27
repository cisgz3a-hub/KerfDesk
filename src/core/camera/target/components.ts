// Connected components of a binary mask with hole ownership (ADR-441). Dark
// pixels join 8-connected and light pixels 4-connected: with that pairing
// every light region fully surrounded by one dark region is exactly a hole of
// it, which is what the ring detector needs. Pure core.

export type ComponentStats = {
  readonly id: number;
  area: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumYY: number;
  sumXY: number;
  touchesBorder: boolean;
};

export type LabelledComponents = {
  readonly dark: ReadonlyArray<ComponentStats>;
  /** Largest hole of each dark component that has one. */
  readonly holeOf: ReadonlyMap<number, ComponentStats>;
  /** Largest dark component that sits alone inside a hole (an anchor's dot). */
  readonly innerDotOf: ReadonlyMap<number, ComponentStats>;
};

// Adjacency sets are only needed while small; the background touches
// hundreds of components and is never a hole, so it is capped and ignored.
const MAX_NEIGHBOURS = 6;

export function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): LabelledComponents {
  const darkLabels = label(mask, width, height, 1, true);
  const lightLabels = label(mask, width, height, 0, false);
  const dark = stats(darkLabels.labels, darkLabels.count, width, height);
  const light = stats(lightLabels.labels, lightLabels.count, width, height);
  const adjacency = adjacencyOf(darkLabels.labels, lightLabels.labels, width, height);
  const holeOf = new Map<number, ComponentStats>();
  const innerDotOf = new Map<number, ComponentStats>();
  light.forEach((hole) => {
    if (hole.touchesBorder) return;
    const neighbours = adjacency.darkAround.get(hole.id);
    if (neighbours === undefined || neighbours.size > MAX_NEIGHBOURS) return;
    const inside = [...neighbours].filter((d) => enclosedBy(adjacency.lightAround.get(d), hole.id));
    const owners = [...neighbours].filter((d) => !inside.includes(d));
    if (owners.length !== 1) return;
    const owner = owners[0] as number;
    const current = holeOf.get(owner);
    if (current === undefined || current.area < hole.area) holeOf.set(owner, hole);
    const dot = largest(inside.map((d) => dark[d - 1]));
    if (dot !== undefined) innerDotOf.set(hole.id, dot);
  });
  return { dark, holeOf, innerDotOf };
}

function enclosedBy(lightNeighbours: ReadonlySet<number> | undefined, hole: number): boolean {
  return lightNeighbours !== undefined && lightNeighbours.size === 1 && lightNeighbours.has(hole);
}

function largest(items: ReadonlyArray<ComponentStats | undefined>): ComponentStats | undefined {
  let best: ComponentStats | undefined;
  for (const item of items)
    if (item !== undefined && (best === undefined || item.area > best.area)) best = item;
  return best;
}

type Labels = { readonly labels: Int32Array; readonly count: number };

// Two-pass union-find labelling. Labels are 1-based; 0 means "not this value".
function label(
  mask: Uint8Array,
  width: number,
  height: number,
  value: number,
  eight: boolean,
): Labels {
  const labels = new Int32Array(width * height);
  const parent: number[] = [0];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (mask[i] !== value) continue;
      const neighbours = previousNeighbours(labels, x, y, width, eight);
      if (neighbours.length === 0) {
        parent.push(parent.length);
        labels[i] = parent.length - 1;
        continue;
      }
      const root = Math.min(...neighbours.map((n) => find(parent, n)));
      labels[i] = root;
      for (const n of neighbours) parent[find(parent, n)] = root;
    }
  }
  return relabel(labels, parent);
}

function previousNeighbours(
  labels: Int32Array,
  x: number,
  y: number,
  width: number,
  eight: boolean,
): number[] {
  const out: number[] = [];
  const push = (value: number | undefined) => {
    if (value !== undefined && value > 0) out.push(value);
  };
  if (x > 0) push(labels[y * width + x - 1]);
  if (y > 0) {
    push(labels[(y - 1) * width + x]);
    if (eight && x > 0) push(labels[(y - 1) * width + x - 1]);
    if (eight && x + 1 < width) push(labels[(y - 1) * width + x + 1]);
  }
  return out;
}

function find(parent: number[], start: number): number {
  let root = start;
  while (parent[root] !== root) root = parent[root] ?? root;
  let node = start;
  while (parent[node] !== root) {
    const next = parent[node] ?? root;
    parent[node] = root;
    node = next;
  }
  return root;
}

function relabel(labels: Int32Array, parent: number[]): Labels {
  const compact = new Int32Array(parent.length);
  let count = 0;
  for (let i = 1; i < parent.length; i += 1) {
    const root = find(parent, i);
    if (compact[root] === 0) compact[root] = ++count;
    compact[i] = compact[root] ?? 0;
  }
  for (let i = 0; i < labels.length; i += 1) {
    const l = labels[i] ?? 0;
    if (l > 0) labels[i] = compact[l] ?? 0;
  }
  return { labels, count };
}

function stats(labels: Int32Array, count: number, width: number, height: number): ComponentStats[] {
  const out: ComponentStats[] = [];
  for (let id = 1; id <= count; id += 1) {
    out.push({ id, area: 0, sumX: 0, sumY: 0, sumXX: 0, sumYY: 0, sumXY: 0, touchesBorder: false });
  }
  for (let y = 0; y < height; y += 1) {
    const edgeRow = y === 0 || y === height - 1;
    for (let x = 0; x < width; x += 1) {
      const l = labels[y * width + x] ?? 0;
      if (l === 0) continue;
      const s = out[l - 1] as ComponentStats;
      s.area += 1;
      s.sumX += x;
      s.sumY += y;
      s.sumXX += x * x;
      s.sumYY += y * y;
      s.sumXY += x * y;
      if (edgeRow || x === 0 || x === width - 1) s.touchesBorder = true;
    }
  }
  return out;
}

type Adjacency = {
  readonly darkAround: Map<number, Set<number>>;
  readonly lightAround: Map<number, Set<number>>;
};

function adjacencyOf(
  dark: Int32Array,
  light: Int32Array,
  width: number,
  height: number,
): Adjacency {
  const darkAround = new Map<number, Set<number>>();
  const lightAround = new Map<number, Set<number>>();
  const link = (l: number, d: number) => {
    addCapped(darkAround, l, d);
    addCapped(lightAround, d, l);
  };
  const linkTo = (l: number, j: number): void => {
    const d = dark[j] ?? 0;
    if (d > 0) link(l, d);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const l = light[i] ?? 0;
      if (l === 0) continue;
      if (x + 1 < width) linkTo(l, i + 1);
      if (x > 0) linkTo(l, i - 1);
      if (y + 1 < height) linkTo(l, i + width);
      if (y > 0) linkTo(l, i - width);
    }
  }
  return { darkAround, lightAround };
}

function addCapped(map: Map<number, Set<number>>, key: number, value: number): void {
  let set = map.get(key);
  if (set === undefined) {
    set = new Set();
    map.set(key, set);
  }
  if (set.size <= MAX_NEIGHBOURS) set.add(value);
}
