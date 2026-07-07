// Pins the operator-facing copy for the GRBL error codes whose semantics the
// 2026-07-07 controller audit (F4) found garbled, against the official
// gnea/grbl error_codes_en_US.csv wording:
//   5  "Setting disabled"    — Homing cycle failure ($H with $22=0).
//   10 "Homing not enabled"  — soft limits need homing enabled first.
//   17 "Setting disabled"    — laser mode requires PWM output (a $32=1 write
//                              REJECTED by the build; telling the user to
//                              "enable $32=1" was the action that just failed).
//   30                       — G53 allows G0 AND G1.

import { describe, expect, it } from 'vitest';
import { describeError } from './error-codes';

describe('GRBL error-code copy (audit F4)', () => {
  it('error 5 describes a refused homing cycle, not a settings write', () => {
    const e = describeError(5);
    expect(e?.detail).toMatch(/homing/i);
    expect(e?.detail).toMatch(/\$H|homing cycle/i);
    expect(e?.detail).not.toMatch(/this setting/i);
  });

  it('error 10 describes soft limits requiring homing', () => {
    const e = describeError(10);
    expect(e?.detail).toMatch(/soft limits/i);
    expect(e?.detail).toMatch(/homing/i);
  });

  it('error 17 does NOT tell the user to enable the $32 write that just failed', () => {
    const e = describeError(17);
    expect(e?.detail).toMatch(/PWM/i);
    // The old copy instructed "Enable $32=1 for laser mode" — the exact
    // action the controller just rejected. The fix states the build cannot.
    expect(e?.detail).not.toMatch(/enable \$32=1 for laser/i);
    expect(e?.detail).toMatch(/cannot/i);
  });

  it('error 30 names both allowed G53 motion modes', () => {
    const e = describeError(30);
    expect(e?.title).toMatch(/G0/);
    expect(e?.title).toMatch(/G1/);
  });
});
