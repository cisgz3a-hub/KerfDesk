import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel } from './gcode-render-model';
import { LINE_CATEGORY, SEG_KIND, SEG_MOTION, type GcodeRenderModel } from './render-model-types';

function okModel(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(`expected ok, got: ${result.reason}`);
  return result.model;
}

describe('buildGcodeRenderModel — segments', () => {
  it('classifies travel, cut, plunge, and retract with modal F/S and source lines', () => {
    const model = okModel(
      [
        'G21 G90', // 0 modal
        'M3 S500', // 1 event
        'G0 X10 Y0', // 2 travel
        'G1 Z-1 F100', // 3 plunge at plunge feed
        'G1 X20 Y0 F600', // 4 cut
        'G0 Z5', // 5 retract (rapid)
        'M5', // 6 event
      ].join('\n'),
    );
    expect(model.segmentCount).toBe(4);
    expect([...model.segKind]).toEqual([
      SEG_KIND.travel,
      SEG_KIND.plunge,
      SEG_KIND.cut,
      SEG_KIND.retract,
    ]);
    expect([...model.segMotion]).toEqual([
      SEG_MOTION.rapid,
      SEG_MOTION.linear,
      SEG_MOTION.linear,
      SEG_MOTION.rapid,
    ]);
    expect([...model.segLine]).toEqual([2, 3, 4, 5]);
    expect(model.segFeed[1]).toBe(100);
    expect(model.segFeed[2]).toBe(600);
    expect(model.segPower[2]).toBe(500);
    expect(model.totalRouteMm).toBeCloseTo(10 + 1 + 10 + 6, 5);
    expect(model.stats.zLevels).toEqual([-1]);
  });

  it('keeps cumulative route arc-true and helix-true', () => {
    const quarter = okModel(['G21 G90', 'G0 X0 Y10', 'G2 X10 Y0 I0 J-10 F300'].join('\n'));
    const arcLength = quarter.totalRouteMm - 10; // minus the travel
    expect(arcLength).toBeCloseTo((Math.PI / 2) * 10, 3);

    const helix = okModel(['G21 G90', 'G0 X10 Y0', 'G2 X10 Y0 I-10 J0 Z-2 F250'].join('\n'));
    const helixLength = helix.totalRouteMm - 10;
    expect(helixLength).toBeCloseTo(Math.hypot(2 * Math.PI * 10, 2), 3);
  });

  it('scales inch programs (coordinates and F) and accumulates relative moves', () => {
    const model = okModel(['G20 G91', 'G1 X1 F30', 'G1 X1'].join('\n'));
    const base = 1 * 6;
    expect(model.positions[base + 3]).toBeCloseTo(50.8, 3);
    expect(model.totalRouteMm).toBeCloseTo(50.8, 3);
    expect(model.segFeed[0]).toBeCloseTo(762, 3);
  });
});

describe('buildGcodeRenderModel — events and accountability', () => {
  it('records events and categorizes every line exactly once', () => {
    const text = [
      '%', // 0 marker
      '', // 1 blank
      '; comment', // 2 comment
      '(also comment)', // 3 comment
      'G21 G90', // 4 modal-only
      'G54 G94', // 5 event (wcs) + modal no-op
      'M3 S200', // 6 event
      'G4 P1.5', // 7 event (dwell)
      'T2', // 8 event (tool word)
      'G1 X5 F100', // 9 motion
      'M0', // 10 event (pause)
      'G43 H1', // 11 unsupported words only
      '!!!???', // 12 junk
      'M2', // 13 event (program end)
      'G1 X9', // 14 after end
    ].join('\n');
    const model = okModel(text);
    const kinds = model.events.map((event) => event.kind);
    expect(kinds).toContain('wcs-select');
    expect(kinds).toContain('spindle-on');
    expect(kinds).toContain('dwell');
    expect(kinds).toContain('tool-word');
    expect(kinds).toContain('pause');
    expect(kinds).toContain('program-end');
    const dwell = model.events.find((event) => event.kind === 'dwell');
    expect(dwell !== undefined && dwell.kind === 'dwell' ? dwell.seconds : 0).toBeCloseTo(1.5, 9);

    expect(model.lineCategories.length).toBe(model.lineCount);
    expect(model.lineCategories[0]).toBe(LINE_CATEGORY.marker);
    expect(model.lineCategories[1]).toBe(LINE_CATEGORY.blank);
    expect(model.lineCategories[2]).toBe(LINE_CATEGORY.comment);
    expect(model.lineCategories[3]).toBe(LINE_CATEGORY.comment);
    expect(model.lineCategories[4]).toBe(LINE_CATEGORY.modalOnly);
    expect(model.lineCategories[5]).toBe(LINE_CATEGORY.event);
    expect(model.lineCategories[6]).toBe(LINE_CATEGORY.event);
    expect(model.lineCategories[7]).toBe(LINE_CATEGORY.event);
    expect(model.lineCategories[8]).toBe(LINE_CATEGORY.event);
    expect(model.lineCategories[9]).toBe(LINE_CATEGORY.motion);
    expect(model.lineCategories[10]).toBe(LINE_CATEGORY.event);
    expect(model.lineCategories[11]).toBe(LINE_CATEGORY.unsupported);
    expect(model.lineCategories[12]).toBe(LINE_CATEGORY.junk);
    expect(model.lineCategories[13]).toBe(LINE_CATEGORY.event);
    expect(model.lineCategories[14]).toBe(LINE_CATEGORY.afterEnd);

    // Accountability: every category value is a known one, and every segment
    // points at a motion-categorized line.
    const valid = new Set<number>(Object.values(LINE_CATEGORY));
    for (const category of model.lineCategories) expect(valid.has(category)).toBe(true);
    for (const line of model.segLine) {
      expect(model.lineCategories[line]).toBe(LINE_CATEGORY.motion);
    }
  });

  it('counts unsupported words with their first line', () => {
    // G43/H remain uninterpreted; G99 and Q became meaningful when canned
    // cycles landed, so they are no longer valid "unsupported" examples.
    const model = okModel(['G21', 'G43 X1', 'G43', 'H5'].join('\n'));
    const g43 = model.unsupportedWords.find((entry) => entry.word === 'G43');
    expect(g43?.count).toBe(2);
    expect(g43?.firstLine).toBe(1);
    expect(model.unsupportedWords.find((entry) => entry.word === 'H')?.count).toBe(1);
  });

  it('homes named axes as visible rapids (G28)', () => {
    // Value form (G28 X0 Y0): bare-letter axis flags carry no number and are
    // invisible to the shared word scanner, which then homes all axes.
    const model = okModel(['G21 G90', 'G1 X10 Y10 F300', 'G28 X0 Y0'].join('\n'));
    const home = model.events.find((event) => event.kind === 'home');
    expect(home !== undefined && home.kind === 'home' ? [...home.axes] : []).toEqual(['X', 'Y']);
    expect(model.segmentCount).toBe(2);
    expect(model.segKind[1]).toBe(SEG_KIND.travel);
    const base = 1 * 6;
    expect(model.positions[base + 3]).toBe(0);
    expect(model.positions[base + 4]).toBe(0);
  });
});

describe('buildGcodeRenderModel — forgiving motion policy', () => {
  it('seeds absolute motion from the supplied work-coordinate position', () => {
    const result = buildGcodeRenderModel('G21 G90\nG0 X110', {
      initialPositionMm: { x: 100, y: 20, z: 3 },
    });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.model.segmentCount).toBe(1);
    expect([...result.model.positions]).toEqual([100, 20, 3, 110, 20, 3]);
  });

  it('skips bad arcs with reasons instead of failing', () => {
    const model = okModel(
      [
        'G21 G90',
        'G2 X10 Y0', // arc without I/J/R
        'G0 X0 Y0',
        'G2 X10 Y0 R3', // radius too small for chord
        'G18',
        'G2 X20 Y0 I5 J0', // wrong plane
        'G17',
        'G1 X30 F100', // still renders after the skips
      ].join('\n'),
    );
    expect(model.skippedMotions.map((skip) => skip.reason)).toEqual([
      'arc needs I/J or R',
      'arc radius too small for its chord',
      'G18/G19 plane arcs are not renderable (XY only)',
    ]);
    expect(model.segmentCount).toBe(1);
    expect(model.segKind[0]).toBe(SEG_KIND.cut);
  });

  // ADR-268: only not-G-code is refused now. The line ceiling was a policy cap,
  // and keeping it here meant a program the parser accepted could not be viewed.
  it('rejects not-G-code, and renders a long program rather than refusing it', () => {
    expect(buildGcodeRenderModel('hello world\nthis is prose').kind).toBe('error');

    const body = 'G1 X1 Y1\nG1 X2 Y2\n'.repeat(300_000);
    const model = buildGcodeRenderModel('G21 G90\n' + body);

    expect(model.kind).toBe('ok');
    if (model.kind !== 'ok') return;
    expect(model.model.segmentCount).toBeGreaterThan(500_000);
  });

  it('keeps the default Inspector model uncapped while honoring an explicit segment budget', () => {
    const program = 'G21 G90\nG0 X10 Y0\nG2 X10 Y0 I-10 J0 F600';
    const inspector = buildGcodeRenderModel(program);
    const bounded = buildGcodeRenderModel(program, { maxSegments: 1 });

    expect(inspector.kind).toBe('ok');
    if (inspector.kind === 'ok') expect(inspector.model.segmentCount).toBeGreaterThan(1);
    expect(bounded).toMatchObject({
      kind: 'error',
      segmentLimit: { maximum: 1 },
    });
  });

  it('warns about render pressure without dropping any segment', () => {
    const program = ['G21 G90', 'G1 X1', 'G1 X2', 'G1 X3', 'M2'].join('\n');
    const result = buildGcodeRenderModel(program, { renderPressureThreshold: 2 });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.model.segmentCount).toBe(3);
    expect(result.model.renderPressure).toEqual({ threshold: 2, observed: 3 });
    expect(result.model.lineCount).toBe(5);
    expect(result.model.events.some((event) => event.kind === 'program-end')).toBe(true);
  });
});
