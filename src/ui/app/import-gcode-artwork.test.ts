import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { gcodeArtworkObject } from './import-gcode-artwork';

const PROGRAM = [
  'G21 G90',
  'G0 X10 Y10',
  'M4 S1000',
  'G1 X20 Y10 F1000',
  'G1 X20 Y20',
  'G1 X10 Y20',
  'G1 X10 Y10',
  'M5',
  'G0 X50 Y50',
  'M4 S500',
  'G1 X60 Y50',
  'M5',
].join('\n');

describe('G-code as artwork', () => {
  it('joins laser-on moves into paths, closes loops and places them on the bed', () => {
    const project = createProject();
    const result = gcodeArtworkObject('job.gcode', PROGRAM, project);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [square, line] = result.object.paths[0]?.polylines ?? [];
    expect(square?.closed).toBe(true);
    expect(square?.points).toHaveLength(5);
    expect(line?.closed).toBe(false);
    expect(line?.points).toHaveLength(2);
    // Front-left origin: machine Y up becomes scene Y down from the bed's top.
    const bedHeight = project.device.bedHeight;
    expect(square?.points[0]).toEqual({ x: 10, y: bedHeight - 10 });
  });

  it('says so when a program has no cutting moves', () => {
    const result = gcodeArtworkObject('travel.gcode', 'G0 X10 Y10\nG0 X0 Y0', createProject());
    expect(result).toEqual({ ok: false, message: 'The program has no cutting moves to import.' });
  });
});
