import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import type { CncPass } from '../job';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG;
const FIRST_REGION_X = 50;
const SECOND_REGION_X = 120;
const REGION_SPLIT_X = 95;

function squarePolyline(atX: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: atX, y: 50 },
      { x: atX + size, y: 50 },
      { x: atX + size, y: 50 + size },
      { x: atX, y: 50 + size },
    ],
  };
}

function squareObject(
  size: number,
  regionXs: ReadonlyArray<number> = [FIRST_REGION_X],
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'square.svg',
    bounds: {
      minX: Math.min(...regionXs),
      minY: 50,
      maxX: Math.max(...regionXs) + size,
      maxY: 50 + size,
    },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: regionXs.map((atX) => squarePolyline(atX, size)),
      },
    ],
  };
}

function sceneWith(
  settings: Partial<CncLayerSettings>,
  size: number,
  regionXs?: ReadonlyArray<number>,
): Scene {
  const layer: Layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...settings },
  };
  return { layers: [layer], objects: [squareObject(size, regionXs)] };
}

function sourceRegionDepthSequence(passes: ReadonlyArray<CncPass>): ReadonlyArray<string> {
  const sequence = passes.map((pass) => {
    if (pass.kind !== 'contour' && pass.kind !== 'helical-contour') {
      throw new Error('expected a pocket contour pass');
    }
    const point = pass.kind === 'contour' ? pass.polyline[0] : pass.start;
    if (point === undefined) throw new Error('expected pocket pass geometry');
    const owner = point.x < REGION_SPLIT_X ? 'A' : 'B';
    return `${owner}:${pass.zMm}`;
  });
  return sequence.filter((value, index) => index === 0 || value !== sequence[index - 1]);
}

describe('compileCncJob pocket strategies', () => {
  it('compiles verified adaptive roughing with native helix and cleanup contours', () => {
    const scene = sceneWith(
      {
        cutType: 'pocket',
        pocketStrategy: 'adaptive',
        adaptiveOptimalLoadMm: 0.4,
        depthMm: 2,
        depthPerPassMm: 2,
      },
      20,
    );
    const job = compileCncJob(scene, dev, config);
    expect(job.groups).toHaveLength(1);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a CNC group');
    expect(group.passes[0]?.kind).toBe('helical-contour');
    expect(group.passes.some((pass) => pass.kind === 'contour')).toBe(true);
    const gcode = cncGrblStrategy.emit(job, dev);
    expect(gcode).toMatch(/^G3 .*I-.*J0\.000/m);
    expect(gcode).toBe(cncGrblStrategy.emit(compileCncJob(scene, dev, config), dev));
  });

  it('completes every adaptive depth in one source region before the next', () => {
    const scene = sceneWith(
      {
        cutType: 'pocket',
        pocketStrategy: 'adaptive',
        adaptiveOptimalLoadMm: 0.4,
        depthMm: 2,
        depthPerPassMm: 1,
      },
      20,
      [FIRST_REGION_X, SECOND_REGION_X],
    );
    const job = compileCncJob(scene, dev, config);
    expect(job.groups).toHaveLength(1);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a CNC group');

    expect(sourceRegionDepthSequence(group.passes)).toEqual(['A:-1', 'A:-2', 'B:-1', 'B:-2']);
  });

  it('applies Climb or Conventional to adaptive entry and finish rotation', () => {
    const compileDirection = (cutDirection: 'climb' | 'conventional', device = dev) => {
      const job = compileCncJob(
        sceneWith(
          {
            cutType: 'pocket',
            pocketStrategy: 'adaptive',
            adaptiveOptimalLoadMm: 0.4,
            cutDirection,
            depthMm: 2,
            depthPerPassMm: 2,
          },
          20,
        ),
        device,
        config,
      );
      const group = job.groups[0];
      if (group?.kind !== 'cnc') throw new Error('expected a CNC group');
      const helix = group.passes.find((pass) => pass.kind === 'helical-contour');
      const finish = group.passes.find((pass) => pass.kind === 'contour');
      if (helix?.kind !== 'helical-contour' || finish?.kind !== 'contour') {
        throw new Error('expected adaptive helix and finish contour');
      }
      return { helix, finish };
    };

    const climb = compileDirection('climb');
    const conventional = compileDirection('conventional');
    expect(climb.helix.clockwise).toBe(false);
    expect(conventional.helix.clockwise).toBe(true);
    expect(Math.sign(signedAreaMm2(climb.finish.polyline))).toBe(1);
    expect(Math.sign(signedAreaMm2(conventional.finish.polyline))).toBe(-1);

    const mirroredClimb = compileDirection('climb', { ...dev, origin: 'front-right' });
    expect(mirroredClimb.helix.clockwise).toBe(true);
    // front-right has handedness -1, so this numeric CW ring is physical CCW.
    expect(Math.sign(signedAreaMm2(mirroredClimb.finish.polyline))).toBe(-1);
  });

  it('runs a larger pocket rougher before a smaller rest-machining bit', () => {
    const job = compileCncJob(
      sceneWith(
        {
          cutType: 'pocket',
          toolId: 'em-1588',
          pocketRoughToolId: 'em-6350',
          depthMm: 2,
          depthPerPassMm: 2,
        },
        30,
      ),
      dev,
      config,
    );
    expect(job.groups).toHaveLength(2);
    const rough = job.groups[0];
    const rest = job.groups[1];
    if (rough?.kind !== 'cnc' || rest?.kind !== 'cnc') throw new Error('expected CNC groups');
    expect(rough.toolId).toBe('em-6350');
    expect(rough.layerPrimaryToolId).toBe('em-1588');
    expect(rest.toolId).toBe('em-1588');
    expect(rest.layerPrimaryToolId).toBe('em-1588');
    expect(rough.passes.length).toBeGreaterThan(rest.passes.length);
    expect(rest.passes.length).toBeGreaterThan(0);
    const gcode = cncGrblStrategy.emit(job, dev);
    const roughToolComment = '; cnc tool: end-mill; diameter-mm: 6.350';
    const restToolComment = '; cnc tool: end-mill; diameter-mm: 1.588';
    expect(gcode).toContain(roughToolComment);
    expect(gcode).toContain(restToolComment);
    expect(gcode.indexOf(roughToolComment)).toBeLessThan(gcode.indexOf(restToolComment));
    expect(gcode.match(/^M0$/gm)).toHaveLength(1);
  });

  it('keeps rougher then rest tool groups source-region-major at every depth', () => {
    const job = compileCncJob(
      sceneWith(
        {
          cutType: 'pocket',
          toolId: 'em-1588',
          pocketRoughToolId: 'em-6350',
          depthMm: 2,
          depthPerPassMm: 1,
        },
        30,
        [FIRST_REGION_X, SECOND_REGION_X],
      ),
      dev,
      config,
    );
    expect(job.groups).toHaveLength(2);
    const rough = job.groups[0];
    const rest = job.groups[1];
    if (rough?.kind !== 'cnc' || rest?.kind !== 'cnc') throw new Error('expected CNC groups');

    expect([rough.toolId, rest.toolId]).toEqual(['em-6350', 'em-1588']);
    expect(sourceRegionDepthSequence(rough.passes)).toEqual(['A:-1', 'A:-2', 'B:-1', 'B:-2']);
    expect(sourceRegionDepthSequence(rest.passes)).toEqual(['A:-1', 'A:-2', 'B:-1', 'B:-2']);
  });

  it('applies Climb or Conventional to the separate rest-roughing group', () => {
    const roughingArea = (cutDirection: 'climb' | 'conventional', device = dev): number => {
      const job = compileCncJob(
        sceneWith(
          {
            cutType: 'pocket',
            cutDirection,
            toolId: 'em-1588',
            pocketRoughToolId: 'em-6350',
            depthMm: 2,
            depthPerPassMm: 2,
          },
          30,
        ),
        device,
        config,
      );
      const rough = job.groups[0];
      if (rough?.kind !== 'cnc') throw new Error('expected the roughing CNC group');
      const contour = rough.passes.find((pass) => pass.kind === 'contour');
      if (contour?.kind !== 'contour') throw new Error('expected a roughing contour');
      return signedAreaMm2(contour.polyline);
    };

    expect(Math.sign(roughingArea('climb'))).toBe(1);
    expect(Math.sign(roughingArea('conventional'))).toBe(-1);
    expect(Math.sign(roughingArea('climb', { ...dev, origin: 'front-right' }))).toBe(-1);
  });

  it('defensively omits rest machining assigned to a non-flat rougher', () => {
    const job = compileCncJob(
      sceneWith(
        {
          cutType: 'pocket',
          toolId: 'em-1588',
          pocketRoughToolId: 'bn-6350',
          depthMm: 2,
          depthPerPassMm: 2,
        },
        30,
      ),
      dev,
      config,
    );
    expect(job.groups).toEqual([]);
  });
});
