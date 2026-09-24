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
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { buildCanvasMotionPlan, mapControllerPointToScene } from '../state/canvas-motion-plan';
import { createExecutionArtifact, type RecoveryCapsule } from '../state/recovery';
import { executionArtifactCanvasPlan } from '../state/recovery/execution-artifact-canvas';
import {
  createStartIntent,
  START_INTENT_INTERRUPTION_MESSAGE,
  startIntentStandInArtifact,
} from '../state/recovery/start-intent';
import { LaserRecoveryReviewDialog } from './LaserRecoveryReviewDialog';

// React DOM's test renderer reads this conventional global. The optional
// augmentation is test-only and does not change the production global type.
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

describe('LaserRecoveryReviewDialog', () => {
  it('reviews an exact artifact and closes without starting or mutating its capsule', () => {
    const capsule = exactCapsule();
    const original = structuredClone(capsule);
    const onClose = vi.fn();
    const onStart = vi.fn(async () => true);
    renderDialog(capsule, onClose, onStart);

    expect(host?.textContent).toContain('Exact job artifact saved');
    expect(host?.textContent).toContain(
      `${capsule.ackedLines} of ${capsule.sendableLines} sendable lines acknowledged`,
    );
    expect(host?.textContent).toContain('Connection lost');
    expect(host?.textContent).toContain('USB cable disconnected');
    expect(host?.textContent).toContain('diagnostic evidence only');
    expect(capsule).toEqual(original);

    act(() => button('Close').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    expect(capsule).toEqual(original);
  });

  // ADR-337: a Start stand-in has the migrated checkpoint's kind, so one copy
  // must be true for both and must not call either record old.
  it.each([
    { source: 'a migrated checkpoint', capsule: legacyCapsule },
    { source: 'a Start stand-in', capsule: standInCapsule },
  ])('makes the limitation of $source explicit without importing anything', ({ capsule }) => {
    const onStart = vi.fn(async () => false);
    renderDialog(capsule(), vi.fn(), onStart);

    expect(host?.textContent).toContain('Fingerprint-only record');
    expect(host?.textContent).toContain(
      'holds only the program fingerprint, not the exact emitted G-code',
    );
    expect(host?.textContent).toContain('current project compiles to the same fingerprint');
    expect(host?.textContent).toContain('Nothing is imported into the open project automatically');
    expect(host?.textContent).not.toMatch(/\b(?:older|migrated|legacy)\b/i);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('allows one start attempt at a time, stays open on failure, and retries successfully', async () => {
    let resolveFirst: ((started: boolean) => void) | null = null;
    const firstAttempt = new Promise<boolean>((resolve) => {
      resolveFirst = resolve;
    });
    const capsule = exactCapsule();
    const onClose = vi.fn();
    const onStart = vi
      .fn<(capsule: RecoveryCapsule) => Promise<boolean>>()
      .mockImplementationOnce(async () => firstAttempt)
      .mockResolvedValueOnce(true);
    renderDialog(capsule, onClose, onStart);

    const start = button('Start supervised recovery');
    act(() => {
      start.click();
      start.click();
    });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(capsule);
    expect(button('Starting supervised recovery...').disabled).toBe(true);
    expect(button('Close').disabled).toBe(true);
    expect(host?.querySelector<HTMLInputElement>('#laser-recovery-start-line')?.disabled).toBe(
      true,
    );

    await act(async () => {
      resolveFirst?.(false);
      await firstAttempt;
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(host?.querySelector('[role="alert"]')?.textContent).toContain(
      'Review the current recovery card',
    );
    expect(button('Start supervised recovery').disabled).toBe(false);

    await act(async () => {
      button('Start supervised recovery').click();
      await Promise.resolve();
    });
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('zooms and selects the exact saved movement without starting, then submits that line explicitly', async () => {
    const capsule = exactCapsule();
    const before = structuredClone(capsule);
    const onStart = vi.fn(async () => true);
    renderDialog(capsule, vi.fn(), onStart);
    const svg = recoveryCanvas();
    const initialView = svg.getAttribute('viewBox');
    act(() =>
      host?.querySelector<HTMLButtonElement>('[aria-label="Zoom in recovery canvas"]')?.click(),
    );
    expect(svg.getAttribute('viewBox')).not.toBe(initialView);
    const rawLine = clickFirstBurn(svg, capsule);
    expect(host?.querySelector<HTMLInputElement>('#laser-recovery-start-line')?.value).toBe(
      String(rawLine),
    );
    expect(
      host
        ?.querySelector('[data-testid="selected-recovery-movement"]')
        ?.getAttribute('data-raw-line'),
    ).toBe(String(rawLine));
    expect(onStart).not.toHaveBeenCalled();
    expect(capsule).toEqual(before);
    await act(async () => button('Start supervised recovery').click());
    expect(onStart).toHaveBeenCalledWith(capsule, rawLine);
  });

  it('allows legacy manual line selection and resets to the automatic estimate without starting', async () => {
    const capsule = legacyCapsule();
    const onStart = vi.fn(async () => false);
    renderDialog(capsule, vi.fn(), onStart);
    setRestartLine('4');
    expect(onStart).not.toHaveBeenCalled();
    expect(host?.textContent).toContain('Recovery replays line 4 and every later line');
    await act(async () => button('Start supervised recovery').click());
    expect(onStart).toHaveBeenLastCalledWith(capsule, 4);
    act(() => button('Use automatic line').click());
    await act(async () => button('Start supervised recovery').click());
    expect(onStart).toHaveBeenLastCalledWith(capsule);
  });
});

function recoveryCanvas(): SVGSVGElement {
  const svg = host?.querySelector('svg[aria-label^="Laser recovery canvas"]');
  if (!(svg instanceof SVGSVGElement)) throw new Error('Expected restart canvas.');
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 640,
    height: 320,
    right: 640,
    bottom: 320,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  return svg;
}

function clickFirstBurn(svg: SVGSVGElement, capsule: RecoveryCapsule): number {
  if (capsule.artifact.kind !== 'exact-execution') throw new Error('Expected exact artifact.');
  const plan = executionArtifactCanvasPlan(capsule.artifact);
  const block = plan.manifest.blocks.find((item) => item.kind === 'process');
  const first = block?.points[0];
  const last = block?.points.at(-1);
  if (block === undefined || first === undefined || last === undefined)
    throw new Error('Expected burn motion.');
  const point = mapControllerPointToScene(
    { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2, z: 0 },
    plan,
  );
  const [x = 0, y = 0, width = 1, height = 1] = (svg.getAttribute('viewBox') ?? '')
    .split(' ')
    .map(Number);
  const event = {
    bubbles: true,
    button: 0,
    clientX: ((point.x - x) / width) * 640,
    clientY: ((point.y - y) / height) * 320,
  };
  act(() => {
    svg.dispatchEvent(new MouseEvent('pointerdown', event));
    svg.dispatchEvent(new MouseEvent('pointerup', event));
  });
  return block.rawLineIndex + 1;
}

function renderDialog(
  capsule: RecoveryCapsule,
  onClose: () => void,
  onStart: (capsule: RecoveryCapsule, fromLine?: number) => Promise<boolean>,
): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <LaserRecoveryReviewDialog capsule={capsule} onClose={onClose} onStart={onStart} />,
    ),
  );
  unmount = () => root.unmount();
}

function setRestartLine(value: string): void {
  const input = host?.querySelector<HTMLInputElement>('#laser-recovery-start-line');
  if (input === null || input === undefined) throw new Error('Expected restart line input.');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement {
  const candidate = [...(host?.querySelectorAll('button') ?? [])].find(
    (element) => element.textContent === label,
  );
  if (!(candidate instanceof HTMLButtonElement)) {
    throw new Error(`Expected button: ${label}`);
  }
  return candidate;
}

function exactCapsule(): RecoveryCapsule {
  const line: SceneObject = {
    kind: 'imported-svg',
    id: 'dialog-fixture-line',
    source: 'dialog-fixture.svg',
    bounds: { minX: 1, minY: 1, maxX: 9, maxY: 9 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 1, y: 1 },
              { x: 9, y: 9 },
            ],
          },
        ],
      },
    ],
  };
  const project = {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [line],
      layers: [createLayer({ id: 'red', color: '#ff0000' })],
    },
  };
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected a valid prepared laser fixture.');
  const emitted = emitPreparedGcode(prepared);
  if (!emitted.preflight.ok) throw new Error('Expected valid laser fixture G-code.');
  const canvasPlan = buildCanvasMotionPlan({
    gcode: emitted.gcode,
    prepared,
    machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
    retentionKey: 'exact-laser-signature',
  });
  const artifact = createExecutionArtifact({
    artifactSchemaVersion: 1,
    runId: 'run-exact-laser',
    createdAtIso: '2026-07-15T09:00:00.000Z',
    gcode: emitted.gcode,
    prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan,
    controllerSettings: null,
  });
  const ackedLines = Math.min(2, artifact.sendableLines);
  return {
    runId: artifact.runId,
    artifactKind: artifact.kind,
    revision: 4,
    ackedLines,
    sendableLines: artifact.sendableLines,
    interruption: {
      kind: 'disconnect',
      message: 'USB cable disconnected',
    },
    updatedAtIso: '2026-07-15T09:10:00.000Z',
    artifact,
  };
}

function legacyCapsule(): RecoveryCapsule {
  const artifact = {
    schemaVersion: 1,
    kind: 'legacy-fingerprint-only',
    runId: 'legacy-laser',
    createdAtIso: '2026-07-14T09:00:00.000Z',
    migratedAtIso: '2026-07-15T09:00:00.000Z',
    fingerprint: { fnv1a: 456, chars: 80, lines: 8 },
    sendableLines: 8,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
  } satisfies Extract<RecoveryCapsule['artifact'], { readonly kind: 'legacy-fingerprint-only' }>;
  return {
    runId: artifact.runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: 3,
    sendableLines: 8,
    interruption: {
      kind: 'controller-reboot',
      message: 'Controller greeting received during the job',
    },
    updatedAtIso: '2026-07-15T09:00:00.000Z',
    artifact,
  };
}

/** The capsule crash reconciliation writes when the app died before a fresh
 * Start's archive was stored (ADR-337). */
function standInCapsule(): RecoveryCapsule {
  const armedAtIso = '2026-09-24T09:00:00.000Z';
  const intent = createStartIntent({
    gcode: 'G0 X1 Y1\nM3 S500\nG1 X9 Y9 F1200\nM5\n',
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: armedAtIso,
  });
  const artifact = startIntentStandInArtifact('run-stand-in-laser', intent, armedAtIso);
  return {
    runId: artifact.runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: 0,
    sendableLines: artifact.sendableLines,
    interruption: { kind: 'unknown', message: START_INTENT_INTERRUPTION_MESSAGE },
    updatedAtIso: armedAtIso,
    artifact,
  };
}
