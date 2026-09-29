// The pinhole fill floods on one typed stack, tests diagonal paper steps only
// beside ink, and stops listing a component once it is too large to fill
// (ADR-530 Amendment 10). It must fill exactly what the flood that listed
// every component filled, and hand the judge the same components in the same
// order.

import { describe, expect, it } from 'vitest';
import { fillPinholes, type PinholeJudge } from './fill-pinholes';
import { createSaddleResolver, type SaddlePolicyInput } from './saddle-connectivity';
import type { RawImageData } from './trace-image';

describe('pinhole fill flood', () => {
  it('fills and judges what listing every component did', () => {
    const policies: (SaddlePolicyInput | undefined)[] = [
      undefined,
      { turnPolicy: 'connect-paper' },
      { turnPolicy: 'auto' },
      { turnPolicy: 'connect-ink' },
    ];
    for (const seed of [2, 7, 9]) {
      const image = crackedInk(91, 67, seed);
      for (const policy of policies) {
        for (const pixelScale of [1, 2]) {
          const actual = judged((judge) => fillPinholes(image, pixelScale, policy, judge));
          const expected = judged((judge) => referenceFill(image, pixelScale, policy, judge));
          expect(actual.calls).toEqual(expected.calls);
          expect(Array.from(actual.out.data)).toEqual(Array.from(expected.out.data));
        }
      }
    }
  });
});

// Fills every other component it is asked about, recording each one.
function judged(run: (judge: PinholeJudge) => RawImageData): {
  readonly calls: number[][];
  readonly out: RawImageData;
} {
  const calls: number[][] = [];
  const out = run((component) => {
    calls.push([...component]);
    return calls.length % 2 === 1;
  });
  return { calls, out };
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

// Ink inside a paper margin, holed at random, with thin paper cracks and a
// large enclosed paper room, so components of every size and diagonal paper
// steps across ink corners occur.
function crackedInk(width: number, height: number, seed: number): RawImageData {
  const random = seeded(seed);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const paint = (x: number, y: number, value: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    data.fill(value, (y * width + x) * 4, (y * width + x) * 4 + 3);
  };
  for (let y = 3; y < height - 3; y += 1) {
    for (let x = 3; x < width - 3; x += 1) paint(x, y, random() < 0.2 ? 255 : 0);
  }
  for (let k = 0; k < 5; k += 1) {
    const x0 = 4 + Math.floor(random() * (width - 8));
    const y0 = 4 + Math.floor(random() * (height - 8));
    for (let t = 0; t < 30; t += 1) paint(x0 + t, y0 + (k % 2 === 0 ? t : 0), 255);
  }
  for (let y = 10; y < 30; y += 1) for (let x = 10; x < 40; x += 1) paint(x, y, 255);
  return { width, height, data };
}

type Grid = {
  readonly ink: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly paperJoins: (x: number, y: number, nx: number, ny: number) => boolean;
};

// The pinhole fill before the change: every component listed in full.
function referenceFill(
  image: RawImageData,
  pixelScale: number,
  policy: SaddlePolicyInput | undefined,
  judge: PinholeJudge,
): RawImageData {
  const grid = referenceGrid(image, policy);
  const { ink, width, height } = grid;
  const outside = referenceOutside(grid);
  const data = new Uint8ClampedArray(image.data);
  const seen = new Uint8Array(width * height);
  for (let start = 0; start < ink.length; start += 1) {
    if (ink[start] !== 0 || outside[start] !== 0 || seen[start] !== 0) continue;
    const component = referenceComponent(grid, start, (p) => {
      if (seen[p] === 1 || ink[p] === 1 || outside[p] === 1) return false;
      seen[p] = 1;
      return true;
    });
    if (component.length > 120 * pixelScale * pixelScale) continue;
    if (!referenceThin(component, ink, width, height, Math.ceil(pixelScale))) continue;
    if (!judge(component)) continue;
    for (const p of component) data.fill(0, p * 4, p * 4 + 3);
  }
  return { width, height, data };
}

function referenceGrid(image: RawImageData, policy: SaddlePolicyInput | undefined): Grid {
  const { width, height } = image;
  const ink = Uint8Array.from({ length: width * height }, (_, i) =>
    (image.data[i * 4] ?? 255) < 128 ? 1 : 0,
  );
  const inkJoinsAt =
    policy === undefined || policy.turnPolicy === 'connect-paper'
      ? null
      : createSaddleResolver(
          { width, height, ink },
          policy.turnPolicy,
          policy.field,
          policy.pixelScale,
        );
  const paperJoins = (x: number, y: number, nx: number, ny: number): boolean =>
    inkJoinsAt !== null &&
    ink[ny * width + nx] !== 1 &&
    ink[y * width + nx] === 1 &&
    ink[ny * width + x] === 1 &&
    !inkJoinsAt(Math.max(x, nx), Math.max(y, ny));
  return { ink, width, height, paperJoins };
}

// Border seeds pushed unfiltered; each pop skips ink and pixels already out.
function referenceOutside(grid: Grid): Uint8Array {
  const { ink, width, height } = grid;
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x += 1) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y += 1) stack.push(y * width, y * width + width - 1);
  while (stack.length > 0) {
    const p = stack.pop() ?? 0;
    if (outside[p] === 1 || ink[p] === 1) continue;
    outside[p] = 1;
    stack.push(...paperSteps(grid, p));
  }
  return outside;
}

// Depth-first from `start`; `admit` filters (and marks) each pushed step.
function referenceComponent(grid: Grid, start: number, admit: (p: number) => boolean): number[] {
  const component: number[] = [];
  const stack = [start];
  admit(start);
  while (stack.length > 0) {
    const p = stack.pop() ?? 0;
    component.push(p);
    for (const q of paperSteps(grid, p)) if (admit(q)) stack.push(q);
  }
  return component;
}

// Four-neighbours, then the diagonal paper steps in their fixed order.
function paperSteps(grid: Grid, p: number): number[] {
  const { width, height } = grid;
  const steps = neighbours(p, width, height);
  const x = p % width;
  const y = (p - x) / width;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const nx = x + sx;
    const ny = y + sy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    if (grid.paperJoins(x, y, nx, ny)) steps.push(ny * width + nx);
  }
  return steps;
}

function neighbours(p: number, width: number, height: number): number[] {
  const x = p % width;
  const out: number[] = [];
  if (x > 0) out.push(p - 1);
  if (x < width - 1) out.push(p + 1);
  if (p >= width) out.push(p - width);
  if (p < width * (height - 1)) out.push(p + width);
  return out;
}

function referenceThin(
  component: ReadonlyArray<number>,
  ink: Uint8Array,
  width: number,
  height: number,
  maxRadius: number,
): boolean {
  const inComponent = new Set(component);
  const depth = new Map<number, number>();
  let frontier = component.filter((p) => neighbours(p, width, height).some((q) => ink[q] === 1));
  for (const p of frontier) depth.set(p, 1);
  let maxDepth = frontier.length > 0 ? 1 : Number.POSITIVE_INFINITY;
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const p of frontier) {
      for (const q of neighbours(p, width, height)) {
        if (!inComponent.has(q) || depth.has(q)) continue;
        depth.set(q, (depth.get(p) ?? 1) + 1);
        maxDepth = Math.max(maxDepth, (depth.get(p) ?? 1) + 1);
        if (maxDepth > maxRadius) return false;
        next.push(q);
      }
    }
    frontier = next;
  }
  return depth.size === component.length && maxDepth <= maxRadius;
}
