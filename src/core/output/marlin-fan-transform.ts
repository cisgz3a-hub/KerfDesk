// Fan-mosfet power transform (ADR-095, 'marlin-fan' dialect). Converts the
// inline-power G-code body (per-move S words) into fan-PWM control: power
// changes become `M106 S<0-255>` lines between moves, travel is guarded by
// `M107`, and M3/M4/M5 spindle words (meaningless on a fan mosfet) become
// explicit fan-off lines. Pure text transform — deterministic in, out.

const MOTION_RE = /^(G0|G1)\b/;
const S_WORD_RE = /\s*\bS(-?\d+(?:\.\d+)?)/;
const SPINDLE_ON_RE = /^M[34]\b/;
const SPINDLE_OFF_RE = /^M5\b/;
const FAN_MAX = 255;

type FanTransformContext = {
  readonly out: string[];
  readonly maxPowerS: number;
  currentFan: number; // -1 = unknown → first change always emits
};

export function toMarlinFanGcode(body: string, maxPowerS: number): string {
  const ctx: FanTransformContext = { out: [], maxPowerS, currentFan: -1 };
  for (const rawLine of body.split('\n')) transformFanLine(ctx, rawLine);
  return ctx.out.join('\n');
}

function transformFanLine(ctx: FanTransformContext, rawLine: string): void {
  const line = rawLine.trim();
  if (line === '' || line.startsWith(';')) {
    ctx.out.push(rawLine);
    return;
  }
  if (SPINDLE_ON_RE.test(line) || SPINDLE_OFF_RE.test(line)) {
    // M3 S0 / M4 S0 arm lines and M5 disarm lines both map to fan-off.
    setFanPower(ctx, 0);
    return;
  }
  const motion = MOTION_RE.exec(line);
  if (motion === null) {
    ctx.out.push(rawLine);
    return;
  }
  transformMotionLine(ctx, line, motion[1] === 'G0');
}

function transformMotionLine(ctx: FanTransformContext, line: string, isTravel: boolean): void {
  const sMatch = S_WORD_RE.exec(line);
  const stripped = line.replace(S_WORD_RE, '');
  if (isTravel) {
    // Travel: beam must be off (non-negotiable #3). M107 satisfies the
    // laser-off-on-travel predicate the same way sticky S0 does.
    setFanPower(ctx, 0);
    ctx.out.push(stripped);
    return;
  }
  const power = sMatch === null ? ctx.currentFan : scaleFanPower(sMatch[1] ?? '0', ctx.maxPowerS);
  if (power >= 0) setFanPower(ctx, power);
  ctx.out.push(stripped);
}

function setFanPower(ctx: FanTransformContext, power: number): void {
  if (power === ctx.currentFan) return;
  ctx.out.push(power === 0 ? 'M107' : `M106 S${power}`);
  ctx.currentFan = power;
}

function scaleFanPower(sText: string, maxPowerS: number): number {
  const value = Number.parseFloat(sText);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const max = maxPowerS > 0 ? maxPowerS : FAN_MAX;
  return Math.max(0, Math.min(FAN_MAX, Math.round((value / max) * FAN_MAX)));
}
