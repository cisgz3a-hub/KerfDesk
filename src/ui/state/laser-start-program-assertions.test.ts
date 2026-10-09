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

    it('refuses a later line the serial wire cannot carry before any byte is sent', () => {
      const program = `G21\n${'G1 X1\n'.repeat(500)}G1 X10 ; Ø5 mm\nM5`;
      expect(() => assertGcodeFitsController(program, {})).toThrow(
        /^G-code line 502: Not sent: the command contains "Ø".*Job not started\.$/,
      );
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

    // Controller audit S-3: the RX window was the only limit, so a line within
    // it but past the parser's line buffer started and then stopped the job on
    // error:11. Stock GRBL keeps 79 significant characters (protocol.h#L31-L32,
    // protocol.c#L141-L143); grblHAL keeps 256 (protocol.h#L35-L36).
    it("applies stock GRBL's 79 significant characters within a larger RX window", () => {
      const spaced = `G1 ${'X1 '.repeat(38)}; ${'c'.repeat(20)}`;
      const accepted = `G1 X${'1'.repeat(76)}`;
      const rejected = `G1 X${'1'.repeat(77)}`;
      expect(spaced.length).toBeGreaterThan(79);
      expect(() =>
        assertGcodeFitsController(`${spaced}\n${accepted}`, { rxBufferBytes: 1024 }, 'grbl-v1.1'),
      ).not.toThrow();
      expect(() =>
        assertGcodeFitsController(`G21\n${rejected}`, { rxBufferBytes: 1024 }, 'grbl-v1.1'),
      ).toThrow(/G-code line 2 has 80 significant characters.*at most 79.*error:11.*not started/);
    });

    it("applies grblHAL's 256 characters, spaces and comments included", () => {
      const accepted = `G1 X${'1'.repeat(252)}`;
      const commented = `G1 X1 ; ${'c'.repeat(250)}`;
      expect(accepted).toHaveLength(256);
      expect(() =>
        assertGcodeFitsController(accepted, { rxBufferBytes: 1024 }, 'grblhal'),
      ).not.toThrow();
      expect(() =>
        assertGcodeFitsController(commented, { rxBufferBytes: 1024 }, 'grbl-v1.1'),
      ).not.toThrow();
      expect(() =>
        assertGcodeFitsController(commented, { rxBufferBytes: 1024 }, 'grblhal'),
      ).toThrow(/G-code line 1 has 258 characters.*grblHAL accepts at most 256.*error:11/);
    });

    it('leaves the parser limit alone for firmwares it does not describe', () => {
      const long = `G1 X${'1'.repeat(200)}`;
      for (const kind of [undefined, 'marlin', 'smoothieware'] as const) {
        expect(() => assertGcodeFitsController(long, { rxBufferBytes: 1024 }, kind)).not.toThrow();
      }
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
