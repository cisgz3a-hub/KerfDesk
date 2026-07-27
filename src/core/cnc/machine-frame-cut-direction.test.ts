import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from '../devices';
import { DEFAULT_CNC_LAYER_SETTINGS } from '../scene';
import {
  machineFrameCutDirection,
  machineFrameMatchesTopView,
  withMachineFrameCutDirection,
} from './machine-frame-cut-direction';

function deviceWith(origin: Origin): DeviceProfile {
  return { ...DEFAULT_DEVICE_PROFILE, origin };
}

// Right-handed in the top view: a shoelace-positive machine loop really is
// counter-clockwise as the operator sees it. Left-handed corners are the two
// that mirror exactly one axis relative to the physical frame.
const RIGHT_HANDED: ReadonlyArray<Origin> = ['front-left', 'rear-right', 'center'];
const LEFT_HANDED: ReadonlyArray<Origin> = ['front-right', 'rear-left'];

describe('machineFrameMatchesTopView', () => {
  it.each(RIGHT_HANDED)('is true for a %s origin', (origin) => {
    expect(machineFrameMatchesTopView(deviceWith(origin))).toBe(true);
  });

  it.each(LEFT_HANDED)('is false for a %s origin', (origin) => {
    expect(machineFrameMatchesTopView(deviceWith(origin))).toBe(false);
  });

  it('does not depend on bed size', () => {
    const wide: DeviceProfile = { ...deviceWith('rear-left'), bedWidth: 1200, bedHeight: 40 };
    expect(machineFrameMatchesTopView(wide)).toBe(false);
  });
});

describe('machineFrameCutDirection', () => {
  it.each(RIGHT_HANDED)('passes both directions through on a %s origin', (origin) => {
    expect(machineFrameCutDirection('climb', deviceWith(origin))).toBe('climb');
    expect(machineFrameCutDirection('conventional', deviceWith(origin))).toBe('conventional');
  });

  it.each(LEFT_HANDED)('mirrors both directions on a %s origin', (origin) => {
    expect(machineFrameCutDirection('climb', deviceWith(origin))).toBe('conventional');
    expect(machineFrameCutDirection('conventional', deviceWith(origin))).toBe('climb');
  });
});

describe('withMachineFrameCutDirection', () => {
  it('leaves an absent direction absent so natural winding still applies', () => {
    const { cutDirection: _dropped, ...noDirection } = DEFAULT_CNC_LAYER_SETTINGS;
    const out = withMachineFrameCutDirection(noDirection, deviceWith('rear-left'));
    expect(out.cutDirection).toBeUndefined();
    expect(out).toBe(noDirection);
  });

  it('mirrors the climb default on a left-handed origin and keeps every other field', () => {
    const out = withMachineFrameCutDirection(DEFAULT_CNC_LAYER_SETTINGS, deviceWith('rear-left'));
    expect(out.cutDirection).toBe('conventional');
    expect({ ...out, cutDirection: 'climb' }).toEqual(DEFAULT_CNC_LAYER_SETTINGS);
  });

  it('returns the climb default untouched on a right-handed origin', () => {
    expect(withMachineFrameCutDirection(DEFAULT_CNC_LAYER_SETTINGS, deviceWith('front-left'))).toBe(
      DEFAULT_CNC_LAYER_SETTINGS,
    );
  });
});
