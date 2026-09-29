import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from '../../core/devices';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { stockNativeEvidence } from '../state/native-bed-frame.test-support';
import {
  clampToBed,
  dispatchPositionLaser,
  positionLaserFeed,
  positionLaserTarget,
} from './position-laser-click';

const ORIGINS: ReadonlyArray<Origin> = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];

function deviceWith(origin: Origin): DeviceProfile {
  return { ...DEFAULT_DEVICE_PROFILE, origin };
}

describe('positionLaserTarget', () => {
  it('maps any click to a machine coordinate inside the bed, for every origin', () => {
    // Property (non-negotiable #1, bounds check): whatever the click and the
    // device origin, the absolute destination stays on the bed.
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 2000, noNaN: true }),
        fc.double({ min: -1000, max: 2000, noNaN: true }),
        fc.constantFrom(...ORIGINS),
        (x, y, origin) => {
          const device = deviceWith(origin);
          const target = positionLaserTarget({ x, y }, device);
          const [minX, maxX] =
            origin === 'center'
              ? [-device.bedWidth / 2, device.bedWidth / 2]
              : [0, device.bedWidth];
          const [minY, maxY] =
            origin === 'center'
              ? [-device.bedHeight / 2, device.bedHeight / 2]
              : [0, device.bedHeight];
          expect(target.x).toBeGreaterThanOrEqual(minX);
          expect(target.x).toBeLessThanOrEqual(maxX);
          expect(target.y).toBeGreaterThanOrEqual(minY);
          expect(target.y).toBeLessThanOrEqual(maxY);
        },
      ),
    );
  });

  it('flips Y for front-left origins (scene top = bed back), like G-code emission', () => {
    const device = deviceWith('front-left');
    // A click at the scene's top-left corner is the bed's BACK-left in
    // machine coordinates.
    expect(positionLaserTarget({ x: 0, y: 0 }, device)).toEqual({
      x: 0,
      y: device.bedHeight,
    });
  });
});

describe('clampToBed / positionLaserFeed', () => {
  it('clamps outside clicks to the nearest bed edge', () => {
    expect(clampToBed({ x: -5, y: 900 }, 400, 400)).toEqual({ x: 0, y: 400 });
  });

  it('caps the positioning feed at the device max', () => {
    expect(positionLaserFeed(6000)).toBe(3000);
    expect(positionLaserFeed(1200)).toBe(1200);
  });
});

describe('dispatchPositionLaser', () => {
  const initial = useLaserStore.getState();
  afterEach(() => useLaserStore.setState(initial, true));
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('refuses with a toast when the machine is not connected', () => {
    const jogToMachinePosition = vi.fn();
    useLaserStore.setState({ connection: { kind: 'disconnected' }, jogToMachinePosition });
    dispatchPositionLaser({ x: 10, y: 10 }, DEFAULT_DEVICE_PROFILE);
    expect(jogToMachinePosition).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts[0]?.message).toContain('Connect the machine');
  });

  it('sends one absolute jog to the mapped machine point when ready', () => {
    const device = {
      ...deviceWith('rear-left'),
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    };
    const jogToMachinePosition = vi.fn(async () => undefined);
    useLaserStore.setState({
      ...stockNativeEvidence(device, true),
      connection: { kind: 'connected' },
      streamer: null,
      motionOperation: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: null,
        wPos: null,
        feed: null,
        spindle: null,
        wco: null,
      },
      jogToMachinePosition,
    });
    dispatchPositionLaser({ x: 12.5, y: 40 }, device);
    expect(jogToMachinePosition).toHaveBeenCalledTimes(1);
    expect(jogToMachinePosition).toHaveBeenCalledWith(12.5, 40, positionLaserFeed(device.maxFeed));
  });

  it('converts a canvas destination to negative native coordinates and refuses unknown mapping', () => {
    const device = {
      ...deviceWith('front-left'),
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    };
    const jogToMachinePosition = vi.fn(async () => undefined);
    useLaserStore.setState({
      ...stockNativeEvidence(device),
      connection: { kind: 'connected' },
      streamer: null,
      motionOperation: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: null,
        wPos: null,
        feed: null,
        spindle: null,
        wco: null,
      },
      jogToMachinePosition,
    });
    dispatchPositionLaser({ x: 50, y: 30 }, device);
    expect(jogToMachinePosition).toHaveBeenCalledWith(
      50 - device.bedWidth,
      -30,
      positionLaserFeed(device.maxFeed),
    );
    useLaserStore.setState({ controllerBuildInfoObservation: null });
    dispatchPositionLaser({ x: 50, y: 30 }, device);
    expect(jogToMachinePosition).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts[0]?.message).toContain('mapping is unverified');
  });

  // GRBL homing trips the switch on the envelope's homing edge and rests $27
  // inside it so the switch does not trip again
  // (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L366-L384);
  // with $21=1 a move back onto that edge can close it and reset the
  // controller into ALARM:1 (grbl/limits.c#L110-L128). Front-left origin:
  // scene (999, -999) is the back-right bed corner, (-999, 999) the front-left.
  const W = DEFAULT_DEVICE_PROFILE.bedWidth;
  const H = DEFAULT_DEVICE_PROFILE.bedHeight;
  it.each([
    ['toward +X/+Y ($23=0), back-right click', 0, { x: 999, y: -999 }, { x: -2, y: -2 }],
    ['toward -X/-Y ($23=3), front-left click', 3, { x: -999, y: 999 }, { x: 2 - W, y: 2 - H }],
    ['toward +X/+Y ($23=0), far front-left click', 0, { x: -999, y: 999 }, { x: -W, y: -H }],
  ])('keeps the homing edge the pull-off clear of the switch: %s', (_name, mask, click, native) => {
    const device = {
      ...deviceWith('front-left'),
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    };
    const evidence = stockNativeEvidence(device, false, mask);
    const jogToMachinePosition = vi.fn(async () => undefined);
    useLaserStore.setState({
      ...evidence,
      controllerSettings: {
        ...evidence.controllerSettings,
        hardLimitsEnabled: true,
        homingPullOffMm: 2,
      },
      connection: { kind: 'connected' },
      streamer: null,
      motionOperation: null,
      statusReport: {
        state: 'Idle',
        subState: null,
        mPos: null,
        wPos: null,
        feed: null,
        spindle: null,
        wco: null,
      },
      jogToMachinePosition,
    });
    dispatchPositionLaser(click, device);
    expect(jogToMachinePosition).toHaveBeenCalledWith(
      native.x,
      native.y,
      positionLaserFeed(device.maxFeed),
    );
  });
});
