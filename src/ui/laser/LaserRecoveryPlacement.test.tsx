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
import { oracleBurns } from '../../core/controllers/grbl/laser-burn-oracle.test-helper';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { buildCanvasMotionPlan } from '../state/canvas-motion-plan';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import { createExecutionArtifact, type RecoveryCapsule } from '../state/recovery';
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
function capsule(wco: WorkCoordinateOffset | null, reportInches = false): RecoveryCapsule {
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
