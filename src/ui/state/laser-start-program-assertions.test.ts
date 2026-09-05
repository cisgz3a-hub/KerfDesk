import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROGRAM_MESSAGE,
  assertActiveDriverAcceptsMachineKind,
  assertCncSetupAttested,
  assertGcodeFitsController,
  assertProgramHasSendableLine,
  assertStartControllerEvidence,
} from './laser-start-program-assertions';
import {
  fluidncDriver,
  grblDriver,
  marlinDriver,
  smoothiewareDriver,
} from '../../core/controllers';
import { ruidaDriver } from '../../core/controllers/ruida/driver';

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

    it('applies FluidNC executable payload limits independently of a larger RX window', () => {
      const accepted = `G1 X${'1'.repeat(123)}`;
      const rejected = `G1 X${'1'.repeat(124)}`;
      expect(accepted).toHaveLength(127);
      expect(rejected).toHaveLength(128);
      expect(() =>
        assertGcodeFitsController(accepted, { rxBufferBytes: 256 }, 'fluidnc'),
      ).not.toThrow();
      expect(() => assertGcodeFitsController(rejected, { rxBufferBytes: 256 }, 'fluidnc')).toThrow(
        /FluidNC accepts at most 127 bytes.*error:14/i,
      );
    });
  });

  describe('assertActiveDriverAcceptsMachineKind', () => {
    it('accepts CNC only on drivers that declare the GRBL-shaped CNC contract', () => {
      expect(() => assertActiveDriverAcceptsMachineKind('cnc', grblDriver)).not.toThrow();
      expect(() => assertActiveDriverAcceptsMachineKind('cnc', fluidncDriver)).not.toThrow();
      for (const driver of [marlinDriver, smoothiewareDriver, ruidaDriver]) {
        expect(() => assertActiveDriverAcceptsMachineKind('cnc', driver)).toThrow(
          /cannot accept LaserForge CNC jobs/i,
        );
      }
    });

    it('does not restrict laser jobs through the CNC capability check', () => {
      expect(() => assertActiveDriverAcceptsMachineKind('laser', marlinDriver)).not.toThrow();
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
