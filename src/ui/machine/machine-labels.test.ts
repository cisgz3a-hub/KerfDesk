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

  it('names CNC mode "CNC", as the Laser / CNC switch does', () => {
    expect(machineNoun('cnc')).toBe('CNC');
    expect(machineDisplayName('cnc')).toBe('CNC');
    expect(machineControlsLabel('cnc')).toBe('CNC controls');
    expect(jobTimeNoun('cnc')).toBe('cut');
  });
});
