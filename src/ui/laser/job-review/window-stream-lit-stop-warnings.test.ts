import { describe, expect, it } from 'vitest';
import {
  detectWindowStreamLitStopWarnings,
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

describe('window-stream lit-stop warning (rolling audit v6 K1, ADR-675)', () => {
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
