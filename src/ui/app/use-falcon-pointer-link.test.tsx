// ADR-635: a discovered Falcon is not reused across a disconnect or a change
// of machine profile.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraBridgeAdapter } from '../../platform/types';
import { useStore } from '../state';
import {
  registerFalconPointerBridge,
  resetFalconPointerLink,
  switchFalconPointer,
} from '../state/falcon-pointer-link';
import { useLaserStore } from '../state/laser-store';
import { useFalconPointerLink } from './use-falcon-pointer-link';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalProject = useStore.getState().project;
let root: Root | null = null;

function Probe(): null {
  useFalconPointerLink();
  return null;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  useLaserStore.setState({ connection: { kind: 'disconnected' } });
  useStore.setState({ project: originalProject });
  resetFalconPointerLink();
});

describe('useFalconPointerLink', () => {
  it('looks for the Falcon again after a disconnect or another machine profile', async () => {
    useLaserStore.setState({ connection: { kind: 'connected' } });
    await act(async () => {
      root = createRoot(document.createElement('div'));
      root.render(<Probe />);
    });
    const discover = vi.fn(async () => ({
      kind: 'found' as const,
      cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
      proxyFrameUrl: '',
    }));
    registerFalconPointerBridge({
      discoverMachineCamera: discover,
      switchFalconPointer: async () => ({ kind: 'ok' as const }),
    } as unknown as CameraBridgeAdapter);

    await switchFalconPointer(true);
    await switchFalconPointer(false);
    expect(discover).toHaveBeenCalledTimes(1);

    await act(async () => useLaserStore.setState({ connection: { kind: 'disconnected' } }));
    await switchFalconPointer(true);
    expect(discover).toHaveBeenCalledTimes(2);

    const project = useStore.getState().project;
    await act(async () =>
      useStore.setState({
        project: { ...project, device: { ...project.device, profileId: 'another-machine' } },
      }),
    );
    await switchFalconPointer(true);
    expect(discover).toHaveBeenCalledTimes(3);
  });
});
