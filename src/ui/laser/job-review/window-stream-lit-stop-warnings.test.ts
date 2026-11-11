import { describe, expect, it } from 'vitest';
import type { WindowStreamReason } from '../../state/laser-connect-attempt';
import {
  detectWindowStreamLitStopWarnings,
  leadWithLitStop,
  WINDOW_STREAM_LIT_STOP_PREFIX,
} from './window-stream-lit-stop-warnings';

const GRBL_M3 = 'M3 S0\nG0 X1\nG1 X2 S800 F1500\nM5\n';
const GRBL_M4 = 'M4 S0\nG0 X1\nG1 X2 S800 F1500\nM5\n';
const MARLIN_INLINE = 'M3 I S0\nG0 X1\nG1 X2 S204 F1500\nM5 I\n';
const MARLIN_FAN = 'M107\nG0 X1\nM106 S204\nG1 X2 F1500\nM107\n';

function warn(
  gcode: string,
  controllerKind: Parameters<typeof detectWindowStreamLitStopWarnings>[0]['controllerKind'],
  jobStreamHost: 'worker' | 'window' | null = 'window',
): ReadonlyArray<string> {
  return detectWindowStreamLitStopWarnings({
    connected: true,
    jobStreamHost,
    controllerKind,
    gcode,
  });
}

describe('window-stream lit-stop warning (rolling audit v6 K1, ADR-676)', () => {
  it.each(['grbl-v1.1', 'grblhal', 'fluidnc'] as const)(
    'warns for constant power (M3) on %s streamed from the window',
    (kind) => {
      const [warning] = warn(GRBL_M3, kind);
      expect(warning).toContain(WINDOW_STREAM_LIT_STOP_PREFIX);
      expect(warning).toContain('constant power (M3, from line 3)');
      expect(warning).toContain('Dynamic (M4)');
    },
  );

  it('says nothing for dynamic power (M4), whose beam goes dark at a stop', () => {
    expect(warn(GRBL_M4, 'grbl-v1.1')).toEqual([]);
  });

  it("names Marlin's laser safety timeout for the inline cutter", () => {
    const [warning] = warn(MARLIN_INLINE, 'marlin');
    expect(warning).toContain('LASER_SAFETY_TIMEOUT_MS');
    expect(warning).toContain('no limit when a build sets it to 0');
  });

  it('says the fan-driven beam can stay on until the E-stop', () => {
    const [warning] = warn(MARLIN_FAN, 'marlin');
    expect(warning).toContain("Marlin's fan output");
    expect(warning).toContain('until you press the E-stop');
  });

  it('says nothing when a worker streams the job, or when disconnected', () => {
    expect(warn(GRBL_M3, 'grbl-v1.1', 'worker')).toEqual([]);
    expect(warn(MARLIN_FAN, 'marlin', null)).toEqual([]);
    expect(
      detectWindowStreamLitStopWarnings({
        connected: false,
        jobStreamHost: 'window',
        controllerKind: 'marlin',
        gcode: MARLIN_FAN,
      }),
    ).toEqual([]);
  });

  it('says nothing for Smoothieware, which goes dark at every stop', () => {
    expect(warn(MARLIN_INLINE, 'smoothieware')).toEqual([]);
  });
});

// ADR-676 Amendment 5: the advice names the route that can reach a worker
// from this connection. Where Background streaming is already on, turning it
// on and reconnecting is not advice that can work.
describe('lit-stop advice by why the window streams', () => {
  function adviceFor(reason: WindowStreamReason | null | undefined): string {
    const [warning] = detectWindowStreamLitStopWarnings({
      connected: true,
      jobStreamHost: 'window',
      windowStreamReason: reason,
      controllerKind: 'grbl-v1.1',
      gcode: GRBL_M3,
    });
    if (warning === undefined) throw new Error('Expected the lit-stop warning');
    return warning;
  }

  it('tells a profile that turned Background streaming off to turn it on and reconnect', () => {
    const warning = adviceFor('opted-out');
    expect(warning).toContain('Background streaming is off in Machine Setup');
    expect(warning).toContain('turn it on and reconnect');
    expect(warning).not.toContain('adapter');
  });

  it('tells an identical-adapter fallback to unplug the twin, not to change the setting', () => {
    const warning = adviceFor('adapter-not-unique');
    expect(warning).toContain('Background streaming is on');
    expect(warning).toContain('Leave only one adapter of this kind plugged in and reconnect');
    expect(warning).not.toContain('turn it on');
  });

  it('says a worker that could not start is not fixed by reconnecting', () => {
    const warning = adviceFor('worker-unavailable');
    expect(warning).toContain('its worker could not start for this connection');
    expect(warning).toContain('reconnecting is likely to end the same way');
    expect(warning).not.toContain('turn it on');
    expect(warning).not.toContain('adapter');
  });

  it.each(['no-worker', null, undefined] as const)(
    'offers no worker route where none exists (%s)',
    (reason) => {
      const warning = adviceFor(reason);
      expect(warning).toContain('no background worker');
      expect(warning).not.toContain('reconnect');
    },
  );

  it('ends every route by asking not to edit the project while it runs', () => {
    for (const reason of [
      'opted-out',
      'adapter-not-unique',
      'worker-unavailable',
      'no-worker',
    ] as const)
      expect(adviceFor(reason)).toMatch(/do not edit the project while it runs\.$/i);
  });
});

describe('the lit-stop warning leads the list (ADR-676 decision 5)', () => {
  const litStop = ['lit stop'];

  it('goes ahead of findings added before it, Frame and identity notes included', () => {
    const model = { warnings: ['Controller identity mismatch', 'Frame WCS', 'lit stop', 'job'] };
    expect(leadWithLitStop(model, litStop).warnings).toEqual([
      'lit stop',
      'Controller identity mismatch',
      'Frame WCS',
      'job',
    ]);
  });

  it('adds it when missing and leaves a model without one untouched', () => {
    const model = { warnings: ['job'] };
    expect(leadWithLitStop(model, litStop).warnings).toEqual(['lit stop', 'job']);
    expect(leadWithLitStop(model, [])).toBe(model);
  });
});
