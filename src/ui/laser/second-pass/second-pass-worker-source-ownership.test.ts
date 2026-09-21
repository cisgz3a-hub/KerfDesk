import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildLaserSecondPassProgram,
  type LaserSecondPassSelection,
} from '../../../core/laser-second-pass';
import { createProject } from '../../../core/scene';
import type { ExecutionArtifactV1 } from '../../state/recovery';

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('../../state/recovery/execution-artifact-integrity', () => ({
  executionArtifactIntegrityIsValid: verify,
}));
vi.mock('../recovery-artifact-binding', () => ({
  recoveryArtifactPreparedProgramMatches: () => true,
}));

type Request = { id: number; source?: ExecutionArtifactV1; selection?: LaserSecondPassSelection };
type Response = { id: number; error?: string; value?: { prepared?: { gcode: string } } };
const selection: LaserSecondPassSelection = {
  version: 1,
  maxPowerS: 1000,
  strokes: [{ id: 'area', mode: 'paint', radiusMm: 100, powerScale: 1, points: [{ x: 5, y: 5 }] }],
};
const PROGRAM_A = 'G21\nG90\nM5\nG0 X0 Y0\nM4 S100\nG1 X10 Y0 F600\nM5\n';
const PROGRAM_B = 'G21\nG90\nM5\nG0 X0 Y10\nM4 S200\nG1 X10 Y10 F600\nM5\n';
let worker: {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  postMessage: ReturnType<typeof vi.fn<(response: Response) => void>>;
};
let replies: Map<number, (response: Response) => void>;
let validations: Map<string, (valid: boolean) => void>;

beforeEach(async () => {
  vi.resetModules();
  replies = new Map();
  validations = new Map();
  verify.mockImplementation(
    (source: ExecutionArtifactV1) =>
      new Promise<boolean>((resolve) => {
        validations.set(source.runId, resolve);
      }),
  );
  worker = {
    onmessage: null,
    postMessage: vi.fn((response: Response) => replies.get(response.id)?.(response)),
  };
  vi.stubGlobal('self', worker);
  await import('./second-pass-worker');
});
afterEach(() => vi.unstubAllGlobals());

describe('second-pass worker source generations', () => {
  it('keeps B when A verification finishes after B was accepted', async () => {
    const openingA = send({ id: 1, source: source('A', PROGRAM_A) });
    const openingB = send({ id: 2, source: source('B', PROGRAM_B) });
    resolveValidation('B', true);
    expect((await openingB).error).toBeUndefined();
    resolveValidation('A', true);
    await openingA;

    const compiled = await send({ id: 3, selection });

    expect(compiled.error).toBeUndefined();
    expect(compiled.value?.prepared?.gcode).toBe(expectedProgram(PROGRAM_B));
    expect(compiled.value?.prepared?.gcode).not.toBe(expectedProgram(PROGRAM_A));
  });

  it('removes a prior source while replacement verification is pending and after it fails', async () => {
    const openingA = send({ id: 1, source: source('A', PROGRAM_A) });
    resolveValidation('A', true);
    await openingA;
    const openingB = send({ id: 2, source: source('B', PROGRAM_B) });
    const during = await send({ id: 3, selection });
    resolveValidation('B', false);
    expect((await openingB).error).toContain('could not be verified');
    const after = await send({ id: 4, selection });

    expect(during.error).toContain('Open a saved laser job');
    expect(after.error).toContain('Open a saved laser job');
    expect(after.value).toBeUndefined();
  });

  it('does not revive late A after its replacement B fails verification', async () => {
    const openingA = send({ id: 1, source: source('A', PROGRAM_A) });
    const openingB = send({ id: 2, source: source('B', PROGRAM_B) });
    resolveValidation('B', false);
    await openingB;
    resolveValidation('A', true);
    await openingA;

    const compiled = await send({ id: 3, selection });

    expect(compiled.error).toContain('Open a saved laser job');
    expect(compiled.value).toBeUndefined();
  });

  it('keeps the cache empty when replacement preview construction fails after validation', async () => {
    const openingA = send({ id: 1, source: source('A', PROGRAM_A) });
    resolveValidation('A', true);
    await openingA;
    const openingB = send({ id: 2, source: source('B', 'G21\nG90\nM5\n') });
    resolveValidation('B', true);
    expect((await openingB).error).toContain('no laser engraving');

    expect((await send({ id: 3, selection })).error).toContain('Open a saved laser job');
  });
});

function send(request: Request): Promise<Response> {
  return new Promise((resolve) => {
    replies.set(request.id, resolve);
    if (worker.onmessage === null) throw new Error('Worker handler was not installed.');
    worker.onmessage({ data: request } as MessageEvent<Request>);
  });
}

function resolveValidation(runId: string, valid: boolean): void {
  const finish = validations.get(runId);
  if (finish === undefined) throw new Error(`No pending verification for ${runId}.`);
  finish(valid);
}

function expectedProgram(gcode: string): string {
  const result = buildLaserSecondPassProgram(gcode, selection);
  if (result.kind === 'error') throw new Error(result.message);
  return result.gcode;
}

function source(runId: string, gcode: string): ExecutionArtifactV1 {
  // Archive checks are stubbed to control verification ordering. This partial
  // fixture supplies the real preview/compiler/geometry/timing inputs only.
  return {
    runId,
    gcode,
    machineKind: 'laser',
    prepared: { project: createProject(), job: { groups: [] } },
    archivedControllerObservation: { statusReport: null, settings: null, wco: null },
  } as unknown as ExecutionArtifactV1;
}
