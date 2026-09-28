// Connected groups of marked pixels (8-connected), for the burn check
// (ADR-490): a change that reaches the picture's edge is something moving in
// view, and a stray mark is counted once however many pixels it spans. An
// explicit stack keeps a bed-sized group from overflowing the call stack.
// Pure core.

export type MaskComponents = {
  /** Group index per pixel, -1 where the pixel is not marked. */
  readonly labels: Int32Array;
  /** Pixel count per group. */
  readonly sizes: ReadonlyArray<number>;
  /** Whether the group reaches the picture's edge. */
  readonly touchesEdge: ReadonlyArray<boolean>;
};

export function maskComponents(marked: Uint8Array, width: number, height: number): MaskComponents {
  const labels = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  const touchesEdge: boolean[] = [];
  const stack = new Int32Array(width * height);
  for (let start = 0; start < marked.length; start += 1) {
    if (marked[start] !== 1 || labels[start] !== -1) continue;
    const label = sizes.length;
    const group = { size: 0, edge: false };
    labels[start] = label;
    let top = 0;
    stack[top++] = start;
    while (top > 0) {
      const index = stack[--top] ?? 0;
      group.size += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) group.edge = true;
      top = pushNeighbours(marked, labels, stack, top, { x, y, width, height, label });
    }
    sizes.push(group.size);
    touchesEdge.push(group.edge);
  }
  return { labels, sizes, touchesEdge };
}

type Visit = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: number;
};

function pushNeighbours(
  marked: Uint8Array,
  labels: Int32Array,
  stack: Int32Array,
  top: number,
  visit: Visit,
): number {
  let next = top;
  for (let dy = -1; dy <= 1; dy += 1) {
    const ny = visit.y + dy;
    if (ny < 0 || ny >= visit.height) continue;
    for (let dx = -1; dx <= 1; dx += 1) {
      const nx = visit.x + dx;
      if ((dx === 0 && dy === 0) || nx < 0 || nx >= visit.width) continue;
      const neighbour = ny * visit.width + nx;
      if (marked[neighbour] !== 1 || labels[neighbour] !== -1) continue;
      labels[neighbour] = visit.label;
      stack[next++] = neighbour;
    }
  }
  return next;
}
