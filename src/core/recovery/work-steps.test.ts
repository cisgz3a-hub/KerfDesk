import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isSendableGcodeLine } from '../controllers/grbl';
import {
  countSendableLines,
  countSendableLinesSteps,
  createJobCheckpoint,
  createJobCheckpointSteps,
  fingerprintGcode,
  fingerprintGcodeSteps,
} from './job-checkpoint';
import { runWorkSteps, TEXT_STEP_CHARS, type WorkSteps } from './work-steps';
import { DEFAULT_OUTPUT_SCOPE } from '../scene';

// The single-pass definitions these steps replaced (ADR-337 Amendment 1), kept
// here as the oracle: the archive must hold the same numbers, not new ones.
function referenceFingerprint(gcode: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < gcode.length; i += 1) {
    hash ^= gcode.charCodeAt(i);
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return { fnv1a: hash, chars: gcode.length, lines: gcode.split('\n').length };
}

function referenceSendableLines(gcode: string): number {
  let count = 0;
  for (const line of gcode.split('\n')) if (isSendableGcodeLine(line)) count += 1;
  return count;
}

function checkpoints<T>(steps: WorkSteps<T>): { readonly value: T; readonly yields: number } {
  let yields = 0;
  for (;;) {
    const step = steps.next();
    if (step.done) return { value: step.value, yields };
    yields += 1;
  }
}

/** A program whose lines straddle every chunk boundary, with blanks, comments,
 * CR line ends and non-ASCII text. */
function largeProgram(lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i += 1) {
    if (i % 97 === 0) out.push('');
    else if (i % 89 === 0) out.push('  ; comment café ✓ 😀');
    else if (i % 83 === 0) out.push(`G1 X${i % 300}.125 Y${i % 211}.5\r`);
    else out.push(`G1 X${(i * 0.37) % 300} Y${(i * 0.11) % 200} S${i % 1000}`);
  }
  return out.join('\n');
}

describe('program text steps', () => {
  const program = largeProgram(60_000);

  it('fingerprint the program exactly as the single pass did, across chunk boundaries', () => {
    expect(program.length).toBeGreaterThan(8 * TEXT_STEP_CHARS);
    const { value, yields } = checkpoints(fingerprintGcodeSteps(program));
    expect(value).toEqual(referenceFingerprint(program));
    expect(fingerprintGcode(program)).toEqual(value);
    expect(yields).toBe(Math.ceil(program.length / TEXT_STEP_CHARS) - 1);
  });

  it('count sendable lines exactly as the split did, with a checkpoint per chunk of text', () => {
    const { value, yields } = checkpoints(countSendableLinesSteps(program));
    expect(value).toBe(referenceSendableLines(program));
    expect(countSendableLines(program)).toBe(value);
    expect(yields).toBeGreaterThanOrEqual(Math.floor(program.length / TEXT_STEP_CHARS) - 1);
  });

  it.each(['', '\n', 'G1 X1', 'G1 X1\n', '\n\n;c\n  \nG0\n', '\r\n\r\n'])(
    'match the single pass on %j',
    (gcode) => {
      expect(fingerprintGcode(gcode)).toEqual(referenceFingerprint(gcode));
      expect(countSendableLines(gcode)).toBe(referenceSendableLines(gcode));
    },
  );

  it('match the single pass on arbitrary text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 400 }), (gcode) => {
        expect(fingerprintGcode(gcode)).toEqual(referenceFingerprint(gcode));
        expect(countSendableLines(gcode)).toBe(referenceSendableLines(gcode));
      }),
    );
  });

  it('build the same checkpoint in steps as in one call', () => {
    const args = {
      gcode: program,
      machineKind: 'laser' as const,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: '2026-11-04T08:00:00.000Z',
    };
    const { value, yields } = checkpoints(createJobCheckpointSteps(args));
    expect(yields).toBeGreaterThan(0);
    expect(value).toEqual(createJobCheckpoint(args));
    expect(runWorkSteps(createJobCheckpointSteps(args))).toEqual(value);
    expect(value.fingerprint).toEqual(referenceFingerprint(program));
    expect(value.sendableLines).toBe(referenceSendableLines(program));
  });
});
