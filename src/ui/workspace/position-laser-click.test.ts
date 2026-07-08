import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from '../../core/devices';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
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
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('refuses with a toast when the machine is not connected', () => {
    const jog = vi.fn();
    useLaserStore.setState({ connection: { kind: 'disconnected' }, jog });
    dispatchPositionLaser({ x: 10, y: 10 }, DEFAULT_DEVICE_PROFILE);
    expect(jog).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts[0]?.message).toContain('Connect the machine');
  });

  it('sends one absolute jog to the mapped machine point when ready', () => {
    const jog = vi.fn(async () => undefined);
    useLaserStore.setState({
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
      jog,
    });
    const device = deviceWith('rear-left'); // identity origin transform
    dispatchPositionLaser({ x: 12.5, y: 40 }, device);
    expect(jog).toHaveBeenCalledTimes(1);
    expect(jog).toHaveBeenCalledWith({
      dx: 12.5,
      dy: 40,
      feed: positionLaserFeed(device.maxFeed),
      relative: false,
    });
  });
});
