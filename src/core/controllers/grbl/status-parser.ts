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
// WCO (Work Coordinate Offset), and Pn (active input pins). WCO is reported
// intermittently by GRBL (every Nth status frame per `$10`'s WCO bit), so
// consumers that need the *current* offset must cache the last non-null value
// across frames — see laser-store's `wcoCache`. UI code MUST NOT read
// `StatusReport.wco` directly (it would flicker on most frames).
// Pn is OMITTED by GRBL whenever no pin is triggered, so `pins` is null on
// those frames — it appears only while a limit / probe / door is active.
// Ov (feed/rapid/spindle override percentages) is reported on the same
// intermittent cadence as WCO, so consumers cache it (`ovCache`) exactly
// like `wcoCache`. Other fields (Bf, Ln) are still not parsed.

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

// Active input pins, decoded from the `Pn:` field. GRBL flags limit switches
// per axis (X/Y/Z), plus probe (P) and door (D). Other Pn letters (hold/reset/
// cycle-start) are not decoded — they aren't safety-relevant to framing.
export type GrblPins = {
  readonly limitX: boolean;
  readonly limitY: boolean;
  readonly limitZ: boolean;
  readonly probe: boolean;
  readonly door: boolean;
};

// Live override percentages from the `Ov:` field (ADR-103 G3).
export type OverrideValues = {
  readonly feed: number;
  readonly rapid: number;
  readonly spindle: number;
};

export type StatusReport = {
  readonly state: GrblState;
  readonly subState: number | null;
  readonly mPos: { x: number; y: number; z: number } | null;
  readonly wPos: { x: number; y: number; z: number } | null;
  readonly feed: number | null;
  readonly spindle: number | null;
  /**
   * Active input pins from the `Pn:` field, or null when GRBL reports no pins
   * triggered (the field is omitted on the wire). Optional so hand-built test
   * mocks need not set it. Used to name which limit a Verified Frame hit
   * (ADR-053 P3).
   */
  readonly pins?: GrblPins | null;
  /**
   * Feed/rapid/spindle override percentages from `Ov:`, reported
   * intermittently like WCO. Optional so hand-built test mocks need not set
   * it; UI code reads the laser-store's `ovCache`, never this field.
   */
  readonly ov?: OverrideValues | null;
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
    pins: pickPins(fields),
    ov: pickOverrides(fields),
  };
}

function pickOverrides(fields: ReadonlyArray<string>): OverrideValues | null {
  for (const f of fields) {
    if (!f.startsWith('Ov:')) continue;
    const [feed, rapid, spindle] = f.slice('Ov:'.length).split(',').map(Number);
    if (
      feed !== undefined &&
      rapid !== undefined &&
      spindle !== undefined &&
      Number.isFinite(feed) &&
      Number.isFinite(rapid) &&
      Number.isFinite(spindle)
    ) {
      return { feed, rapid, spindle };
    }
    return null;
  }
  return null;
}

function pickPins(fields: ReadonlyArray<string>): GrblPins | null {
  for (const f of fields) {
    if (!f.startsWith('Pn:')) continue;
    const body = f.slice('Pn:'.length);
    return {
      limitX: body.includes('X'),
      limitY: body.includes('Y'),
      limitZ: body.includes('Z'),
      probe: body.includes('P'),
      door: body.includes('D'),
    };
  }
  return null;
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
