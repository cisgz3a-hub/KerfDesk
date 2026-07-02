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

describe('parseStatusReport — Pn pins (ADR-053 P3)', () => {
  it('decodes limit-switch letters from the Pn field', () => {
    const r = parseStatusReport('<Alarm|MPos:0.000,0.000,0.000|FS:0,0|Pn:XY>');
    expect(r?.pins).toEqual({
      limitX: true,
      limitY: true,
      limitZ: false,
      probe: false,
      door: false,
    });
  });

  it('decodes a single Z limit', () => {
    expect(parseStatusReport('<Alarm|MPos:0.000,0.000,0.000|FS:0,0|Pn:Z>')?.pins?.limitZ).toBe(
      true,
    );
  });

  it('decodes probe and door without flagging limits', () => {
    const pins = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Pn:PD>')?.pins;
    expect(pins?.probe).toBe(true);
    expect(pins?.door).toBe(true);
    expect(pins?.limitX).toBe(false);
  });

  it('returns pins=null when GRBL omits the Pn field (nothing triggered)', () => {
    expect(parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>')?.pins).toBeNull();
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

describe('parseStatusReport Ov overrides (ADR-102 G3)', () => {
  it('parses Ov feed/rapid/spindle percentages', () => {
    const r = parseStatusReport('<Run|MPos:1.000,2.000,3.000|FS:1500,8000|Ov:110,50,90>');
    expect(r?.ov).toEqual({ feed: 110, rapid: 50, spindle: 90 });
  });

  it('reports null ov when the field is absent (intermittent cadence)', () => {
    const r = parseStatusReport('<Run|MPos:1.000,2.000,3.000|FS:1500,8000>');
    expect(r?.ov).toBeNull();
  });

  it('reports null ov for a malformed field', () => {
    const r = parseStatusReport('<Run|MPos:1.000,2.000,3.000|Ov:110,x,90>');
    expect(r?.ov).toBeNull();
  });
});
