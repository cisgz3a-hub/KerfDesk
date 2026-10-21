// Audit 13-P1-1: what the Auto-focus button may send (ADR-400 Amendment 1).

import { describe, expect, it } from 'vitest';
import {
  autofocusCommandIssue,
  normalizeAutofocusCommand,
  profileAutofocusIssue,
  type AutofocusController,
} from './autofocus-command';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from './falcon-profiles';
import { validateMachineProfile } from './profile-catalog';

const FALCON: AutofocusController = { kind: 'grblhal', commandSet: 'creality-falcon-a1-pro' };

describe('autofocusCommandIssue', () => {
  it.each([
    ['', { kind: 'grbl-v1.1' }],
    ['$HZ1', FALCON],
    ['$HZ', { kind: 'fluidnc' }],
    ['$ HZ 1', { kind: 'grbl-v1.1', commandSet: 'creality-falcon-a1-pro' }],
    ['G38.2 Z-10 F100', { kind: 'grblhal' }],
    ['G38.3Z-5', { kind: 'grbl-v1.1' }],
    ['G30', { kind: 'marlin' }],
    ['G30 Z1.5', { kind: 'smoothieware' }],
  ] as const)('accepts the focus form %j on %o', (command, controller) => {
    expect(autofocusCommandIssue(command, controller)).toBeNull();
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
    ['M500', /cannot send an M-code/],
    ['M84', /cannot send an M-code/],
    ['M17', /cannot send an M-code/],
    ['M2001', /cannot send an M-code/],
    ['M800 P1 S0', /cannot send an M-code/],
    ['M72', /cannot send an M-code/],
    ['$H', /accepts one focus command/],
    ['$X', /accepts one focus command/],
    ['$SD/Run=job.nc', /cannot write controller settings/],
    ['G38.2 F100', /needs a Z target/],
    ['G92 Z0', /accepts one focus command/],
    ['$HZ1 (focus)', /accepts one focus command/],
    ['M2001 Z5', /cannot send an M-code/],
    ['G38.2 Z-5 M3', /accepts one focus command/],
    ['switch focus on', /accepts one focus command/],
    [`M2001 P${'1'.repeat(120)}`, /at most 100 characters/],
  ])('refuses %j', (command, reason) => {
    expect(autofocusCommandIssue(command, FALCON)).toMatch(reason);
  });

  it('applies the controller rules only when the controller is known', () => {
    // Stock GRBL starts homing on `$H`, then refuses the suffix and stays
    // stuck (grbl-sim-lines.ts refuseHomeSuffix); Codex review on #1352.
    expect(autofocusCommandIssue('$HZ1', { kind: 'grbl-v1.1' })).toMatch(/stuck until a reset/);
    expect(autofocusCommandIssue('$HZ', { kind: 'grbl-v1.1' })).toMatch(/stuck until a reset/);
    expect(autofocusCommandIssue('$HZ1', { kind: 'grblhal' })).toMatch(/Falcon A1 Pro's/);
    expect(autofocusCommandIssue('$HZ', { kind: 'grblhal' })).toBeNull();
    expect(autofocusCommandIssue('$HZ1', { kind: 'smoothieware' })).toMatch(/GRBL-family/);
    expect(autofocusCommandIssue('$HZ1', { kind: 'marlin' })).toMatch(/GRBL-family/);
    expect(autofocusCommandIssue('G30', { kind: 'grblhal' })).toMatch(/stored position/);
    expect(autofocusCommandIssue('$HZ1')).toBeNull();
    expect(autofocusCommandIssue('G30')).toBeNull();
  });
});

describe('profileAutofocusIssue', () => {
  it('checks a profile without a controller kind as the stock GRBL it connects with', () => {
    expect(profileAutofocusIssue({ autofocusCommand: '$HZ1' })).toMatch(/stuck until a reset/);
    expect(
      profileAutofocusIssue({
        autofocusCommand: '$HZ1',
        controllerCommandSet: 'creality-falcon-a1-pro',
      }),
    ).toBeNull();
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
