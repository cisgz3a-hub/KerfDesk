// CNC audit v3 N7-P3-3: surfacing capped a typed RPM and kept its feed, so the
// chip load rose by the cap ratio. It now follows the compiler's rate rule
// (ADR-233 Amendment 1). Each case reads the emitted surfacing program.
import { describe, expect, it } from 'vitest';
import { buildSurfacingProgram } from '../../core/cnc/surfacing';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG, type CncMachineConfig } from '../../core/scene';
import { surfacingParams } from './save-surfacing-program';

const MACHINE: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleMaxRpm: 12000 },
};

function program(inputs: { feedMmPerMin: number; plungeMmPerMin: number; spindleRpm: number }) {
  const result = buildSurfacingProgram(
    surfacingParams(
      { widthMm: 40, heightMm: 20, stepoverPct: 40, totalDepthMm: 0.5, ...inputs },
      createProject(),
      MACHINE,
    ),
  );
  if (!result.ok) return { ok: false as const, reason: result.reason };
  const lines = [...result.program.lines];
  const feeds = (move: RegExp) => [
    ...new Set(lines.filter((line) => move.test(line)).map((line) => /F(\S+)/.exec(line)?.[1])),
  ];
  return {
    ok: true as const,
    spindle: lines.filter((line) => /^M3 S/.test(line)),
    xyFeeds: feeds(/^G1 [XY]/),
    plungeFeeds: feeds(/^G1 Z-/),
  };
}

describe('surfacing scales its feeds with a capped spindle (N7-P3-3)', () => {
  it('sends S12000 with feed and plunge halved for a typed 24,000 RPM', () => {
    const out = program({ feedMmPerMin: 2000, plungeMmPerMin: 400, spindleRpm: 24000 });
    if (!out.ok) throw new Error(out.reason);
    expect(out.spindle).toEqual(['M3 S12000']);
    expect(out.xyFeeds).toEqual(['1000.000']);
    expect(out.plungeFeeds).toEqual(['200.000']);
  });

  it('leaves an uncapped program unchanged', () => {
    const out = program({ feedMmPerMin: 2000, plungeMmPerMin: 400, spindleRpm: 10000 });
    if (!out.ok) throw new Error(out.reason);
    expect(out.spindle).toEqual(['M3 S10000']);
    expect(out.xyFeeds).toEqual(['2000.000']);
    expect(out.plungeFeeds).toEqual(['400.000']);
  });

  it('still refuses a typed feed of 0 by name instead of sending F1', () => {
    const out = program({ feedMmPerMin: 0, plungeMmPerMin: 400, spindleRpm: 24000 });
    expect(out.ok).toBe(false);
  });
});
