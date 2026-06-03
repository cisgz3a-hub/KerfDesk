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
  overscanMm: 0,
  segments: [{ polyline: [{ x: 10, y }, { x: 20, y }], closed: false }],
});

const cut = (): CutGroup => ({
  kind: 'cut',
  layerId: 'cut',
  color: '#ff0000',
  power: 50,
  speed: 1500,
  passes: 1,
  segments: [{ polyline: [{ x: 1, y: 1 }, { x: 2, y: 2 }], closed: false }],
});

describe('grblStrategy fill dynamic-power mode (ADR-036)', () => {
  it('arms M4 dynamic power before the fill body, after the M3 preamble', () => {
    const out = emit({ groups: [fill(5)] });
    // Preamble arms constant M3, then the fill flips to dynamic M4 (M5 clears
    // the constant mode first, mirroring emit-raster) before any burn.
    expect(out).toContain('G21\nG90\nM3 S0\nM5\nM4 S0\n; fill layer');
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
    expect(out).toContain('G21\nG90\nM3 S0\n; layer cut');
  });
});
