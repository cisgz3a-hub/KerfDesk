import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { DEFAULT_OUTPUT_SCOPE, createProject } from '../../core/scene';
import type { WorkSteps, WorkStepsRunner } from '../../core/recovery';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { initialLaserState } from '../state/laser-store-helpers';
import type { LaserState } from '../state/laser-store';
import type { LaserModeStartEvidence } from '../state/laser-mode-start-evidence';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import {
  stageFreshExecutionArtifact,
  untrackedLaserRunRecord,
} from './start-job-execution-tracking';

// ADR-337 Amendment 1: the accepted run's archive is built in slices. These
// tests hold it to the archive a single call stores, byte for byte, and count
// the work any one task can do while the job runs.

const sync = vi.hoisted(() => ({ watching: false, checkpointsCrossed: 0, drains: 0 }));

// Count how far each synchronous drain runs. A whole-program pass that is not
// handed to the archive's runner drains past at least one checkpoint here.
vi.mock('../../core/recovery/work-steps', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    runWorkSteps: <T>(steps: WorkSteps<T>): T => {
      let crossed = 0;
      for (;;) {
        const step = steps.next();
        if (step.done) {
          if (sync.watching) {
            sync.drains += 1;
            sync.checkpointsCrossed = Math.max(sync.checkpointsCrossed, crossed);
          }
          return step.value;
        }
        crossed += 1;
      }
    },
  };
});

vi.mock('../app/build-info', () => ({
  buildGcodeMetadata: () => ({
    appName: 'KerfDesk',
    appVersion: '0.0.0-test',
    gitSha: 'test',
    buildTimeUtc: '2026-11-04T00:00:00.000Z',
    emitterRevision: 'test',
  }),
}));

const RUN_ID = 'run-archive-slices';
const NOW = new Date('2026-11-04T09:00:00.000Z');
/** sha256 of the archive `stageFreshExecutionArtifact` stored for this fixture
 * on main ede14589b, before the archive was sliced. */
const GOLDEN_ARCHIVE_DIGEST = '58b026e93a5bac50f8c1b626599cf5981ea05d9ee11964d7e76d73f5213ff4a4';

function program(moves: number): string {
  const lines = ['G21', 'G90', '; café', 'M4 S0'];
  for (let i = 0; i < moves; i += 1) {
    lines.push(
      i % 7 === 0
        ? `G0 X${i % 250} Y${(i * 3) % 170}`
        : `N${i} G1 X${(i * 1.25) % 250} Y${(i * 0.5) % 170} S${i % 900}`,
    );
    if (i % 31 === 0) lines.push('');
    if (i % 501 === 0) lines.push(`G2 X${i % 250} Y${(i * 3) % 170} I1.5 J0`);
  }
  lines.push('M5', 'G0 X0 Y0', '');
  return lines.join('\n');
}

function laserState(): LaserState {
  return {
    ...initialLaserState(),
    capabilities: { transport: 'serial' },
    serialPortInfo: { usbVendorId: 0x1a86, usbProductId: 0x7523 },
    controllerSessionEpoch: 7,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    grblSettingsRows: [{ code: '$32', rawValue: '1' }],
  } as unknown as LaserState;
}

async function fixture() {
  const project = createProject(DEFAULT_DEVICE_PROFILE);
  const gcode = program(60_000);
  const canvasPlan = {
    retentionKey: 'signature-archive-slices',
    manifest: buildMotionManifest(gcode, { machineKind: 'laser' }),
  } as CanvasMotionPlan;
  const backend = new MemoryRecoveryStorageBackend();
  const repository = new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
  const laser = laserState();
  const args: Parameters<typeof stageFreshExecutionArtifact>[0] = {
    runId: RUN_ID,
    prepared: {
      ok: true,
      gcode,
      canvasPlan,
      prepared: { ok: true, project, job: { groups: [] }, jobOriginOffset: { x: 0, y: 0 } },
    } as unknown as Parameters<typeof stageFreshExecutionArtifact>[0]['prepared'],
    outputScope: DEFAULT_OUTPUT_SCOPE,
    laser,
    repository,
    reviewedAtIso: NOW.toISOString(),
    reviewModel: {
      warnings: [],
      acknowledgement: { kind: 'laser-verified' },
    } as unknown as Parameters<typeof stageFreshExecutionArtifact>[0]['reviewModel'],
    laserModeStartEvidence: {
      controllerSessionEpoch: 7,
      settingsCapability: 'grbl-dollar',
      settingsObservation: { sessionEpoch: 7, observedAt: 1 },
      laserModeEnabled: true,
      maxPowerS: project.device.maxPowerS,
      controllerBuildInfo: null,
      buildInfoObservation: null,
      expectedMaxPowerS: project.device.maxPowerS,
      m7Required: false,
      unverifiedAcknowledged: false,
    } as unknown as LaserModeStartEvidence,
  };
  return { args, backend, gcode, laser };
}

type Hash = ReturnType<typeof createHash>;

/** Primitives by type and exact bits; false for an object. */
function hashedPrimitive(hash: Hash, item: unknown): boolean {
  if (item === null || item === undefined) hash.update(item === null ? 'N' : 'U');
  else if (typeof item === 'boolean') hash.update(item ? 'T' : 'F');
  else if (typeof item === 'number') {
    const bits = Buffer.alloc(8);
    bits.writeDoubleLE(item);
    hash.update('D').update(bits);
  } else if (typeof item === 'string') {
    hash.update(`S${item.length}:`).update(Buffer.from(item, 'utf16le'));
  } else if (typeof item === 'object') return false;
  else throw new Error(`Unexpected ${typeof item} in an archive.`);
  return true;
}

/** Structured-clone-relevant bytes: key order, every double's bits, every
 * string's code units and every view's backing bytes. */
function canonicalDigest(value: unknown): string {
  const hash = createHash('sha256');
  const seen = new Map<object, number>();
  const visit = (value: unknown): void => {
    if (hashedPrimitive(hash, value)) return;
    const item = value as object;
    const known = seen.get(item);
    if (known !== undefined) return void hash.update(`R${known}`);
    seen.set(item, seen.size);
    if (ArrayBuffer.isView(item)) {
      hash.update(`V${Object.prototype.toString.call(item)}${item.byteLength}:`);
      return void hash.update(new Uint8Array(item.buffer, item.byteOffset, item.byteLength));
    }
    if (Array.isArray(item)) {
      hash.update(`A${item.length}`);
      for (const entry of item) visit(entry);
      return;
    }
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    hash.update(`O${keys.length}`);
    for (const key of keys) {
      hash.update(`K${key}`);
      visit(record[key]);
    }
  };
  visit(value);
  return hash.digest('hex');
}

async function storedArchiveDigest(backend: MemoryRecoveryStorageBackend): Promise<string> {
  const record = (await backend.getArtifact(RUN_ID)) as { readonly artifact: unknown } | undefined;
  expect(record).toBeDefined();
  return canonicalDigest(record?.artifact);
}

/** Yields to a later task after every step, and counts them. */
function everyStepRunner(): { readonly run: WorkStepsRunner; readonly steps: () => number } {
  let steps = 0;
  const run = async <T>(work: WorkSteps<T>): Promise<T> => {
    for (;;) {
      const step = work.next();
      if (step.done) return step.value;
      steps += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  return { run, steps: () => steps };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  sync.watching = false;
  sync.checkpointsCrossed = 0;
  sync.drains = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the accepted run archive in slices', () => {
  it('stores the archive main stored, whether drained in one call or a step per task', async () => {
    const whole = await fixture();
    const staged = await stageFreshExecutionArtifact(whole.args);
    expect(staged.staged).toBe(true);
    const wholeDigest = await storedArchiveDigest(whole.backend);
    expect(wholeDigest).toBe(GOLDEN_ARCHIVE_DIGEST);

    const sliced = await fixture();
    const runner = everyStepRunner();
    const stagedInSlices = await stageFreshExecutionArtifact({ ...sliced.args, run: runner.run });
    expect(stagedInSlices.staged).toBe(true);
    expect(await storedArchiveDigest(sliced.backend)).toBe(wholeDigest);
    expect(stagedInSlices.keep?.()).toEqual(staged.keep?.());
  });

  it('never runs a whole-program pass inside one task while the job runs', async () => {
    const { args, gcode, laser } = await fixture();
    const runner = everyStepRunner();
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    sync.watching = true;
    const staged = await stageFreshExecutionArtifact({ ...args, run: runner.run });
    const untracked = await untrackedLaserRunRecord(
      {
        runId: RUN_ID,
        gcode,
        machineKind: 'laser',
        outputScope: DEFAULT_OUTPUT_SCOPE,
        jobOrigin: undefined,
        laser,
      },
      runner.run,
    );
    sync.watching = false;
    expect(staged.staged).toBe(true);
    expect(untracked?.intent.sendableLines).toBeGreaterThan(60_000);
    // Every synchronous drain finished inside one checkpoint's worth of work.
    expect(sync.checkpointsCrossed).toBe(0);
    // Nothing encoded more than one slice of the program at once.
    const longest = Math.max(...encode.mock.calls.map(([text]) => text?.length ?? 0));
    expect(longest).toBeLessThanOrEqual(1 << 18);
    expect(longest).toBeLessThan(gcode.length);
    // The program is several chunks long, and each of its passes (fingerprint
    // and count when built and validated, both encodings, the intent) went
    // through the runner.
    expect(gcode.length).toBeGreaterThan(16 * (1 << 16));
    expect(runner.steps()).toBeGreaterThan(6 * Math.floor(gcode.length / (1 << 16)));
  });
});
