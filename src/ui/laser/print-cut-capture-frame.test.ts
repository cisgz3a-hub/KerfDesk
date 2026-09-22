import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords, type Origin } from '../../core/devices';
import { capturedMachinePointToScene as captureWithFrame } from './print-cut-capture-frame';
import { machineBoundsForDevice } from '../../core/devices/machine-bounds';
import { nativeBedFrame } from '../../core/devices/native-bed-frame';

// These original round-trip cases explicitly model a controller whose native
// envelope matches the profile bed. Separate regressions cover negative GRBL.
function capturedMachinePointToScene(
  reported: Parameters<typeof captureWithFrame>[0],
  device: Parameters<typeof captureWithFrame>[1],
  inches: boolean,
) {
  return captureWithFrame(
    reported,
    device,
    inches,
    nativeBedFrame(device, machineBoundsForDevice(device)),
  );
}

const ORIGINS: readonly Origin[] = [
  'rear-left',
  'front-left',
  'front-right',
  'rear-right',
  'center',
];

function deviceAt(origin: Origin) {
  return { ...DEFAULT_DEVICE_PROFILE, origin, bedWidth: 400, bedHeight: 300 };
}

describe('capturedMachinePointToScene', () => {
  it('maps negative native GRBL marks through the bed before solving registration', () => {
    const device = deviceAt('front-left');
    const frame = nativeBedFrame(device, { minX: -400, minY: -300, maxX: 0, maxY: 0 });
    expect(captureWithFrame({ x: -350, y: -270, z: 0 }, device, false, frame)).toEqual({
      x: 50,
      y: 270,
    });
    expect(
      captureWithFrame({ x: -350 / 25.4, y: -270 / 25.4, z: 0 }, device, true, frame)?.x,
    ).toBeCloseTo(50);
    expect(captureWithFrame({ x: -350, y: -270, z: NaN }, device, false, frame)).toBeNull();
  });
  it.each(ORIGINS)('retains controller-relative registration without homing on %s', (origin) => {
    const device = deviceAt(origin);
    const native = { x: -350, y: -270, z: 0 };
    const scene = captureWithFrame(native, device, false, null);
    expect(scene).not.toBeNull();
    expect(toMachineCoords(scene!, device)).toEqual({ x: native.x, y: native.y });
  });
  // The round trip is the whole contract: the compile path emits
  // toMachineCoords(scenePoint), so jogging to that emitted position and
  // capturing it must recover the scene point on EVERY origin. Before the fix
  // the raw report was stored, which only round-trips on 'rear-left'.
  it.each(ORIGINS)('round-trips a scene point through the machine frame on %s', (origin) => {
    const device = deviceAt(origin);
    const scene = { x: 120, y: 80 };
    const machine = toMachineCoords(scene, device);

    const recovered = capturedMachinePointToScene(
      { x: machine.x, y: machine.y, z: 0 },
      device,
      false,
    );

    expect(recovered?.x).toBeCloseTo(scene.x, 9);
    expect(recovered?.y).toBeCloseTo(scene.y, 9);
  });

  it('mirrors Y on front-left, where the raw report was wrong by bedHeight - 2y', () => {
    const device = deviceAt('front-left');

    const recovered = capturedMachinePointToScene({ x: 120, y: 80, z: 0 }, device, false);

    // Raw capture would have stored y = 80; the scene frame is Y-down.
    expect(recovered).toEqual({ x: 120, y: 220 });
  });

  it('converts an inch-reporting controller before mapping', () => {
    const device = deviceAt('rear-left');

    const recovered = capturedMachinePointToScene({ x: 1, y: 2, z: 0 }, device, true);

    expect(recovered?.x).toBeCloseTo(25.4, 9);
    expect(recovered?.y).toBeCloseTo(50.8, 9);
  });

  it('returns null for a non-finite report rather than poisoning the solver', () => {
    const device = deviceAt('rear-left');

    expect(capturedMachinePointToScene({ x: Number.NaN, y: 10, z: 0 }, device, false)).toBeNull();
    expect(
      capturedMachinePointToScene({ x: 10, y: Number.POSITIVE_INFINITY, z: 0 }, device, false),
    ).toBeNull();
  });
});
