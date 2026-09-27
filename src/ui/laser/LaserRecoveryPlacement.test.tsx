import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import type { JobOriginPlacement } from '../../core/job';
import { oracleBurns } from '../../core/controllers/grbl/laser-burn-oracle.test-helper';
import { resumeEntryPointMm } from '../../core/controllers/grbl/resume-program';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { buildCanvasMotionPlan } from '../state/canvas-motion-plan';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import {
  createExecutionArtifact,
  type ExecutionArtifactV1,
  type RecoveryCapsule,
} from '../state/recovery';
import { buildLaserRecoveryPreviewRoute } from './laser-recovery-preview-route';
import { remainingRecoveryWorkBounds } from './laser-recovery-picker-model';
import { LaserRecoveryPlacement } from './LaserRecoveryPlacement';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let unmount: (() => void) | null = null;

afterEach(() => {
  act(() => unmount?.());
  host?.remove();
  host = null;
  unmount = null;
});

/** Two strokes on separate lines of the program: (1,1)-(9,9) then (20,5)-(30,5). */
function capsule(
  wco: WorkCoordinateOffset | null,
  reportInches = false,
  jobOrigin?: JobOriginPlacement,
): RecoveryCapsule {
  const stroke = (id: string, from: { x: number; y: number }, to: { x: number; y: number }) =>
    ({
      kind: 'imported-svg',
      id,
      source: `${id}.svg`,
      bounds: {
        minX: Math.min(from.x, to.x),
        minY: Math.min(from.y, to.y),
        maxX: Math.max(from.x, to.x),
        maxY: Math.max(from.y, to.y),
      },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#ff0000', polylines: [{ closed: false, points: [from, to] }] }],
    }) satisfies SceneObject;
  const project = {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [
        stroke('a', { x: 1, y: 1 }, { x: 9, y: 9 }),
        stroke('b', { x: 20, y: 5 }, { x: 30, y: 5 }),
      ],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected a valid prepared laser fixture.');
  const emitted = emitPreparedGcode(prepared);
  const artifact = createExecutionArtifact({
    artifactSchemaVersion: 1,
    runId: 'run-placement',
    createdAtIso: '2026-09-23T09:00:00.000Z',
    gcode: emitted.gcode,
    prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    ...(jobOrigin === undefined ? {} : { jobOrigin }),
    canvasPlan: buildCanvasMotionPlan({
      gcode: emitted.gcode,
      prepared,
      machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
      retentionKey: 'placement-signature',
    }),
    controllerSettings: reportInches ? ({ reportInches: true } as never) : null,
    controllerObservation: { wco },
  });
  return {
    runId: artifact.runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: 1,
    sendableLines: artifact.sendableLines,
    interruption: { kind: 'disconnect', message: 'USB cable disconnected' },
    updatedAtIso: '2026-09-23T09:10:00.000Z',
    artifact,
  };
}

function render(props: Parameters<typeof LaserRecoveryPlacement>[0]): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<LaserRecoveryPlacement {...props} />));
  unmount = () => root.unmount();
}

function button(label: string): HTMLButtonElement {
  const candidate = [...(host?.querySelectorAll('button') ?? [])].find(
    (element) => element.textContent === label,
  );
  if (!(candidate instanceof HTMLButtonElement)) throw new Error(`Expected button: ${label}`);
  return candidate;
}

describe('recovery placement and work origin', () => {
  it('says the origin matches when it is within 0.05 mm of the one the job ran with', () => {
    render({
      capsule: capsule({ x: 20, y: 20, z: 0 }),
      liveWorkOffsetMm: { x: 20.04, y: 19.97, z: 0 },
      restartLine: 1,
      disabled: false,
    });
    expect(host?.textContent).toContain('Origin thenX 20 · Y 20 mm from machine zero');
    expect(host?.textContent).toContain('Origin nowX 20.04 · Y 19.97 mm from machine zero');
    expect(host?.textContent).toContain('matches the one this job ran with');
  });

  it('warns, without blocking anything, when the origin moved', () => {
    render({
      capsule: capsule({ x: 20, y: 20, z: 0 }),
      liveWorkOffsetMm: { x: 35, y: 35, z: 0 },
      restartLine: 1,
      disabled: false,
    });
    expect(host?.querySelector('[role="note"]')?.textContent).toContain(
      'The work origin has moved X 15 mm, Y 15 mm since this job ran.',
    );
    expect(host?.querySelector('button')).toBeNull();
  });

  it('offers Restore saved origin when the origin moved, and hands it the saved offset', async () => {
    const onRestoreOrigin = vi.fn(async () => undefined);
    render({
      capsule: capsule({ x: 20, y: 30, z: 0 }),
      liveWorkOffsetMm: { x: 0, y: 0, z: 0 },
      restartLine: 1,
      disabled: false,
      onRestoreOrigin,
    });
    expect(host?.textContent).toContain(
      'Restore saved origin puts work zero back at X 20, Y 30 mm from machine zero',
    );
    expect(host?.textContent).toContain('home it first');
    const restore = [...(host?.querySelectorAll('button') ?? [])].find(
      (element) => element.textContent === 'Restore saved origin',
    );
    if (restore === undefined) throw new Error('Expected the Restore saved origin button.');
    await act(async () => restore.click());
    expect(onRestoreOrigin).toHaveBeenCalledWith({ x: 20, y: 30, z: 0 });
  });

  it('homes from beside the restore, and holds the restore while homing', async () => {
    let finishHome: () => void = () => undefined;
    const onHome = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishHome = resolve;
        }),
    );
    const onRestoreOrigin = vi.fn(async () => undefined);
    render({
      capsule: capsule({ x: 20, y: 30, z: 0 }),
      liveWorkOffsetMm: { x: 0, y: 0, z: 0 },
      restartLine: 1,
      disabled: false,
      onRestoreOrigin,
      onHome,
    });
    expect(host?.textContent).toContain('home it first with Home machine');
    await act(async () => button('Home machine').click());
    expect(onHome).toHaveBeenCalledTimes(1);
    expect(button('Homing…').disabled).toBe(true);
    expect(button('Restore saved origin').disabled).toBe(true);
    await act(async () => finishHome());
    expect(button('Restore saved origin').disabled).toBe(false);
    await act(async () => button('Restore saved origin').click());
    expect(onRestoreOrigin).toHaveBeenCalledWith({ x: 20, y: 30, z: 0 });
  });

  it('says homing rules out continuing from where the head stopped', () => {
    render({
      capsule: capsule({ x: 20, y: 30, z: 0 }),
      liveWorkOffsetMm: { x: 0, y: 0, z: 0 },
      restartLine: 1,
      disabled: false,
      onRestoreOrigin: async () => undefined,
      onHome: async () => undefined,
      headStop: {
        stop: {
          line: 5,
          sentLines: 4,
          pointMm: { x: 9, y: 9 },
          unconfirmedLines: 0,
          unconfirmedTravelMm: null,
        },
        sendableLines: 10,
        anchored: false,
        onContinue: async () => undefined,
      },
    });
    expect(host?.textContent).toContain(
      'Homing moves the head off the spot where the job stopped, so after it only the restore can place the job.',
    );
    expect(button('Continue from where the head stopped').disabled).toBe(false);
  });

  it('moves to the job origin and the restart point once the origin is in place', async () => {
    const saved = capsule({ x: 20, y: 30, z: 0 });
    const artifact = saved.artifact as ExecutionArtifactV1;
    const lines = artifact.gcode.split('\n');
    const restartLine = lines.findIndex((line, index) => index > 2 && /X/.test(line)) + 2;
    const entry = resumeEntryPointMm(artifact.gcode, restartLine);
    if (entry === null) throw new Error('Expected a followable restart line.');
    const onMoveToWorkPoint = vi.fn(async () => undefined);
    render({
      capsule: saved,
      liveWorkOffsetMm: { x: 20, y: 30, z: 0 },
      liveOriginSet: true,
      restartLine,
      disabled: false,
      onMoveToWorkPoint,
    });
    await act(async () => button('Go to job origin').click());
    expect(onMoveToWorkPoint).toHaveBeenLastCalledWith({ x: 0, y: 0 });
    await act(async () => button('Go to restart point').click());
    expect(onMoveToWorkPoint).toHaveBeenLastCalledWith(entry);
  });

  it('offers no moves while the origin is not the one the job ran with', () => {
    render({
      capsule: capsule({ x: 20, y: 30, z: 0 }),
      liveWorkOffsetMm: { x: 35, y: 35, z: 0 },
      restartLine: 1,
      disabled: false,
      onMoveToWorkPoint: async () => undefined,
    });
    expect(host?.textContent).not.toContain('Go to job origin');
    expect(host?.textContent).not.toContain('Go to restart point');
  });

  it('offers no Home without homing set up', () => {
    render({
      capsule: capsule({ x: 20, y: 30, z: 0 }),
      liveWorkOffsetMm: { x: 0, y: 0, z: 0 },
      restartLine: 1,
      disabled: false,
      onRestoreOrigin: async () => undefined,
    });
    expect(host?.textContent).not.toContain('Home machine');
  });

  it('shows why the restore failed', async () => {
    render({
      capsule: capsule({ x: 20, y: 30, z: 0 }),
      liveWorkOffsetMm: null,
      restartLine: 1,
      disabled: false,
      onRestoreOrigin: async () => {
        throw new Error('Machine must be Idle before changing origin (currently Alarm).');
      },
    });
    const restore = [...(host?.querySelectorAll('button') ?? [])].find(
      (element) => element.textContent === 'Restore saved origin',
    );
    await act(async () => restore?.click());
    expect(host?.querySelector('[role="alert"]')?.textContent).toBe(
      'Machine must be Idle before changing origin (currently Alarm).',
    );
  });

  it('says a User Origin that a reset cleared is gone, even when it sat at machine zero', () => {
    const onRestoreOrigin = vi.fn(async () => undefined);
    render({
      capsule: capsule({ x: 0, y: 0, z: 0 }, false, {
        startFrom: 'user-origin',
        anchor: 'front-left',
      }),
      liveWorkOffsetMm: { x: 0, y: 0, z: 0 },
      liveOriginSet: false,
      restartLine: 1,
      disabled: false,
      onRestoreOrigin,
    });
    expect(host?.textContent).not.toContain('matches the one this job ran with');
    expect(host?.querySelector('[role="note"]')?.textContent).toContain(
      'The controller has no work origin set now',
    );
    expect(host?.textContent).toContain('Restore saved origin');
  });

  it('offers no restore once the origin matches and is set', () => {
    render({
      capsule: capsule({ x: 20, y: 30, z: 0 }, false, {
        startFrom: 'user-origin',
        anchor: 'front-left',
      }),
      liveWorkOffsetMm: { x: 20, y: 30, z: 0 },
      liveOriginSet: true,
      restartLine: 1,
      disabled: false,
      onRestoreOrigin: async () => undefined,
    });
    expect(host?.textContent).toContain('matches the one this job ran with');
    expect(host?.textContent).not.toContain('Restore saved origin');
  });

  it('converts an origin the controller reported in inches', () => {
    render({
      capsule: capsule({ x: 1, y: 2, z: 0 }, true),
      liveWorkOffsetMm: { x: 25.4, y: 50.8, z: 0 },
      restartLine: 1,
      disabled: false,
    });
    expect(host?.textContent).toContain('Origin thenX 25.4 · Y 50.8 mm from machine zero');
    expect(host?.textContent).toContain('matches the one this job ran with');
  });

  it('asks for a controller report before it can compare', () => {
    render({ capsule: capsule(null), liveWorkOffsetMm: null, restartLine: 1, disabled: false });
    expect(host?.textContent).toContain('Not reported when the job started');
    expect(host?.textContent).toContain('Not reported yet.');
    expect(host?.querySelector('[role="note"]')).toBeNull();
  });

  it('frames exactly what remains from the chosen line, in the program coordinates', async () => {
    const saved = capsule({ x: 0, y: 0, z: 0 });
    if (saved.artifact.kind !== 'exact-execution') throw new Error('Expected exact artifact.');
    const route = buildLaserRecoveryPreviewRoute(saved.artifact);
    // Expected extents come from an independent interpreter of the sealed program.
    const burns = oracleBurns(saved.artifact.gcode);
    const extent = (from: number) => {
      const points = burns.filter((burn) => burn.line >= from).flatMap((b) => [b.from, b.to]);
      return {
        minX: Math.min(...points.map((point) => point.x)),
        minY: Math.min(...points.map((point) => point.y)),
        maxX: Math.max(...points.map((point) => point.x)),
        maxY: Math.max(...points.map((point) => point.y)),
      };
    };
    const secondStroke = burns.find((burn) => Math.min(burn.from.x, burn.to.x) >= 19)?.line;
    if (secondStroke === undefined) throw new Error('Expected the second stroke to burn.');
    const all = remainingRecoveryWorkBounds(route, 1);
    expect(all).toEqual(extent(1));
    expect(remainingRecoveryWorkBounds(route, secondStroke)).toEqual(extent(secondStroke));
    expect(extent(secondStroke).minX).toBeGreaterThan(extent(1).minX);
    const lastLine = saved.artifact.gcode.split('\n').length;
    expect(remainingRecoveryWorkBounds(route, lastLine + 1)).toBeNull();

    const onFrameRemaining = vi.fn(async () => undefined);
    render({
      capsule: saved,
      liveWorkOffsetMm: null,
      restartLine: 1,
      disabled: false,
      onFrameRemaining,
    });
    const frame = [...(host?.querySelectorAll('button') ?? [])].find(
      (element) => element.textContent === 'Frame remaining area',
    );
    if (frame === undefined) throw new Error('Expected the Frame button.');
    await act(async () => frame.click());
    expect(onFrameRemaining).toHaveBeenCalledWith(all);
  });
});
