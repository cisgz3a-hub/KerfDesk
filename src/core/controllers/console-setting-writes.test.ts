import { describe, expect, it } from 'vitest';
import type { ControllerDriver } from './controller-driver';
import { consoleSettingReadbackIssue, consoleSettingWriteIssue } from './console-setting-writes';
import type { GrblHalSessionEvidence } from './grblhal/grblhal-evidence';
import { selectControllerDriver } from './select-controller-driver';

const falcon = selectControllerDriver('grblhal', 'creality-falcon-a1-pro');
const grbl = selectControllerDriver('grbl-v1.1');
const grblHal = selectControllerDriver('grblhal');
const fluidnc = selectControllerDriver('fluidnc');

function issue(driver: ControllerDriver, input: string): string | null {
  const prepared = driver.prepareConsoleCommand(input);
  if (!prepared.ok) throw new Error(prepared.reason);
  return consoleSettingWriteIssue(driver, prepared.command);
}

describe('Console numeric setting writes (ADR-370)', () => {
  it('leaves a GRBL-settings driver free to send any numeric write', () => {
    expect(issue(grblHal, '$110=6000')).toBeNull();
  });

  it("sends Creality's documented air settings on the Falcon contract", () => {
    for (const input of ['$150=25', '$151=100', '$152=100', '$152=0', '$ 152 = 30']) {
      expect(issue(falcon, input), input).toBeNull();
    }
  });

  it('refuses an air setting outside its documented whole-number range', () => {
    expect(issue(falcon, '$152=101')).toBe(
      '$152 (air pump standby wait in seconds, 100 = never) takes a whole number from 0 to 100.',
    );
    expect(issue(falcon, '$151=50.5')).toContain('whole number from 0 to 100');
    expect(issue(falcon, '$150=-1')).toContain('whole number from 0 to 100');
  });

  it('keeps every other numeric write out of the Falcon contract', () => {
    expect(issue(falcon, '$110=36000')).toBe(
      `KerfDesk does not send numeric $ setting writes other than $150, $151 and $152 on the ${falcon.label} profile. Configure the controller with its own tools.`,
    );
  });

  it('keeps a driver without listed writes refusing them all', () => {
    expect(issue(fluidnc, '$30=1000')).toBe(
      `KerfDesk does not send numeric $ setting writes on the ${fluidnc.label} profile. Configure the controller with its own tools.`,
    );
  });

  it('judges only setting writes', () => {
    expect(issue(falcon, 'M8')).toBeNull();
  });
});

// Controller audit 2 (ADR-375), C-4: stock GRBL keeps its integer settings in
// 8 bits through `uint8_t int_value = trunc(value)` and still answers ok
// (grbl/settings.c#L229), so `$22=0.5` stored 0 and turned homing and soft
// limits off (#L275-L280). The value is read the way GRBL's line reader does.
describe('Console setting values stock GRBL would store differently', () => {
  it.each([
    ['$22=0.5', /\$22 is an on\/off setting: enter 0 or 1\. .*0\.5 would turn it off/],
    ['$22=.5', /enter 0 or 1/],
    ['$22 = 0 . 5 (half)', /0\.5 would turn it off/],
    ['$22=2', /enter 0 or 1\. GRBL would store 2 as 1\./],
    ['$23=1.9', /\$23 as a whole number from 0 to 255/],
    ['$1=300', /\$1 as a whole number from 0 to 255/],
    ['$10=511', /whole number from 0 to 255/],
  ])('refuses %j', (input, reason) => {
    expect(issue(grbl, input)).toMatch(reason);
  });

  it.each(['$22=1', '$22=1.0', '$1=255', '$32=0', '$110=500.5', '$22=1;x', '$22=1 (on)'])(
    'sends %j, which stock GRBL stores as typed',
    (input) => {
      expect(issue(grbl, input)).toBeNull();
    },
  );

  it.each(['$22=-1', '$20=abc', '$1=25x'])(
    'leaves %j to the firmware, which refuses it',
    (input) => {
      expect(issue(grbl, input)).toBeNull();
    },
  );
});

// Controller audit v2 C4-P2-1 (ADR-375 Amendment 4). grblHAL core keeps every
// character after `=` (system.c#L1139-L1213) and reads only the number at the
// start (settings.c#L3527-L3552, nuts_bolts.c read_uint/read_float), answering
// ok; d7aaee3's read_uint also takes each zero after the point as one more
// digit (nuts_bolts.c#L194-L244), fixed only in 20261015.
describe('Console setting values grblHAL would store differently', () => {
  it.each([
    [
      '$100=26,67',
      /^\$100=26,67 cannot be sent: Enter a finite decimal number\. grblHAL keeps only the number at the start/,
    ],
    ['$110=5O00', /^\$110=5O00 cannot be sent: .*keeps only the number at the start/],
    ['$22=1 (on)', /keeps only the number at the start/],
    ['$22=0.5', /^\$22=0\.5 cannot be sent: Enter an unsigned integer/],
    [
      '$22=1.0',
      /^grblHAL would not store \$22=1\.0 as typed\. Send \$22=1 instead\. grblHAL builds before 20261015 read 1\.0 as 10 /,
    ],
    ['$1=255.0', /Send \$1=255 instead\. .*read 255\.0 as 2550/],
    ['$3=1.00', /Send \$3=1 instead\. .*read 1\.00 as 100/],
    ['$100=1e2', /Send \$100=100 instead\. grblHAL stops reading a value at its exponent\./],
    ['$26=70000', /^grblHAL stores \$26 in 16 bits, so 70000 would be stored as 4464\./],
  ])('refuses %j', (input, reason) => {
    expect(issue(grblHal, input)).toMatch(reason);
  });

  it.each([
    '$110=6000',
    '$110=5000.0',
    '$100=26.67',
    '$22=9',
    '$22=0.0',
    '$26=25.',
    '$1=+25',
    '$1=025',
    '$26=65535',
    '$ 22 = 1',
  ])('sends %j, which grblHAL stores as typed', (input) => {
    expect(issue(grblHal, input)).toBeNull();
  });

  it.each(['$300=laser-1', '$302=192.168.5.1', '$330=12ab', '$680=25.0'])(
    'leaves %j, a setting KerfDesk does not know, to the firmware and the re-read',
    (input) => {
      expect(issue(grblHal, input)).toBeNull();
    },
  );

  it('keeps the Falcon contract on its own list', () => {
    expect(issue(falcon, '$152=100.0')).toContain('whole number from 0 to 100');
  });
});

// Meta audit v1 M3-P3-3 (ADR-375 Amendment 5). Ortur's ESP32-S2 grblHAL
// firmware (COMPATIBILITY_LEVEL 1) greets as "Grbl 1.1f" and has no KerfDesk
// preset, so it runs under the stock-GRBL profile. Its settings_store_global_
// setting reads the value with read_float and never checks what follows, so
// `$100=26,67` stores 26 with ok (settings.c#L456-L472, nuts_bolts.c#L152-L209
// at Ortur_Laser_Firmware_17X-18X 4849ac8), where stock GRBL answers error:3.
describe('Console setting values on a grblHAL board under the stock-GRBL profile', () => {
  const session = (overrides: Partial<GrblHalSessionEvidence> = {}): GrblHalSessionEvidence => ({
    detectedControllerKind: 'grbl-v1.1',
    controllerSettings: { listsGrblHalSignalSettings: true },
    controllerBuildInfoRawLines: ['[VER:1.1f(ESP32).20210403:]', '[OPT:VNMHSL,35,16384,3]'],
    ...overrides,
  });
  const onGrbl = (input: string, evidence?: GrblHalSessionEvidence) => {
    const prepared = grbl.prepareConsoleCommand(input);
    if (!prepared.ok) throw new Error(prepared.reason);
    return consoleSettingWriteIssue(grbl, prepared.command, evidence);
  };

  it('refuses a value grblHAL keeps only in part, naming why grblHAL applies', () => {
    expect(onGrbl('$100=26,67', session())).toBe(
      '$100=26,67 cannot be sent: Enter a finite decimal number. grblHAL keeps only the number at ' +
        "the start of a value and still answers ok. The profile selects GRBL v1.1, but this controller lists grblHAL's $14-$18 in its $$ report.",
    );
    expect(onGrbl('$110=5O00', session())).toMatch(/keeps only the number at the start/);
    expect(onGrbl('$22=1.0', session())).toMatch(/^grblHAL would not store \$22=1\.0 as typed\./);
  });

  it('names each kind of grblHAL evidence', () => {
    const banner = session({ detectedControllerKind: 'grblhal', controllerSettings: null });
    expect(onGrbl('$100=26,67', banner)).toMatch(/this controller greets as grblHAL\.$/);
    const buildInfo = session({
      controllerSettings: {},
      controllerBuildInfoRawLines: ['[VER:1.1f.20260923:]', '[FIRMWARE:grblHAL]'],
    });
    expect(onGrbl('$100=26,67', buildInfo)).toMatch(/names grblHAL in its \$I report\.$/);
    expect(
      onGrbl(
        '$100=26,67',
        session({ controllerSettings: null, controllerBuildInfoRawLines: [' [NEWOPT:ENUMS,RT+]'] }),
      ),
    ).toMatch(/names grblHAL in its \$I report\.$/);
  });

  it('keeps the stock refusal first: this firmware truncates a whole-number value too', () => {
    // settings.c#L534: int_value = (uint_fast16_t)truncf(value).
    expect(onGrbl('$22=0.5', session())).toMatch(/0\.5 would turn it off/);
    expect(onGrbl('$1=300', session())).toMatch(/whole number from 0 to 255/);
  });

  it('sends what both firmwares store as typed', () => {
    for (const input of ['$100=26.67', '$110=5000.0', '$22=1', '$32=1', '$30=1000']) {
      expect(onGrbl(input, session()), input).toBeNull();
    }
  });

  it('leaves the stock check alone when the session shows no grblHAL', () => {
    const stock = session({ controllerSettings: {}, controllerBuildInfoRawLines: [] });
    expect(onGrbl('$100=26,67', stock)).toBeNull();
    expect(onGrbl('$22=1.0', stock)).toBeNull();
    expect(onGrbl('$22=1.0')).toBeNull();
    expect(onGrbl('$22=0.5', stock)).toMatch(/0\.5 would turn it off/);
  });
});

describe('the $$ re-read after a Console setting write', () => {
  const readback = (driver: ControllerDriver, input: string, reported: string | undefined) =>
    consoleSettingReadbackIssue(driver, input, reported);

  it('names a value stored in part whatever profile chose the driver', () => {
    // Stock GRBL refuses `26,67` (error:3), so an ok and 26.000 mean grblHAL
    // under a stock-GRBL profile, at any COMPATIBILITY_LEVEL.
    expect(readback(grbl, '$100=26,67', '26.000')).toBe(
      'The controller reports $100=26.000 after the re-read, not 26,67: it stored a different value. Write $100 again with the intended value.',
    );
    expect(readback(grbl, '$22=1.0', '10')).toContain('reports $22=10 after the re-read');
    expect(readback(grbl, '$22=-0', '0')).toBeNull();
    expect(readback(grbl, '$74=Workshop', 'Workshop')).toBeNull();
  });

  it('names a value grblHAL stored differently', () => {
    expect(readback(grblHal, '$680=25.0', '250')).toBe(
      'The controller reports $680=250 after the re-read, not 25.0: it stored a different value. Write $680 again with the intended value.',
    );
    expect(readback(grblHal, '$680=5O00', '5')).toContain('reports $680=5 after the re-read');
    expect(readback(grbl, '$110=5000', '500.000')).toContain('reports $110=500.000');
  });

  it('accepts the value at the precision the controller printed', () => {
    expect(readback(grblHal, '$100=26.67', '26.670')).toBeNull();
    expect(readback(grblHal, '$0=5.25', '5.3')).toBeNull();
    expect(readback(grbl, '$22=1 (on)', '1')).toBeNull();
    expect(readback(grbl, '$30=1000.4', '1000')).toBeNull();
  });

  it('leaves text settings and settings the re-read did not list alone', () => {
    expect(readback(grblHal, '$300=laser-1', 'laser-1')).toBeNull();
    expect(readback(grblHal, '$302=192.168.5.1', '192.168.5.1')).toBeNull();
    expect(readback(grblHal, '$330=1234', '1234')).toBeNull();
    expect(readback(grblHal, '$100=26.67', undefined)).toBeNull();
  });
});
