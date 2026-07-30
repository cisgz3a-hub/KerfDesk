import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import type { JobPlacementSettings } from '../../core/job';
import {
  captureLayerOperationSettings,
  createLayerSubLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_OUTPUT_SCOPE,
  type OutputScope,
  type Project,
} from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { kerfContextTestFixtures } from '../../__fixtures__/image-editor/kerf-context-test-fixtures';
import type { EditorSession } from './editor-session';
import {
  isKerfCheckContextCurrent as checkKerfCheckContextCurrent,
  kerfCheckContext as resolveKerfCheckContext,
  kerfOperationLayer,
  type KerfCheckContext,
} from './kerf-check-context';

const {
  objectId: OBJECT_ID,
  sizePx: SIZE_PX,
  image,
  project,
  selectedScope,
  session,
  withScene,
} = kerfContextTestFixtures;

function kerfCheckContext(
  editor: EditorSession,
  sourceProject: Project,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
  jobPlacement: JobPlacementSettings = DEFAULT_JOB_PLACEMENT,
) {
  return resolveKerfCheckContext(editor, sourceProject, outputScope, jobPlacement);
}

function isKerfCheckContextCurrent(
  expected: KerfCheckContext,
  editor: EditorSession,
  sourceProject: Project,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
  jobPlacement: JobPlacementSettings = DEFAULT_JOB_PLACEMENT,
): boolean {
  return checkKerfCheckContextCurrent(expected, editor, sourceProject, outputScope, jobPlacement);
}

describe('kerf-check context ownership', () => {
  it('invalidates a result when its revision, document, or layer settings change', () => {
    const editor = session();
    const sourceProject = project();
    const context = kerfCheckContext(editor, sourceProject, DEFAULT_OUTPUT_SCOPE);
    if (context === null) throw new Error('expected a kerf-check context');

    expect(isKerfCheckContextCurrent(context, editor, sourceProject, DEFAULT_OUTPUT_SCOPE)).toBe(
      true,
    );
    expect(
      isKerfCheckContextCurrent(
        context,
        { ...editor, revision: editor.revision + 1 },
        sourceProject,
        DEFAULT_OUTPUT_SCOPE,
      ),
    ).toBe(false);
    expect(
      isKerfCheckContextCurrent(
        context,
        { ...editor, doc: createRgbaBuffer(SIZE_PX, SIZE_PX) },
        sourceProject,
        DEFAULT_OUTPUT_SCOPE,
      ),
    ).toBe(false);
    expect(
      isKerfCheckContextCurrent(
        context,
        editor,
        {
          ...sourceProject,
          scene: {
            ...sourceProject.scene,
            layers: sourceProject.scene.layers.map((layer) => ({
              ...layer,
              dotWidthCorrectionMm: 0.5,
            })),
          },
        },
        DEFAULT_OUTPUT_SCOPE,
      ),
    ).toBe(false);
  });

  it('finds a positive Image sublayer while retaining its zero-correction Image parent', () => {
    const sourceProject = project();
    const parent = {
      ...sourceProject.scene.layers[0]!,
      dotWidthCorrectionMm: 0,
    };
    const positive = createLayerSubLayer(parent, {
      id: 'positive',
      label: 'Positive correction',
      settings: {
        ...captureLayerOperationSettings(parent),
        mode: 'image',
        dotWidthCorrectionMm: 0.75,
      },
    });
    const layered = withScene(sourceProject, image(), [{ ...parent, subLayers: [positive] }]);
    const context = kerfCheckContext(session(), layered, DEFAULT_OUTPUT_SCOPE);

    expect(context?.layers).toEqual(layered.scene.layers);
    expect(kerfOperationLayer(context!, parent.id)).toBe(layered.scene.layers[0]);
    expect(kerfOperationLayer(context!, `${parent.id}:positive`)).toMatchObject({
      mode: 'image',
      dotWidthCorrectionMm: 0.75,
    });
  });

  it('finds one enabled Image sublayer under a Line parent', () => {
    const sourceProject = project();
    const parent = {
      ...sourceProject.scene.layers[0]!,
      mode: 'line' as const,
      dotWidthCorrectionMm: 0,
    };
    const imagePass = createLayerSubLayer(parent, {
      id: 'image-pass',
      label: 'Image pass',
      settings: {
        ...captureLayerOperationSettings(parent),
        mode: 'image',
        dotWidthCorrectionMm: 0.75,
      },
    });
    const layered = withScene(sourceProject, image(), [{ ...parent, subLayers: [imagePass] }]);
    const context = kerfCheckContext(session(), layered, DEFAULT_OUTPUT_SCOPE);

    expect(context?.layers).toHaveLength(1);
    expect(kerfOperationLayer(context!, `${parent.id}:image-pass`)).toMatchObject({
      mode: 'image',
      dotWidthCorrectionMm: 0.75,
    });
  });

  it('ignores a disabled positive Image sublayer', () => {
    const sourceProject = project();
    const parent = {
      ...sourceProject.scene.layers[0]!,
      mode: 'line' as const,
      dotWidthCorrectionMm: 0,
    };
    const disabled = createLayerSubLayer(parent, {
      id: 'disabled-image',
      label: 'Disabled image',
      enabled: false,
      settings: {
        ...captureLayerOperationSettings(parent),
        mode: 'image',
        dotWidthCorrectionMm: 0.75,
      },
    });
    const layered = withScene(sourceProject, image(), [{ ...parent, subLayers: [disabled] }]);

    expect(kerfCheckContext(session(), layered, DEFAULT_OUTPUT_SCOPE)).toBeNull();
  });

  it('uses the edited raster operation override when resolving correction ownership', () => {
    const sourceProject = project();
    const zeroLayer = {
      ...sourceProject.scene.layers[0]!,
      dotWidthCorrectionMm: 0,
    };
    const overriddenImage = {
      ...image(),
      operationOverride: {
        mode: 'image' as const,
        dotWidthCorrectionMm: 0.75,
      },
    };
    const overridden = withScene(sourceProject, overriddenImage, [zeroLayer]);

    expect(kerfCheckContext(session(), overridden, DEFAULT_OUTPUT_SCOPE)?.object).toBe(
      overriddenImage,
    );
  });

  it('does not run the laser raster advisory for a CNC project', () => {
    expect(
      kerfCheckContext(
        session(),
        { ...project(), machine: DEFAULT_CNC_MACHINE_CONFIG },
        DEFAULT_OUTPUT_SCOPE,
      ),
    ).toBeNull();
  });

  it('keeps translated job-origin placements outside the exact advisory contract', () => {
    const editor = session();
    const sourceProject = project();
    expect(
      kerfCheckContext(editor, sourceProject, DEFAULT_OUTPUT_SCOPE, {
        startFrom: 'user-origin',
        anchor: 'front-left',
      }),
    ).toBeNull();
    const context = kerfCheckContext(editor, sourceProject);
    if (context === null) throw new Error('expected an absolute-placement context');
    expect(
      isKerfCheckContextCurrent(context, editor, sourceProject, DEFAULT_OUTPUT_SCOPE, {
        ...DEFAULT_JOB_PLACEMENT,
        anchor: 'center',
      }),
    ).toBe(false);
  });

  it('retains every separately bound Image operation when any correction is positive', () => {
    const sourceProject = project();
    const operationTemplate = sourceProject.scene.layers[0]!;
    const zero = { ...operationTemplate, id: 'zero', dotWidthCorrectionMm: 0 };
    const positive = { ...operationTemplate, id: 'positive', dotWidthCorrectionMm: 0.75 };
    const boundImage = { ...image(), operationIds: [zero.id, positive.id] };
    const multi = withScene(sourceProject, boundImage, [zero, positive]);

    expect(kerfCheckContext(session(), multi, DEFAULT_OUTPUT_SCOPE)?.layers).toEqual([
      zero,
      positive,
    ]);
  });

  it('tracks selected-output membership and exact output-scope identity', () => {
    const editor = session();
    const sourceProject = project();
    const included = selectedScope([OBJECT_ID, 'kerf-context-mask']);
    const context = kerfCheckContext(editor, sourceProject, included);
    if (context === null) throw new Error('expected selected output context');

    expect(isKerfCheckContextCurrent(context, editor, sourceProject, included)).toBe(true);
    expect(
      isKerfCheckContextCurrent(
        context,
        editor,
        sourceProject,
        selectedScope([OBJECT_ID, 'kerf-context-mask'], true),
      ),
    ).toBe(false);
    expect(isKerfCheckContextCurrent(context, editor, sourceProject, DEFAULT_OUTPUT_SCOPE)).toBe(
      false,
    );
    expect(
      kerfCheckContext(editor, sourceProject, selectedScope(['kerf-context-mask'])),
    ).toBeNull();
  });

  it('invalidates when captured sublayer settings change', () => {
    const sourceProject = project();
    const parent = {
      ...sourceProject.scene.layers[0]!,
      mode: 'line' as const,
      dotWidthCorrectionMm: 0,
    };
    const imagePass = createLayerSubLayer(parent, {
      id: 'image-pass',
      label: 'Image pass',
      settings: {
        ...captureLayerOperationSettings(parent),
        mode: 'image',
        dotWidthCorrectionMm: 0.75,
      },
    });
    const capturedProject = withScene(sourceProject, image(), [
      { ...parent, subLayers: [imagePass] },
    ]);
    const editor = session();
    const context = kerfCheckContext(editor, capturedProject, DEFAULT_OUTPUT_SCOPE);
    if (context === null) throw new Error('expected sublayer context');
    const changedProject = {
      ...capturedProject,
      scene: {
        ...capturedProject.scene,
        layers: capturedProject.scene.layers.map((layer) => ({
          ...layer,
          subLayers: layer.subLayers.map((subLayer) => ({
            ...subLayer,
            settings: { ...subLayer.settings, dotWidthCorrectionMm: 0.5 },
          })),
        })),
      },
    };

    expect(isKerfCheckContextCurrent(context, editor, changedProject, DEFAULT_OUTPUT_SCOPE)).toBe(
      false,
    );
  });

  it('invalidates every independently owned freshness input', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'object',
          'layer',
          'source-doc',
          'revision',
          'active-layer',
          'dimensions',
          'correction',
          'device',
          'mask-object',
          'output-scope',
          'output-placement',
        ),
        (changedInput) => {
          const editor = session();
          const sourceProject = project();
          const context = kerfCheckContext(editor, sourceProject, DEFAULT_OUTPUT_SCOPE);
          if (context === null) throw new Error('expected a kerf-check context');
          let currentSession = editor;
          let currentProject = sourceProject;
          let outputScope = DEFAULT_OUTPUT_SCOPE;
          let jobPlacement: JobPlacementSettings = DEFAULT_JOB_PLACEMENT;

          if (changedInput === 'object') {
            currentProject = {
              ...sourceProject,
              scene: {
                ...sourceProject.scene,
                objects: sourceProject.scene.objects.map((object) => ({ ...object })),
              },
            };
          } else if (changedInput === 'layer') {
            currentProject = {
              ...sourceProject,
              scene: {
                ...sourceProject.scene,
                layers: sourceProject.scene.layers.map((layer) => ({ ...layer })),
              },
            };
          } else if (changedInput === 'source-doc') {
            currentSession = {
              ...editor,
              doc: createRgbaBuffer(SIZE_PX, SIZE_PX),
            };
          } else if (changedInput === 'revision') {
            currentSession = { ...editor, revision: editor.revision + 1 };
          } else if (changedInput === 'active-layer') {
            currentSession = { ...editor, activeLayerId: 'different-layer' };
          } else if (changedInput === 'dimensions') {
            currentSession = {
              ...editor,
              doc: createRgbaBuffer(SIZE_PX + 1, SIZE_PX),
            };
          } else if (changedInput === 'device') {
            currentProject = { ...sourceProject, device: { ...sourceProject.device } };
          } else if (changedInput === 'mask-object') {
            currentProject = {
              ...sourceProject,
              scene: {
                ...sourceProject.scene,
                objects: sourceProject.scene.objects.map((object) =>
                  object.id === 'kerf-context-mask' ? { ...object } : object,
                ),
              },
            };
          } else if (changedInput === 'output-scope') {
            outputScope = selectedScope([OBJECT_ID, 'kerf-context-mask']);
          } else if (changedInput === 'output-placement') {
            jobPlacement = { ...DEFAULT_JOB_PLACEMENT, anchor: 'center' };
          } else {
            currentProject = {
              ...sourceProject,
              scene: {
                ...sourceProject.scene,
                layers: sourceProject.scene.layers.map((layer) => ({
                  ...layer,
                  dotWidthCorrectionMm: 0.5,
                })),
              },
            };
          }

          expect(
            isKerfCheckContextCurrent(
              context,
              currentSession,
              currentProject,
              outputScope,
              jobPlacement,
            ),
          ).toBe(false);
        },
      ),
    );
  });
});
