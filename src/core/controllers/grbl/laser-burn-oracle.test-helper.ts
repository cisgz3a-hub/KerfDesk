// Independent laser burn interpreter for recovery oracles. It shares no
// scanner, parser or formatter with production code, and models only what a
// GRBL-family controller in laser mode does with a program (GRBL v1.1 wiki,
// "Laser Mode"; NIST RS274NGC order of execution):
//  - motion mode is modal; a line with only axis words moves in that mode;
//  - "a G0 rapid motion mode ... will never turn on and always disable the
//    laser", so only G1 with an armed beam (M3/M4) and S > 0 burns;
//  - within one block feed, power, beam state and coolant apply before motion;
//  - G92, G10, G53, Z, arcs and inverse-time feed are not modelled and throw,
//    so a test cannot pass by silently ignoring them.

export type OraclePoint = { readonly x: number; readonly y: number };

export type OracleBurn = {
  /** 1-based source line that produced the burn. */
  readonly line: number;
  readonly from: OraclePoint;
  readonly to: OraclePoint;
  readonly power: number;
  readonly feed: number;
  readonly beam: 3 | 4;
  /** 'off', 'M7', 'M8' or 'M7M8'. */
  readonly air: string;
  /** Work frame the burn runs in: coordinate system, feed mode and units. */
  readonly frame: string;
};

type OracleState = {
  x: number | null;
  y: number | null;
  unit: number;
  absolute: boolean;
  wcs: number;
  feedMode: number;
  motion: number | null;
  beam: 0 | 3 | 4;
  power: number;
  feed: number;
  mist: boolean;
  flood: boolean;
};

function freshState(position: OraclePoint | null): OracleState {
  return {
    x: position?.x ?? null,
    y: position?.y ?? null,
    unit: 1,
    absolute: true,
    wcs: 54,
    feedMode: 94,
    motion: null,
    beam: 0,
    power: 0,
    feed: 0,
    mist: false,
    flood: false,
  };
}

function words(raw: string): Array<{ letter: string; value: number }> {
  const text = raw.replace(/\([^)]*\)/g, '').split(';')[0] ?? '';
  return [...text.toUpperCase().matchAll(/([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g)].map((m) => ({
    letter: m[1] ?? '',
    value: Number(m[2]),
  }));
}

function applyGWord(state: OracleState, value: number, line: number): void {
  if ([0, 1].includes(value)) state.motion = value;
  else if (value === 20) state.unit = 25.4;
  else if (value === 21) state.unit = 1;
  else if (value === 90) state.absolute = true;
  else if (value === 91) state.absolute = false;
  else if (value >= 54 && value <= 59) state.wcs = value;
  else if (value === 94) state.feedMode = value;
  else if (value === 17 || value === 4)
    return; // plane select; dwell (no motion, beam state unchanged)
  else throw new Error(`Line ${line}: G${value} is outside the oracle's laser subset`);
}

function applyMWord(state: OracleState, value: number): void {
  if (value === 3 || value === 4) state.beam = value;
  else if (value === 5) state.beam = 0;
  else if (value === 7) state.mist = true;
  else if (value === 8) state.flood = true;
  else if (value === 9) {
    state.mist = false;
    state.flood = false;
  }
}

function applyWord(
  state: OracleState,
  letter: string,
  value: number,
  line: number,
): Partial<OraclePoint> {
  if (letter === 'G') applyGWord(state, value, line);
  else if (letter === 'M') applyMWord(state, value);
  else if (letter === 'F') state.feed = value * state.unit;
  else if (letter === 'S') state.power = value;
  else if (letter === 'X') return { x: value };
  else if (letter === 'Y') return { y: value };
  else if (letter !== 'N' && letter !== 'P') {
    throw new Error(`Line ${line}: ${letter} words are not modelled`);
  }
  return {};
}

function axisTarget(state: OracleState, value: number | undefined, current: number | null) {
  if (value === undefined) return current;
  return value * state.unit + (state.absolute ? 0 : (current ?? 0));
}

function knownPosition(state: OracleState): OraclePoint | null {
  return state.x === null || state.y === null ? null : { x: state.x, y: state.y };
}

function burnOf(state: OracleState, from: OraclePoint | null, line: number): OracleBurn | null {
  const burning = state.motion === 1 && state.beam !== 0 && state.power > 0;
  if (!burning) return null;
  const to = knownPosition(state);
  if (from === null || to === null) throw new Error(`Line ${line}: burn from an unknown position`);
  return {
    line,
    from,
    to,
    power: state.power,
    feed: state.feed,
    beam: state.beam as 3 | 4,
    air: `${state.mist ? 'M7' : ''}${state.flood ? 'M8' : ''}` || 'off',
    frame: `G${state.wcs} G${state.feedMode} ${state.unit === 1 ? 'mm' : 'in'}`,
  };
}

function step(state: OracleState, raw: string, line: number, burns: OracleBurn[]): void {
  let target: Partial<OraclePoint> = {};
  for (const { letter, value } of words(raw)) {
    target = { ...target, ...applyWord(state, letter, value, line) };
  }
  if (target.x === undefined && target.y === undefined) return;
  const from = knownPosition(state);
  state.x = axisTarget(state, target.x, state.x);
  state.y = axisTarget(state, target.y, state.y);
  const burn = burnOf(state, from, line);
  if (burn !== null) burns.push(burn);
}

/** Burns of a whole program run on a controller whose head starts at `start`
 * (null = unknown) with the beam off and air off. */
export function oracleBurns(gcode: string, start: OraclePoint | null = null): OracleBurn[] {
  const state = freshState(start);
  const burns: OracleBurn[] = [];
  gcode.split(/\r\n|\n|\r/).forEach((raw, index) => step(state, raw, index + 1, burns));
  return burns;
}

/** Geometry, power, feed, beam and frame, without the air state or line number.
 * Takes exactly one argument so it is safe as an Array#map callback. */
export function burnGeometryKey(burn: OracleBurn): string {
  return geometryKey(burn, (value) => value);
}

/** Like `burnGeometryKey`, comparing positions at a machine resolution (3 = 1 µm)
 * for programs whose re-entry move is written at that resolution. */
export function burnGeometryKeyAt(decimals: number): (burn: OracleBurn) => string {
  const scale = 10 ** decimals;
  return (burn) => geometryKey(burn, (value) => Math.round(value * scale) / scale);
}

function geometryKey(burn: OracleBurn, at: (value: number) => number): string {
  const point = (p: OraclePoint) => ({ x: at(p.x), y: at(p.y) });
  return JSON.stringify([
    point(burn.from),
    point(burn.to),
    burn.power,
    burn.feed,
    burn.beam,
    burn.frame,
  ]);
}

export function burnLengthMm(burns: ReadonlyArray<OracleBurn>): number {
  return burns.reduce(
    (total, burn) => total + Math.hypot(burn.to.x - burn.from.x, burn.to.y - burn.from.y),
    0,
  );
}
