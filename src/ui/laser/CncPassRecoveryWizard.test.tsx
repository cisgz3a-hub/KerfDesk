import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { useStore } from '../state';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { createExecutionArtifact, type RecoveryCapsule } from '../state/recovery';
import { runCncPassRecoveryFlow } from './cnc-pass-recovery-flow';
import { CncPassRecoveryWizard } from './CncPassRecoveryWizard';

vi.mock('./cnc-pass-recovery-flow', () => ({
  runCncPassRecoveryFlow: vi.fn(async () => true),
}));
vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

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
  useStore.setState({ project: createProject() });
  useLaserStore.setState(initialLaserState());
  vi.mocked(runCncPassRecoveryFlow).mockReset().mockResolvedValue(true);
});

function recoveryProject(): Project {
  const color = '#ff0000';
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'straight-path',
    source: 'straight.svg',
    bounds: { minX: 20, minY: 20, maxX: 80, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: false,
            points: [
              { x: 20, y: 20 },
              { x: 40, y: 20 },
              { x: 60, y: 20 },
              { x: 80, y: 20 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'layer-a', color }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'profile-on-path',
            depthMm: 3,
            depthPerPassMm: 1,
          },
        },
      ],
    },
  };
}

function exactCapsule(options?: {
  readonly archiveWco?: boolean;
  readonly interruptionKind?: RecoveryCapsule['interruption']['kind'];
}): RecoveryCapsule {
  const prepared = prepareOutput(recoveryProject());
  if (!prepared.ok) throw new Error('Expected prepared CNC output.');
  const emitted = emitPreparedGcode(prepared);
  if (!emitted.preflight.ok) throw new Error('Expected valid CNC preflight.');
  const runId = 'run-archived-cnc';
  const artifact = createExecutionArtifact({
    artifactSchemaVersion: 1,
    runId,
    gcode: emitted.gcode,
    prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: 'archived-cnc-signature' } as CanvasMotionPlan,
    controllerSettings: null,
    ...(options?.archiveWco === false
      ? {}
      : { controllerObservation: { wco: { x: 0, y: 0, z: 0 } } }),
    createdAtIso: '2026-07-16T12:00:00.000Z',
  });
  return {
    runId,
    artifactKind: artifact.kind,
    revision: 1,
    ackedLines: Math.min(3, artifact.sendableLines),
    sendableLines: artifact.sendableLines,
    interruption: {
      kind: options?.interruptionKind ?? 'disconnect',
      message: 'Connection lost.',
    },
    updatedAtIso: '2026-07-16T12:01:00.000Z',
    artifact,
  };
}

function renderWizard(capsule: RecoveryCapsule): { readonly onClose: ReturnType<typeof vi.fn> } {
  useStore.setState({ project: createProject() });
  useLaserStore.setState({ ...initialLaserState(), wcoCache: { x: 0, y: 0, z: 0 } });
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  act(() => root.render(<CncPassRecoveryWizard capsule={capsule} onClose={onClose} />));
  unmount = () => root.unmount();
  return { onClose };
}

function wizardButton(label: string): HTMLButtonElement {
  const button = [...(host?.querySelectorAll('button') ?? [])].find((candidate) =>
    (candidate.textContent ?? '').startsWith(label),
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected wizard button: ${label}`);
  }
  return button;
}

function boundarySelect(): HTMLSelectElement {
  const select = host?.querySelector<HTMLSelectElement>(
    'select[aria-label="CNC recovery boundary pass"]',
  );
  if (!(select instanceof HTMLSelectElement)) throw new Error('Expected boundary pass selector.');
  return select;
}

function completeChecklist(): void {
  act(() => {
    for (const checkbox of host?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ??
      []) {
      checkbox.click();
    }
  });
}

function rezeroedRadio(): HTMLInputElement {
  const radio = host?.querySelector<HTMLInputElement>(
    'input[type="radio"][title^="Position was re-established"]',
  );
  if (!(radio instanceof HTMLInputElement)) throw new Error('Expected re-zeroed position radio.');
  return radio;
}

describe('CncPassRecoveryWizard', () => {
  it('shows extraction guidance and preselects the computed default boundary', () => {
    renderWizard(exactCapsule());
    expect(host?.textContent).toContain('The app lost the controller mid-job');
    expect(host?.textContent).toContain('STILL BE SPINNING');
    expect(boundarySelect().value).toBe('0:0');
    expect(host?.querySelector('[data-testid="cnc-pass-recovery-preview"]')).not.toBeNull();
    expect(wizardButton('Start pass recovery').disabled).toBe(true);
  });

  it('keeps Start disabled until the operator explicitly picks a position option', () => {
    renderWizard(exactCapsule());
    const radios = [...(host?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [])];
    expect(radios).toHaveLength(2);
    expect(radios.some((radio) => radio.checked)).toBe(false);
    completeChecklist();
    expect(wizardButton('Start pass recovery').disabled).toBe(true);
    act(() => {
      rezeroedRadio().click();
    });
    expect(wizardButton('Start pass recovery').disabled).toBe(false);
  });

  it('starts the flow with the completed review and closes on success', async () => {
    const { onClose } = renderWizard(exactCapsule());
    completeChecklist();
    act(() => {
      rezeroedRadio().click();
    });
    const start = wizardButton('Start pass recovery');
    expect(start.disabled).toBe(false);
    await act(async () => {
      start.click();
    });
    expect(vi.mocked(runCncPassRecoveryFlow)).toHaveBeenCalledTimes(1);
    const [, review] = vi.mocked(runCncPassRecoveryFlow).mock.calls[0] ?? [];
    expect(review).toMatchObject({
      cutterClear: true,
      spindleStopped: true,
      workholdingConfirmed: true,
      toolConfirmed: true,
      position: { kind: 're-zeroed' },
      groupIndex: 0,
      passIndex: 0,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('warns inline when a later pass than the default is selected', () => {
    renderWizard(exactCapsule());
    const select = boundarySelect();
    act(() => {
      select.value = '0:2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host?.textContent).toContain('Later than the computed safe boundary');
  });

  it('offers retained position only with session-continuity evidence', () => {
    renderWizard(exactCapsule());
    const retained = host?.querySelector<HTMLInputElement>('input[type="radio"]');
    expect(retained?.disabled).toBe(false);
  });

  it('disables retained position and explains why after a controller reboot', () => {
    renderWizard(exactCapsule({ interruptionKind: 'controller-reboot' }));
    const retained = host?.querySelector<HTMLInputElement>('input[type="radio"]');
    expect(retained?.disabled).toBe(true);
    expect(host?.textContent).toContain('rebooted');
  });

  it('opens the advanced runway wizard on request', () => {
    renderWizard(exactCapsule());
    act(() => {
      wizardButton('Advanced: mid-pass runway…').click();
    });
    expect(host?.textContent).toContain('Supervised CNC recovery');
  });
});
