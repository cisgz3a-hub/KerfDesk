import { describe, expect, it } from 'vitest';
import { applyLumaAdjustments, lumaAdjustmentLut, type LumaAdjustments } from './luma-adjust';

const RAMP = Uint8Array.from({ length: 256 }, (_, level) => level);
const BRIGHTNESS = [-100, -40, -10, -2, 0, 3, 10, 25, 60, 100];
const CONTRAST = [-100, -60, -15, 0, 5, 25, 50, 100];
const GAMMA = [0.1, 0.4, 0.8, 1, 1.2, 1.7, 3, 5];

function* settingsGrid(): Generator<LumaAdjustments> {
  for (const brightness of BRIGHTNESS) {
    for (const contrast of CONTRAST) {
      for (const gamma of GAMMA) yield { brightness, contrast, gamma };
    }
  }
}

// The composed curve before any rounding: the documented stage order and
// clamps, kept in floating point (ADR-671).
function exactLevel(level: number, { brightness = 0, contrast = 0, gamma = 1 }: LumaAdjustments) {
  const clamp = (v: number): number => Math.max(0, Math.min(255, v));
  const brightened = clamp(level + brightness * 2.55);
  const contrasted = clamp((brightened - 128) * (1 + contrast / 100) + 128);
  const g = Math.max(0.1, Math.min(5, gamma));
  return clamp(Math.pow(contrasted / 255, 1 / g) * 255);
}

// The former implementation: every stage rounded to a byte before the next.
function stageRoundedLevel(level: number, adjustments: LumaAdjustments): number {
  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
  const { brightness = 0, contrast = 0, gamma = 1 } = adjustments;
  let v = level;
  if (brightness !== 0) v = byte(v + brightness * 2.55);
  if (contrast !== 0) v = byte((v - 128) * (1 + contrast / 100) + 128);
  const g = Math.max(0.1, Math.min(5, gamma));
  if (g !== 1) v = byte(Math.pow(v / 255, 1 / g) * 255);
  return v;
}

describe('applyLumaAdjustments', () => {
  it('returns the same buffer for neutral adjustments', () => {
    const input = new Uint8Array([0, 128, 255]);
    expect(applyLumaAdjustments(input, {})).toBe(input);
    expect(applyLumaAdjustments(input, { brightness: 0, contrast: 0, gamma: 1 })).toBe(input);
    expect(lumaAdjustmentLut({ brightness: 0, contrast: 0, gamma: 1 })).toBeNull();
  });

  it('applies brightness, contrast, then gamma without mutating input', () => {
    const input = new Uint8Array([64, 128, 192]);
    const out = applyLumaAdjustments(input, { brightness: 10, contrast: 50, gamma: 2 });

    expect(Array.from(input)).toEqual([64, 128, 192]);
    // 64 -> 89.5 -> 70.25 -> 133.84: one rounding gives 134, where rounding
    // each stage (90 -> 71 -> 134.55) gave 135.
    expect(Array.from(out)).toEqual([134, 206, 255]);
  });

  it('clamps extreme gamma into the safe trace-adjustment range', () => {
    const input = new Uint8Array([128]);
    expect(Array.from(applyLumaAdjustments(input, { gamma: 0 }))).toEqual([0]);
    expect(Array.from(applyLumaAdjustments(input, { gamma: 99 }))).toEqual([222]);
  });

  it('maps every pixel through one 256-entry curve', () => {
    const adjustments = { brightness: 12, contrast: 30, gamma: 1.3 };
    const lut = lumaAdjustmentLut(adjustments);
    expect(Array.from(applyLumaAdjustments(RAMP, adjustments))).toEqual(Array.from(lut ?? []));
  });
});

describe('lumaAdjustmentLut (ADR-671)', () => {
  it('rounds only once: every level is within half a grey level of the exact curve', () => {
    let worst = 0;
    let worstStageRounded = 0;
    for (const adjustments of settingsGrid()) {
      const lut = lumaAdjustmentLut(adjustments) ?? RAMP;
      for (let level = 0; level < 256; level += 1) {
        const exact = exactLevel(level, adjustments);
        worst = Math.max(worst, Math.abs((lut[level] ?? -1) - exact));
        worstStageRounded = Math.max(
          worstStageRounded,
          Math.abs(stageRoundedLevel(level, adjustments) - exact),
        );
      }
    }
    expect(worst).toBeLessThanOrEqual(0.5);
    // The former stage rounding strayed far from the curve near black under
    // strong gamma, the error this change removes.
    expect(worstStageRounded).toBeGreaterThan(20);
  });

  it('matches the former bytes when only one tone control is off its default', () => {
    for (const adjustments of settingsGrid()) {
      const active = [
        (adjustments.brightness ?? 0) !== 0,
        (adjustments.contrast ?? 0) !== 0,
        (adjustments.gamma ?? 1) !== 1,
      ].filter(Boolean).length;
      if (active !== 1) continue;
      const lut = lumaAdjustmentLut(adjustments);
      expect(Array.from(lut ?? [])).toEqual(
        Array.from(RAMP, (level) => stageRoundedLevel(level, adjustments)),
      );
    }
  });

  it('keeps the grey levels that stage rounding merged in a portrait curve', () => {
    const adjustments = { brightness: 10, contrast: 25, gamma: 1.2 };
    const lut = lumaAdjustmentLut(adjustments) ?? RAMP;
    const former = Array.from(RAMP, (level) => stageRoundedLevel(level, adjustments));

    expect(new Set(lut).size).toBe(205);
    expect(new Set(former).size).toBe(196);
  });

  it('stays monotonic, so no grey level ever overtakes a darker one', () => {
    let reversals = 0;
    for (const adjustments of settingsGrid()) {
      const lut = lumaAdjustmentLut(adjustments) ?? RAMP;
      for (let level = 1; level < 256; level += 1) {
        if ((lut[level] ?? 0) < (lut[level - 1] ?? 0)) reversals += 1;
      }
    }
    expect(reversals).toBe(0);
  });
});
