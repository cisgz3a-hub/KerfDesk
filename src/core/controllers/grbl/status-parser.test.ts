import { describe, expect, it } from 'vitest';
import { parseStatusReport } from './status-parser';

describe('parseStatusReport — happy paths', () => {
  it('parses <Idle|MPos:0.000,0.000,0.000|FS:0,0>', () => {
    const r = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(r?.state).toBe('Idle');
    expect(r?.subState).toBeNull();
    expect(r?.mPos).toEqual({ x: 0, y: 0, z: 0 });
    expect(r?.feed).toBe(0);
    expect(r?.spindle).toBe(0);
  });

  it('parses <Run|MPos:1.234,5.678,0.000|FS:1500,500>', () => {
    const r = parseStatusReport('<Run|MPos:1.234,5.678,0.000|FS:1500,500>');
    expect(r?.state).toBe('Run');
    expect(r?.mPos).toEqual({ x: 1.234, y: 5.678, z: 0 });
    expect(r?.feed).toBe(1500);
    expect(r?.spindle).toBe(500);
  });

  it('parses Hold:0 substate', () => {
    const r = parseStatusReport('<Hold:0|MPos:1.000,2.000,0.000|FS:0,0>');
    expect(r?.state).toBe('Hold');
    expect(r?.subState).toBe(0);
  });

  it('parses Door:1 substate', () => {
    const r = parseStatusReport('<Door:1|WPos:0.000,0.000,0.000|FS:0,0>');
    expect(r?.state).toBe('Door');
    expect(r?.subState).toBe(1);
  });

  it('parses WPos as an alternative to MPos', () => {
    const r = parseStatusReport('<Idle|WPos:10.000,20.000,0.000|FS:0,0>');
    expect(r?.mPos).toBeNull();
    expect(r?.wPos).toEqual({ x: 10, y: 20, z: 0 });
  });

  it('accepts trailing whitespace and surrounding noise lines', () => {
    expect(parseStatusReport('  <Idle|MPos:0.000,0.000,0.000|FS:0,0>  \r\n')?.state).toBe('Idle');
  });

  // GRBL 1.1 reports WCO (Work Coordinate Offset) on a cadence — every Nth
  // status frame, configurable via the WCO bit of `$10`. These three cases
  // cover the modes the parser needs to handle for Phase F.3 set-work-origin:
  // present + well-formed, absent (most frames), and malformed (don't crash
  // siblings).
  it('parses WCO when present in the status frame', () => {
    const r = parseStatusReport('<Idle|MPos:50.000,60.000,0.000|FS:0,0|WCO:10.000,20.000,0.000>');
    expect(r?.wco).toEqual({ x: 10, y: 20, z: 0 });
  });

  it('returns wco=null on status frames that omit the WCO field (typical case)', () => {
    const r = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(r?.wco).toBeNull();
    // Siblings still parsed.
    expect(r?.state).toBe('Idle');
    expect(r?.mPos).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('tolerates a malformed WCO field without losing other fields', () => {
    const r = parseStatusReport('<Idle|MPos:1.000,2.000,0.000|FS:0,0|WCO:not,a,number>');
    expect(r?.wco).toBeNull();
    expect(r?.mPos).toEqual({ x: 1, y: 2, z: 0 });
    expect(r?.feed).toBe(0);
  });
});

describe('parseStatusReport — degenerate inputs', () => {
  it('returns null for non-status lines', () => {
    expect(parseStatusReport('ok')).toBeNull();
    expect(parseStatusReport('error:5')).toBeNull();
    expect(parseStatusReport('[VER:1.1h.20190825:]')).toBeNull();
  });

  it('returns null for malformed reports', () => {
    expect(parseStatusReport('<>')).toBeNull();
    expect(parseStatusReport('<Idle')).toBeNull();
    expect(parseStatusReport('Idle|MPos:0,0,0>')).toBeNull();
  });

  it('returns null when the state token is not a known GRBL state', () => {
    expect(parseStatusReport('<Bogus|MPos:0.000,0.000,0.000|FS:0,0>')).toBeNull();
  });

  it('tolerates a missing FS field', () => {
    const r = parseStatusReport('<Idle|MPos:0.000,0.000,0.000>');
    expect(r?.feed).toBeNull();
    expect(r?.spindle).toBeNull();
  });

  it('tolerates a missing axis field', () => {
    const r = parseStatusReport('<Idle|FS:0,0>');
    expect(r?.mPos).toBeNull();
    expect(r?.wPos).toBeNull();
  });
});
