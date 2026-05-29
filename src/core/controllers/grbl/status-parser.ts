// Parse GRBL v1.1 real-time status reports.
//
// Wire format (between < and >, fields separated by `|`):
//   <Idle|MPos:0.000,0.000,0.000|FS:0,0>
//   <Run|MPos:1.234,5.678,0.000|FS:1500,500>
//   <Hold:0|MPos:1.000,2.000,0.000|FS:0,0>
//   <Alarm|MPos:0.000,0.000,0.000|FS:0,0|Pn:XY>
//   <Door:1|WPos:...|FS:...|Ov:100,100,100>
//
// We extract: state (with optional substate), MPos or WPos, feed+spindle,
// and WCO (Work Coordinate Offset). WCO is reported intermittently by
// GRBL (every Nth status frame per `$10`'s WCO bit), so consumers that
// need the *current* offset must cache the last non-null value across
// frames — see laser-store's `wcoCache`. UI code MUST NOT read
// `StatusReport.wco` directly (it would flicker on most frames).
// Other fields (Bf, Ln, Pn, Ov) are still not parsed.

export type GrblState =
  | 'Idle'
  | 'Run'
  | 'Hold'
  | 'Jog'
  | 'Alarm'
  | 'Door'
  | 'Check'
  | 'Home'
  | 'Sleep';

export type StatusReport = {
  readonly state: GrblState;
  readonly subState: number | null;
  readonly mPos: { x: number; y: number; z: number } | null;
  readonly wPos: { x: number; y: number; z: number } | null;
  readonly feed: number | null;
  readonly spindle: number | null;
  /**
   * Work Coordinate Offset — the machine-to-work translation that
   * GRBL is currently applying. WPos = MPos - WCO. Reported on a
   * cadence (every Nth status), so it's null on most frames. **UI
   * code must read `wcoCache` from the laser-store, NEVER this
   * field**, or the readout will flicker.
   */
  readonly wco: { x: number; y: number; z: number } | null;
};

const STATE_VALUES: ReadonlyArray<GrblState> = [
  'Idle',
  'Run',
  'Hold',
  'Jog',
  'Alarm',
  'Door',
  'Check',
  'Home',
  'Sleep',
];

const STATE_SET = new Set<string>(STATE_VALUES);

export function parseStatusReport(line: string): StatusReport | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('<') || !trimmed.endsWith('>')) return null;
  const inner = trimmed.slice(1, -1);
  const fields = inner.split('|');
  const first = fields[0];
  if (first === undefined || first === '') return null;
  const stateParsed = parseState(first);
  if (stateParsed === null) return null;
  return {
    state: stateParsed.state,
    subState: stateParsed.subState,
    mPos: pickAxisField(fields, 'MPos'),
    wPos: pickAxisField(fields, 'WPos'),
    feed: pickFsValue(fields, 0),
    spindle: pickFsValue(fields, 1),
    wco: pickAxisField(fields, 'WCO'),
  };
}

function parseState(token: string): { state: GrblState; subState: number | null } | null {
  const [name, sub] = token.split(':');
  if (name === undefined || !STATE_SET.has(name)) return null;
  const state = name as GrblState;
  if (sub === undefined) return { state, subState: null };
  const subNumber = Number.parseInt(sub, 10);
  return { state, subState: Number.isFinite(subNumber) ? subNumber : null };
}

function pickAxisField(
  fields: ReadonlyArray<string>,
  label: 'MPos' | 'WPos' | 'WCO',
): { x: number; y: number; z: number } | null {
  for (const f of fields) {
    if (!f.startsWith(`${label}:`)) continue;
    const parts = f
      .slice(label.length + 1)
      .split(',')
      .map(Number);
    const [x, y, z] = parts;
    if (
      x !== undefined &&
      y !== undefined &&
      z !== undefined &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(z)
    ) {
      return { x, y, z };
    }
    return null;
  }
  return null;
}

function pickFsValue(fields: ReadonlyArray<string>, index: 0 | 1): number | null {
  for (const f of fields) {
    if (!f.startsWith('FS:') && !f.startsWith('F:')) continue;
    // F:1500 has 1 component (feed only). FS:1500,500 has 2.
    const body = f.slice(f.indexOf(':') + 1);
    const parts = body.split(',').map(Number);
    const v = parts[index];
    if (v === undefined) return null;
    return Number.isFinite(v) ? v : null;
  }
  return null;
}
