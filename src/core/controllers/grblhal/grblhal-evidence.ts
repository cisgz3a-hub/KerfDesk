// What a session shows of grblHAL when the profile chose another driver (meta
// audit v1 M3-P3-3, ADR-375 Amendment 4). Connect binds the driver from the
// machine profile and a banner never switches it. grblHAL built at
// COMPATIBILITY_LEVEL 1 greets as "Grbl 1.1f", as Ortur's ESP32-S2 firmware for
// the Laser Master 2 Pro S1/S2 and the Aufero lasers does. KerfDesk has no
// preset for those machines, so they run under the default stock-GRBL profile.
//
// The evidence, in the order it is checked:
// - 'banner': the welcome banner reads "GrblHAL" (COMPATIBILITY_LEVEL 0).
// - 'settings': the `$$` lists one of grblHAL's `$14`-`$18`
//   (listsGrblHalSignalSettings), as it does at level 0 or 1.
// - 'build-info': the `$I` reply carries `[FIRMWARE:grblHAL]` or `[NEWOPT:`,
//   which a plain `$I` prints only at level 0.
// A level 1 build prints neither in reply to `$I`, and a level 2 build lists
// only legacy settings, so it shows none of the three.
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L310-L315
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L918-L920
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L1030
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L1111
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L628-L656
// https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/config.h#L47
// https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/report.c#L1100-L1114

import type { ControllerKind } from '../../devices/device-profile';
import type { ControllerSettingsSnapshot } from '../grbl/parse-settings';

/** The session state the evidence comes from; LaserState has these fields. */
export type GrblHalSessionEvidence = {
  readonly detectedControllerKind: ControllerKind | null;
  readonly controllerSettings: Pick<
    ControllerSettingsSnapshot,
    'listsGrblHalSignalSettings'
  > | null;
  readonly controllerBuildInfoRawLines: ReadonlyArray<string>;
};

export type GrblHalEvidence = 'banner' | 'settings' | 'build-info';

const GRBLHAL_BUILD_INFO_LINE = /^\[(?:FIRMWARE:grblHAL\]|NEWOPT:)/;

/** How this session shows grblHAL, or null when it does not. */
export function grblHalEvidence(
  session: GrblHalSessionEvidence | undefined,
): GrblHalEvidence | null {
  if (session === undefined) return null;
  if (session.detectedControllerKind === 'grblhal') return 'banner';
  if (session.controllerSettings?.listsGrblHalSignalSettings === true) return 'settings';
  const buildInfoNamesGrblHal = session.controllerBuildInfoRawLines.some((line) =>
    GRBLHAL_BUILD_INFO_LINE.test(line.trim()),
  );
  return buildInfoNamesGrblHal ? 'build-info' : null;
}
