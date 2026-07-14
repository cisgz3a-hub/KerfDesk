import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('names the active bit and passes explicit stock-top confirmation to the owned action', async () => {
    const recover = vi.fn(async () => undefined);
    useStore.setState({
      project: { ...createProject(), machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: { x: 0, y: 0, z: 0 },
        wPos: null,
        feed: 0,
        spindle: 0,
        wco: null,
      },
      activeControllerKind: 'grbl-v1.1',
      recoverWorkZFromController: recover,
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<WorkZRecoveryControl />));

    const button = [...host.querySelectorAll('button')].find((item) =>
      item.textContent?.includes('Read & recover Work Z'),
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());

    expect(jobAwareConfirm).toHaveBeenCalledWith(expect.stringMatching(/3\.175 mm.*end mill/i));
    expect(recover).toHaveBeenCalledWith({
      activeToolId: DEFAULT_CNC_MACHINE_CONFIG.toolId,
      controllerOffsetRepresentsStockTop: true,
    });
  });
});
