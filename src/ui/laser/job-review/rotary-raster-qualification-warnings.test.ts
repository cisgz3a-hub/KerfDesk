import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../../core/devices';
import type { Job } from '../../../core/job';
import { DEFAULT_CNC_MACHINE_CONFIG, type Project } from '../../../core/scene';
import {
  detectRotaryRasterQualificationWarnings,
  ROTARY_RASTER_QUALIFICATION_WARNING,
} from './rotary-raster-qualification-warnings';

const ACTIVE_ROTARY: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 360,
  objectDiameterMm: 60,
};

const RASTER_GROUP: Job['groups'][number] = {
  kind: 'raster',
  layerId: 'image',
  color: '#808080',
  power: 50,
  speed: 600,
  passes: 1,
  airAssist: false,
  sValues: new Uint16Array([500]),
  pixelWidth: 1,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  overscanMm: 0,
  dotWidthCorrectionMm: 0,
};

const VECTOR_GROUP: Job['groups'][number] = {
  kind: 'cut',
  layerId: 'line',
  color: '#ff0000',
  power: 50,
  speed: 600,
  passes: 1,
  airAssist: false,
  segments: [],
};

function project(
  rotary: RotarySetup | undefined,
  cnc = false,
): Pick<Project, 'device' | 'machine'> {
  const device =
    rotary === undefined ? DEFAULT_DEVICE_PROFILE : { ...DEFAULT_DEVICE_PROFILE, rotary };
  return cnc ? { device, machine: DEFAULT_CNC_MACHINE_CONFIG } : { device };
}

describe('rotary raster Job Review qualification warning', () => {
  it.each([
    ['raster-only', { groups: [RASTER_GROUP] }],
    ['mixed vector and raster', { groups: [VECTOR_GROUP, RASTER_GROUP] }],
  ])('adds exactly one warning for active rotary %s output', (_label, job) => {
    expect(detectRotaryRasterQualificationWarnings(project(ACTIVE_ROTARY), job)).toEqual([
      ROTARY_RASTER_QUALIFICATION_WARNING,
    ]);
  });

  it.each([
    ['selected output with no raster', project(ACTIVE_ROTARY), { groups: [VECTOR_GROUP] }],
    ['inactive rotary', project({ ...ACTIVE_ROTARY, enabled: false }), { groups: [RASTER_GROUP] }],
    ['flat-bed output', project(undefined), { groups: [RASTER_GROUP] }],
    ['CNC output', project(ACTIVE_ROTARY, true), { groups: [RASTER_GROUP] }],
  ])('stays silent for %s', (_label, preparedProject, job) => {
    expect(detectRotaryRasterQualificationWarnings(preparedProject, job)).toEqual([]);
  });
});
