import { describe, expect, it, vi } from 'vitest';
import { compileJob } from '../../core/job';
import { FocusTestCompilationError } from '../../core/job/focus-test-compilation-error';
import { generateFocusTest } from '../../core/job/focus-test';
import { COMPILE_INTEGRITY_PREFLIGHT_CODES } from '../../core/preflight';
import {
  createLayerSubLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  layerFromSubLayer,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject } from '../project';
import { normalizeLayer } from '../project/normalize-layer';
import {
  buildPreviewToolpath,
  buildPreviewToolpathUnbounded,
} from '../../ui/workspace/draw-preview';
import { emitGcode } from './emit-gcode';
import { prepareOutput } from './prepare-output';
import { prepareOutputAsync } from './prepare-output-async';

function focusProject(): Project {
  return {
    ...createProject(),
    scene: generateFocusTest({
      steps: 3,
      minOffsetMm: -1,
      maxOffsetMm: 1,
      speed: 1200,
      power: 10,
      lineLengthMm: 20,
      spacingMm: 3,
      travelFeedMmPerMin: 300,
    }),
  };
}

function invalidModeProject(project: Project, mode: 'fill' | 'image'): Project {
  return {
    ...project,
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) => ({ ...layer, mode })),
      objects: project.scene.objects.map((object): SceneObject => {
        if (object.kind !== 'imported-svg') return object;
        if (mode === 'fill')
          return {
            ...object,
            paths: object.paths.map((path) => ({
              ...path,
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 20, y: 0 },
                    { x: 20, y: 10 },
                    { x: 0, y: 10 },
                  ],
                },
              ],
            })),
          };
        return {
          kind: 'raster-image',
          id: object.id,
          source: 'focus-raster.png',
          ...(object.operationIds === undefined ? {} : { operationIds: object.operationIds }),
          dataUrl: 'data:image/png;base64,',
          pixelWidth: 1,
          pixelHeight: 1,
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          transform: object.transform,
          color: object.paths[0]?.color ?? '#000000',
          dither: 'threshold',
          linesPerMm: 10,
          lumaBase64: 'AA==',
        };
      }),
    },
  };
}

describe('Focus compilation failures', () => {
  it.each(['fill', 'image', 'unsupported-controller'] as const)(
    'returns the same structured failure for sync, async, export and Preview: %s',
    async (invalid) => {
      const source = focusProject();
      const project: Project =
        invalid === 'unsupported-controller'
          ? { ...source, device: { ...source.device, controllerKind: 'ruida' } }
          : invalidModeProject(source, invalid);
      expect(() => compileJob(project.scene, project.device)).toThrow(FocusTestCompilationError);
      const prepared = prepareOutput(project);
      expect(prepared).toMatchObject({
        ok: false,
        preflight: { issues: [{ code: 'focus-test-uncompilable' }] },
      });
      if (prepared.ok) throw new Error('Expected compilation failure');
      const runCncTasks = vi.fn();
      expect(
        await prepareOutputAsync(project, {}, { jobId: 'invalid-focus', runCncTasks }),
      ).toEqual(prepared);
      expect(runCncTasks).not.toHaveBeenCalled();
      expect(emitGcode(project)).toEqual({ gcode: '', preflight: prepared.preflight });
      for (const preview of [
        buildPreviewToolpath(project),
        buildPreviewToolpathUnbounded(project),
      ]) {
        expect(preview).toMatchObject({
          steps: [],
          previewIssue: {
            kind: 'preparation-failed',
            messages: prepared.preflight.issues.map((issue) => issue.message),
          },
        });
      }
      expect(COMPILE_INTEGRITY_PREFLIGHT_CODES.has('focus-test-uncompilable')).toBe(true);
    },
  );
});

describe('Focus metadata ownership', () => {
  it.each([false, true])(
    'rejects injected subpass Z metadata when decoding schema18 (CNC=%s)',
    (cnc) => {
      const source = focusProject();
      const project = {
        ...source,
        ...(cnc ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
        scene: {
          ...source.scene,
          layers: source.scene.layers.map(({ focusTest: _focus, ...layer }) => ({
            ...layer,
            subLayers: [
              {
                ...createLayerSubLayer(layer, { id: 'hidden', label: 'Hidden' }),
                settings: { ...layer, focusTest: { offsetMm: 999, travelFeedMmPerMin: 1000 } },
              },
            ],
          })),
        },
      };
      expect(deserializeProject(JSON.stringify(project))).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('settings.focusTest is only valid on the parent operation'),
      });
      // Direct in-memory compilation also cannot acquire hidden Z intent.
      expect(
        compileJob(project.scene, project.device).groups.every((group) => !('focusTest' in group)),
      ).toBe(true);
      expect(emitGcode(project).gcode).not.toContain('Focus Test Z offset');
    },
  );

  it('strips injected settings on normalization and only inherits the parent offset during compilation', () => {
    const project = focusProject();
    const layer = project.scene.layers[0];
    if (!layer) throw new Error('Missing sample');
    const injected = {
      ...createLayerSubLayer(layer, { id: 'hidden', label: 'Hidden' }),
      settings: { ...layer, focusTest: { offsetMm: 999, travelFeedMmPerMin: 1000 } },
    };
    expect(layerFromSubLayer(layer, injected).focusTest).toEqual(layer.focusTest);
    const normalized = normalizeLayer({ ...layer, subLayers: [injected] }) as Layer;
    expect(normalized.subLayers[0]?.settings).not.toHaveProperty('focusTest');
    const scene = { ...project.scene, layers: [{ ...layer, subLayers: [injected] }] };
    expect(
      compileJob(scene, project.device).groups.map(
        (group) => group.kind === 'cut' && group.focusTest?.offsetMm,
      ),
    ).toEqual([-1, -1]);
    // A legitimate saved subpass still decodes and compiles at the disclosed parent offset.
    const decoded = deserializeProject(
      JSON.stringify({ ...project, scene: { ...scene, layers: [normalized] } }),
    );
    expect(decoded.kind).toBe('ok');
    if (decoded.kind !== 'ok') throw new Error('Expected repaired project');
    expect(emitGcode(decoded.project).gcode).toContain('G1 Z-1.000');
    expect(emitGcode(decoded.project).gcode).not.toContain('Z999');
  });
});
