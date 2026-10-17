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

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaser = useLaserStore.getState();
const originalPreferences = useJogControlPreferences.getState();
let host: HTMLDivElement;
let root: Root;
const jog = vi.fn(async () => undefined);

beforeEach(() => {
  resetStore();
  jog.mockClear();
  const shape = createRectangle({
    id: 'shape',
    color: '#000000',
    spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
  });
  useStore.setState((state) => ({
    project: {
      ...state.project,
      device: { ...state.project.device, origin: 'rear-left' },
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
    jogToMachinePosition: jog,
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
});

function centreButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Centre selection"]');
  if (button === null) throw new Error('Centre selection button missing');
  return button;
}

describe('Centre selection in the jog pad', () => {
  it('moves to the transformed selection centre through the beam-off jog and hides in CNC', async () => {
    await act(async () => root.render(<JogPad disabled={false} />));
    expect(centreButton().title).toContain('beam off');
    await act(async () => centreButton().click());
    expect(jog).toHaveBeenCalledExactlyOnceWith(40, 45, 1200);
    await act(async () => useStore.getState().setMachineKind('cnc'));
    expect(host.querySelector('button[aria-label="Centre selection"]')).toBeNull();
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
});
