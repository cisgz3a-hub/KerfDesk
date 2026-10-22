import { describe, expect, it } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../gcode-view';
import { reviewExternalProgram, type ExternalProgramContext } from './external-program-review';
import { kerfDeskBitChangeLabels } from './kerfdesk-bit-changes';
import { normalizeExternalProgram } from './normalize-external-program';

const LASER: ExternalProgramContext = { machineKind: 'laser', laserMaxPowerS: 1000 };
const CNC: ExternalProgramContext = { machineKind: 'cnc', laserMaxPowerS: 1000 };

function model(gcode: string, machineKind: 'laser' | 'cnc' = 'laser'): GcodeRenderModel {
  const result = buildGcodeRenderModel(gcode, { machineKind });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

// As the Run dialog does: review the exact canonical bytes, baseline first.
function sendable(file: string): string {
  const normalized = normalizeExternalProgram(file);
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
  return normalized.program.gcode;
}

function review(file: string, context = LASER) {
  const gcode = sendable(file);
  return reviewExternalProgram(gcode, model(gcode, context.machineKind), context);
}

// As the Run dialog does: read from where the head stands, placing only what
// the program moves in the coordinates it starts in.
function reviewFrom(file: string, start: { x: number; y: number; z: number }, context = LASER) {
  const gcode = sendable(file);
  const result = buildGcodeRenderModel(gcode, {
    machineKind: context.machineKind,
    initialPositionMm: start,
    boundsFromStart: true,
  });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return reviewExternalProgram(gcode, result.model, { ...context, start });
}

const HEAD = { x: 50, y: 50, z: 0 };

describe('external G-code program review (ADR-630)', () => {
  it('measures the XY envelope in work millimetres', () => {
    const result = review('G21 G90\nG0 X10 Y5\nM4 S500\nG1 X60 Y5 F1000\nG1 X60 Y45\nM5\n');
    expect(result.envelope).toEqual({ minX: 10, minY: 5, maxX: 60, maxY: 45 });
    expect(result.units).toBe('mm');
    expect(result.warnings).toEqual([]);
  });

  it('includes arc extents, relative moves and inch programs', () => {
    const arc = review('G21 G90\nG0 X0 Y0\nM4 S300\nG2 X20 Y0 I10 J0 F600\nM5\n');
    expect(arc.envelope?.maxY).toBeCloseTo(10, 6);
    const relative = review('G21 G91\nG0 X5 Y5\nM4 S300\nG1 X10 F600\nG1 Y10\nM5\n');
    // A relative program is read from the work origin, which it then leaves.
    expect(relative.envelope).toEqual({ minX: 0, minY: 0, maxX: 15, maxY: 15 });
    expect(relative.warnings.join()).toContain('relative moves (G91)');
    const inches = review('G20 G90\nG0 X1 Y1\nM4 S300\nG1 X2 F20\nM5\n');
    expect(inches.envelope).toEqual({ minX: 25.4, minY: 25.4, maxX: 50.8, maxY: 25.4 });
    expect(inches.units).toBe('inch');
    expect(inches.warnings.some((warning) => warning.includes('inches (G20)'))).toBe(true);
  });

  it('has no envelope for a program that never moves', () => {
    expect(review('G21\nM5\n').envelope).toBeNull();
  });

  it('discloses the synthetic XY origin and point Frame for a Z-only program', () => {
    const result = review('G21 G90\nG1 Z-1 F100\n', CNC);
    expect(result.envelope).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    expect(result.warnings.join()).toContain('zero XY extent');
    expect(result.warnings.join()).toContain('never sets X or Y, so it runs where the head stands');
    expect(result.warnings.join()).toContain('does not prove Z clearance or cutting depth');
  });

  it('keeps a declared point and a one-axis outline distinct from unknown XY', () => {
    const point = review('G21 G90\nG0 X10 Y5\nG1 Z-1 F100\n', CNC);
    expect(point.envelope).toEqual({ minX: 10, minY: 5, maxX: 10, maxY: 5 });
    expect(point.warnings.join()).toContain('zero XY extent');
    expect(point.warnings.join()).not.toContain('never sets');
    const line = review('G21 G90\nG0 X10 Y5\nG1 X20 F100\n', CNC);
    expect(line.envelope).toEqual({ minX: 10, minY: 5, maxX: 20, maxY: 5 });
    expect(line.warnings.join()).not.toContain('zero XY extent');
  });

  it('warns about moves the Frame cannot trace', () => {
    const warnings = review(
      'G21 G90\nG0 X1 Y1\nG53 G0 X0 Y0\nG55\nG92 X0 Y0\nG28\nM6 T2\nM5\n',
      CNC,
    ).warnings.join('\n');
    expect(warnings).toContain('machine coordinates (G53)');
    expect(warnings).toContain('switches to G55');
    expect(warnings).toContain('own origin (G92)');
    expect(warnings).toContain('stored position (G28 or G30)');
    expect(warnings).toContain('tool change (M6)');
  });

  it('finds packed words and leaves look-alike numbers alone', () => {
    expect(review('G21\nN10G0G53X0Y0\nM5\n').warnings.join()).toContain('G53');
    expect(review('G21\nG0 X53 Y92\nG1 X28 F100 S60\nM5\n').warnings).toEqual([]);
  });

  it.each(['G10 L20 P1 X0 Y0', 'n12g010.0l020p1x0y0', 'L20 P0 G 1 0 X 0'])(
    'warns precisely about unmodelled work-offset writes, including aliases: %s',
    (line) => {
      const warnings = review(`G21 G90\nG0 X0 Y0\n${line}\nG1 X20 F600\nM5\n`).warnings.join();
      expect(warnings).toContain('work-coordinate offsets (G10 L20)');
      expect(warnings).toContain('may be displaced from the traced outline');
    },
  );

  it('names direct offset writes and leaves numeric lookalikes alone', () => {
    expect(review('G21\nG0 X0\nG10L2P1X5\nG1X20F600\nM5\n').warnings.join()).toContain('G10 L2');
    expect(review('G21\nG0 X10 Y20\nG1 X20 F600\nM5\n').warnings).toEqual([]);
  });

  it('ignores offset-write words that occur only in comments', () => {
    expect(
      review('G21\n(G10 L20 P1 X0 Y0)\nG0 X0 Y0 ; G10 L2 P1 X5\nG1 X20 F600\nM5\n').warnings,
    ).toEqual([]);
  });

  it('warns when the laser or spindle is still on at the end', () => {
    const warnings = review('G21 G90\nM3 S500\nG1 X10 F600\n').warnings.join('\n');
    expect(warnings).toContain('never sends M5');
  });

  it('counts M2/M30 as switching the tool off, as GRBL does, until a later M3/M4', () => {
    for (const end of ['M30', 'M2']) {
      const ended = review(`G21 G90\nM3 S500\nG1 X10 F600\n${end}\n`).warnings.join('\n');
      expect(ended).not.toContain('never sends M5');
    }
    const relit = review('G21 G90\nM3 S500\nG1 X10 F600\nM30\nM3 S200\nG1 X20\n').warnings;
    expect(relit.join('\n')).toContain('never sends M5');
  });

  it('warns when the program looks like the other machine mode', () => {
    const router = 'G21 G90\nM3 S18000\nG0 Z5\nG0 X0 Y0\nG1 Z-2 F300\nG1 X10 F800\nM5\n';
    const laserWarnings = review(router, LASER).warnings.join('\n');
    expect(laserWarnings).toContain('S18000, above');
    expect(laserWarnings).toContain('moves Z');
    const flat = review('G21 G90\nG0 X0 Y0\nM3 S800\nG1 X10 F800\nM5\n', CNC).warnings.join();
    expect(flat).toContain('never moves Z');
  });

  it('adds Program Health findings above info severity', () => {
    const gcode = 'G21\nG0 X1 Y1\nG1 X2 F600\n';
    const result = reviewExternalProgram(gcode, model(gcode), LASER, [
      { id: 'a', severity: 'warning', title: 'Odd', detail: 'Something odd.', line: 1, count: 1 },
      { id: 'b', severity: 'info', title: 'Note', detail: 'Just a note.', line: null, count: 1 },
    ]);
    expect(result.warnings).toEqual(['Odd: Something odd.']);
  });
});

describe('external program stops (ADR-630)', () => {
  // M1 differs per firmware: program-stops.test.ts (ADR-630 Amendment 5).
  it("says an M0 stop waits for the machine's own cycle start", () => {
    const stopped = review('G21 G90\nG0 X0 Y0\nM0\nG1 X10 F100 S50\nM5\n').warnings.join('\n');
    expect(stopped).toContain('stops with M0. The controller holds there');
    expect(review('G21\nG0 X0 Y0\nG1 X5 F100\nM5\nM30\n').warnings.join()).not.toContain(
      'stops with',
    );
    expect(review('G21\nG0 X0 Y0\nG1 X5 F100\nM5\nM10\n').warnings.join()).not.toContain(
      'stops with',
    );
  });

  // Controller audit v4 E3-P2-1 (ADR-392 Amendment 2): KerfDesk's own bit
  // change cannot be re-zeroed once its M0 is with the controller.
  it('names a KerfDesk bit change at an M0, and only then', () => {
    const file =
      'G21\nG0 X0 Y0\nM3 S12000\nG1 Z-1 F300\nG0 Z5\nM5\n' +
      '; tool change: load 6.35 mm (1/4") end mill\n' +
      '; re-zero Z on the stock top, then cycle-start to resume\nM0\n' +
      '; tool change: load 3.175 mm (1/8") end mill\nM0\nM3 S12000\nG1 Z-1 F300\nM5\n';
    const labels = kerfDeskBitChangeLabels(file);
    expect(labels).toEqual(['6.35 mm (1/4") end mill', '3.175 mm (1/8") end mill']);
    const warned = review(file, { ...CNC, kerfDeskBitChanges: labels }).warnings;
    expect(warned).toContain(
      'This file changes bits at an M0 stop (load 6.35 mm (1/4") end mill, then 1 more). ' +
        'Run G-code file sends that M0 to the controller as written. The controller then takes ' +
        "no jog or Zero Z until cycle start, and the new bit's spindle start and plunge are " +
        "already sent, so it would cut at the old bit's Z zero. Start the job from its project, " +
        'which holds for the re-zero, or save its tiles again: each bit is then its own file.',
    );
    // A program stop that is not KerfDesk's bit change keeps the generic notice only.
    expect(review(file, CNC).warnings.join('\n')).not.toContain('changes bits');
    expect(kerfDeskBitChangeLabels('G21\nM0\nG1 X1 F100\n')).toEqual([]);
    // Labels without the M0 itself: nothing stops there.
    const noStop = 'G21\n; tool change: load 6.35 mm end mill\nG1 X1 F100\n';
    expect(
      review(noStop, { ...CNC, kerfDeskBitChanges: kerfDeskBitChangeLabels(noStop) }).warnings,
    ).not.toContainEqual(expect.stringContaining('changes bits'));
  });
});

describe('external program command spellings (ADR-630)', () => {
  it.each(['G91', 'G+91', 'G91.0', 'G 91', 'G091'])('finds relative moves spelt %s', (word) => {
    const warnings = review(`G21\n${word}\nG1 X-100 F600\n`).warnings.join('\n');
    expect(warnings).toContain('relative moves (G91)');
  });

  it('does not read G91.1 (arc centre mode) as relative moves', () => {
    expect(review('G21\nG91.1\nG1 X10 F600\n').warnings.join()).not.toContain('(G91)');
  });

  it.each(['M6', 'M 6', 'M06', 'M6.0'])('finds a tool change spelt %s', (word) => {
    expect(review(`G21\nG0 X1\n${word} T2\n`, CNC).warnings.join()).toContain('tool change (M6)');
  });

  it('tells storing a G28/G30 position from moving to it', () => {
    const stores = review('G21\nG0 X1 Y1\nG28.1\nG30.1\n').warnings.join('\n');
    expect(stores).toContain('stores a new G28 or G30 position');
    expect(stores).not.toContain('moves to a stored position');
    const moves = review('G21\nG0 X1 Y1\nG28\n').warnings.join('\n');
    expect(moves).toContain('moves to a stored position');
  });

  it('finds G53 and G10 offset writes however they are spelt', () => {
    expect(review('G21\nG0 X1\nG 53 G0 X0\n').warnings.join()).toContain('(G53)');
    expect(review('G21\nG0 X1\nG10.0 L20 P1 X0\n').warnings.join()).toContain('G10 L20');
  });
});

describe('external program final units (ADR-630)', () => {
  it('says the controller is left in inches only when the program ends in inches', () => {
    const ends = review('G20\nG0 X1 Y1\nG1 X2 F10\n').warnings.join('\n');
    expect(ends).toContain('leaves the controller in inches');
    const back = review('G20\nG0 X1 Y1\nG21\nG1 X20 F100\n');
    expect(back.units).toBe('both');
    expect(back.warnings.join('\n')).not.toContain('leaves the controller in inches');
    expect(back.warnings.join('\n')).toContain('ends in millimetres');
  });

  it('does not count the baseline as the program declaring millimetres', () => {
    expect(review('G0 X1 Y1\nG1 X2 F100\n').units).toBe('undeclared');
    expect(review('G20\nG0 X1 Y1\n').units).toBe('inch');
  });

  // Smoothieware's baseline restores the M221 power scale a Frame zeroed
  // (ADR-630 Amendment 3). It is a percent, not the program's S, and it does
  // not leave the program's laser on.
  it("does not read Smoothieware's M221 S100 baseline as the program's own command", () => {
    const smoothie: ExternalProgramContext = { ...LASER, controllerKind: 'smoothieware' };
    const reviewSmoothie = (file: string) => {
      const normalized = normalizeExternalProgram(file, undefined, 'smoothieware');
      if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
      const gcode = normalized.program.gcode;
      expect(gcode.startsWith('G17G21G90G0\nM221 S100\n')).toBe(true);
      const built = buildGcodeRenderModel(gcode, {
        machineKind: 'laser',
        laserPowerControl: 'smoothieware',
      });
      if (built.kind !== 'ok') throw new Error(built.reason);
      return { model: built.model, review: reviewExternalProgram(gcode, built.model, smoothie) };
    };
    const { model, review: sOnly } = reviewSmoothie('G0 X0 Y0\nG1 X10 S0.5 F600\nG0 X0\n');
    expect(sOnly.warnings).toEqual([]);
    // The review draws the burn at the scale the baseline sets.
    expect(model.stats.cutMm).toBe(10);
    expect(Array.from(model.segPower)).toContain(0.5);
    expect(reviewSmoothie('M3\nG1 X10 S0.5 F600\nM5\n').review.warnings.join('\n')).toContain(
      'before it sets S',
    );
    expect(reviewSmoothie('M3 S0.5\nG1 X10 F600\n').review.warnings.join('\n')).toContain(
      'never sends M5',
    );
  });
});

// The Frame traces the program's outline in the work coordinates it starts in.
// A move the program states in other coordinates, or that ends where it does
// not say, is left out instead of framed somewhere the program never goes.
describe('external program placement (ADR-630 Amendment 1)', () => {
  it('leaves machine-coordinate moves (G53) out of the outline', () => {
    const result = reviewFrom('G21 G90\nG1 X60 Y70 F600\nG53 G0 X-400 Y-5\n', HEAD);
    expect(result.envelope).toEqual({ minX: 50, minY: 50, maxX: 60, maxY: 70 });
    const warnings = result.warnings.join('\n');
    expect(warnings).toContain('machine coordinates (G53)');
    expect(warnings).toContain('not in the Frame outline');
  });

  it('places the axis again once the program sets it after a G53 move', () => {
    const relative = reviewFrom('G21\nG53 G0 X-400\nG91 G1 X10 F600\n', HEAD);
    expect(relative.envelope).toEqual({ minX: 50, minY: 50, maxX: 50, maxY: 50 });
    const absolute = reviewFrom('G21\nG53 G0 X-400\nG1 X70 F600\nG91 G1 X5\n', HEAD);
    expect(absolute.envelope).toEqual({ minX: 50, minY: 50, maxX: 75, maxY: 50 });
  });

  it.each(['G92 X0 Y0', 'G10 L20 P1 X0 Y0', 'G10 L2 P0 X0 Y0', 'G92.1'])(
    'does not frame moves made from an origin the program changed: %s',
    (line) => {
      const result = reviewFrom(`G21 G90\nG1 X60 Y60 F600\n${line}\nG1 X100 Y100\n`, HEAD);
      expect(result.envelope).toEqual({ minX: 50, minY: 50, maxX: 60, maxY: 60 });
    },
  );

  it('keeps the axes an origin write leaves alone, and writes to another system', () => {
    const zOnly = reviewFrom('G21 G90\nG92 Z0\nG1 X100 Y80 F600\n', HEAD);
    expect(zOnly.envelope).toEqual({ minX: 50, minY: 50, maxX: 100, maxY: 80 });
    const otherSystem = reviewFrom('G21 G90\nG10 L2 P2 X5\nG1 X100 F600\n', HEAD);
    expect(otherSystem.envelope).toEqual({ minX: 50, minY: 50, maxX: 100, maxY: 50 });
  });

  it('draws no move to the values a G92 declares', () => {
    const gcode = sendable('G21 G90\nG1 X60 Y60 F600\nG92 X0 Y0\nG1 X10 Y0\n');
    const result = buildGcodeRenderModel(gcode, { initialPositionMm: HEAD, boundsFromStart: true });
    if (result.kind !== 'ok') throw new Error(result.reason);
    // The start to X60 Y60, then X60 Y60 (now X0 Y0) to X10 Y0: two moves.
    expect(result.model.segmentCount).toBe(2);
  });

  it('leaves probe moves and moves in another work coordinate system out', () => {
    const probe = reviewFrom('G21 G90\nG38.2 X-50 F100\nG0 Y80\n', HEAD, CNC);
    expect(probe.envelope).toEqual({ minX: 50, minY: 50, maxX: 50, maxY: 80 });
    expect(probe.warnings.join('\n')).toContain('probes (G38');
    const sticky = reviewFrom('G21 G90\nG38.2 X60 F100\nX-50\nG0 X70\n', HEAD, CNC);
    expect(sticky.envelope).toEqual({ minX: 50, minY: 50, maxX: 70, maxY: 50 });
    const fixture = reviewFrom('G21 G90\nG55\nG0 X200 Y200\nG54\nG0 X70 Y60\n', HEAD);
    expect(fixture.envelope).toEqual({ minX: 50, minY: 50, maxX: 70, maxY: 60 });
  });

  it('leaves a move to the stored G30 position out, and frames G28.1 axis words as GRBL moves them', () => {
    const stored = reviewFrom('G21\nG30\nG91 G1 X10 F600\n', HEAD);
    expect(stored.envelope).toEqual({ minX: 50, minY: 50, maxX: 50, maxY: 50 });
    // GRBL reads axis words beside G28.1 as an ordinary move (gcode.c).
    const implicit = reviewFrom('G21 G90\nG1 F600\nG28.1 X70\n', HEAD);
    expect(implicit.envelope).toEqual({ minX: 50, minY: 50, maxX: 70, maxY: 50 });
  });

  it('frames the spot the head stands on for a program that never moves', () => {
    const result = reviewFrom('M3 S10000\nG4 P60\nM5\n', HEAD, CNC);
    expect(result.envelope).toEqual({ minX: 50, minY: 50, maxX: 50, maxY: 50 });
    expect(result.warnings.join('\n')).toContain('never moves');
    // Arcs the Inspector cannot draw are motion: no point is framed for them.
    expect(reviewFrom('G21 G90\nG18\nG2 X10 I5 F100\n', HEAD, CNC).envelope).toBeNull();
  });
});

describe('external program words the review cannot follow (ADR-630 Amendment 1)', () => {
  it('names unsupported words the Program Health notes list as info', () => {
    const gcode = sendable('G21\nG0 X1 Y1\nG43.1 Z1\nG1 X2 F600\n');
    const built = model(gcode);
    const result = reviewExternalProgram(gcode, built, LASER, [
      {
        id: 'unsupported-word:G43.1',
        severity: 'info',
        title: 'Unsupported word G43.1',
        detail: 'G43.1 is not interpreted by the Inspector.',
        line: 2,
        count: 1,
      },
      {
        id: 'unsupported-word:G53',
        severity: 'info',
        title: 'Unsupported word G53',
        detail: 'G53 is not interpreted by the Inspector.',
        line: 3,
        count: 1,
      },
    ]);
    const warnings = result.warnings.join('\n');
    expect(warnings).toContain('does not interpret G43.1');
    // G53 has its own warning, so it is not listed twice.
    expect(warnings).not.toContain('interpret G43.1, G53');
  });

  it('says when the laser or spindle is switched on before any S', () => {
    const stale = 'before it sets S';
    expect(review('G21\nM3\nG1 X10 F600\nM5\n').warnings.join()).toContain(stale);
    // A later S does not cover the moves before it.
    const lateS = 'G21\nM3\nG1 X10 F600\nS100\nG1 X20\nM5\n';
    expect(review(lateS).warnings.join()).toContain(stale);
    // An S on the same block, or on an earlier one, does.
    expect(review('G21\nM4 S0\nG1 X10 F600 S300\nM5\n').warnings.join()).not.toContain(stale);
    expect(review('G21\nS500\nM3\nG1 X10 F600\nM5\n').warnings.join()).not.toContain(stale);
    expect(review('G21\nG1 X1 F600\nM5\n').warnings.join()).not.toContain(stale);
  });
});
