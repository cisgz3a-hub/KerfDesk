// Continue from where the head stopped in the laser recovery review (ADR-341
// Amendment 6): offered after a lost link that recorded the lines sent; it sets
// the origin from the head's stop point through the host and picks the next
// line as the restart.

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
import type { JobInterruption } from '../../core/recovery';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { buildCanvasMotionPlan } from '../state/canvas-motion-plan';
import type { WorkCoordinateOffset } from '../state/origin-actions';
import { createExecutionArtifact, type RecoveryCapsule } from '../state/recovery';
import { recoveryHeadStop } from './laser-recovery-head-stop';
import { LaserRecoveryReviewDialog } from './LaserRecoveryReviewDialog';

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

const LIVE: WorkCoordinateOffset = { x: 3, y: 4, z: 0 };

describe('LaserRecoveryReviewDialog continue from where the head stopped', () => {
  it('stops claiming anchoring when a reset clears an origin with the same offset', async () => {
    const capsule = strokesCapsule({ kind: 'disconnect', message: 'USB lost', sentLines: 8 });
    const renderOriginState = renderDialog(
      capsule,
      vi.fn(async () => true),
      vi.fn(async () => ({ x: 0, y: 0 })),
      { x: 0, y: 0, z: 0 },
    );
    renderOriginState(false);
    await act(async () => button('Continue from where the head stopped').click());
    renderOriginState(true);
    expect(host?.textContent).toContain('The origin is set from where the head stopped');
    const selectedLine = host?.querySelector<HTMLInputElement>('#laser-recovery-start-line')?.value;
    renderOriginState(false);
    expect(host?.textContent).not.toContain('The origin is set from where the head stopped');
    expect(host?.textContent).toContain('The controller has no work origin set now');
    expect(button('Continue from where the head stopped').disabled).toBe(false);
    expect(host?.querySelector<HTMLInputElement>('#laser-recovery-start-line')?.value).toBe(
      selectedLine,
    );
  });

  it('sets the origin from the stop point and restarts from the next line', async () => {
    const capsule = strokesCapsule({ kind: 'disconnect', message: 'USB lost', sentLines: 8 });
    const stop = recoveryHeadStop(capsule);
    if (stop === null) throw new Error('Expected a head stop.');
    const onSetOriginAtHead = vi.fn(async () => ({ x: LIVE.x, y: LIVE.y }));
    const onStart = vi.fn(async () => true);
    renderDialog(capsule, onStart, onSetOriginAtHead);

    expect(host?.textContent).toContain('8 sent before the connection dropped');
    expect(host?.textContent).toContain(`restarts from line ${stop.line}`);
    await act(async () => button('Continue from where the head stopped').click());

    expect(onSetOriginAtHead).toHaveBeenCalledWith(stop.pointMm);
    expect(host?.querySelector<HTMLInputElement>('#laser-recovery-start-line')?.value).toBe(
      String(stop.line),
    );
    expect(host?.textContent).toContain('The origin is set from where the head stopped');
    expect(host?.textContent).not.toContain('Restore saved origin');
    await act(async () => button('Start supervised recovery').click());
    expect(onStart).toHaveBeenCalledWith(capsule, stop.line);
  });

  it('shows the failure and keeps the automatic restart when the origin cannot be set', async () => {
    const capsule = strokesCapsule({ kind: 'disconnect', message: 'USB lost', sentLines: 8 });
    const onSetOriginAtHead = vi.fn(async () => {
      throw new Error('KerfDesk does not know where the head is in machine coordinates yet.');
    });
    renderDialog(
      capsule,
      vi.fn(async () => true),
      onSetOriginAtHead,
    );
    const before = host?.querySelector<HTMLInputElement>('#laser-recovery-start-line')?.value;
    await act(async () => button('Continue from where the head stopped').click());
    expect(host?.querySelector('[role="alert"]')?.textContent).toContain(
      'does not know where the head is',
    );
    expect(host?.querySelector<HTMLInputElement>('#laser-recovery-start-line')?.value).toBe(before);
  });

  it('is not offered without a recorded stop or after a stop that discarded the planner', () => {
    renderDialog(
      strokesCapsule({ kind: 'disconnect', message: 'USB lost' }),
      vi.fn(async () => true),
      vi.fn(async () => ({ x: 0, y: 0 })),
    );
    expect(host?.textContent).not.toContain('Continue from where the head stopped');
    act(() => unmount?.());
    renderDialog(
      strokesCapsule({ kind: 'controller-reboot', message: 'Rebooted', sentLines: 8 }),
      vi.fn(async () => true),
      vi.fn(async () => ({ x: 0, y: 0 })),
    );
    expect(host?.textContent).not.toContain('Continue from where the head stopped');
  });
});

function renderDialog(
  capsule: RecoveryCapsule,
  onStart: (capsule: RecoveryCapsule, fromLine?: number) => Promise<boolean>,
  onSetOriginAtHead: (point: { x: number; y: number }) => Promise<{ x: number; y: number }>,
  liveWorkOffsetMm: WorkCoordinateOffset = LIVE,
): (liveOriginSet: boolean) => void {
  host?.remove();
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (liveOriginSet: boolean): void =>
    act(() =>
      root.render(
        <LaserRecoveryReviewDialog
          capsule={capsule}
          onClose={vi.fn()}
          onStart={onStart}
          liveWorkOffsetMm={liveWorkOffsetMm}
          liveOriginSet={liveOriginSet}
          onSetOriginAtHead={onSetOriginAtHead}
        />,
      ),
    );
  render(true);
  unmount = () => root.unmount();
  return render;
}

function button(label: string): HTMLButtonElement {
  const candidate = [...(host?.querySelectorAll('button') ?? [])].find(
    (element) => element.textContent === label,
  );
  if (!(candidate instanceof HTMLButtonElement)) throw new Error(`Expected button: ${label}`);
  return candidate;
}

/** Three strokes on separate lines of a User Origin program. */
function strokesCapsule(interruption: JobInterruption): RecoveryCapsule {
  const stroke = (id: string, y: number): SceneObject => ({
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 2, minY: y, maxX: 12, maxY: y },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 2, y },
              { x: 12, y },
            ],
          },
        ],
      },
    ],
  });
  const project = {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [stroke('a', 2), stroke('b', 5), stroke('c', 8)],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected a valid prepared laser fixture.');
  const jobOrigin = { startFrom: 'user-origin', anchor: 'front-left' } as const;
  const emitted = emitPreparedGcode(prepared, { jobOrigin });
  const artifact = createExecutionArtifact({
    artifactSchemaVersion: 1,
    runId: 'run-head-stop',
    createdAtIso: '2026-09-27T11:00:00.000Z',
    gcode: emitted.gcode,
    prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    jobOrigin,
    canvasPlan: buildCanvasMotionPlan({
      gcode: emitted.gcode,
      prepared,
      machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
      retentionKey: 'head-stop-signature',
    }),
    controllerSettings: null,
  });
  return {
    runId: artifact.runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: 3,
    sendableLines: artifact.sendableLines,
    interruption,
    updatedAtIso: '2026-09-27T11:10:00.000Z',
    artifact,
  };
}
