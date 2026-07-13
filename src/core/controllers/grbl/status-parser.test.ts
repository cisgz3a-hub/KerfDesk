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

  // Audit F7: Smoothieware's grbl-mode report uses `F:<feed>,<override%>`
  // (per the Smoothieware docs; not hardware-verified) — the second
  // component is the FEED OVERRIDE, not spindle. Only `FS:` carries a
  // spindle value; reading F:'s second component as spindle showed "S: 100"
  // on the live readout regardless of beam state.
  it('never reads spindle from a 2-component F: field (Smoothie feed,override)', () => {
    const r = parseStatusReport(
      '<Idle|MPos:0.000,0.000,0.000|WPos:0.000,0.000,0.000|F:4000.0,100.0>',
    );
    expect(r?.feed).toBe(4000);
    expect(r?.spindle).toBeNull();
  });

  it('parses Hold:0 substate', () => {
    const r = parseStatusReport('<Hold:0|MPos:1.000,2.000,0.000|FS:0,0>');
    expect(r?.state).toBe('Hold');
    expect(r?.subState).toBe(0);
  });

  // grblHAL reports `Tool` during an M6 tool change; vanilla GRBL never
  // does. Unrecognized states drop the whole report (audit F11).
  it('parses the grblHAL Tool state', () => {
    const r = parseStatusReport('<Tool|MPos:1.000,2.000,0.000|FS:0,0>');
    expect(r?.state).toBe('Tool');
  });

  it('parses Door:1 substate', () => {
    const r = parseStatusReport('<Door:1|WPos:0.000,0.000,0.000|FS:0,0>');
    expect(r?.state).toBe('Door');
    expect(r?.subState).toBe(1);
  });

  it('does not parse numeric prefixes as substates', () => {
    const r = parseStatusReport('<Hold:1x|MPos:1.000,2.000,0.000|FS:0,0>');
    expect(r?.state).toBe('Hold');
    expect(r?.subState).toBeNull();
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

describe('parseStatusReport Ov overrides (ADR-103 G3)', () => {
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

describe('parseStatusReport A accessories (ADR-179)', () => {
  it('decodes clockwise spindle, flood, and mist in any field-letter order', () => {
    const r = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,8000|Ov:100,100,100|A:MFS>');
    expect(r?.accessories).toEqual({
      spindleCw: true,
      spindleCcw: false,
      flood: true,
      mist: true,
    });
  });

  it('decodes counter-clockwise spindle without inferring clockwise', () => {
    const r = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,8000|Ov:100,100,100|A:C>');
    expect(r?.accessories).toEqual({
      spindleCw: false,
      spindleCcw: true,
      flood: false,
      mist: false,
    });
  });

  it('treats an Ov frame without A as a known all-off accessory observation', () => {
    const r = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>');
    expect(r?.accessories).toEqual({
      spindleCw: false,
      spindleCcw: false,
      flood: false,
      mist: false,
    });
  });

  it('keeps accessory state unknown when both A and intermittent Ov are absent', () => {
    const r = parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    expect(r?.accessories).toBeNull();
  });

  it('detects grblHAL secondary-spindle telemetry outside the primary A field', () => {
    const r = parseStatusReport(
      '<Idle|MPos:0.000,0.000,0.000|FS:0,0|SP1:12000,,S,100|Ov:100,100,100>',
    );
    expect(r?.accessories).toMatchObject({
      spindleCw: false,
      spindleCcw: false,
      secondarySpindlePresent: true,
    });
  });

  it('decodes grblHAL spindle-encoder faults and pending tool changes', () => {
    const r = parseStatusReport('<Tool|MPos:0.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:ET>');
    expect(r?.accessories).toMatchObject({
      spindleEncoderFault: true,
      toolChangePending: true,
    });
  });
});
