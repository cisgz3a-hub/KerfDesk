// Smoothieware status fields the GRBL grammar reads differently (controller
// audit SM-9). Kernel::get_query_string prints two report forms:
// - running (Run, Home): `|F:<current>,<requested>,<override>`, then with the
//   Laser module `|L:<laser power %>|S:<S value>` and otherwise `|S:<spindle>`
//   (Kernel.cpp L206-L259);
// - otherwise (Idle, Hold, Alarm): `|F:<requested>,<override>` and, only
//   without the Laser module, `|S:<spindle>` (Kernel.cpp L261-L302).
// So the first F component is the live feed only while running; at rest it is
// the requested (modal) feed, which GRBL would report as 0. The S cell comes
// from `S:`, which the GRBL grammar only knows as the second `FS:` component.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L206-L302

import { parseCanonicalStatusNumber, type StatusReport } from '../grbl/status-parser';

export function smoothieStatusReport(report: StatusReport, line: string): StatusReport {
  const running = report.state === 'Run' || report.state === 'Home';
  const fields = line.trim().slice(1, -1).split('|');
  const spindle = numberField(fields, 'S:');
  const laserPower = numberField(fields, 'L:');
  return {
    ...report,
    feed: running ? report.feed : null,
    spindle: spindle ?? report.spindle,
    laserPowerPercent: laserPower,
  };
}

function numberField(fields: ReadonlyArray<string>, label: string): number | null {
  const field = fields.find((candidate) => candidate.startsWith(label));
  return field === undefined ? null : parseCanonicalStatusNumber(field.slice(label.length));
}
