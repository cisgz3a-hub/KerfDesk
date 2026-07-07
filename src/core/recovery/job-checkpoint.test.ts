import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createStreamer } from '../controllers/grbl';
import {
  JOB_CHECKPOINT_SCHEMA_VERSION,
  advanceJobCheckpoint,
  countSendableLines,
  createJobCheckpoint,
  fingerprintGcode,
  fingerprintsEqual,
  markResumeInFlight,
  parseJobCheckpoint,
  rawResumeLine,
  serializeJobCheckpoint,
} from './job-checkpoint';

// Shaped like real emitted G-code: comments and blanks interleaved, so raw
// line numbers (1-based) diverge from sendable numbering. Sendable lines are
// raw 1, 2, 5, 7, 8 — five of nine raw lines.
const GCODE = [
  'G21', // raw 1, sendable 1
  'G90', // raw 2, sendable 2
  '; layer L1 color #ff0000 power 60%', // raw 3
  '; pass 1 of 1', // raw 4
  'G0 X10.000 Y10.000 S0', // raw 5, sendable 3
  '', // raw 6
  'G1 X30.000 Y10.000 F1200 S600', // raw 7, sendable 4
  'M5', // raw 8, sendable 5
  '', // raw 9
].join('\n');
const NOW = '2026-07-07T03:00:00.000Z';
const LATER = '2026-07-07T04:00:00.000Z';

function checkpoint(): ReturnType<typeof createJobCheckpoint> {
  return createJobCheckpoint({ gcode: GCODE, machineKind: 'laser', nowIso: NOW });
}

describe('fingerprintGcode', () => {
  it('is deterministic and sensitive to single-character changes', () => {
    const a = fingerprintGcode(GCODE);
    expect(fingerprintGcode(GCODE)).toEqual(a);
    const b = fingerprintGcode(GCODE.replace('S600', 'S601'));
    expect(fingerprintsEqual(a, b)).toBe(false);
    expect(b.chars).toBe(a.chars);
  });

  it('counts chars and raw newline-split lines', () => {
    const fp = fingerprintGcode(GCODE);
    expect(fp.chars).toBe(GCODE.length);
    expect(fp.lines).toBe(9);
  });

  it('hashes any string to an unsigned 32-bit integer (100 seeds)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const fp = fingerprintGcode(s);
        return Number.isInteger(fp.fnv1a) && fp.fnv1a >= 0 && fp.fnv1a <= 0xffffffff;
      }),
      { numRuns: 100 },
    );
  });
});

describe('sendable-line accounting', () => {
  it('counts exactly what the streamer streams', () => {
    expect(countSendableLines(GCODE)).toBe(5);
    expect(createStreamer(GCODE).total).toBe(5);
    expect(checkpoint().sendableLines).toBe(5);
  });

  it('agrees with the streamer on arbitrary comment/blank layouts (100 seeds)', () => {
    const arbLine = fc.oneof(
      fc.constant('G1 X1 S100'),
      fc.constant('; comment'),
      fc.constant(''),
      fc.constant('   '),
      fc.constant('M5'),
    );
    fc.assert(
      fc.property(fc.array(arbLine, { maxLength: 30 }), (lines) => {
        const gcode = lines.join('\n');
        return countSendableLines(gcode) === createStreamer(gcode).total;
      }),
      { numRuns: 100 },
    );
  });
});

describe('rawResumeLine', () => {
  it('maps an acked-sendable count to the raw line of the first un-acked sendable line', () => {
    // 0 acked → first sendable line, raw 1. 2 acked (G21, G90) → next
    // sendable is raw 5 (the G0), skipping the two comments.
    expect(rawResumeLine(GCODE, 0)).toBe(1);
    expect(rawResumeLine(GCODE, 2)).toBe(5);
    expect(rawResumeLine(GCODE, 3)).toBe(7);
    expect(rawResumeLine(GCODE, 4)).toBe(8);
  });

  it('clamps to the last sendable raw line when everything acked', () => {
    expect(rawResumeLine(GCODE, 5)).toBe(8);
    expect(rawResumeLine(GCODE, 999)).toBe(8);
  });

  it('falls back to 1 for a program with no sendable lines', () => {
    expect(rawResumeLine('; only\n\n; comments', 0)).toBe(1);
  });
});

describe('advanceJobCheckpoint', () => {
  it('advances monotonically and stamps the update time', () => {
    const advanced = advanceJobCheckpoint(checkpoint(), 3, LATER);
    expect(advanced.ackedLines).toBe(3);
    expect(advanced.updatedAtIso).toBe(LATER);
    expect(advanceJobCheckpoint(advanced, 2, LATER)).toBe(advanced);
    expect(advanceJobCheckpoint(advanced, 3, LATER)).toBe(advanced);
  });

  it('clamps to the sendable count and floors fractions', () => {
    const cp = checkpoint();
    expect(advanceJobCheckpoint(cp, 999, LATER).ackedLines).toBe(cp.sendableLines);
    expect(advanceJobCheckpoint(cp, 2.9, LATER).ackedLines).toBe(2);
  });
});

describe('markResumeInFlight', () => {
  it('sets the flag once and is idempotent', () => {
    const marked = markResumeInFlight(checkpoint(), LATER);
    expect(marked.resumeInFlight).toBe(true);
    expect(marked.updatedAtIso).toBe(LATER);
    expect(markResumeInFlight(marked, '2026-07-07T05:00:00.000Z')).toBe(marked);
  });
});

describe('serialize / parse round-trip', () => {
  it('round-trips a valid checkpoint', () => {
    const cp = markResumeInFlight(advanceJobCheckpoint(checkpoint(), 2, LATER), LATER);
    expect(parseJobCheckpoint(serializeJobCheckpoint(cp))).toEqual(cp);
  });

  it('rejects malformed payloads', () => {
    const valid = JSON.parse(serializeJobCheckpoint(checkpoint())) as Record<string, unknown>;
    const cases: ReadonlyArray<string> = [
      'not json',
      'null',
      '[]',
      '42',
      JSON.stringify({ ...valid, schemaVersion: JOB_CHECKPOINT_SCHEMA_VERSION + 1 }),
      JSON.stringify({ ...valid, fingerprint: undefined }),
      JSON.stringify({ ...valid, fingerprint: { fnv1a: 1, chars: 1, lines: 0 } }),
      JSON.stringify({ ...valid, fingerprint: { fnv1a: 1.5, chars: 1, lines: 1 } }),
      JSON.stringify({ ...valid, sendableLines: 999 }),
      JSON.stringify({ ...valid, sendableLines: -1 }),
      JSON.stringify({ ...valid, ackedLines: -1 }),
      JSON.stringify({ ...valid, ackedLines: 6 }),
      JSON.stringify({ ...valid, ackedLines: 1.5 }),
      JSON.stringify({ ...valid, resumeInFlight: 'yes' }),
      JSON.stringify({ ...valid, machineKind: 'toaster' }),
      JSON.stringify({ ...valid, startedAtIso: 5 }),
      JSON.stringify({ ...valid, updatedAtIso: null }),
    ];
    for (const raw of cases) expect(parseJobCheckpoint(raw)).toBeNull();
  });
});
