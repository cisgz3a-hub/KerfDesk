// Smoothieware Laser module presence and build (controller audit SM-3, SM-2).
//
// The Laser module deletes itself at boot unless `laser_module_enable` is true
// and its pin is a hardware-PWM pin (Laser.cpp L51-L74). Nothing else answers
// the lowercase `fire` shell command (SimpleShell.cpp L286-L288; GcodeDispatch
// ignores lowercase lines, L79-L82), so without the module `fire off` never
// gets a reply and each one strands an owed acknowledgement.
//
// `M221` with no argument is the probe. Laser::on_gcode_received prints one
// report line and changes nothing (Laser.cpp L198-L202), then GcodeDispatch
// prints its `ok` (GcodeDispatch.cpp L383-L423):
// - edge since 971eb8cf (2021-06-15):
//   `Laser power: %6.2f %%, disable auto power: %d, PWM frequency: %f Hz`;
// - 04197132 (2016-08-28) to 971eb8cf: `Laser power scale at %6.2f %%`, and
//   `M221 P` did not exist: every G1-G3 block ran speed-proportional
//   (971eb8cf added disable_auto_power and the P word).
// Without the module only `ok` arrives. A selected Extruder answers the same
// query with `Flow rate at …` (Extruder.cpp L314-L326), never a Laser line.
// Builds before 04197132 also answer only `ok`; they predate `fire` (73cc27d2,
// 2016-08-29) as well.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L198-L202
// https://github.com/Smoothieware/Smoothieware/commit/971eb8cf281c978cd31f2f9563a7992effb5e5e9

import type { ControllerDriver, LaserModuleEvidence, LaserModuleProbe } from '../controller-driver';
import { normalizeConsoleSpaces } from '../console-text';

export const SMOOTHIE_CMD_LASER_REPORT = 'M221';

const LASER_REPORT_RE = /^Laser power\b/;
const AUTO_POWER_FIELD_RE = /\bdisable auto power:/;
const FIRE_COMMAND_RE = /^fire\b/;

export const SMOOTHIE_NO_LASER_MODULE_FIRE_REASON =
  'Smoothieware reported no Laser module (M221 printed no "Laser power" line), so nothing on the board answers fire commands. Enable the Laser module in the Smoothieware config, reset the board and reconnect.';

/** Classify the lines `M221` printed before its `ok`. */
export function parseSmoothieLaserReport(responses: ReadonlyArray<string>): LaserModuleEvidence {
  const report = responses.map((line) => line.trim()).find((line) => LASER_REPORT_RE.test(line));
  if (report === undefined) return { module: 'absent', constantPowerMode: null };
  return { module: 'loaded', constantPowerMode: AUTO_POWER_FIELD_RE.test(report) };
}

/** The Smoothieware driver for a board without the Laser module: `fire off`
 *  leaves the tool-off lines of jog, Frame and Home, and the Console refuses
 *  `fire`, because nothing would answer them. */
export function smoothieDriverWithoutLaserModule(driver: ControllerDriver): ControllerDriver {
  const commands = driver.commands;
  return {
    ...driver,
    commands: {
      ...commands,
      home: commands.home === null ? null : withoutFireLines(commands.home),
      frameToolOffLines: commands.frameToolOffLines.filter((line) => !isFireLine(line)),
      buildJog: (params) => withoutFireLines(commands.buildJog(params)),
    },
    prepareConsoleCommand: (input) =>
      isFireLine(normalizeConsoleSpaces(input))
        ? { ok: false, reason: SMOOTHIE_NO_LASER_MODULE_FIRE_REASON }
        : driver.prepareConsoleCommand(input),
  };
}

export const smoothieLaserModuleProbe: LaserModuleProbe = {
  command: SMOOTHIE_CMD_LASER_REPORT,
  parse: parseSmoothieLaserReport,
  withoutLaserModule: smoothieDriverWithoutLaserModule,
};

function withoutFireLines(payload: string): string {
  return payload
    .split('\n')
    .filter((line) => !isFireLine(line))
    .join('\n');
}

function isFireLine(line: string): boolean {
  return FIRE_COMMAND_RE.test(line.trim());
}
