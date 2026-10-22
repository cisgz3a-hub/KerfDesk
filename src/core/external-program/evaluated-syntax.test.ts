import { describe, expect, it } from 'vitest';
import type { ControllerKind } from '../devices';
import { externalProgramBaseline, normalizeExternalProgram } from './normalize-external-program';

// Controller audit v4 E4-P2-2 (ADR-630 Amendment 5): FluidNC works out `#`
// parameters, `[ ]` expressions and O-word flow control as it runs, and the
// Inspector reads none of them, so such a program is refused rather than
// framed along a path that does not run.

function refusal(text: string, kind: ControllerKind): ReadonlyArray<string> {
  const result = normalizeExternalProgram(text, externalProgramBaseline(kind), kind);
  if (result.kind !== 'refused') throw new Error(`accepted: ${result.program.gcode}`);
  return result.reasons;
}

function sendsAs(text: string, kind: ControllerKind): string {
  const result = normalizeExternalProgram(text, externalProgramBaseline(kind), kind);
  if (result.kind !== 'ok') throw new Error(result.reasons.join('\n'));
  return result.program.gcode;
}

describe('FluidNC and grblHAL evaluated syntax (ADR-630 Amendment 5)', () => {
  it("refuses the audit's FluidNC program, whose Frame stopped at X10 while it ran to X120", () => {
    const reasons = refusal('G1 X10 F1000\n#1 = 120\nG1 X#1\n', 'fluidnc');
    expect(reasons).toEqual([
      'Line 2 (#1=120) uses a # parameter, which FluidNC works out as the program runs. KerfDesk cannot work it out, so the Frame would not trace the path that runs. Save the program with plain numbers.',
      'Line 3 (G1X#1) uses a # parameter, which FluidNC works out as the program runs. KerfDesk cannot work it out, so the Frame would not trace the path that runs. Save the program with plain numbers.',
    ]);
  });

  it.each([
    ['G1 X#<width>', 'a # parameter'],
    ['G1 X##2', 'a # parameter'],
    ['#<width> = [100 + 20]', 'a # parameter'],
    ['G1 X[10 + 110]', 'a [ ] expression'],
    ['G1 X[COS[0] * 120]', 'a [ ] expression'],
    ['O100 if [1 GT 0]', 'a [ ] expression'],
    ['o100 else', 'O-word flow control'],
    ['O100 endif', 'O-word flow control'],
    ['N5 O<loop> endwhile', 'O-word flow control'],
  ])('refuses %j on FluidNC as %s', (line, syntax) => {
    const [reason] = refusal(`G0 X0\n${line}\n`, 'fluidnc');
    expect(reason).toMatch(/^Line 2 \(/);
    expect(reason).toContain(`uses ${syntax}, which FluidNC works out as the program runs`);
  });

  it('names an expression that holds a * as an expression, not a checksum', () => {
    const [reason] = refusal('G0 X0\nG1 X[5*2] F600\n', 'fluidnc');
    expect(reason).toContain('uses a [ ] expression');
    expect(reason).not.toContain('checksum');
  });

  it('says grblHAL either works it out or stops with an error, depending on its build', () => {
    const [reason] = refusal('G1 X10 F1000\nG1 X[10+110]\n', 'grblhal');
    expect(reason).toContain(
      'which grblHAL works out as the program runs in builds with expressions, and answers with an error in others',
    );
  });

  it('reads only what is sent: a commented # or [ ] does not refuse', () => {
    expect(sendsAs('G1 X10 F600 (PRINT, #1 [mm])\n; #2 = [3]\n', 'fluidnc')).toBe(
      `${externalProgramBaseline('fluidnc')}\nG1X10F600\n`,
    );
  });

  it('keeps a lone O program number, which runs no flow control', () => {
    expect(sendsAs('O1001\nG1 X10 F600\n', 'fluidnc')).toContain('O1001\nG1X10F600\n');
  });

  it("keeps FluidNC's bracket controller command its own refusal", () => {
    const [reason] = refusal('G0 X0\n[ESP800]\n', 'fluidnc');
    expect(reason).toContain('a bracket controller command');
  });

  // Stock GRBL rejects such a line, which the Run review already names
  // (grbl-block-rejection.ts); Marlin and Smoothieware have no such syntax.
  it.each(['grbl-v1.1', 'marlin', 'smoothieware'] as const)(
    'leaves %s to its own review',
    (kind) => {
      expect(sendsAs('G1 X10 F1000\n#1 = 120\nG1 X#1\n', kind)).toContain('#1');
    },
  );

  it('still calls a stock GRBL line with a * a checksum', () => {
    const [reason] = refusal('G0 X0\nG1 X[5*2]\n', 'grbl-v1.1');
    expect(reason).toContain('carries a checksum (*)');
  });
});
