import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  createRegistrationLayer,
  DEFAULT_OUTPUT_SCOPE,
  type Project,
} from '../../core/scene';
import { createRegistrationBox } from '../../core/shapes';
import { createRectangle } from '../../core/shapes/primitives';
import type { VariableTextRenderer } from '../../io/gcode';
import { prepareStartJobSnapshot } from './start-job-readiness';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
  wco: { x: 0, y: 0, z: 0 },
};

const unusedRenderer: VariableTextRenderer = async () => ({
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  paths: [],
});

function projectWithMixedRegistrationOutput(): Project {
  const base = createProject();
  const box = createRegistrationBox({ widthMm: 80, heightMm: 40 });
  const art = createRectangle({
    id: 'art',
    color: '#0000ff',
    spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
  });
  let scene = addObject(addObject(base.scene, box), art);
  scene = addLayer(scene, { ...createRegistrationLayer(), output: true });
  scene = addLayer(scene, { ...createLayer({ id: 'art', color: '#0000ff' }), output: true });
  return { ...base, scene };
}

describe('Print-and-Cut Frame warnings', () => {
  it('prepares the exact job and warns when mixed jig output and job-origin placement are active', async () => {
    const result = await prepareStartJobSnapshot(
      projectWithMixedRegistrationOutput(),
      { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
      {
        statusReport: idleStatus,
        alarmCode: null,
        hasActiveStreamer: false,
        workOriginActive: true,
        wcoCache: { x: 0, y: 0, z: 0 },
      },
      { startFrom: 'user-origin', anchor: 'front-left' },
      DEFAULT_OUTPUT_SCOPE,
      false,
      {
        clock: () => new Date('2026-07-19T00:00:00.000Z'),
        renderVariableText: unusedRenderer,
        registration: { scale: 1, rotationRad: 0, translation: { x: 1, y: 2 } },
        requireFrame: false,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('box and your artwork are both set to burn'),
        expect.stringContaining(
          'Print-and-Cut registration and job-origin placement are both active',
        ),
      ]),
    );
  });
});
