import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControllerKind } from '../../core/devices/device-profile';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { WorkZRecoveryControl } from './WorkZRecoveryControl';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

const idleStatus = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

function setCncState(input?: {
  readonly connection?: 'connected' | 'disconnected';
  readonly controllerState?: 'Idle' | 'Run';
  readonly controllerKind?: ControllerKind;
  readonly recover?: ReturnType<typeof vi.fn>;
}): ReturnType<typeof vi.fn> {
  const recover = input?.recover ?? vi.fn(async () => undefined);
  useStore.setState({
    project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
  });
  useLaserStore.setState({
    connection: { kind: input?.connection ?? 'connected' },
    statusReport: { ...idleStatus, state: input?.controllerState ?? 'Idle' },
    activeControllerKind: input?.controllerKind ?? 'grbl-v1.1',
    workZReferenceEpoch: 4,
    controllerSessionEpoch: 7,
    workZZeroEvidence: null,
    recoverWorkZFromController: recover,
  });
  return recover;
}

async function renderControl(): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(<WorkZRecoveryControl />));
  return host;
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.setState({ project: createProject() });
  useLaserStore.setState(initialLaserState());
  vi.mocked(jobAwareConfirm).mockReset().mockReturnValue(true);
});

describe('WorkZRecoveryControl', () => {
  it('puts the renamed action in a collapsed advanced setup-reuse disclosure', async () => {
    const recover = setCncState();
    const rendered = await renderControl();

    const details = rendered.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toContain(
      'Advanced: Reuse existing controller setup',
    );
    const button = [...rendered.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Use existing controller Z zero'),
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());

    expect(jobAwareConfirm).toHaveBeenCalledWith(expect.stringMatching(/3\.175 mm.*end mill/i));
    expect(recover).toHaveBeenCalledWith({
      activeToolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      controllerOffsetRepresentsStockTop: true,
    });
  });

  it.each([
    ['disconnected', { connection: 'disconnected' as const }],
    ['not Idle', { controllerState: 'Run' as const }],
    ['unsupported', { controllerKind: 'marlin' as const }],
  ])('hides controller setup reuse while the controller is %s', async (_label, state) => {
    setCncState(state);
    const rendered = await renderControl();
    expect(rendered.querySelector('details')).toBeNull();
    expect(rendered.querySelector('button')).toBeNull();
  });

  it('hides setup reuse when current Work-Z evidence already exists for the active bit', async () => {
    setCncState();
    useLaserStore.setState({
      workZZeroEvidence: {
        source: 'manual-zero',
        referenceEpoch: 4,
        toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      },
    });
    const rendered = await renderControl();
    expect(rendered.querySelector('details')).toBeNull();
    expect(rendered.querySelector('button')).toBeNull();
  });

  it('replaces the action with compact verified status after owned controller readback', async () => {
    setCncState();
    useLaserStore.setState({
      workZZeroEvidence: {
        source: 'controller-readback',
        referenceEpoch: 4,
        controllerSessionEpoch: 7,
        toolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
        activeWcs: 'G54',
        offsetZMm: -12.5,
        observedAtMs: 1234,
      },
    });
    const rendered = await renderControl();
    const status = rendered.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Controller Z zero verified');
    expect(status?.textContent).toContain('G54 offset -12.500 mm');
    expect(rendered.querySelector('details')).toBeNull();
    expect(rendered.querySelector('button')).toBeNull();
  });
});
