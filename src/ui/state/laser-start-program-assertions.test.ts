import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROGRAM_MESSAGE,
  assertCncSetupAttested,
  assertGcodeFitsController,
  assertProgramHasSendableLine,
  assertStartControllerEvidence,
} from './laser-start-program-assertions';

// These four leaf checks were previously private to laser-job-actions.ts and
// only reachable through a full startJob run. Extracting them made them
// directly testable; this pins the throw/pass boundary of each.
describe('laser start program assertions', () => {
  describe('assertProgramHasSendableLine', () => {
    it('accepts a program with at least one sendable line', () => {
      expect(() => assertProgramHasSendableLine('; header\nG21\nG0 X1')).not.toThrow();
    });

    it('rejects a program that is only comments and blanks', () => {
      expect(() => assertProgramHasSendableLine('; header\n\n; done\n')).toThrow(
        EMPTY_PROGRAM_MESSAGE,
      );
    });

    it('rejects an empty program', () => {
      expect(() => assertProgramHasSendableLine('')).toThrow(EMPTY_PROGRAM_MESSAGE);
    });
  });

  describe('assertGcodeFitsController', () => {
    it('accepts ordinary lines', () => {
      expect(() => assertGcodeFitsController('G1 X10.000 Y10.000 F1000 S500', {})).not.toThrow();
    });

    it('rejects a line longer than the controller RX buffer and names the line number', () => {
      const oversized = `G1 ${'X1.000 '.repeat(60)}`;
      expect(() => assertGcodeFitsController(`G21\n${oversized}`, {})).toThrow(/G-code line 2/);
    });
  });

  describe('assertCncSetupAttested', () => {
    const epoch = { trustedPosition: 0, workZReference: 0 };

    it('does not apply to laser output', () => {
      expect(() => assertCncSetupAttested('G0 X1', { machineKind: 'laser' }, epoch)).not.toThrow();
    });

    it('rejects a CNC program with no attestation', () => {
      expect(() => assertCncSetupAttested('G0 X1', { machineKind: 'cnc' }, epoch)).toThrow();
    });
  });

  describe('assertStartControllerEvidence', () => {
    it('does not apply to CNC output, which carries its own attestation', () => {
      expect(() => assertStartControllerEvidence('cnc', {}, 'G0 X1')).not.toThrow();
    });

    it('rejects laser output with no reviewed mode evidence', () => {
      expect(() => assertStartControllerEvidence('laser', {}, 'G0 X1')).toThrow();
    });
  });
});
