import { describe, expect, it } from 'vitest';
import { sliceToolpath, type Toolpath, type ToolpathStep } from '../../core/job';
import type { Vec2 } from '../../core/scene';
import { displayPolylinePointIndices, displayStepIndices } from './preview-display-decimation';
import {
  preparePreviewFrame,
  type PreparedPreviewFrame,
  type PreviewDisplayStep,
  type PreviewFrameOptions,
} from './preview-route-frame';

const steps: ReadonlyArray<ToolpathStep> = [
  { kind: 'travel', from: { x: -0, y: 0 }, to: { x: 4, y: 0 }, length: 4 },
  {
    kind: 'cut',
    color: '#abcdef',
    length: 4,
    polyline: [
      { x: 4, y: 0 },
      { x: 8, y: 0 },
    ],
  },
  { kind: 'travel', from: { x: 8, y: 0 }, to: { x: 8, y: 3 }, length: 3, motion: 'feed' },
  { kind: 'plunge', at: { x: 8, y: 3 }, fromZ: 0, toZ: -2, length: 2 },
  {
    kind: 'cut',
    color: '#fedcba',
    length: 3,
    polyline: [
      { x: 8, y: 3 },
      { x: 11, y: 3 },
    ],
  },
];
const route: Toolpath = { steps, totalLength: 16 };

describe('prepared Preview display frames', () => {
  it('preserves ordered travel, partial cut, head and endpoint geometry', () => {
    const frame = preparePreviewFrame(route, 6 / 16);
    expect(frame.futureSteps.map((step) => step.kind)).toEqual(['travel', 'cut', 'travel', 'cut']);
    expect(frame.wholeSteps).toEqual([
      { kind: 'travel', from: { x: -0, y: 0 }, to: { x: 4, y: 0 } },
    ]);
    expect(frame.partial).toEqual({
      kind: 'cut',
      polyline: [
        { x: 4, y: 0 },
        { x: 6, y: 0 },
      ],
    });
    expect(frame.head).toEqual({ x: 6, y: 0 });
    expect(frame.start).toEqual({ x: -0, y: 0 });
    expect(frame.end).toEqual({ x: 11, y: 3 });
    expect(Object.is(frame.start?.x, -0)).toBe(true);
    expect(structuredClone(frame)).toEqual(frame);
  });

  it('matches the original slice across exact boundaries, zero steps and varied display options', () => {
    const zero: ToolpathStep = { kind: 'cut', color: '#000000', length: 0, polyline: [] };
    const repeated: ToolpathStep = {
      kind: 'cut',
      color: '#000000',
      length: 2,
      polyline: [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
    };
    const routes = [
      route,
      { steps: [zero, repeated, zero], totalLength: 2 },
      { steps: [], totalLength: 0 },
    ];
    const options: PreviewFrameOptions[] = [
      {},
      { showTravel: false },
      { showFuture: false },
      { showEndpoints: false },
      { showTravel: false, showFuture: false, showEndpoints: false },
    ];
    for (const candidate of routes) {
      for (const t of [-1, 0, 0.125, 0.25, 0.5, 11 / 16, 12 / 16, 13 / 16, 0.999, 1, 2]) {
        for (const option of options) {
          expect(preparePreviewFrame(candidate, t, option)).toEqual(
            referenceFrame(candidate, t, option),
          );
        }
      }
    }
  });

  it('does not allocate the full whole-step prefix when preparing a partial display', () => {
    const source = Array.from({ length: 100 }, () => steps[0]!);
    Object.defineProperty(source, 'slice', {
      value: () => {
        throw new Error('whole prefix allocated');
      },
    });
    const input = { steps: source, totalLength: 400 };
    expect(() => sliceToolpath(input, 200)).toThrow('whole prefix allocated');
    const frame = preparePreviewFrame(input, 0.5, { showFuture: false });
    expect(frame.wholeSteps).toHaveLength(50);
    expect(frame.head).toEqual({ x: 0, y: 0 });
  });

  it('selects the existing display indices before filtering travel and excludes source metadata', () => {
    const source = Array.from(
      { length: 240_003 },
      (_, index): ToolpathStep =>
        index % 2 === 0
          ? { kind: 'travel', from: { x: index, y: 0 }, to: { x: index + 1, y: 0 }, length: 1 }
          : {
              kind: 'cut',
              color: '#000000',
              length: 1,
              polyline: [
                { x: index, y: 0 },
                { x: index + 1, y: 0 },
              ],
              source: {
                kind: 'raster',
                source: 'not-display-data',
                rowIndex: index,
                passIndex: 0,
                spanIndex: 0,
                pixelStartX: 0,
                pixelEndX: 1,
              },
            },
    );
    const input = { steps: source, totalLength: source.length };
    const frame = preparePreviewFrame(input, 1, { showTravel: false, showEndpoints: false });
    const expected = [...displayStepIndices(source.length)].filter((index) => index % 2 === 1);
    expect(
      frame.wholeSteps.map((step) => (step.kind === 'cut' ? step.polyline[0]?.x : -1)),
    ).toEqual(expected);
    expect(frame.wholeSteps.length).toBeLessThan(120_000);
    expect(
      frame.wholeSteps.every(
        (step) => !('source' in step) && !('length' in step) && !('color' in step),
      ),
    ).toBe(true);
    expect(source[1]?.kind === 'cut' && source[1].source?.source).toBe('not-display-data');
  });
});

// Independent old-path oracle: use the full core slice, then select the exact
// prefix that drawPreview previously passed to drawWholeSteps.
function referenceFrame(
  input: Toolpath,
  t: number,
  options: PreviewFrameOptions,
): PreparedPreviewFrame {
  const empty: PreparedPreviewFrame = {
    futureSteps: [],
    wholeSteps: [],
    partial: null,
    head: null,
    start: null,
    end: null,
  };
  if (input.totalLength === 0) return empty;
  const sliced = sliceToolpath(input, t * input.totalLength);
  const select = (source: ReadonlyArray<ToolpathStep>) =>
    [...displayStepIndices(source.length)].flatMap((index) =>
      source[index] === undefined ? [] : selectedStep(source[index], options),
    );
  const last =
    [...input.steps]
      .reverse()
      .map(endPoint)
      .find((point) => point !== null) ?? null;
  const first = input.steps[0];
  return {
    futureSteps: options.showFuture !== false && t < 1 ? select(input.steps) : [],
    wholeSteps: select(sliced.whole),
    partial: sliced.partial === null ? null : (selectedStep(sliced.partial, options)[0] ?? null),
    head: t < 1 ? sliced.head : null,
    start: options.showEndpoints === false || first === undefined ? null : startPoint(first),
    end: options.showEndpoints !== false ? last : null,
  };
}

function selectedStep(
  step: ToolpathStep,
  options: PreviewFrameOptions,
): ReadonlyArray<PreviewDisplayStep> {
  if (step.kind === 'plunge' || (step.kind === 'travel' && options.showTravel === false)) return [];
  if (step.kind === 'travel')
    return [
      {
        kind: 'travel',
        from: step.from,
        to: step.to,
        ...(step.motion === undefined ? {} : { motion: step.motion }),
      },
    ];
  return [
    {
      kind: 'cut',
      polyline: [...displayPolylinePointIndices(step.polyline.length)].flatMap((index) =>
        step.polyline[index] === undefined ? [] : [step.polyline[index]],
      ),
    },
  ];
}

function endPoint(step: ToolpathStep): Vec2 | null {
  return step.kind === 'cut'
    ? (step.polyline.at(-1) ?? null)
    : step.kind === 'travel'
      ? step.to
      : step.at;
}

function startPoint(step: ToolpathStep): Vec2 | null {
  if (step.kind === 'travel') return step.from;
  if (step.kind === 'plunge') return step.at;
  return step.polyline[0] ?? null;
}
