// Audit 13-P1-1: what the Auto-focus button may send (ADR-400 Amendment 1).

import { describe, expect, it } from 'vitest';
import { autofocusCommandIssue, normalizeAutofocusCommand } from './autofocus-command';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from './falcon-profiles';
import { validateMachineProfile } from './profile-catalog';

describe('autofocusCommandIssue', () => {
  it.each([
    ['', undefined],
    ['$HZ1', 'grblhal'],
    ['$HZ', 'fluidnc'],
    ['$ HZ 1', 'grbl-v1.1'],
    ['G38.2 Z-10 F100', 'grblhal'],
    ['G38.3Z-5', 'grbl-v1.1'],
    ['G30', 'marlin'],
    ['G30 Z1.5', 'smoothieware'],
    ['M2001', 'grbl-v1.1'],
    ['M800 P1 S0', 'marlin'],
  ] as const)('accepts the focus form %j on %s', (command, kind) => {
    expect(autofocusCommandIssue(command, kind)).toBeNull();
  });

  it.each([
    ['G1 X300 Y10 F100 S1000 M3', /cannot move the head/],
    ['G0 X400 Y400', /cannot move the head/],
    ['G1 Z-5 F100', /cannot move the head/],
    ['$J=G91 X10 F1000', /cannot move the head/],
    ['G38.2 X10 Z-5 F100', /cannot move the head/],
    ['M3 S1000', /laser, spindle or air/],
    ['M4', /laser, spindle or air/],
    ['M106 P1', /laser, spindle or air/],
    ['M64 P0', /laser, spindle or air/],
    ['M2001 S1000', /laser, spindle or air/],
    ['$32=0', /cannot write controller settings/],
    ['$Sta/SSID=x', /cannot write controller settings/],
    ['M500', /not a focus command/],
    ['M84', /not a focus command/],
    ['M72', /not a focus command/],
    ['$H', /accepts one focus command/],
    ['$X', /accepts one focus command/],
    ['$SD/Run=job.nc', /cannot write controller settings/],
    ['G38.2 F100', /needs a Z target/],
    ['G92 Z0', /accepts one focus command/],
    ['$HZ1 (focus)', /accepts one focus command/],
    ['M2001 Z5', /accepts one focus command/],
    ['G38.2 Z-5 M3', /accepts one focus command/],
    ['switch focus on', /accepts one focus command/],
    [`M2001 P${'1'.repeat(120)}`, /at most 100 characters/],
  ])('refuses %j', (command, reason) => {
    expect(autofocusCommandIssue(command, 'grblhal')).toMatch(reason);
  });

  it('applies the controller rules only when the controller is known', () => {
    expect(autofocusCommandIssue('$HZ1', 'smoothieware')).toMatch(/GRBL-family command/);
    expect(autofocusCommandIssue('$HZ1', 'marlin')).toMatch(/GRBL-family command/);
    expect(autofocusCommandIssue('G30', 'grblhal')).toMatch(/stored position/);
    expect(autofocusCommandIssue('$HZ1')).toBeNull();
    expect(autofocusCommandIssue('G30')).toBeNull();
  });
});

describe('normalizeAutofocusCommand', () => {
  it('keeps a focus command as written and clears anything else', () => {
    expect(normalizeAutofocusCommand('$HZ1')).toBe('$HZ1');
    expect(normalizeAutofocusCommand(' $HZ1 ')).toBe(' $HZ1 ');
    expect(normalizeAutofocusCommand('G1 X300 Y10 F100 S1000 M3')).toBe('');
    expect(normalizeAutofocusCommand(42)).toBe('');
  });
});

describe('validateMachineProfile', () => {
  it('keeps the Falcon preset and refuses a burn as the Auto-focus command', () => {
    expect(validateMachineProfile(FALCON_A1_PRO_GRBLHAL_PROFILE)).toEqual([]);
    expect(
      validateMachineProfile({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, autofocusCommand: 'M3 S1000' }),
    ).toEqual([expect.stringMatching(/laser, spindle or air/)]);
  });
});
