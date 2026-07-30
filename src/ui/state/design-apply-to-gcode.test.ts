// The DS-5 acceptance gate (ADR-268): a part designed in the Studio must reach
// real G-code through the UNCHANGED pipeline. This is the test that earns the
// phrase "end to end" — everything else only proves the Studio holds geometry.
//
// It deliberately goes the whole way: sketch -> Apply mutation -> compileJob ->
// grblStrategy.emit -> assertions on the emitted text, plus the laser-off
// invariant that every G0 travel is dark (PROJECT.md non-negotiable #3).

import { describe, expect, it } from 'vitest';
import type { Sketch } from '../../core/design';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import { grblStrategy } from '../../core/output';
import { createProject } from '../../core/scene';
import { applyDesignSketch } from './design-apply-mutation';

// A sign plaque: rounded outer profile, two mounting holes, one scored line.
const PLAQUE: Sketch = {
  entities: [
    {
      kind: 'rect',
      id: 'plate',
      origin: { x: 20, y: 20 },
      widthMm: 120,
      heightMm: 60,
      cornerRadiusMm: 6,
    },
    { kind: 'circle', id: 'h1', center: { x: 30, y: 30 }, radiusMm: 2.5 },
    { kind: 'circle', id: 'h2', center: { x: 130, y: 30 }, radiusMm: 2.5 },
    { kind: 'line', id: 'score', start: { x: 30, y: 65 }, end: { x: 130, y: 65 } },
  ],
};

function emitDesignedGcode(sketch: Sketch): string {
  const applied = applyDesignSketch(
    { project: createProject(), undoStack: [] },
    sketch,
    sketch.entities.map((_entity, index) => `id-${index}`),
  );
  if (applied === null) throw new Error('expected the sketch to apply');
  const job = compileJob(applied.project.scene, DEFAULT_DEVICE_PROFILE);
  return grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
}

describe('a designed part reaches G-code', () => {
  const gcode = emitDesignedGcode(PLAQUE);

  it('emits a real program, not an empty one', () => {
    expect(gcode.length).toBeGreaterThan(200);
    expect(gcode).toContain('G21');
    expect(gcode).toContain('G90');
    expect(gcode).toContain('M5');
  });

  it('emits cutting moves for every designed entity', () => {
    const cuts = gcode.split('\n').filter((line) => /^G1\b/.test(line));
    expect(cuts.length).toBeGreaterThan(40);
  });

  // Asserts the SPAN of the cuts, not their absolute position, because the device
  // profile maps the scene into the machine frame and legitimately flips Y for a
  // front-left origin (PROJECT.md non-negotiable #2). A span check is true under
  // every origin convention, so it tests the designed size rather than restating
  // the origin maths.
  //
  // Only CUTTING moves are measured: travel and the end-of-job park legitimately
  // leave the artwork box, and the laser-off test below proves those are dark.
  it('cuts a part of exactly the designed size', () => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const line of gcode.split('\n')) {
      if (!/^G1\b/.test(line)) continue;
      const x = /X(-?\d+(?:\.\d+)?)/.exec(line);
      const y = /Y(-?\d+(?:\.\d+)?)/.exec(line);
      if (x !== null) xs.push(Number(x[1]));
      if (y !== null) ys.push(Number(y[1]));
    }
    expect(xs.length).toBeGreaterThan(0);
    // The plaque is 120 x 60 mm and every hole and score sits inside it, so the
    // cut extents must equal the plaque exactly, to within one chord tolerance.
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(120, 1);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(60, 1);
  });

  // PROJECT.md non-negotiable #3, checked on designed geometry specifically.
  it('never travels with the laser on', () => {
    let lastS: number | null = null;
    let armed = false;
    for (const raw of gcode.split('\n')) {
      const line = raw.trim();
      const s = /S(\d+(?:\.\d+)?)/.exec(line);
      if (s !== null) lastS = Number(s[1]);
      if (/^M[34]\b/.test(line)) armed = true;
      if (/^M5\b/.test(line)) {
        armed = false;
        lastS = 0;
      }
      if (!/^G0\b/.test(line)) continue;
      const inlineS = s === null ? null : Number(s[1]);
      const dark = inlineS === 0 || lastS === 0 || !armed;
      expect(dark, `G0 travel emitted with the beam on: ${line}`).toBe(true);
    }
  });

  it('is deterministic — the same sketch emits byte-identical G-code', () => {
    expect(emitDesignedGcode(PLAQUE)).toBe(gcode);
  });
});

describe('the pipeline sees designed geometry as ordinary artwork', () => {
  it('compiles a rounded rectangle into a closed cut contour', () => {
    const applied = applyDesignSketch(
      { project: createProject(), undoStack: [] },
      { entities: [PLAQUE.entities[0]!] },
      ['only'],
    );
    if (applied === null) throw new Error('expected the sketch to apply');
    const job = compileJob(applied.project.scene, DEFAULT_DEVICE_PROFILE);
    const group = job.groups[0];
    expect(group?.kind).toBe('cut');
    if (group?.kind !== 'cut') return;
    expect(group.segments[0]?.closed).toBe(true);
  });
});
