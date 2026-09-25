// Controller audit SM-6: reading Smoothieware's G28.6 homed-axes report
// (Endstops.cpp L1114-L1120 at edge 38e2cc08).

import { describe, expect, it } from 'vitest';
import { smoothiewareDriver } from './driver';
import { smoothieUnhomedReason, SMOOTHIE_HOMED_AXES_QUERY } from './home-verification';
import { classifySmoothieResponse } from './response';

describe('smoothieUnhomedReason', () => {
  it('confirms X and Y homed, whatever the other axes report', () => {
    expect(smoothieUnhomedReason(['X:1 Y:1'])).toBeNull();
    expect(smoothieUnhomedReason(['X:1 Y:1 Z:0'])).toBeNull();
  });

  it('names the axes that are not homed', () => {
    expect(smoothieUnhomedReason(['X:0 Y:0'])).toMatch(/^The controller reports X and Y not homed/);
    expect(smoothieUnhomedReason(['X:1 Y:0 Z:1'])).toMatch(/^The controller reports Y not homed/);
    expect(smoothieUnhomedReason(['Z:1'])).toMatch(/^The controller reports X and Y not homed/);
  });

  it('reads a bare ok as a board without homing switches', () => {
    expect(smoothieUnhomedReason([])).toMatch(/reports no homing switches \(G28\.6\)/);
  });

  it('is the driver Home verification, sent as G28.6', () => {
    expect(SMOOTHIE_HOMED_AXES_QUERY).toBe('G28.6');
    expect(smoothiewareDriver.homeVerification?.query).toBe('G28.6');
  });
});

describe('classifySmoothieResponse and the G28.6 report', () => {
  it('files the report as a message, not an unknown line', () => {
    expect(classifySmoothieResponse('X:1 Y:1 ')).toEqual({
      kind: 'message',
      tag: 'HOMED',
      body: 'X:1 Y:1',
    });
    expect(classifySmoothieResponse('X:0 Y:1 Z:0')).toMatchObject({ kind: 'message' });
  });

  it('leaves other text alone', () => {
    expect(classifySmoothieResponse('X:10.000 Y:2.000')).toMatchObject({ kind: 'unknown' });
    expect(classifySmoothieResponse('Smoothie')).toMatchObject({ kind: 'welcome' });
  });
});
