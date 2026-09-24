import { describe, expect, it } from 'vitest';
import {
  parseActiveWcsFromModalResponses,
  parseOwnedWorkOffsetReadback,
} from './work-offset-readback';

describe('owned GRBL work-offset readback', () => {
  it('selects the active modal WCS and its exact XYZ offset', () => {
    expect(
      parseOwnedWorkOffsetReadback(
        ['[GC:G0 G55 G17 G21 G90 G94 M5 M9 T0 F0 S0]'],
        ['[G54:1.000,2.000,3.000]', '[G55:4.000,5.000,-6.250]', '[G92:0.000,0.000,0.000]'],
      ),
    ).toEqual({
      ok: true,
      activeWcs: 'G55',
      offset: { x: 4, y: 5, z: -6.25 },
    });
  });

  it.each([
    { modal: [], offsets: ['[G54:0,0,0]'], reason: /one GC modal report/i },
    {
      modal: ['[GC:G0 G54 G17]', '[GC:G0 G54 G17]'],
      offsets: ['[G54:0,0,0]'],
      reason: /one GC modal report/i,
    },
    { modal: ['[GC:G0 G17 G21]'], offsets: ['[G54:0,0,0]'], reason: /active G54-G59/i },
    { modal: ['[GC:G0 G54 G17]'], offsets: [], reason: /one G54 offset report/i },
    {
      modal: ['[GC:G0 G54 G17]'],
      offsets: ['[G54:0,0,0]', '[G54:0,0,0]'],
      reason: /one G54 offset report/i,
    },
    ...['[G54:0,broken,0]', '[G54:1,2]', '[G54:1,2,]', '[G54:1,,3,4]', '[G54:1,2,3e2]'].map(
      (line) => ({
        modal: ['[GC:G0 G54 G17]'],
        offsets: [line],
        reason: /at least three finite coordinates/i,
      }),
    ),
  ])('fails closed on ambiguous or malformed readback', ({ modal, offsets, reason }) => {
    const result = parseOwnedWorkOffsetReadback(modal, offsets);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });

  // grblHAL (get_axis_values loops over system_n_axis()) and FluidNC
  // (report_util_axis_values loops over _numberAxis) print every configured
  // axis, so a rotary router reports four or more values per WCS.
  it.each([
    ['a 4-axis grblHAL/FluidNC router', '[G54:-120.000,-80.000,-42.500,0.000]'],
    ['a 6-axis build', '[G54:-120.000,-80.000,-42.500,0.000,15.000,-90.000]'],
    ['a grblHAL ROTATION_ENABLE build', '[G54:-120.000,-80.000,-42.500:30.00]'],
  ])('reads XYZ from %s', (_label, line) => {
    expect(
      parseOwnedWorkOffsetReadback(
        ['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]'],
        [line, '[G55:0.000,0.000,0.000,0.000]', '[G92:0.000,0.000,0.000,0.000]', '[TLO:0.000]'],
      ),
    ).toEqual({ ok: true, activeWcs: 'G54', offset: { x: -120, y: -80, z: -42.5 } });
  });
});

describe('parseActiveWcsFromModalResponses', () => {
  it('reads the active WCS from a lone GC modal report (no $# needed)', () => {
    expect(parseActiveWcsFromModalResponses(['[GC:G0 G55 G17 G21 G90 G94 M5 M9 T0 F0 S0]'])).toBe(
      'G55',
    );
  });

  it('reads G54 when that is the active frame', () => {
    expect(parseActiveWcsFromModalResponses(['ok', '[GC:G0 G54 G17 G21 G90]'])).toBe('G54');
  });

  it.each([
    { label: 'no GC report', lines: ['ok'] },
    { label: 'two GC reports', lines: ['[GC:G0 G54]', '[GC:G0 G55]'] },
    { label: 'no G54-G59 word', lines: ['[GC:G0 G17 G21 G90]'] },
    { label: 'two WCS words', lines: ['[GC:G0 G54 G55 G17]'] },
  ])('returns null on $label', ({ lines }) => {
    expect(parseActiveWcsFromModalResponses(lines)).toBeNull();
  });
});
