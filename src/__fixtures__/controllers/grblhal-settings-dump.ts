// A grblHAL `$$` dump for a 3-axis 400 x 300 mm laser, as grblHAL core
// d7aaee3 prints it at its default COMPATIBILITY_LEVEL 0: `$$` lists the core
// and extended settings (`$384` among them), `$21`/`$22` as whole bitfields,
// and each decimal to the places of its format string. Built from the printed
// formats in settings.c, not captured from a board.
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2341-L2476
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L300-L317

export const GRBLHAL_LASER_DUMP: ReadonlyArray<string> = [
  '$0=5.0',
  '$1=25',
  '$2=0',
  '$3=0',
  '$4=0',
  '$5=0',
  '$6=0',
  '$10=511',
  '$11=0.010',
  '$12=0.002',
  '$13=0',
  '$20=1',
  '$21=1',
  '$22=1',
  '$23=0',
  '$24=25.0',
  '$25=500.0',
  '$26=250',
  '$27=2.000',
  '$30=1000.000',
  '$31=0.000',
  '$32=1',
  '$100=250.000',
  '$101=250.000',
  '$102=250.000',
  '$110=3000.000',
  '$111=3000.000',
  '$112=500.000',
  '$120=500.000',
  '$121=500.000',
  '$122=10.000',
  '$130=400.000',
  '$131=300.000',
  '$132=50.000',
  '$384=0',
];

/** The dump as the settings collector keys it, with `$N` values replaced. */
export function grblHalSettingsMap(
  overrides: Readonly<Record<number, string>> = {},
  dump: ReadonlyArray<string> = GRBLHAL_LASER_DUMP,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of dump) {
    const match = /^\$(\d+)=(.*)$/.exec(line);
    if (match !== null) map.set(Number(match[1]), match[2] ?? '');
  }
  for (const [id, value] of Object.entries(overrides)) map.set(Number(id), value);
  return map;
}

/** A `$$` shaped after Ortur's ESP32-S2 grblHAL firmware (OLF 1.7x-1.8x for the
 *  Laser Master 2 Pro S1/S2 and the Aufero lasers). It is built at
 *  COMPATIBILITY_LEVEL 1, greets as "Grbl 1.1f", and its report_grbl_settings
 *  (true) lists `$14`-`$18` and other extended settings beside the legacy
 *  ones, decimals to three places. Trimmed, with illustrative values; not
 *  captured from a board (ADR-375 Amendment 4).
 *  https://github.com/Ortur-Tech/Ortur_Laser_Firmware_17X-18X/blob/4849ac85fc1f1a15c47d0dbbfc3e69450922ad32/ESPLaserMasterGrbl/main/grbl/report.c#L461-L709 */
export const GRBLHAL_LEVEL_1_GRBL_BANNER_DUMP: ReadonlyArray<string> = [
  '$0=10.0',
  '$1=25',
  '$2=0',
  '$3=0',
  '$4=0',
  '$5=0',
  '$6=0',
  '$10=511',
  '$11=0.010',
  '$12=0.002',
  '$13=0',
  '$14=0',
  '$15=0',
  '$16=0',
  '$17=0',
  '$18=0',
  '$20=0',
  '$21=0',
  '$22=0',
  '$23=0',
  '$24=25.000',
  '$25=500.000',
  '$26=250',
  '$27=1.000',
  '$28=0.000',
  '$30=1000.000',
  '$31=0.000',
  '$32=1',
  '$33=1000.000',
  '$100=80.000',
  '$101=80.000',
  '$102=80.000',
  '$110=10000.000',
  '$111=10000.000',
  '$112=1000.000',
  '$120=1000.000',
  '$121=1000.000',
  '$122=100.000',
  '$130=400.000',
  '$131=400.000',
  '$132=50.000',
];

/** The dump a COMPATIBILITY_LEVEL 2 build prints: legacy settings only, so no
 *  `$384`, and `$21`/`$22` as 0 or 1. */
export const GRBLHAL_LEVEL_2_DUMP: ReadonlyArray<string> = GRBLHAL_LASER_DUMP.filter(
  (line) => !line.startsWith('$384='),
);
