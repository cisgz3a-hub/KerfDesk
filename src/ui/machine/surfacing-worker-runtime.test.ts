import { describe, expect, it } from 'vitest';
import { buildSurfacingProgram } from '../../core/cnc/surfacing';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { emitStandaloneCncGcode } from '../../io/gcode/standalone-cnc-gcode';
import { buildGcodeMetadata } from '../app/build-info';
import { prepareSurfacingStream } from './surfacing-worker-runtime';
import type { SurfacingWorkerInput } from './surfacing-worker-protocol';

const input: SurfacingWorkerInput = {
  params: {
    widthMm: 100,
    heightMm: 999,
    bitDiameterMm: 1,
    stepoverPct: 100,
    depthPerPassMm: 0.5,
    totalDepthMm: 1.2,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 5,
  },
  device: DEFAULT_DEVICE_PROFILE,
  machine: DEFAULT_CNC_MACHINE_CONFIG,
  metadata: buildGcodeMetadata(),
};
describe('surfacing worker generation and output', () => {
  it('keeps exact provenance/body bytes and preflight with bounded output chunks', () => {
    const result = buildSurfacingProgram(input.params);
    if (!result.ok) throw new Error(result.reason);
    const project = { ...createProject(input.device), machine: input.machine };
    const expected = emitStandaloneCncGcode(
      project,
      [...result.program.lines].join('\n'),
      input.metadata,
    );
    const session = prepareSurfacingStream(input);
    const chunks = [...{ [Symbol.iterator]: () => session.chunks }];
    expect(chunks.length).toBeGreaterThan(20);
    expect(chunks.every((chunk) => chunk.split('\n').length <= 257)).toBe(true);
    expect(chunks.join('')).toBe(expected.gcode);
    expect(session.prepared.preflight).toEqual(expected.preflight);
    expect(session.prepared.summary).toMatchObject({ passes: 3, rowsPerPass: 1000 });
  });
});
