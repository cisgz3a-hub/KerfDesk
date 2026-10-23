// grblHAL report commands only print (the enumeration, help, pin, limit and
// spindle reports of grblHAL's core dispatch table, system.c#L1013-L1047), so
// the Console must not treat them as a machine-state change that voids the
// completed Frame (controller audit 2, ADR-375, C-6).
import { describe, expect, it } from 'vitest';
import { selectControllerDriver } from '../select-controller-driver';
import { grblHalDriver } from './driver';

const READ_ONLY_REPORTS = [
  '$HELP',
  '$help',
  '$ES',
  '$ESG',
  '$ESH',
  '$EA',
  '$EAG',
  '$EE',
  '$EEG',
  '$EG',
  '$E*',
  '$PINS',
  '$PINSTATE',
  '$PORTS',
  '$LEV',
  '$LIM',
  '$HSS',
  '$SPINDLES',
  '$SPINDLESH',
  '$I+',
  '$',
  '$N',
];

describe('grblHAL Console report commands', () => {
  it.each(READ_ONLY_REPORTS)('prepares %s as a read-only report', (input) => {
    expect(grblHalDriver.prepareConsoleCommand(input)).toMatchObject({
      ok: true,
      command: {
        kind: 'report-query',
        requiresIdle: false,
        requiresNoActiveOperation: true,
        requiresConfirmation: false,
        stateEffect: 'read-only',
      },
    });
  });

  it('keeps the reports read-only on the Falcon command contract too', () => {
    const falcon = selectControllerDriver('grblhal', 'creality-falcon-a1-pro');
    expect(falcon.prepareConsoleCommand('$PINS')).toMatchObject({
      ok: true,
      command: { kind: 'report-query', stateEffect: 'read-only' },
    });
  });

  it('keeps a help topic, an assignment and $DWNGRD out of the read-only list', () => {
    expect(grblHalDriver.prepareConsoleCommand('$HELP settings')).toMatchObject({
      ok: true,
      command: { stateEffect: 'machine-state' },
    });
    expect(grblHalDriver.prepareConsoleCommand('$ES=1')).toMatchObject({
      ok: true,
      command: { kind: 'gcode' },
    });
    expect(grblHalDriver.prepareConsoleCommand('$DWNGRD').ok).toBe(false);
  });
});

// A tool table's offsets outlast M30 and a soft reset on grblHAL, so the
// Console voids Work Z for them as it does for G43.1 (ADR-630 Amendment 8).
describe('grblHAL Console tool length offsets', () => {
  it.each(['G43 H1', 'G43', 'G43.2 H2', 'G49', 'M61 Q2'])(
    'prepares %s as a tool change',
    (input) => {
      expect(grblHalDriver.prepareConsoleCommand(input)).toMatchObject({
        ok: true,
        command: { kind: 'gcode', stateEffect: 'tool' },
      });
    },
  );
});
