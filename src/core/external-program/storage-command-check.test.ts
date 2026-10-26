import { describe, expect, it } from 'vitest';
import { storageCommandRefusal } from './storage-command-check';

// Lines as the normalizer sends them: canonical (no spaces) except on Marlin.
describe('storageCommandRefusal (ADR-630 Amendment 5)', () => {
  describe('Smoothieware', () => {
    const refusal = (line: string): string | null => storageCommandRefusal(line, 'smoothieware');

    it('refuses a line that starts with a lowercase letter, shell word or G-code', () => {
      for (const line of ['version', 'reset', 'g1x10y10', 'm3s500']) {
        expect(refusal(line)).toMatch(/^starts with a lowercase letter, so Smoothieware runs it/);
      }
    });

    it('refuses the shell passthrough, SD-card and config-file M-codes', () => {
      expect(refusal('M1000version')).toMatch(/^is M1000, which passes the rest of the line/);
      expect(refusal('M28notes.txt')).toMatch(/^is M28, which writes the lines after it/);
      expect(refusal('M29')).toBe('is M29, which ends an SD-card upload');
      expect(refusal('M24')).toMatch(/^is M24, which plays a file stored on the SD card/);
      expect(refusal('M32job.gcode')).toMatch(/^is M32, which plays a file/);
      expect(refusal('M374')).toMatch(/^is M374, which saves or deletes the levelling grid/);
      expect(refusal('M374.1')).toMatch(/^is M374,/);
      for (const code of [500, 501, 502, 504]) {
        expect(refusal(`M${code}`)).toMatch(new RegExp(`^is M${code}, which .*config-override`));
      }
    });

    it('finds the command anywhere on the line, as GcodeDispatch splits it at each G and M', () => {
      expect(refusal('G1X10M28notes.txt')).toMatch(/^is M28,/);
      expect(refusal('G0X0Y0M1000version')).toMatch(/^is M1000,/);
      // Gcode::get_int reads the number with strtol: a sign and leading zeros count.
      expect(refusal('M+28notes.txt')).toMatch(/^is M28,/);
      expect(refusal('M0500')).toMatch(/^is M500,/);
    });

    it('refuses M30 with a file name, but not M30 ending the program', () => {
      expect(refusal('M30notes.txt')).toBe(
        'is M30 with a file name, which deletes that file from the SD card',
      );
      expect(refusal('M30')).toBeNull();
      expect(refusal('M5M30')).toBeNull();
    });

    it('passes ordinary laser G-code', () => {
      for (const line of ['G21', 'G90', 'M3S0', 'G0X10Y10', 'G1X20F1200S0.5', 'M5', 'M2', 'M114']) {
        expect(refusal(line)).toBeNull();
      }
    });
  });

  describe('Marlin', () => {
    const refusal = (line: string): string | null => storageCommandRefusal(line, 'marlin');

    it.each([810, 811, 812, 813, 814, 815, 816, 817, 818, 819])(
      'refuses defining or invoking stored macro M%s',
      (code) => {
        for (const line of [`M${code}`, `M${code} G1 X120 F600`, `m0${code}.0`]) {
          expect(refusal(line)).toBe(
            `is M${code}, which defines or runs a macro stored on the controller`,
          );
        }
      },
    );

    it.each(['M 00810', 'M66346', 'M4294968106', 'M-64726', 'M+020074'])(
      'recognizes the firmware command-number alias %s for M810',
      (line) => expect(refusal(line)).toMatch(/^is M810, which defines or runs a macro/),
    );

    it('does not turn a later parameter or a neighboring code into a macro call', () => {
      for (const line of [
        'G1 X10 M810',
        'M355 S1 M819',
        'G53 G1 X10 M810',
        'M809',
        'M820',
        'M 8 10',
      ]) {
        expect(refusal(line)).toBeNull();
      }
    });

    it.each(['G53 M810', 'G53G53 M810', 'G 53 M810', 'G65589 M66346', 'n1 M810', 'G53 n+1 M810'])(
      'finds the stored macro behind the supported parser prefix in %s',
      (line) => expect(refusal(line)).toMatch(/is M810, which defines or runs a macro/),
    );

    it.each(['G53G1 M810', 'G53junk M810', 'G53G1 G53junk M810', 'n1 G53junk M810'])(
      'finds the stored macro reached by the fast parser chain in %s',
      (line) => expect(refusal(line)).toMatch(/^is M810, which defines or runs a macro/),
    );

    it('does not chain an ordinary command or switch parser modes mid-chain', () => {
      for (const line of ['G53G1 X10 M810', 'G53junk M355 S1 M810', 'G53junk G 53 M810']) {
        expect(refusal(line)).toBeNull();
      }
    });

    it.each(['\\M810', 'M8\\10', 'G53junk \\M810', 'G53J" \\M810"'])(
      'recognizes the macro exposed by serial or quoted-string unescaping in %s',
      (line) => expect(refusal(line)).toMatch(/^is M810, which defines or runs a macro/),
    );

    it('keeps quoted text that no supported parser configuration executes', () => {
      for (const line of ['G1 J" \\M810"', 'G53 J" \\M810"', 'G53J" x\\M810"']) {
        expect(refusal(line)).toBeNull();
      }
    });

    it('keeps the quoted build fixed while nested G53 parsers unescape the shared buffer again', () => {
      const line = String.raw`G53 G53J" \\M810"`;
      expect(refusal(line)).toMatch(/^is M810, which defines or runs a macro/);
      expect(refusal(`${'G53 '.repeat(10_000)}J"ordinary"`)).toBeNull();
    });

    it('refuses SD-card writes, SD prints, EEPROM saves and firmware updates', () => {
      expect(refusal('M28 notes.txt')).toMatch(/^is M28, which writes the lines after it/);
      expect(refusal('M29')).toBe('is M29, which ends an SD-card upload');
      expect(refusal('M928 log.txt')).toMatch(/^is M928, which logs the lines after it/);
      expect(refusal('M24')).toMatch(/^is M24, which starts a print stored on the SD card/);
      expect(refusal('M32 !job.gcode#')).toMatch(/^is M32,/);
      expect(refusal('M1000')).toMatch(/^is M1000, which resumes a print/);
      expect(refusal('M500')).toBe('is M500, which saves the settings to EEPROM');
      expect(refusal('M997')).toBe('is M997, which starts a firmware update');
      // The parser skips spaces, and a case-insensitive build reads m as M.
      expect(refusal('  M 28 notes.txt')).toMatch(/^is M28,/);
      expect(refusal('m500')).toMatch(/^is M500,/);
    });

    it('refuses M30 with a file name, but not M30 ending the program', () => {
      expect(refusal('M30 notes.txt')).toMatch(/^is M30 with a file name, which deletes/);
      expect(refusal('M30')).toBeNull();
    });

    it("reads only the line's first command, as Marlin does", () => {
      expect(refusal('G1 X10 M28')).toBeNull();
      for (const line of ['G21', 'G90', 'M3 S0', 'G0 X10 Y10', 'G1 X20 F1200', 'M5', 'M107']) {
        expect(refusal(line)).toBeNull();
      }
    });
  });

  describe('grblHAL', () => {
    const refusal = (line: string): string | null => storageCommandRefusal(line, 'grblhal');

    it('refuses stored macro and subprogram calls', () => {
      expect(refusal('G65P100')).toBe('is G65, which runs a macro stored on the controller');
      expect(refusal('G66P100')).toMatch(/^is G66,/);
      expect(refusal('g65p100')).toMatch(/^is G65,/);
      expect(refusal('M98P100')).toBe('is M98, which runs a subprogram stored on the controller');
      expect(refusal('O<probe>CALL')).toMatch(/^calls a named subroutine, which grblHAL loads/);
      expect(refusal('N10o<probe>call')).toMatch(/^calls a named subroutine/);
    });

    it('passes ordinary G-code and plain M-codes', () => {
      for (const line of ['G21G90', 'M3S1000', 'G0X10Y10', 'G1X20F1200', 'M5', 'M30', 'M6T1']) {
        expect(refusal(line)).toBeNull();
      }
    });
  });

  it('leaves the dialects that keep no stored programs to the $ refusal', () => {
    for (const kind of ['grbl-v1.1', 'fluidnc', undefined] as const) {
      for (const line of ['reset', 'M28notes.txt', 'M1000version', 'G65P100', 'M98P100']) {
        expect(storageCommandRefusal(line, kind)).toBeNull();
      }
    }
  });
});
