import { describe, expect, it, vi } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { cncGrblStrategy, selectOutputStrategy } from '../../core/output';
import { projectWithLine } from '../../__fixtures__/file-actions';

import { MAX_REUSABLE_PREVIEW_PROGRAM_CHARS, prepareLargeJob } from './large-job-preparation';
import {
  previewRouteSource,
  serializeExecutablePlanPreviewRoute,
} from './executable-plan-preview-route';
import { buildPreviewToolpathFromPrepared } from './draw-preview';
import { estimateLiveJobFromPrepared } from '../laser/live-job-estimate';

describe('prepareLargeJob', () => {
  it.each(['fluidnc', 'grblhal', 'marlin', 'smoothieware', 'cnc'] as const)(
    'reuses the exact %s program while preserving the prior preview route',
    (kind) => {
      const base = projectWithLine();
      const project =
        kind === 'cnc'
          ? {
              ...base,
              machine: DEFAULT_CNC_MACHINE_CONFIG,
              scene: {
                ...base.scene,
                layers: base.scene.layers.map((layer) => ({
                  ...layer,
                  cnc: {
                    ...DEFAULT_CNC_LAYER_SETTINGS,
                    cutType: 'profile-on-path' as const,
                    depthMm: 2,
                    depthPerPassMm: 1,
                  },
                })),
              },
            }
          : { ...base, device: { ...base.device, controllerKind: kind } };
      const prepared = prepareOutput(project);
      const exactProgram = emitPreparedGcode(prepared).gcode;
      expect(exactProgram.length).toBeGreaterThan(0);
      const expectedRoute = serializeExecutablePlanPreviewRoute(
        buildPreviewToolpathFromPrepared(project, prepared, undefined, { executablePlan: true }),
      );
      const emit = vi.spyOn(
        kind === 'cnc' ? cncGrblStrategy : selectOutputStrategy(project.device),
        'emit',
      );
      try {
        const result = prepareLargeJob(project);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.results[0]?.value).toBe(exactProgram);
        expect(result.toolpath).toEqual(expectedRoute);
      } finally {
        emit.mockRestore();
      }
    },
  );

  it('keeps the full multi-pass route and duration above the source reuse bound without re-emitting', () => {
    const base = createProject();
    const points = Array.from({ length: 50_001 }, (_, index) => ({
      x: 10 + index / 200,
      y: index % 2 === 0 ? 10.123 : 100.456,
    }));
    const project = {
      ...base,
      scene: {
        objects: [
          {
            kind: 'imported-svg' as const,
            id: 'large',
            source: 'large.svg',
            bounds: { minX: 10, minY: 10, maxX: 261, maxY: 101 },
            transform: IDENTITY_TRANSFORM,
            paths: [{ color: '#ff0000', polylines: [{ closed: false, points }] }],
          },
        ],
        layers: [{ ...createLayer({ id: 'line', color: '#ff0000' }), passes: 2 }],
      },
    };
    const prepared = prepareOutput(project);
    const exactProgram = emitPreparedGcode(prepared).gcode;
    expect(exactProgram.length).toBeGreaterThan(MAX_REUSABLE_PREVIEW_PROGRAM_CHARS);
    const expectedRoute = buildPreviewToolpathFromPrepared(project, prepared);
    const expectedEstimate = estimateLiveJobFromPrepared(prepared, undefined, { unbounded: true });
    const emit = vi.spyOn(selectOutputStrategy(project.device), 'emit');
    try {
      const result = prepareLargeJob(project);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit.mock.results[0]?.value).toBe(exactProgram);
      expect(previewRouteSource(result.toolpath)).toBe('legacy-toolpath');
      expect(result.toolpath).toEqual(expectedRoute);
      expect(result.estimate).toEqual(expectedEstimate);
    } finally {
      emit.mockRestore();
    }
  });

  it('derives preview and ETA from one prepared output', () => {
    const base = createProject();
    const project = {
      ...base,
      scene: addLayer(
        addObject(base.scene, {
          kind: 'imported-svg' as const,
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        }),
        createLayer({ id: 'cut', color: '#ff0000' }),
      ),
    };

    const compile = vi.fn(prepareOutput);
    const expectedProgram = emitPreparedGcode(prepareOutput(project)).gcode;
    const emit = vi.spyOn(selectOutputStrategy(project.device), 'emit');
    let result: ReturnType<typeof prepareLargeJob>;
    try {
      result = prepareLargeJob(project, {}, compile);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit.mock.results[0]?.value).toBe(expectedProgram);
    } finally {
      emit.mockRestore();
    }

    expect(compile).toHaveBeenCalledTimes(1);
    expect(result.toolpath.totalLength).toBeGreaterThan(0);
    expect(previewRouteSource(result.toolpath)).toBe('executable-plan');
    expect(result.toolpath.executablePlanPreview?.source).toBe('executable-plan');
    expect(previewRouteSource(structuredClone(result.toolpath))).toBe('executable-plan');
    expect(result.estimate.kind).toBe('estimated');
  });
});
