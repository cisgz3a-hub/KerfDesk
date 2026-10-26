// Audit 13-P1-1 and controller audit v3 D2: what the Auto-focus button may
// send (ADR-400 Amendments 1 and 2).

import { describe, expect, it } from 'vitest';
import { DEFAULT_Z_PROBE_PARAMS } from '../controllers/grbl/probe';
import {
  autofocusCommandIssue,
  MAX_AUTOFOCUS_PROBE_FEED_MM_PER_MIN,
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
    ['G38.2Z-5F150', { kind: 'grbl-v1.1' }],
    ['G38.4 Z5 F25', { kind: 'grbl-v1.1' }],
    ['G38.2 Z-10 F100', { kind: 'marlin' }],
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
    ['G38.2 Z-10', /needs its own feed/],
    ['G38.4 Z5', /needs its own feed/],
    ['G38.2 Z-10 F100000', /at most 150 mm\/min/],
    ['G38.2 Z-10 F150.001', /at most 150 mm\/min/],
    ['G38.2 Z-10 F0', /above 0/],
    ['G38.3 Z-500 F100', /G38.3 and G38.5 stop without an error/],
    ['G38.5 Z5 F100', /G38.3 and G38.5 stop without an error/],
    ['G38.2 Z-10 F100 S0', /accepts one focus command/],
    ['G30', /not a focus command/],
    ['G30 Z1.5', /not a focus command/],
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
    expect(autofocusCommandIssue('$HZ1')).toBeNull();
  });

  it('refuses an F-less probe on every controller, since F is modal (D2-P3-3)', () => {
    // GRBL pushes the last state feed for a block without F (gcode.c:418-421),
    // so after a 6000 mm/min fill the probe would run at the $112 ceiling.
    for (const kind of ['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'] as const) {
      expect(autofocusCommandIssue('G38.2 Z-10', { kind })).toMatch(/needs its own feed/);
      expect(autofocusCommandIssue('G38.2 Z-10 F6000', { kind })).toMatch(/at most 150/);
    }
    expect(autofocusCommandIssue('G38.2 Z-10')).toMatch(/needs its own feed/);
  });

  it('refuses G30 on every controller, because none focuses with it (D2-P3-4)', () => {
    for (const kind of ['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'] as const) {
      expect(autofocusCommandIssue('G30', { kind })).toMatch(/not a focus command/);
    }
    expect(autofocusCommandIssue('G30')).toMatch(/not a focus command/);
  });

  it('caps the probe feed at the feed KerfDesk’s own probes first touch at', () => {
    expect(MAX_AUTOFOCUS_PROBE_FEED_MM_PER_MIN).toBe(DEFAULT_Z_PROBE_PARAMS.seekFeedMmPerMin);
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
    expect(normalizeAutofocusCommand('G38.2 Z-10')).toBe('');
    expect(normalizeAutofocusCommand('G30')).toBe('');
    expect(normalizeAutofocusCommand(42)).toBe('');
  });
});

describe('validateMachineProfile', () => {
  it('keeps the Falcon preset and refuses a burn as the Auto-focus command', () => {
    expect(validateMachineProfile(FALCON_A1_PRO_GRBLHAL_PROFILE)).toEqual([]);
    expect(
      validateMachineProfile({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, autofocusCommand: 'M3 S1000' }),
    ).toEqual([expect.stringMatching(/laser, spindle or air/)]);
    expect(
      validateMachineProfile({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, autofocusCommand: 'G38.2 Z-10' }),
    ).toEqual([expect.stringMatching(/needs its own feed/)]);
  });
});
