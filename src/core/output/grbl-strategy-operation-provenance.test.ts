import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../devices';
import { compileJob, type FillGroup, type Job, type RasterGroup } from '../job';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type SceneObject } from '../scene';
import { grblStrategy } from './grbl-strategy';

const device = { ...DEFAULT_DEVICE_PROFILE, origin: 'rear-left' as const };
const uncalibrated = { ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, origin: 'rear-left' as const };
const square: SceneObject = {
  kind: 'imported-svg',
  id: 'square',
  source: 'square.svg',
  transform: IDENTITY_TRANSFORM,
  bounds: { minX: 20, minY: 20, maxX: 40, maxY: 30 },
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 20, y: 20 },
            { x: 40, y: 20 },
            { x: 40, y: 30 },
            { x: 20, y: 30 },
          ],
        },
      ],
    },
  ],
};

function compile(
  object: SceneObject,
  settings: Partial<Layer> = {},
  profile: DeviceProfile = device,
): Job {
  return compileJob(
    {
      objects: [object],
      layers: [
        {
          ...createLayer({ id: 'fill', color: '#000000', mode: 'fill' }),
          hatchSpacingMm: 0.1,
          fillBidirectional: false,
          fillCrossHatch: false,
          ...settings,
        },
      ],
    },
    profile,
  );
}

function output(job: Job, profile: DeviceProfile = device): string {
  const result = grblStrategy.emit(job, profile);
  // Provenance must never change executable words, F/S, modal state, or motion.
  const withoutProvenance: Job = {
    groups: job.groups.map((group) => {
      if (group.kind === 'cnc') return group;
      const { operationSettings: _settings, ...rest } = group;
      return rest;
    }),
  };
  const commands = (text: string): string[] =>
    text.split('\n').filter((line) => !line.startsWith(';'));
  expect(commands(result)).toEqual(commands(grblStrategy.emit(withoutProvenance, profile)));
  return result;
}

describe('GRBL requested override and resolved scan provenance', () => {
  it('discloses one-way Fill output when requested bidirectional falls back', () => {
    const job = compile(
      { ...square, operationOverride: { fillBidirectional: true } },
      {},
      uncalibrated,
    );
    const group = job.groups[0] as FillGroup;
    expect(group.segments).toHaveLength(100);
    expect(group.segments.every((segment) => !segment.reverse)).toBe(true);
    const text = output(job, uncalibrated);
    expect(text).toContain('; requested override: mode fill;');
    expect(text).toContain('direction bidirectional; cross-hatch off');
    expect(text).toContain(
      '; effective hatch plan: interval 0.1 mm; angle 0 deg; direction one-way;',
    );
    expect(text).not.toContain('effective override:');
  });

  it('discloses the 0.05 mm hatch minimum separately from a requested 0.049 mm', () => {
    const job = compile({ ...square, operationOverride: { hatchSpacingMm: 0.049 } });
    const group = job.groups[0] as FillGroup;
    expect(group.segments).toHaveLength(200);
    expect(group.segments[1]!.polyline[0]!.y - group.segments[0]!.polyline[0]!.y).toBeCloseTo(
      0.05,
      9,
    );
    const text = output(job);
    expect(text).toContain('interval 0.049 mm;');
    expect(text).toContain('; effective hatch plan: interval 0.05 mm;');
  });

  it('discloses the resolved Image direction and pass-through row pitch', () => {
    const image: SceneObject = {
      kind: 'raster-image',
      id: 'image',
      source: 'pixels.png',
      dataUrl: 'data:image/png;base64,AA==',
      lumaBase64: 'AAAAAA==',
      pixelWidth: 2,
      pixelHeight: 2,
      bounds: { minX: 20, minY: 20, maxX: 22, maxY: 22 },
      transform: IDENTITY_TRANSFORM,
      color: '#000000',
      dither: 'threshold',
      linesPerMm: 10,
      operationOverride: { imageBidirectional: true },
    };
    const job = compile(image, { mode: 'image', passThrough: true, linesPerMm: 10 }, uncalibrated);
    const group = job.groups[0] as RasterGroup;
    expect(group.bidirectional).toBe(false);
    expect(group.pixelHeight).toBe(2);
    const text = output(job, uncalibrated);
    expect(text).toContain('; requested override: mode image;');
    expect(text).toContain('lines 10/mm; direction bidirectional;');
    expect(text).toContain('; effective image scan: row pitch 1 mm; direction one-way');
  });

  it('reports normalized hatch angle and preserves permitted bidirectional scanning', () => {
    const job = compile({
      ...square,
      operationOverride: { hatchAngleDeg: 180, fillBidirectional: true },
    });
    const group = job.groups[0] as FillGroup;
    expect(group.segments.some((segment) => segment.reverse)).toBe(true);
    const text = output(job);
    expect(text).toContain('angle 180 deg; direction bidirectional;');
    expect(text).toContain(
      '; effective hatch plan: interval 0.1 mm; angle 0 deg; direction bidirectional;',
    );
  });

  it('keeps unused scan controls as requested facts for Follow Shape contours', () => {
    const job = compile({
      ...square,
      operationOverride: { fillStyle: 'offset', fillBidirectional: true, fillCrossHatch: true },
    });
    const text = output(job);
    expect(text).toContain('; requested override: mode fill; style offset;');
    expect(text).not.toContain('effective hatch plan:');
  });
});
