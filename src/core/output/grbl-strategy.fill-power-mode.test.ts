// Fix 1 / ADR-036 — fill engraving emits M4 DYNAMIC power, not M3 constant.
//
// The small-text "uneven density" defect (docs/research/burn-perfection-small-
// text.md, Cause A): under M3 a short engrave stroke that never reaches the
// commanded feed over-burns wherever the head is slow (accel-from-rest inside a
// few-mm glyph). M4 makes GRBL scale S by actual/programmed feed, holding
// energy/mm constant. Raster already used M4; this wires the same mode into the
// fill path. These tests pin the cross-group mode state machine (the failure
// mode CLAUDE.md requires covered, not just the happy path) and prove the cut
// path is byte-unchanged.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { findLaserOnTravelIssues } from '../invariants';
import type { CutGroup, FillGroup, Job } from '../job';
import { grblStrategy } from './grbl-strategy';

const dev = DEFAULT_DEVICE_PROFILE;
const emit = (job: Job): string => grblStrategy.emit(job, dev);

const fill = (y: number): FillGroup => ({
  kind: 'fill',
  layerId: 'fill',
  color: '#000000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  overscanMm: 0,
  segments: [
    {
      polyline: [
        { x: 10, y },
        { x: 20, y },
      ],
      closed: false,
      reverse: false,
    },
  ],
});

const cut = (): CutGroup => ({
  kind: 'cut',
  layerId: 'cut',
  color: '#ff0000',
  power: 50,
  speed: 1500,
  passes: 1,
  airAssist: false,
  segments: [
    {
      polyline: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
      closed: false,
    },
  ],
});

describe('grblStrategy fill dynamic-power mode (ADR-036)', () => {
  it('arms M4 dynamic power before the fill body, after the M3 preamble', () => {
    const out = emit({ groups: [fill(5)] });
    // Preamble arms constant M3, then the fill flips to dynamic M4 (M5 clears
    // the constant mode first, mirroring emit-raster) before any burn.
    expect(out).toContain('G21\nG90\nG54\nG94\nM3 S0\nM5\nM4 S0\n; fill layer');
    // The burn G1 comes AFTER the M4 flip — so it runs under dynamic power.
    expect(out.indexOf('G1 X20.000 Y5.000')).toBeGreaterThan(out.indexOf('M4 S0'));
    // No constant-power burn: there is no M3 with positive S anywhere.
    expect(out).not.toMatch(/^M3 S[1-9]/m);
    // Still PROJECT.md #3 clean (M4 S0 sets sticky S=0; every G0 stays laser-off).
    expect(findLaserOnTravelIssues(out)).toEqual([]);
  });

  it('restores constant power (M3) when a cut group follows a fill group', () => {
    const out = emit({ groups: [fill(5), cut()] });
    // fill arms M4; the cut that follows must flip back to constant M3 so a slow
    // corner still cuts through.
    expect(out).toContain('M3 S0\n; layer cut color #ff0000');
    expect(out.indexOf('M3 S0\n; layer cut')).toBeGreaterThan(out.indexOf('M4 S0'));
  });

  it('emits a single M4 flip for consecutive fill groups (no redundant re-arm)', () => {
    const out = emit({ groups: [fill(5), fill(10)] });
    expect(out.match(/^M4 S0$/gm) ?? []).toHaveLength(1);
  });

  it('leaves a cut-only job byte-identical — never emits M4', () => {
    const out = emit({ groups: [cut()] });
    expect(out).not.toContain('M4');
    expect(out).toContain('G21\nG90\nG54\nG94\nM3 S0\n; layer cut');
  });

  it('re-arms between passes with the GROUP effective mode, not the dialect default', () => {
    // Rolling audit 2026-07-17-0625 P2-1: the pass-2 re-arm hardcoded the
    // dialect's cutPowerMode (always M3 S0), so a dynamic-override cut layer
    // burned pass 1 under M4 and passes 2+ under M3 — and emitJob's modal
    // tracker was never told, so a following fill group got no re-arm at all.
    const dynamicCut: CutGroup = {
      ...cut(),
      layerId: 'dyn-multi',
      powerMode: 'dynamic',
      passes: 2,
    };
    const out = emit({ groups: [dynamicCut, fill(5)] });
    // Pass 2 re-arms dynamic, never constant.
    expect(out).toContain('; pass 2 of 2\nM4 S0');
    // The ONLY M3 S0 in the file is the preamble arm — the controller is in
    // M4 when the fill body runs, matching the tracker.
    expect(out.match(/^M3 S0$/gm) ?? []).toHaveLength(1);
    expect(findLaserOnTravelIssues(out)).toEqual([]);
  });

  it('re-arms between passes with constant power for a plain multi-pass cut (unchanged)', () => {
    const multiCut: CutGroup = { ...cut(), layerId: 'plain-multi', passes: 2 };
    const out = emit({ groups: [multiCut] });
    expect(out).toContain('; pass 2 of 2\nM3 S0');
    expect(out).not.toContain('M4');
  });

  it('emits no motion for a degenerate single-point segment', () => {
    const degenerate: CutGroup = {
      ...cut(),
      layerId: 'degen',
      segments: [{ polyline: [{ x: 5, y: 5 }], closed: false }],
    };
    const out = emit({ groups: [degenerate] });
    // A one-point polyline has nothing to cut; it must not emit a bare rapid.
    expect(out).not.toContain('X5.000 Y5.000');
  });

  it('drops a vector segment that collapses at emit precision', () => {
    const degenerate: CutGroup = {
      ...cut(),
      layerId: 'rounded-degen',
      segments: [
        {
          polyline: [
            { x: 1, y: 1.0000000000000002 },
            { x: 1, y: 1 },
            { x: 1.0000000000000002, y: 1 },
          ],
          closed: false,
        },
      ],
    };
    const out = emit({ groups: [degenerate] });
    expect(out).not.toContain('X1.000 Y1.000');
    expect(out).not.toMatch(/^G1 .* S[1-9]/m);
  });

  it('puts feed and power on the first real move after a collapsed prefix', () => {
    const collapsedPrefix: CutGroup = {
      ...cut(),
      layerId: 'collapsed-prefix',
      segments: [
        {
          polyline: [
            { x: 1, y: 1 },
            { x: 1.0004, y: 1.0004 },
            { x: 2, y: 2 },
          ],
          closed: false,
        },
      ],
    };
    const out = emit({ groups: [collapsedPrefix] });
    expect(out).not.toContain('G1 X1.000 Y1.000');
    expect(out).toContain('G1 X2.000 Y2.000 F1500 S500');
  });

  it('honors explicit vector overrides and switches before each affected group', () => {
    const dynamicCut: CutGroup = { ...cut(), layerId: 'dynamic-cut', powerMode: 'dynamic' };
    const constantFill: FillGroup = {
      ...fill(5),
      layerId: 'constant-fill',
      powerMode: 'constant',
    };
    const out = emit({ groups: [dynamicCut, constantFill] });

    expect(out).toContain('M5\nM4 S0\n; layer dynamic-cut');
    expect(out).toContain('M3 S0\n; fill layer constant-fill');
    expect(out.indexOf('M4 S0')).toBeLessThan(out.indexOf('; layer dynamic-cut'));
    expect(out.lastIndexOf('M3 S0')).toBeLessThan(out.indexOf('; fill layer constant-fill'));
    expect(findLaserOnTravelIssues(out)).toEqual([]);
  });
});
