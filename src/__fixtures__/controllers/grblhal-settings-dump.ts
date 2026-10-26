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

/** The dump a COMPATIBILITY_LEVEL 2 build prints: legacy settings only, so no
 *  `$384`, and `$21`/`$22` as 0 or 1. */
export const GRBLHAL_LEVEL_2_DUMP: ReadonlyArray<string> = GRBLHAL_LASER_DUMP.filter(
  (line) => !line.startsWith('$384='),
);
