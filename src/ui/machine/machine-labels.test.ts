import { describe, expect, it } from 'vitest';
import {
  jobTimeNoun,
  machineControlsLabel,
  machineDisplayName,
  machineNoun,
} from './machine-labels';

describe('machine-labels (ADR-101 §7)', () => {
  it('keeps laser copy byte-identical for laser projects', () => {
    expect(machineNoun('laser')).toBe('laser');
    expect(machineDisplayName('laser')).toBe('Laser');
    expect(machineControlsLabel('laser')).toBe('Laser controls');
    expect(jobTimeNoun('laser')).toBe('burn');
  });

  it('swaps to router copy in CNC mode', () => {
    expect(machineNoun('cnc')).toBe('router');
    expect(machineDisplayName('cnc')).toBe('Router');
    expect(machineControlsLabel('cnc')).toBe('Router controls');
    expect(jobTimeNoun('cnc')).toBe('cut');
  });
});
