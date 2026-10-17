import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { JogPad } from './JogPad';
import { useJogControlPreferences } from './jog-control-preferences';
import { useMachineSetupDialogStore } from './device-setup/machine-setup-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaser = useLaserStore.getState();
const originalPreferences = useJogControlPreferences.getState();
let host: HTMLDivElement;
let root: Root;
const jog = vi.fn(async () => undefined);
const off = vi.fn(async () => undefined);

beforeEach(() => {
  resetStore();
  jog.mockClear();
  off.mockClear();
  const shape = createRectangle({
    id: 'shape',
    color: '#000000',
    spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
  });
  useStore.setState((state) => ({
    project: {
      ...state.project,
      device: {
        ...state.project.device,
        origin: 'rear-left',
        positioningLight: {
          onCommand: 'M64 P0',
          offCommand: 'M65 P0',
          offsetXmm: 0,
          offsetYmm: 0,
        },
      },
      scene: {
        ...state.project.scene,
        objects: [{ ...shape, transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 } }],
      },
    },
    selectedObjectId: 'shape',
    jobPlacement: { ...state.jobPlacement, startFrom: 'absolute' },
  }));
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    centrePositioningLight: jog,
    setPositioningLightEnabled: off,
    positioningLightEnabled: false,
  });
  useJogControlPreferences.setState({ requestedFeedMmPerMin: 1200 });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useLaserStore.setState(originalLaser, true);
  useJogControlPreferences.setState(originalPreferences, true);
  useMachineSetupDialogStore.getState().close();
});

function centreButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Centre & LED"]');
  if (button === null) throw new Error('Centre selection button missing');
  return button;
}

describe('Centre selection in the jog pad', () => {
  it('dispatches the transformed centre through the separate-light action and hides in CNC', async () => {
    await act(async () => root.render(<JogPad disabled={false} />));
    expect(centreButton().title).toContain('beam off');
    await act(async () => centreButton().click());
    expect(jog).toHaveBeenCalledExactlyOnceWith(40, 45, 1200);
    await act(async () => useStore.getState().setMachineKind('cnc'));
    expect(host.querySelector('button[aria-label="Centre & LED"]')).toBeNull();
  });

  it('explains unavailable selection, placement and machine states without sending movement', async () => {
    await act(async () => root.render(<JogPad disabled={false} />));
    await act(async () => useStore.getState().selectObject(null));
    expect(centreButton().disabled).toBe(true);
    expect(centreButton().title).toContain('Select a trace');
    await act(async () => centreButton().click());

    await act(async () => {
      useStore.getState().selectObject('shape');
      useStore.setState((state) => ({
        jobPlacement: { ...state.jobPlacement, startFrom: 'user-origin' },
      }));
    });
    expect(centreButton().disabled).toBe(true);
    expect(centreButton().title).toContain('Absolute Coords');
    await act(async () => centreButton().click());

    await act(async () => {
      useStore.setState((state) => ({
        jobPlacement: { ...state.jobPlacement, startFrom: 'absolute' },
      }));
      useLaserStore.setState({ connection: { kind: 'disconnected' } });
    });
    expect(centreButton().disabled).toBe(true);
    expect(centreButton().title).toContain('Connect');
    await act(async () => centreButton().click());

    await act(async () => {
      useLaserStore.setState((state) => ({
        connection: { kind: 'connected' },
        statusReport: { ...state.statusReport!, state: 'Run' },
      }));
    });
    expect(centreButton().disabled).toBe(true);
    expect(centreButton().title).toContain('Idle');
    await act(async () => centreButton().click());
    expect(jog).not.toHaveBeenCalled();
  });

  it('subtracts the pointer offset before converting bed axes to native coordinates', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          origin: 'front-left',
          bedHeight: 300,
          positioningLight: {
            onCommand: 'M64 P0',
            offCommand: 'M65 P0',
            offsetXmm: 10,
            offsetYmm: -5,
          },
        },
      },
    }));
    await act(async () => root.render(<JogPad disabled={false} />));
    await act(async () => centreButton().click());
    // Centre (40,45), head (30,50) in canvas bed axes, native Y=300-50.
    expect(jog).toHaveBeenCalledExactlyOnceWith(30, 250, 1200);
  });

  it('keeps light off available after deselection and switching to CNC', async () => {
    useLaserStore.setState({ positioningLightEnabled: true });
    useStore.getState().selectObject(null);
    useStore.getState().setMachineKind('cnc');
    await act(async () => root.render(<JogPad disabled={false} />));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="LED off"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
    expect(off).toHaveBeenCalledExactlyOnceWith(false);
    expect(jog).not.toHaveBeenCalled();
  });

  it('opens light setup when unconfigured and explains Ruida file-only support', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          positioningLight: undefined,
        },
      },
    }));
    await act(async () => root.render(<JogPad disabled={false} />));
    expect(centreButton().disabled).toBe(true);
    const setup = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Set up LED',
    );
    await act(async () => setup?.click());
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({
      kind: 'open',
      target: { step: 'options', highlight: 'positioning-light' },
    });
    await act(async () =>
      useStore.setState((state) => ({
        project: {
          ...state.project,
          device: {
            ...state.project.device,
            controllerKind: 'ruida',
          },
        },
      })),
    );
    expect(centreButton().title).toContain('file export only');
    expect(host.textContent).not.toContain('Set up LED');
    expect(jog).not.toHaveBeenCalled();
  });
});
