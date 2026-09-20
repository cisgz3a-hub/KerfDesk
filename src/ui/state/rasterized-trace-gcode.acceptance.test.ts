import { describe, expect, it } from 'vitest';
import { parseGcodeWord, stripGcodeComment } from '../../core/invariants';
import { scanModalMotionLine, type GcodeMotionMode } from '../../core/gcode/modal-motion-line';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, type DeviceProfile } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { applyRasterizedTraceToExisting } from './rasterized-trace-mutation';

const OPERATION_ID = 'source-image-operation';

function sourceImage(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'source-photo',
    source: 'source-photo.png',
    dataUrl: 'data:image/png;base64,AAAA',
    lumaBase64: 'AAAA',
    pixelWidth: 3,
    pixelHeight: 1,
    bounds: { minX: 100, minY: 20, maxX: 103, maxY: 21 },
    transform: IDENTITY_TRANSFORM,
    color: '#335577',
    operationIds: [OPERATION_ID],
    dither: 'threshold',
    linesPerMm: 1,
  };
}

function rasterizedTrace(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'rasterized-trace',
    source: 'source-photo.png (trace bitmap)',
    dataUrl: 'data:image/png;base64,/wD/',
    // White, black, white: one deterministic active pixel and therefore one
    // scan span with a measurable laser-off lead-in on either side.
    lumaBase64: '/wD/',
    pixelWidth: 3,
    pixelHeight: 1,
    bounds: { minX: 20, minY: 20, maxX: 23, maxY: 21 },
    transform: IDENTITY_TRANSFORM,
    color: '#ffffff',
    dither: 'floyd-steinberg',
    linesPerMm: 9,
  };
}

function sourceOperation(): Layer {
  return {
    ...createLayer({ id: OPERATION_ID, color: '#335577', mode: 'image' }),
    power: 47,
    speed: 876,
    ditherAlgorithm: 'threshold',
    linesPerMm: 1,
    imageBidirectional: false,
  };
}

function projectWithSource(device?: DeviceProfile): Project {
  const project = device === undefined ? createProject() : createProject(device);
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: [sourceImage()],
      layers: [sourceOperation()],
    },
  };
}

function committedTraceProject(device?: DeviceProfile): Project {
  return applyRasterizedTraceToExisting(
    { project: projectWithSource(device), undoStack: [] },
    'source-photo',
    rasterizedTrace(),
  ).project;
}

// Raster rows may hold an inherited G1 and pack their words, so this walks the
// program with the production modal scanner rather than matching line shapes
// (ADR-332). The contract is unchanged: dynamic mode, then a laser-off runway
// at the layer feed, then the first powered burn.
function feedMoves(
  gcode: string,
): ReadonlyArray<{ readonly index: number; readonly s: number | null; readonly f: number | null }> {
  const out: Array<{ index: number; s: number | null; f: number | null }> = [];
  let motion: GcodeMotionMode | null = 0;
  gcode.split('\n').forEach((raw, index) => {
    const stripped = stripGcodeComment(raw);
    if (stripped === '') return;
    const scanned = scanModalMotionLine(stripped, motion);
    motion = scanned.motion;
    if (!scanned.isMotion || motion !== 1) return;
    out.push({ index, s: parseGcodeWord(stripped, 'S'), f: parseGcodeWord(stripped, 'F') });
  });
  return out;
}

function expectDynamicRasterRunway(gcode: string): void {
  const dynamicModeIndex = gcode.split('\n').indexOf('M4 S0');
  const moves = feedMoves(gcode);
  // Power is modal: the runway is the first feed move whose effective S is 0,
  // and the burn is the first whose effective S is positive.
  let power = 0;
  const effective = moves.map((move) => {
    power = move.s ?? power;
    return { ...move, power };
  });
  const runway = effective.find((move) => move.power === 0 && move.f === 876);
  const burn = effective.find((move) => move.power > 0);

  expect(dynamicModeIndex).toBeGreaterThanOrEqual(0);
  expect(runway?.index).toBeGreaterThan(dynamicModeIndex);
  expect(burn?.index).toBeGreaterThan(runway?.index ?? Number.POSITIVE_INFINITY);
  expect(burn?.power).toBe(470);
}

describe('rasterized trace production output', () => {
  it('commits through Image settings and emits one M4 raster with an S0 runway', () => {
    const committed = committedTraceProject();

    const source = committed.scene.objects.find((object) => object.id === 'source-photo');
    expect(source).toMatchObject({ kind: 'raster-image', role: 'trace-source' });

    const job = compileJob(committed.scene, committed.device);
    expect(job.groups.map((group) => group.kind)).toEqual(['raster']);
    expect(job.groups[0]).toMatchObject({
      kind: 'raster',
      sourceObjectId: 'rasterized-trace',
      layerId: OPERATION_ID,
      power: 47,
      speed: 876,
      bidirectional: false,
    });

    const { gcode, preflight } = emitGcode(committed);
    expect(preflight.ok).toBe(true);
    expectDynamicRasterRunway(gcode);
  });

  it('keeps the S0 feed runway under the incident Neotronics 4040 profile', () => {
    const committed = committedTraceProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    expect(committed.device.profileId).toBe('neotronics-4040-max-lt4lds-v2-20w');
    expect(committed.device.gcodeDialect).toEqual({ dialectId: 'neotronics-4040-safe' });

    const job = compileJob(committed.scene, committed.device);
    expect(job.groups).toHaveLength(1);
    expect(job.groups[0]).toMatchObject({
      kind: 'raster',
      sourceObjectId: 'rasterized-trace',
      speed: 876,
      power: 47,
      bidirectional: false,
    });

    const { gcode, preflight } = emitGcode(committed);
    expect(preflight.ok).toBe(true);
    expectDynamicRasterRunway(gcode);
  });
});
