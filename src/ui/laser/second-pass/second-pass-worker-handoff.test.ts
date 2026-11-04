import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLaserSecondPassProgram,
  type LaserSecondPassSelection,
} from '../../../core/laser-second-pass';
import { buildMotionManifest, type MotionManifest } from '../../../core/job/motion-manifest';
import { createProject } from '../../../core/scene';
import type { ExecutionArtifactV1 } from '../../state/recovery';
import { hasColumnPackedEncoding } from '../../state/recovery/packed-motion-manifest';
import {
  hydrateSecondPassFrameGeometry,
  hydrateSecondPassPreview,
  type TransferredSecondPassFrameGeometry,
  type TransferredSecondPassPreview,
} from './second-pass-worker-protocol';

vi.mock('../../state/recovery/execution-artifact-integrity', () => ({
  executionArtifactIntegrityIsValid: () => Promise.resolve(true),
}));
vi.mock('../recovery-artifact-binding', () => ({
  recoveryArtifactPreparedProgramMatches: () => true,
}));

type Request = {
  id: number;
  source?: ExecutionArtifactV1;
  selection?: LaserSecondPassSelection;
  gcode?: string;
  initialPosition?: { x: number; y: number; z: number };
};
type Response = { id: number; error?: string; value?: unknown };
const selection: LaserSecondPassSelection = {
  version: 1,
  maxPowerS: 1000,
  strokes: [{ id: 'area', mode: 'paint', radiusMm: 100, powerScale: 1, points: [{ x: 5, y: 5 }] }],
};
const SMALL_PROGRAM = 'G21\nG90\nM5\nG0 X0 Y0\nM4 S100\nG1 X10 Y0 F600\nM5\n';
let replies: Map<number, (response: Response) => void>;
let worker: {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: (response: Response, options?: StructuredSerializeOptions) => void;
};

beforeEach(async () => {
  vi.resetModules();
  replies = new Map();
  worker = {
    onmessage: null,
    // A worker reply crosses a structured clone, which keeps data but drops
    // every class: the motion columns must survive it as data.
    postMessage: (response: Response, options?: StructuredSerializeOptions) =>
      replies.get(response.id)?.(structuredClone(response, options)),
  };
  vi.stubGlobal('self', worker);
  await import('./second-pass-worker');
});
afterEach(() => vi.unstubAllGlobals());

describe('second-pass worker handoff', () => {
  it.each([
    ['a dense raster, packed and transferred', rasterProgram(2_600), true],
    ['a short program, as plain blocks', SMALL_PROGRAM, false],
  ])('delivers the exact compiled manifest for %s', async (_name, gcode, packed) => {
    await open(gcode);
    const reply = await send({ id: 2, selection });
    expect(reply.error).toBeUndefined();
    const transferred = reply.value as TransferredSecondPassPreview;
    expect(hasColumnPackedEncoding(transferred.prepared.canvasPlan.manifest)).toBe(packed);

    const { prepared } = hydrateSecondPassPreview(transferred);
    const expected = expectedProgram(gcode);
    expect(prepared.gcode).toBe(expected);
    const reference = buildMotionManifest(expected, { machineKind: 'laser' });
    expect(blocksOf(prepared.canvasPlan.manifest)).toEqual(blocksOf(reference));
    if (packed) expect(reference.blocks.length).toBeGreaterThan(4_096);
  });

  it('delivers the exact Frame geometry manifest from a start position', async () => {
    const gcode = rasterProgram(2_600);
    await open(gcode);
    const compiled = await send({ id: 2, selection });
    const program = (compiled.value as TransferredSecondPassPreview).prepared.gcode;
    const initialPosition = { x: 3, y: 4, z: 0 };

    const reply = await send({ id: 3, gcode: program, initialPosition });
    expect(reply.error).toBeUndefined();
    const geometry = hydrateSecondPassFrameGeometry(
      reply.value as TransferredSecondPassFrameGeometry,
    );

    const reference = buildMotionManifest(program, { machineKind: 'laser', initialPosition });
    expect(blocksOf(geometry.manifest)).toEqual(blocksOf(reference));
    expect(geometry.manifest.totalRouteMm).toBe(reference.totalRouteMm);
    expect(geometry.manifest.finalPoint).toEqual(reference.finalPoint);
  });
});

/** Serpentine raster rows, two motion lines a row, all inside the painted area. */
function rasterProgram(rows: number): string {
  const lines = ['G21', 'G90', 'M5', 'G0 X0 Y0', 'M4 S100', 'G1 F600'];
  for (let row = 0; row < rows; row += 1) {
    const y = (row * 0.0035).toFixed(4);
    lines.push(`G1 X${row % 2 === 0 ? 10 : 0} Y${y}`, `G1 Y${((row + 0.5) * 0.0035).toFixed(4)}`);
  }
  lines.push('M5', '');
  return lines.join('\n');
}

async function open(gcode: string): Promise<void> {
  const reply = await send({ id: 1, source: source(gcode) });
  if (reply.error !== undefined) throw new Error(reply.error);
}

function send(request: Request): Promise<Response> {
  return new Promise((resolve) => {
    replies.set(request.id, resolve);
    if (worker.onmessage === null) throw new Error('Worker handler was not installed.');
    worker.onmessage({ data: request } as MessageEvent<Request>);
  });
}

function blocksOf(manifest: MotionManifest | undefined): unknown[] {
  if (manifest === undefined) throw new Error('The plan has no manifest.');
  return Array.from(manifest.blocks, (block) => ({ ...block, points: [...block.points] }));
}

function expectedProgram(gcode: string): string {
  const result = buildLaserSecondPassProgram(gcode, selection);
  if (result.kind === 'error') throw new Error(result.message);
  return result.gcode;
}

function source(gcode: string): ExecutionArtifactV1 {
  // Archive checks are mocked; this partial fixture supplies the real
  // preview, compiler, geometry and timing inputs only.
  return {
    runId: 'handoff',
    gcode,
    machineKind: 'laser',
    prepared: { project: createProject(), job: { groups: [] } },
    archivedControllerObservation: { statusReport: null, settings: null, wco: null },
  } as unknown as ExecutionArtifactV1;
}
