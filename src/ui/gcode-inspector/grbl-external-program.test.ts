import { describe, expect, it } from 'vitest';
import { normalizeExternalProgram, reviewExternalProgram } from '../../core/external-program';
import { createStreamer, step } from '../../core/controllers/grbl/streamer';
import { inspectGcodeText } from './gcode-inspector-parse';
import { prepareExternalRun } from './prepare-external-run';

function inspect(text: string, start = { x: 100, y: 0, z: 0 }) {
  const normalized = normalizeExternalProgram(text, undefined, 'grbl-v1.1');
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
  const program = normalized.program;
  const parsed = inspectGcodeText(program.gcode, {
    controllerKind: 'grbl-v1.1',
    machineKind: 'laser',
    boundsFromStart: true,
    initialPositionMm: start,
  });
  if (parsed.parsed.kind !== 'ok' || parsed.analysis === null) throw new Error('inspection failed');
  const model = parsed.parsed.model;
  const review = reviewExternalProgram(
    program.gcode,
    model,
    {
      controllerKind: 'grbl-v1.1',
      machineKind: 'laser',
      laserMaxPowerS: 1000,
      start,
    },
    parsed.analysis.findings,
  );
  return { program, model, review, start };
}

describe('stock GRBL external block semantics', () => {
  // gnea/grbl bfb67f0 gcode.c validates the complete block before STEP 4
  // commits modal state. An error does not undo later already-buffered lines.
  it.each(['F-1', 'S-1', 'P-1', 'N-1', 'T-1', 'G123', 'M123', 'G90.1'])(
    'keeps absolute mode when G91 shares a rejected %s block',
    (invalid) => {
      const { program, model, review, start } = inspect(`G91 ${invalid}\nM4 S500\nG1 X10 F600\nM5`);
      expect(review.envelope).toEqual({ minX: 10, minY: 0, maxX: 100, maxY: 0 });
      expect(model.stats.cutMm).toBe(90);
      expect(review.warnings.join('\n')).toMatch(/rejects.*whole block/i);
      expect(program.gcode).toContain(`G91${invalid}\n`);
      expect(step(createStreamer(program.gcode)).toSend).toBe(program.gcode);
      expect(prepareExternalRun('invalid.nc', program, start, () => review)).toMatchObject({
        kind: 'ready',
        run: { gcode: program.gcode, envelope: review.envelope },
      });
    },
  );

  it('does not apply tool, units or distance words from a rejected block', () => {
    const { model, review } = inspect('G20 G91 M4 S-1\nG1 X10 F600');
    expect(model.stats.cutMm).toBe(0);
    expect(model.stats.travelMm).toBe(90);
    expect(review.envelope?.maxX).toBe(100);
    expect(review.units).toBe('undeclared');
  });

  it.each(['M7', 'M56 P1', 'G1000'])(
    'does not assume block acceptance for optional %s',
    (command) => {
      const { review } = inspect(`G91 ${command}\nG1 X10 F600`);
      expect(review.envelope?.maxX).toBe(100);
      expect(review.warnings.join('\n')).toContain('firmware build options');
    },
  );

  it('frames a firmware-accepted large-radius arc and its following relative move', () => {
    // GRBL accepts radius differences <=0.5 mm AND <=0.1%, or <=0.005 mm.
    const { model, review } = inspect('G3 X0 Y500.2 I-500 J0 F600\nG91\nG1 X10', {
      x: 500,
      y: 0,
      z: 0,
    });
    expect(model.skippedMotions).toEqual([]);
    expect(review.envelope).toEqual({ minX: 0, minY: 0, maxX: 500, maxY: 500.2 });
    expect(Array.from(model.positions.slice(-6))).toEqual([
      0,
      Math.fround(500.2),
      0,
      10,
      Math.fround(500.2),
      0,
    ]);
  });

  it.each([
    [1, 0.004, true], // Within GRBL's absolute 5um allowance, despite >0.1%.
    [1, 0.006, false],
    [100, 0.09, true],
    [100, 0.2, false], // Less than 0.5mm but greater than 0.1%.
    [1000, 0.6, false], // Less than 0.1% but greater than 0.5mm.
  ] as const)(
    'matches GRBL arc acceptance at radius %s, mismatch %s',
    (radius, delta, accepted) => {
      const { review } = inspect(`G3 X0 Y${radius + delta} I-${radius} F600\nG91\nG1 X10`, {
        x: radius,
        y: 0,
        z: 0,
      });
      expect(review.envelope?.maxY).toBe(accepted ? radius + delta : 0);
      expect(review.envelope?.maxX).toBe(accepted ? Math.max(radius, 10) : radius + 10);
    },
  );

  it('rejects an R-form chord longer than its diameter without applying G91', () => {
    const { review } = inspect('G91 G2 X10.0001 R5 F600\nG1 X10');
    expect(review.envelope).toEqual({ minX: 10, minY: 0, maxX: 100, maxY: 0 });
    expect(review.warnings.join('\n')).toContain('radius too small');
  });

  it('does not commit same-block distance or tool mode when an arc is rejected', () => {
    const { model, review } = inspect('G91 M4 S500 G2 X10 I4 J10 F600\nG1 X10');
    expect(review.envelope).toEqual({ minX: 10, minY: 0, maxX: 100, maxY: 0 });
    expect(model.stats.cutMm).toBe(0);
    expect(review.warnings.join('\n')).toContain('radius mismatch');
  });

  it.each(['G2 I10 J0', 'G2', 'G2 Z10 I10 J0'])(
    'rejects %s without plane axis words before applying distance or tool mode',
    (arc) => {
      const { model, review, program } = inspect(`G91 ${arc} F600 M4 S500\nG1 X10 F600`);
      expect(review.envelope).toEqual({ minX: 10, minY: 0, maxX: 100, maxY: 0 });
      expect(model.stats.cutMm).toBe(0);
      expect(model.stats.travelMm).toBe(90);
      expect(review.warnings.join('\n')).toContain('axis words');
      expect(program.gcode).toContain('M4S500\n');
    },
  );

  it('retains a full circle that explicitly names its unchanged endpoint', () => {
    const { model } = inspect('G2 X100 I10 J0 F600\nG1 X10');
    expect(model.skippedMotions).toEqual([]);
    expect(model.stats.travelMm).toBeCloseTo(20 * Math.PI + 90);
  });

  it('places relative moves from a supported G18 arc endpoint', () => {
    const { model, review } = inspect('G18 G2 X0 Z100 I-100 K0 F600\nG91\nG1 X10');
    expect(model.skippedMotions).toEqual([]);
    expect(review.envelope).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 0 });
    expect(Array.from(model.positions.slice(-6))).toEqual([0, 0, 100, 10, 0, 100]);
  });

  it.each(['G18 G2 X10 I4 K10', 'G19 G2 Y10 J4 K10'])(
    'rejects invalid %s geometry before distance or tool changes',
    (arc) => {
      const { model, review } = inspect(`G91 M4 S500 ${arc} F600\nG1 X10`);
      expect(review.envelope).toEqual({ minX: 10, minY: 0, maxX: 100, maxY: 0 });
      expect(model.stats.cutMm).toBe(0);
      expect(review.warnings.join('\n')).toContain('Stock GRBL rejects');
      expect(review.warnings.join('\n')).toContain('radius mismatch');
    },
  );

  it.each([
    ['G18 G2 X0 Z500.2 I-500 K0', { x: 500, y: 0, z: 0 }],
    ['G19 G3 Y0 Z500.2 J-500 K0', { x: 0, y: 500, z: 0 }],
  ] as const)('uses stock radius tolerance for %s', (arc, start) => {
    const { model } = inspect(`${arc} F600\nG91\nG1 X10`, start);
    expect(model.skippedMotions).toEqual([]);
    expect(model.stats.programBounds?.maxZ).toBeCloseTo(500.2);
    expect(Array.from(model.positions.slice(-3))).toEqual([10, 0, Math.fround(500.2)]);
  });

  it.each(['G18 G2 Y10 I5 K0', 'G19 G2 X10 J5 K0'])(
    'rejects %s without selected-plane axis words atomically',
    (arc) => {
      const { model, review } = inspect(`G91 ${arc} M4 S500 F600\nG1 X10`);
      expect(review.envelope).toEqual({ minX: 10, minY: 0, maxX: 100, maxY: 0 });
      expect(model.stats.cutMm).toBe(0);
      expect(review.warnings.join('\n')).toContain('axis words');
    },
  );

  it.each(['G18 G2 X10.0001 R5', 'G19 G2 Y10.0001 R5'])(
    'rejects %s with an impossible R chord atomically',
    (arc) => {
      const { model, review } = inspect(`G91 ${arc} M4 S500 F600\nG1 X10`);
      expect(review.envelope).toEqual({ minX: 10, minY: 0, maxX: 100, maxY: 0 });
      expect(model.stats.cutMm).toBe(0);
      expect(review.warnings.join('\n')).toContain('radius too small');
    },
  );

  it.each(['G18 G2 X10 R5 J0', 'G19 G2 Y10 R5 I0', 'G2 X10 R5 K0'])(
    'rejects unused out-of-plane offsets in %s atomically',
    (arc) => {
      const { model, review } = inspect(`G91 ${arc} M4 S500 F600\nG1 X10`);
      expect(review.envelope).toEqual({ minX: 10, minY: 0, maxX: 100, maxY: 0 });
      expect(model.stats.cutMm).toBe(0);
      expect(review.warnings.join('\n')).toContain('unused I/J/K');
    },
  );

  it.each(['G18 G3 X0 Z500 I-500 K0', 'G19 G3 Y0 Z500 J-500 K0'])(
    'does not assert invalid %s geometry after the Z origin changes',
    (arc) => {
      const { review } = inspect(`G10 L2 P1 Z500\n${arc} F600\nG91\nG1 X10`);
      expect(review.warnings.join('\n')).not.toContain('Stock GRBL rejects');
    },
  );

  it('does not use a forgotten Z position to reject a G18 arc', () => {
    const { review } = inspect('G28 Z0\nG18 G3 X0 Z500 I-500 K0 F600\nG1 X10');
    expect(review.warnings.join('\n')).not.toContain('Stock GRBL rejects');
  });

  it('still validates XY arcs when only Z has an unknown origin', () => {
    const { review } = inspect('G10 L2 P1 Z500\nG91 G2 X10 I4 J10 F600\nG1 X10');
    expect(review.warnings.join('\n')).toContain('Stock GRBL rejects');
    expect(review.envelope).toEqual({ minX: 10, minY: 0, maxX: 100, maxY: 0 });
  });

  it('does not declare an arc rejected from a start displaced by an offset write', () => {
    const { review } = inspect('G10 L2 P1 X500\nG3 X0 Y500 I-500 F600\nG91\nG1 X10');
    expect(review.warnings.join('\n')).not.toContain('Stock GRBL rejects');
  });

  it('does not validate probe targets using the preceding arc mode', () => {
    const { review } = inspect('G3 X0 Y100 I-100 F600\nG38.2 X10 F100\nG1 X20');
    expect(review.warnings.join('\n')).not.toContain('Stock GRBL rejects');
  });

  it('warns about an unsupported G10 mode instead of suppressing its G and L words', () => {
    const { review } = inspect('G10 L3\nG1 X10 F600');
    expect(review.warnings.join('\n')).toMatch(/G10|L3/);
  });
});
