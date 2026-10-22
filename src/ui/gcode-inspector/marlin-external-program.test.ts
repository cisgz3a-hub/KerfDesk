import { describe, expect, it } from 'vitest';
import {
  powerUpMarlin,
  runMarlinLines,
} from '../../__fixtures__/controllers/marlin-laser-power-model';
import {
  externalProgramBaseline,
  normalizeExternalProgram,
  reviewExternalProgram,
} from '../../core/external-program';
import { inspectGcodeText } from './gcode-inspector-parse';
import { prepareExternalRun } from './prepare-external-run';
import { deviceInspectionContext } from './gcode-inspection-source';
import { createProject } from '../../core/scene';
import { createStreamer } from '../../core/controllers/grbl/streamer';

const START = { x: 0, y: 0, z: 0 };

function inspect(text: string) {
  const normalized = normalizeExternalProgram(text, externalProgramBaseline('marlin'), 'marlin');
  if (normalized.kind !== 'ok') throw new Error(normalized.reasons.join('\n'));
  const program = normalized.program;
  expect(createStreamer(program.gcode).queued.join('')).toBe(program.gcode);
  const parsed = inspectGcodeText(program.gcode, {
    controllerKind: 'marlin',
    machineKind: 'laser',
    laserPowerControl: 'spindle',
    boundsFromStart: true,
    initialPositionMm: START,
  });
  if (parsed.parsed.kind !== 'ok' || parsed.analysis === null) throw new Error('inspection failed');
  const model = parsed.parsed.model;
  const review = reviewExternalProgram(
    program.gcode,
    model,
    {
      controllerKind: 'marlin',
      machineKind: 'laser',
      laserMaxPowerS: 255,
      start: START,
    },
    parsed.analysis.findings,
  );
  return { program, model, review };
}

describe('Marlin external executable interpretation', () => {
  it('uses connected Marlin power semantics when the saved profile names Smoothieware', () => {
    const device = { ...createProject().device, controllerKind: 'smoothieware' as const };
    const context = deviceInspectionContext(device, 'laser', 'marlin');
    expect(context).toMatchObject({ controllerKind: 'marlin', laserPowerControl: 'spindle' });
  });
  it('frames the actual endpoint of the first-command-only firmware oracle', () => {
    const { program, model, review } = inspect('G0 X100\nG90 G0 X0\nG91\nG1 X10 F600\nM5');
    const firmware = runMarlinLines(powerUpMarlin(), program.gcode);
    expect(firmware.x).toBe(110);
    expect(review.envelope).toEqual({ minX: 0, minY: 0, maxX: 110, maxY: 0 });
    expect(model.segmentCount).toBe(2);
    expect(review.warnings.join('\n')).toContain('executes only G90');
    expect(program.gcode).toContain('G90 G0 X0\n');
    const run = prepareExternalRun('marlin.gcode', program, START, () => review);
    expect(run).toMatchObject({
      kind: 'ready',
      run: { gcode: program.gcode, envelope: review.envelope },
    });
  });

  it('does not turn off a burn for a trailing M5 parameter', () => {
    const { program, model, review } = inspect('M3 S100\nG1 X10 F600 M5');
    const firmware = runMarlinLines(powerUpMarlin(), program.gcode);
    expect(firmware.burns).toMatchObject([{ power: 100, to: { x: 10, y: 0 } }]);
    expect(model.stats.cutMm).toBe(10);
    expect(model.segPower[0]).toBe(100);
    expect(review.warnings.join('\n')).toContain('still on when the program ends');
    expect(review.warnings.join('\n')).toContain('executes only G1');
  });

  it('does not turn M3 parameters into motion or let M30 end the program', () => {
    const { program, model, review } = inspect('M3 G1 X100 S50\nG91\nG1 X10 F600\nM30\nG1 X10\nM5');
    const firmware = runMarlinLines(powerUpMarlin(), program.gcode);
    expect(firmware.x).toBe(20);
    expect(model.segmentCount).toBe(2);
    expect(review.envelope?.maxX).toBe(20);
    expect(model.stats.cutMm).toBe(20);
    expect(review.warnings.join('\n')).toContain('Marlin M30 is not interpreted');
  });

  it('uses separate baseline commands even when the previous program left G91', () => {
    const { program, review } = inspect('G1 X10 F600');
    const firmware = powerUpMarlin({ x: 50, y: 0 });
    firmware.relative = true;
    runMarlinLines(firmware, program.gcode);
    expect(firmware.x).toBe(10);
    expect(program.gcode).toBe('G21\nG90\nG1 X10 F600\n');
    expect(program.lineCount).toBe(3);
    expect(program.byteCount).toBe(program.gcode.length);
    expect(review.units).toBe('undeclared');
  });

  it('preserves spaces and treats separated digits as Marlin does', () => {
    const { program, review } = inspect('G1 X1 0 0 F600');
    expect(program.gcode).toContain('G1 X1 0 0 F600');
    expect(review.envelope?.maxX).toBe(1);
    expect(inspect('G 1 X100 Y10 F600').review.envelope).toEqual({
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 10,
    });
    expect(inspect('G1.0 X10 F600').review.envelope?.maxX).toBe(10);
  });

  it('does not invent exponent words when projecting ordinary decimal coordinates', () => {
    const { review } = inspect('G1 X1000000000000000000000 F600');
    expect(review.envelope?.maxX).toBe(1e21);
  });

  it.each(['G1 X 500', 'G1 x500', 'g91'])('does not assume parser build options for %s', (line) => {
    const { review } = inspect(`G1 X10 F600\n${line}\nG1 X100`);
    expect(review.envelope?.maxX).toBe(10);
    expect(review.warnings.join('\n')).toMatch(/firmware options|parser build options/);
  });

  it('retains spindle power through a CNC rapid rather than applying laser blanking', () => {
    const parsed = inspectGcodeText('M3 S100\nG0 X10\nG1 X20 F600', {
      controllerKind: 'marlin',
      machineKind: 'cnc',
      boundsFromStart: true,
      initialPositionMm: START,
    });
    if (parsed.parsed.kind !== 'ok') throw new Error('inspection failed');
    expect(Array.from(parsed.parsed.model.segPower)).toEqual([100, 100]);
  });

  it.each(['X500', 'G53 G0 X500', 'G2 X500 I250'])(
    'does not frame relative motion after unplaced %s',
    (line) => {
      const { review, model } = inspect(`G1 X10 F600\n${line}\nG91\nG1 X100`);
      expect(review.envelope?.maxX).toBe(10);
      expect(model.skippedMotions).not.toHaveLength(0);
      expect(review.warnings.join('\n')).toMatch(/firmware|machine coordinates/);
    },
  );

  it('does not turn an unsupported origin-changing command into an absolute framed point', () => {
    const { review } = inspect('G1 X10 F600\nG54\nG1 X500\nG91\nG1 X100');
    expect(review.envelope?.maxX).toBe(10);
    expect(review.warnings.join('\n')).toContain('following coordinates cannot be placed');
  });

  it('keeps accepted same-group blocks instead of applying GRBL block refusals', () => {
    const { program, review } = inspect('G90 G91\nM3 S100 M5\nG1 X10 F600\nM5');
    const firmware = runMarlinLines(powerUpMarlin(), program.gcode);
    expect(firmware.x).toBe(10);
    expect(review.envelope?.maxX).toBe(10);
    expect(program.gcode).toContain('M3 S100 M5');
  });

  it.each([
    'M3 S100\nG1 X10 F600 S0\nG0 X20\nG1 X30\nM5',
    'M3 I S100\nG1 X10 F600\nG0 X20\nG1 X30\nG1 X40 S50\nM5',
    'M3 I S100\nG1 X10 F600\nM5\nG1 X20 S50\nG1 X30 I\nM5 I',
    'M3 I S100\nG1 X10 F600\nM5\nM3 S50\nG1 X20\nM5 I',
  ])('matches the independent standard/inline burn oracle for %s', (text) => {
    const { program, model } = inspect(text);
    const firmware = runMarlinLines(powerUpMarlin(), program.gcode);
    const cuts = Array.from(model.segPower).flatMap((power, index) =>
      model.segKind[index] === 1 ? [{ power, x: model.positions[index * 6 + 3] }] : [],
    );
    expect(cuts).toEqual(firmware.burns.map((burn) => ({ power: burn.power, x: burn.to.x })));
  });

  it('warns that an inline M3 after M5 burns on a LASER_POWER_SYNC build', () => {
    const disabled = inspect('M3 I S100\nG1 X10 F600\nM5\nM3 S50\nG1 X20\nM5 I').review;
    expect(disabled.warnings.join('\n')).toContain('LASER_POWER_SYNC');
    const enabled = inspect('M3 I S100\nG1 X10 F600\nM3 S50\nG1 X20\nM5 I').review;
    expect(enabled.warnings.join('\n')).not.toContain('LASER_POWER_SYNC');
    const reEnabled = inspect('M3 I S100\nG1 X10 F600\nM5\nM3 I S50\nG1 X20\nM5 I').review;
    expect(reEnabled.warnings.join('\n')).not.toContain('LASER_POWER_SYNC');
  });
});
