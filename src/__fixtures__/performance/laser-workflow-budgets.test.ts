import { describe, expect, it } from 'vitest';
import { createStreamer, onAck, step } from '../../core/controllers/grbl';
import { quickNest } from '../../core/nesting';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import {
  TRACE_PRESETS,
  traceImageToColoredPaths,
  type RawImageData,
  type TraceOptions,
} from '../../core/trace';
import { emitGcode, prepareOutput } from '../../io/gcode';
import { serializeProject } from '../../io/project';
import { parseSvg } from '../../io/svg';
import { ciBudgetMs } from '../ci-budget';

type Size = 'small' | 'medium' | 'large';
type Phase = 'import' | 'trace' | 'editing' | 'preview' | 'save' | 'compile' | 'streaming';

const FIXTURES: Readonly<
  Record<Size, { objects: number; traceEdge: number; streamLines: number }>
> = {
  small: { objects: 10, traceEdge: 32, streamLines: 1_000 },
  medium: { objects: 200, traceEdge: 96, streamLines: 10_000 },
  large: { objects: 1_000, traceEdge: 192, streamLines: 100_000 },
};

const LOCAL_BUDGETS: Readonly<Record<Size, Readonly<Record<Phase, number>>>> = {
  small: {
    import: 150,
    trace: 800,
    editing: 100,
    preview: 500,
    save: 100,
    compile: 800,
    streaming: 500,
  },
  medium: {
    import: 600,
    trace: 2_500,
    editing: 400,
    preview: 2_000,
    save: 400,
    compile: 3_000,
    streaming: 1_500,
  },
  large: {
    import: 2_500,
    trace: 8_000,
    editing: 1_500,
    preview: 7_000,
    save: 1_500,
    compile: 10_000,
    streaming: 5_000,
  },
};

describe('laser workflow performance budgets', () => {
  for (const size of ['small', 'medium', 'large'] as const) {
    it(
      `keeps the ${size} fixture inside every phase budget`,
      async () => {
        const fixture = FIXTURES[size];
        const project = projectFixture(fixture.objects);
        const timings: Partial<Record<Phase, number>> = {};
        timings.import = measured(() =>
          parseSvg({ svgText: svgFixture(fixture.objects), id: size, source: `${size}.svg` }),
        );
        timings.trace = await measuredAsync(() =>
          traceImageToColoredPaths(
            traceFixture(fixture.traceEdge),
            TRACE_PRESETS['Line Art'] as TraceOptions,
          ),
        );
        timings.editing = measured(() =>
          quickNest({ minX: 0, minY: 0, maxX: 2_000, maxY: 2_000 }, nestItems(fixture.objects), {
            padding: 1,
          }),
        );
        timings.preview = measured(() => prepareOutput(project));
        timings.save = measured(() => serializeProject(project));
        const emitted = measuredValue(() => emitGcode(project));
        timings.compile = emitted.elapsed;
        timings.streaming = measured(() => consumeStream(streamFixture(fixture.streamLines)));

        console.info(
          `[workflow-perf] ${size}: ${Object.entries(timings)
            .map(([phase, elapsed]) => `${phase}=${elapsed?.toFixed(1)}ms`)
            .join(' ')}`,
        );

        for (const phase of Object.keys(LOCAL_BUDGETS[size]) as Phase[]) {
          const elapsed = timings[phase];
          expect(elapsed, `${size} ${phase} timing missing`).toBeDefined();
          expect(elapsed ?? Infinity, `${size} ${phase}`).toBeLessThanOrEqual(
            ciBudgetMs(LOCAL_BUDGETS[size][phase], LOCAL_BUDGETS[size][phase] * 3),
          );
        }
      },
      ciBudgetMs(40_000, 120_000),
    );
  }
});

function projectFixture(count: number): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      layers: [createLayer({ id: 'perf-layer', color: '#ff0000' })],
      objects: Array.from({ length: count }, (_, index) => squareObject(index)),
    },
  };
}

function squareObject(index: number): SceneObject {
  const x = (index % 40) * 8;
  const y = Math.floor(index / 40) * 8;
  const points = [
    { x, y },
    { x: x + 5, y },
    { x: x + 5, y: y + 5 },
    { x, y: y + 5 },
  ];
  return {
    kind: 'imported-svg',
    id: `perf-${index}`,
    source: 'performance-fixture.svg',
    bounds: { minX: x, minY: y, maxX: x + 5, maxY: y + 5 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [{ points, closed: true }] }],
  };
}

function svgFixture(count: number): string {
  const geometry = Array.from({ length: count }, (_, index) => {
    const x = (index % 40) * 8;
    const y = Math.floor(index / 40) * 8;
    return `<rect x="${x}" y="${y}" width="5" height="5" fill="none" stroke="#f00"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${geometry}</svg>`;
}

function traceFixture(edge: number): RawImageData {
  const data = new Uint8ClampedArray(edge * edge * 4);
  for (let y = 0; y < edge; y += 1) {
    for (let x = 0; x < edge; x += 1) {
      const offset = (y * edge + x) * 4;
      const value = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0 ? 0 : 255;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width: edge, height: edge, data };
}

function nestItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    width: 5,
    height: 5,
    canRotate: true,
  }));
}

function consumeStream(gcode: string): void {
  let state = createStreamer(gcode);
  while (state.status !== 'done') {
    state = step(state).state;
    if (state.inFlight.length === 0) break;
    state = onAck(state, 'ok').state;
  }
}

function streamFixture(lineCount: number): string {
  return Array.from({ length: lineCount }, (_unused, index) => `G1 X${index % 400} S100`).join(
    '\n',
  );
}

function measured(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

function measuredValue<T>(run: () => T): { readonly value: T; readonly elapsed: number } {
  const started = performance.now();
  const value = run();
  return { value, elapsed: performance.now() - started };
}

async function measuredAsync(run: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  await run();
  return performance.now() - started;
}
