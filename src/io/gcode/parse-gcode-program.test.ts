import { describe, expect, it } from 'vitest';
import { parseGcodeProgram } from './parse-gcode-program';

function ok(text: string) {
  const result = parseGcodeProgram(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result;
}

describe('parseGcodeProgram linear motion', () => {
  it('classifies rapids, feeds, and pure-Z moves into travel/cut/plunge steps', () => {
    const result = ok(
      ['G21 G90', 'G0 Z5', 'G0 X10 Y0', 'G1 Z-1 F300', 'G1 X20 Y0 F800', 'G0 Z5'].join('\n'),
    );
    const kinds = result.toolpath.steps.map((step) => step.kind);
    expect(kinds).toEqual(['plunge', 'travel', 'plunge', 'cut', 'plunge']);
    const cut = result.toolpath.steps[3];
    if (cut?.kind !== 'cut') throw new Error('cut step missing');
    expect(cut.polyline).toEqual([
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(cut.z).toEqual({ from: -1, to: -1 });
    expect(result.summary.cutMm).toBeCloseTo(10, 9);
    expect(result.summary.travelMm).toBeCloseTo(10, 9);
    expect(result.summary.plungeMm).toBeCloseTo(5 + 6 + 6, 9);
  });

  it('applies G20 inches and G91 relative coordinates', () => {
    const result = ok(['G20 G91', 'G1 X1 F30', 'G1 X1'].join('\n'));
    const [first, second] = result.toolpath.steps;
    if (first?.kind !== 'cut' || second?.kind !== 'cut') throw new Error('cuts missing');
    expect(first.polyline.at(-1)?.x).toBeCloseTo(25.4, 9);
    expect(second.polyline.at(-1)?.x).toBeCloseTo(50.8, 9);
  });

  it('keeps the motion mode modal across coordinate-only lines', () => {
    const result = ok(['G21 G90', 'G1 X5 F100', 'X10', 'Y10'].join('\n'));
    expect(result.toolpath.steps.map((s) => s.kind)).toEqual(['cut', 'cut', 'cut']);
  });

  it('stops at M2 and ignores later motion', () => {
    const result = ok(['G21 G90', 'G1 X5 F100', 'M2', 'G1 X50'].join('\n'));
    expect(result.summary.cutMm).toBeCloseTo(5, 9);
  });
});

describe('parseGcodeProgram arcs', () => {
  it('flattens an I/J quarter circle onto the analytic radius', () => {
    // CCW quarter around (0,10): from (0,0) to (10,10).
    const result = ok(['G21 G90 G17', 'G1 F500', 'G3 X10 Y10 I0 J10'].join('\n'));
    const arc = result.toolpath.steps[0];
    if (arc?.kind !== 'cut') throw new Error('arc cut missing');
    for (const point of arc.polyline) {
      expect(Math.hypot(point.x - 0, point.y - 10)).toBeCloseTo(10, 6);
    }
    expect(arc.polyline.at(-1)).toEqual({ x: 10, y: 10 });
    expect(arc.length).toBeCloseTo((Math.PI / 2) * 10, 6);
  });

  it('emits a full circle for an I/J arc that returns to its start', () => {
    const result = ok(['G21 G90', 'G2 X0 Y0 I5 J0 F500'].join('\n'));
    const arc = result.toolpath.steps[0];
    if (arc?.kind !== 'cut') throw new Error('arc cut missing');
    expect(arc.length).toBeCloseTo(Math.PI * 10, 6);
  });

  it('solves the R-form center on the correct side for CW and CCW minor arcs', () => {
    // G2 (CW) from (0,0) to (10,0) with R=10: minor arc bulges UP (+y side,
    // center below at (5,-8.66)... center right of the chord means the CW
    // arc's midpoint is above the chord? Pin it analytically: the midpoint
    // of the CW minor arc lies on the OPPOSITE side of the center.
    const cw = ok(['G21 G90', 'G2 X10 Y0 R10 F500'].join('\n'));
    const cwArc = cw.toolpath.steps[0];
    if (cwArc?.kind !== 'cut') throw new Error('cw arc missing');
    const cwMaxY = Math.max(...cwArc.polyline.map((p) => p.y));
    const cwMinY = Math.min(...cwArc.polyline.map((p) => p.y));
    // Minor arc: sagitta = R - sqrt(R² - (c/2)²) ≈ 1.34 mm; CW goes above.
    expect(cwMaxY).toBeGreaterThan(1);
    expect(cwMaxY).toBeLessThan(2);
    expect(cwMinY).toBeGreaterThanOrEqual(-1e-6);

    const ccw = ok(['G21 G90', 'G3 X10 Y0 R10 F500'].join('\n'));
    const ccwArc = ccw.toolpath.steps[0];
    if (ccwArc?.kind !== 'cut') throw new Error('ccw arc missing');
    const ccwMinY = Math.min(...ccwArc.polyline.map((p) => p.y));
    expect(ccwMinY).toBeLessThan(-1);
    expect(ccwMinY).toBeGreaterThan(-2);
  });

  it('carries helical Z through an arc step', () => {
    const result = ok(['G21 G90', 'G1 Z-1 F100', 'G2 X0 Y0 I5 J0 Z-3 F500'].join('\n'));
    const arc = result.toolpath.steps.at(-1);
    if (arc?.kind !== 'cut') throw new Error('arc missing');
    expect(arc.z).toEqual({ from: -1, to: -3 });
  });

  it('rejects arcs without I/J/R, radius mismatches, and G18/G19 planes', () => {
    expect(parseGcodeProgram('G90\nG2 X10 Y0').kind).toBe('error');
    expect(parseGcodeProgram('G90\nG2 X10 Y0 I0 J50').kind).toBe('error');
    const plane = parseGcodeProgram('G18\nG2 X10 Z0 I5 K0');
    expect(plane.kind).toBe('error');
    if (plane.kind === 'error') expect(plane.reason).toContain('G18');
  });
});

describe('parseGcodeProgram rejection and notes', () => {
  it('rejects files that do not look like G-code, naming the first line', () => {
    const result = parseGcodeProgram('hello world\nthis is prose\n');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.reason).toContain('line 1');
  });

  it('counts unsupported words instead of failing', () => {
    const result = ok(['G21 G90', 'G4 P2', 'G1 X5 F100', 'M6 T2'].join('\n'));
    expect(result.notes.join(' ')).toContain('G4');
    expect(result.notes.join(' ')).toContain('M6');
  });

  it('ignores comments, percent markers, and N numbers', () => {
    const result = ok(['%', 'N10 G21 G90 (metric)', 'N20 G1 X5 F100 ; move', '%'].join('\n'));
    expect(result.summary.cutMm).toBeCloseTo(5, 9);
  });

  it('parses an empty-motion program as ok with an empty toolpath', () => {
    const result = ok(['G21 G90', 'M5'].join('\n'));
    expect(result.toolpath.steps).toHaveLength(0);
    expect(result.toolpath.totalLength).toBe(0);
  });
});
