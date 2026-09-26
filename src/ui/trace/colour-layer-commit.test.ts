// Committing a Colour layers trace (ADR-430): every colour becomes its own
// operation, and each laser operation starts at a power set by its colour's
// darkness.
import { describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  operationIdsForObject,
  type Layer,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene/machine';
import { applyFreshImport, applyTraceToExisting } from '../state/scene-mutations';
import type { TraceExistingImageOptions } from '../state/scene-mutations';
import { commitTraceOutput } from './trace-output-commit';

const SOURCE_ID = 'src';
const TRACE_ID = 'trace';
// Lightest first, as the colour-layer backend emits them.
const COLOURS = ['#e0e0e0', '#808080', '#000000'];

function source(): RasterImage {
  return {
    kind: 'raster-image',
    id: SOURCE_ID,
    source: 'badge.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 100,
    pixelHeight: 100,
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function traced(): TracedImage {
  const square = (x: number) => ({
    closed: true,
    points: [
      { x, y: 10 },
      { x: x + 10, y: 10 },
      { x: x + 10, y: 20 },
      { x, y: 20 },
      { x, y: 10 },
    ],
  });
  return {
    kind: 'traced-image',
    id: TRACE_ID,
    source: 'badge.png',
    traceMode: 'filled-contours',
    bounds: { minX: 10, minY: 10, maxX: 50, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: COLOURS.map((color, i) => ({ color, polylines: [square(10 + i * 10)] })),
  };
}

function project(machine?: Project['machine']): Project {
  const base = createProject();
  const withMachine = machine === undefined ? base : { ...base, machine };
  return applyFreshImport({ project: withMachine, undoStack: [] }, source(), 0).project;
}

function traceOperations(result: { readonly project: Project }): Layer[] {
  const object = result.project.scene.objects.find((candidate) => candidate.id === TRACE_ID);
  if (object === undefined) throw new Error('trace missing');
  const ids = operationIdsForObject(object, result.project.scene.layers);
  return ids.map((id) => result.project.scene.layers.find((layer) => layer.id === id) as Layer);
}

function powerByColour(result: { readonly project: Project }): Map<string, number> {
  const object = result.project.scene.objects.find((candidate) => candidate.id === TRACE_ID);
  const operations = traceOperations(result);
  const out = new Map<string, number>();
  if (object === undefined || !('paths' in object)) return out;
  for (const path of object.paths) {
    const operation = operations.find((candidate) => candidate.id === path.operationIds?.[0]);
    if (operation !== undefined) out.set(path.color, operation.power);
  }
  return out;
}

describe('colour-layer commit', () => {
  it('gives every colour its own operation, powered by darkness', () => {
    const state = { project: project(), undoStack: [] };
    const plain = applyTraceToExisting(state, SOURCE_ID, traced());
    const layered = applyTraceToExisting(state, SOURCE_ID, traced(), {
      colourLayers: { output: 'cut-out' },
    });
    expect(traceOperations(layered)).toHaveLength(3);
    expect(traceOperations(layered).every((operation) => operation.output)).toBe(true);
    const base = traceOperations(plain)[0]?.power as number;
    const powers = powerByColour(layered);
    expect(powers.get('#000000')).toBe(base);
    const mid = powers.get('#808080') as number;
    const pale = powers.get('#e0e0e0') as number;
    expect(mid).toBeLessThan(base);
    expect(pale).toBeLessThan(mid);
    expect(pale).toBeCloseTo(base / 4, 1);
    // Without the colour-layer option every operation keeps the default power.
    expect([...powerByColour(plain).values()]).toEqual([base, base, base]);
  });

  it('keeps CNC operations as created', () => {
    const state = { project: project(DEFAULT_CNC_MACHINE_CONFIG), undoStack: [] };
    const plain = applyTraceToExisting(state, SOURCE_ID, traced());
    const layered = applyTraceToExisting(state, SOURCE_ID, traced(), {
      colourLayers: { output: 'cut-out' },
    });
    expect([...powerByColour(layered).values()]).toEqual([...powerByColour(plain).values()]);
  });

  it('creates the traced paper with output off', () => {
    const state = { project: project(), undoStack: [] };
    const layered = applyTraceToExisting(state, SOURCE_ID, traced(), {
      colourLayers: { output: 'cut-out', paperTraced: true },
    });
    const outputs = new Map(
      traceOperations(layered).map((operation) => [operation.id, operation.output]),
    );
    const object = layered.project.scene.objects.find((candidate) => candidate.id === TRACE_ID);
    const byColour = new Map(
      (object !== undefined && 'paths' in object ? object.paths : []).map((path) => [
        path.color,
        outputs.get(path.operationIds?.[0] ?? ''),
      ]),
    );
    // #e0e0e0 is the lightest traced colour and paper-light: it is the paper.
    expect(byColour.get('#e0e0e0')).toBe(false);
    expect(byColour.get('#808080')).toBe(true);
    expect(byColour.get('#000000')).toBe(true);
  });

  it('hands the chosen output to the store and names the layers in the toast', async () => {
    const calls: Array<TraceExistingImageOptions | undefined> = [];
    const toasts: string[] = [];
    const live = project();
    const claim = { project: live, source: source() };
    const ok = await commitTraceOutput(
      {
        seed: { id: SOURCE_ID, source: 'badge.png' },
        options: { colourLayers: { output: 'stacked' } },
      },
      {
        traceExistingImage: (_id, _traced, options) => calls.push(options),
        commitRasterizedTrace: () => undefined,
        pushToast: (message) => toasts.push(message),
        claimOwner: () => claim,
      },
      traced(),
      live,
    );
    expect(ok).toBe(true);
    expect(calls[0]?.colourLayers).toEqual({ output: 'stacked', paperTraced: false });
    expect(toasts[0]).toContain('3 colour layers, power set by darkness');
  });

  it('does not claim darkness powers on a CNC', async () => {
    const toasts: string[] = [];
    const live = project(DEFAULT_CNC_MACHINE_CONFIG);
    const ok = await commitTraceOutput(
      {
        seed: { id: SOURCE_ID, source: 'badge.png' },
        options: { colourLayers: { keepBackground: true } },
      },
      {
        traceExistingImage: () => undefined,
        commitRasterizedTrace: () => undefined,
        pushToast: (message) => toasts.push(message),
        claimOwner: () => ({ project: live, source: source() }),
      },
      traced(),
      live,
    );
    expect(ok).toBe(true);
    expect(toasts[0]).toContain('3 colour layers');
    expect(toasts[0]).not.toContain('power');
  });
});
