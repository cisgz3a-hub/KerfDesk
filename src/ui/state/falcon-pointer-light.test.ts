import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALCON_POINTER_LIGHT } from '../../core/devices/positioning-light';
import type { CameraBridgeAdapter, FalconPointerSwitchResult } from '../../platform/types';
import { harness, originalProject } from '../../__fixtures__/positioning-light-harness';
import { useCameraStore } from './camera-store';
import { registerFalconPointerBridge, resetFalconPointerLink } from './falcon-pointer-link';
import {
  falconPointerOffOnDisconnect,
  positioningLightDisconnectOff,
} from './positioning-light-actions';
import { useStore } from './store';

const initialCamera = useCameraStore.getState();

afterEach(() => {
  useStore.setState({ project: originalProject });
  useCameraStore.setState({
    machineCamera: initialCamera.machineCamera,
    sourceState: initialCamera.sourceState,
  });
  resetFalconPointerLink();
});

function falconHarness(found = 'http://192.168.10.1:8080/media/getCapturePhoto') {
  const h = harness('grblhal', 'creality-falcon-a1-pro');
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: {
        ...project.device,
        controllerCommandSet: 'creality-falcon-a1-pro',
        positioningLight: FALCON_POINTER_LIGHT,
      },
    },
  });
  const calls: Array<{ host: string; on: boolean; writes: number }> = [];
  let onResult: FalconPointerSwitchResult = { kind: 'ok' };
  const discover = vi.fn(async () =>
    found === ''
      ? { kind: 'not-found' as const }
      : { kind: 'found' as const, cameraUrl: found, proxyFrameUrl: '' },
  );
  const bridge = {
    discoverMachineCamera: discover,
    switchFalconPointer: async (host: string, on: boolean) => {
      calls.push({ host, on, writes: h.writes.length });
      return on ? onResult : { kind: 'ok' as const };
    },
  } as unknown as CameraBridgeAdapter;
  registerFalconPointerBridge(bridge);
  const lines = () =>
    h.writes.flatMap((wire) => wire.split('\n').map((line) => line.trim())).filter(Boolean);
  return {
    ...h,
    calls,
    discover,
    lines,
    failOn: (reason: string) => {
      onResult = { kind: 'failed', reason };
    },
  };
}

describe('Falcon red pointer through the LED controls (ADR-635)', () => {
  it('switches over the network after asserting the beam off, with no light G-code', async () => {
    const h = falconHarness();
    await h.actions.switchPositioningLightOn();
    expect(h.calls.map(({ host, on }) => [host, on])).toEqual([
      ['192.168.10.1', false],
      ['192.168.10.1', true],
    ]);
    expect(h.lines()).toContain('M5');
    expect(h.lines().some((line) => /^M6[45]|^M355/.test(line))).toBe(false);
    expect(h.get().positioningLightEnabled).toBe(true);
    expect(positioningLightDisconnectOff(h.get(), h.refs)).toBeNull();
    falconPointerOffOnDisconnect(h.get(), h.refs);
    await vi.waitFor(() => expect(h.calls).toHaveLength(3));
    expect(h.calls.at(-1)).toMatchObject({ on: false });
    await h.actions.switchPositioningLightOff();
    expect(h.calls.at(-1)).toMatchObject({ on: false });
    expect(h.get().positioningLightEnabled).toBe(false);
    expect(h.get().controllerOperation).toBeNull();
  });

  it('lights the pointer only after the beam-off move to the centre', async () => {
    const h = falconHarness();
    await h.actions.centrePositioningLight(40, 45, 1200);
    const move = h.lines().indexOf('G1 X40.000 Y45.000 F1200 S0');
    expect(move).toBeGreaterThan(-1);
    const on = h.calls.find((call) => call.on);
    expect(on?.writes).toBeGreaterThan(h.writes.findIndex((wire) => wire.includes('G1 X40.000')));
    expect(h.get().positioningLightEnabled).toBe(true);
  });

  it('uses the address of the Falcon camera KerfDesk already reaches, not a phone camera', async () => {
    const h = falconHarness();
    useCameraStore.setState({
      machineCamera: {
        kind: 'found',
        cameraUrl: 'http://192.168.10.7:8080/media/getCapturePhoto',
        proxyFrameUrl: '',
      },
    });
    await h.actions.switchPositioningLightOn();
    expect(h.discover).not.toHaveBeenCalled();
    expect(h.calls.every((call) => call.host === '192.168.10.7')).toBe(true);

    const phone = falconHarness();
    useCameraStore.setState({
      machineCamera: {
        kind: 'found',
        cameraUrl: 'http://192.168.1.50:8080/shot.jpg',
        proxyFrameUrl: '',
      },
    });
    await phone.actions.switchPositioningLightOn();
    expect(phone.discover).toHaveBeenCalled();
    expect(phone.calls.every((call) => call.host === '192.168.10.1')).toBe(true);
  });

  it('keeps the pointer off when no request could leave KerfDesk', async () => {
    const h = falconHarness('');
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow(
      'KerfDesk cannot find the Falcon on the network.',
    );
    expect(h.calls).toEqual([]);
    expect(h.get().positioningLightEnabled).toBe(false);
    expect(h.get().controllerOperation).toBeNull();

    resetFalconPointerLink();
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow('needs KerfDesk Desktop');
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('keeps Off available when the Falcon may have received the on request', async () => {
    const h = falconHarness();
    h.failOn('The Falcon at 192.168.10.1 did not answer within 5 s.');
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow('did not answer');
    expect(h.get().positioningLightEnabled).toBe(true);
    await h.actions.switchPositioningLightOff();
    expect(h.calls.at(-1)).toMatchObject({ on: false });
    expect(h.get().positioningLightEnabled).toBe(false);
  });

  it('refuses the Falcon pointer on another machine profile without any request', async () => {
    const h = falconHarness();
    const project = useStore.getState().project;
    const { controllerCommandSet: _falcon, ...device } = project.device;
    useStore.setState({ project: { ...project, device } });
    await expect(h.actions.switchPositioningLightOn()).rejects.toThrow(
      'needs the Creality Falcon A1 Pro machine profile',
    );
    expect(h.calls).toEqual([]);
  });
});
