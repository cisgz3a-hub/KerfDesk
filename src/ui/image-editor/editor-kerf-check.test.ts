import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import type { JobPlacementSettings } from '../../core/job';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type OutputScope,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import {
  applyThicken,
  computeKerfCheck as computeKerfCheckWithPlacement,
} from './editor-kerf-check';
import { createSession, type EditorSession } from './editor-session';
import { addLayerAboveActive } from './editor-session-layers';
import { useImageEditorStore } from './image-editor-store';
import { DEFAULT_OUTPUT_SCOPE_SETTINGS, useStore, useToastStore } from '../state';

// 60×60 px on 60×60 mm (1 px = 1 mm).
const BOUNDS = { minX: 0, minY: 0, maxX: 60, maxY: 60 };

function raster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'source.png',
    dataUrl: 'data:image/png;base64,source',
    pixelWidth: 60,
    pixelHeight: 60,
    bounds: BOUNDS,
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    lumaBase64: 'AAA=',
  };
}

function projectWithDotWidth(
  dotWidthCorrectionMm: number,
  kerfOffsetMm = 0,
  linesPerMm = 0.1,
): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      objects: [raster()],
      layers: [
        {
          ...createLayer({ id: 'L1', color: '#808080', mode: 'image' }),
          ditherAlgorithm: 'threshold',
          dotWidthCorrectionMm,
          kerfOffsetMm,
          linesPerMm,
        },
      ],
    },
  };
}

// A 1-px vertical hairline at x=10 and a solid 10×10 block at (30..39, 30..39).
function projectWithImageSubLayer(dotWidthCorrectionMm: number): Project {
  const imageProject = projectWithDotWidth(dotWidthCorrectionMm);
  const imageSettings = imageProject.scene.layers[0];
  if (imageSettings === undefined) throw new Error('expected Image settings');
  const parent = createLayer({ id: 'L1', color: '#808080', mode: 'line' });
  const imagePass = createLayerSubLayer(parent, {
    id: 'image-pass',
    label: 'Image pass',
    settings: captureLayerOperationSettings(imageSettings),
  });
  return {
    ...imageProject,
    scene: {
      objects: [{ ...raster(), operationIds: [parent.id] }],
      layers: [{ ...parent, subLayers: [imagePass] }],
    },
  };
}

function selectedScope(selectedObjectIds: ReadonlyArray<string>): OutputScope {
  return {
    cutSelectedGraphics: true,
    useSelectionOrigin: false,
    selectedObjectIds,
  };
}

function computeKerfCheck(
  session: EditorSession,
  project: Project,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
) {
  return computeKerfCheckWithPlacement(session, project, outputScope, DEFAULT_JOB_PLACEMENT);
}

function strokesSession() {
  const doc = createRgbaBuffer(60, 60);
  const ink = (x: number, y: number): void => {
    const base = (y * 60 + x) * 4;
    doc.data[base] = 0;
    doc.data[base + 1] = 0;
    doc.data[base + 2] = 0;
  };
  for (let y = 5; y < 55; y += 1) ink(10, y);
  for (let y = 30; y < 40; y += 1) for (let x = 30; x < 40; x += 1) ink(x, y);
  return createSession('R1', 'source.png', doc, BOUNDS);
}

beforeEach(() => {
  useImageEditorStore.setState({ session: null, transform: null });
  useStore.setState({
    project: createProject(),
    selectedObjectId: null,
    additionalSelectedIds: new Set(),
    outputScopeSettings: DEFAULT_OUTPUT_SCOPE_SETTINGS,
    jobPlacement: DEFAULT_JOB_PLACEMENT,
  });
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
});

describe('computeKerfCheck', () => {
  it('flags a horizontal raster run that dot-width correction fully removes', () => {
    const check = computeKerfCheck(strokesSession(), projectWithDotWidth(3), DEFAULT_OUTPUT_SCOPE);
    expect(check).not.toBeNull();
    if (check === null) return;
    expect(check.minCorrectionMm).toBe(1);
    expect(check.maxCorrectionMm).toBe(1);
    // Each row of the 1-px vertical hairline is a 1 mm run and is removed;
    // the 10 mm block remains wider than 2 × the compiled 1 mm correction.
    expect(check.removedMask?.alpha[30 * 60 + 10]).toBe(255);
    expect(check.removedPixels).toBeGreaterThan(0);
    expect(check.removedMask?.alpha[35 * 60 + 35]).toBe(0);
  });

  it('ignores line-mode kerf offset and returns null without dot-width correction', () => {
    expect(
      computeKerfCheck(strokesSession(), projectWithDotWidth(0, 3), DEFAULT_OUTPUT_SCOPE),
    ).toBeNull();
  });

  it('uses the same line-interval clamp as raster compilation', () => {
    const check = computeKerfCheck(
      strokesSession(),
      projectWithDotWidth(3, 0, 1),
      DEFAULT_OUTPUT_SCOPE,
    );
    expect(check?.minCorrectionMm).toBe(1);
    expect(check?.maxCorrectionMm).toBe(1);
  });

  it('does not call a long horizontal hairline removed merely because it is one pixel tall', () => {
    const session = strokesSession();
    for (let x = 5; x < 55; x += 1) {
      const base = (2 * 60 + x) * 4;
      session.doc.data[base] = 0;
      session.doc.data[base + 1] = 0;
      session.doc.data[base + 2] = 0;
    }
    const check = computeKerfCheck(session, projectWithDotWidth(3), DEFAULT_OUTPUT_SCOPE);
    expect(check?.removedMask?.alpha[2 * 60 + 30]).toBe(0);
  });

  it('applyThicken repairs the thin strokes as one undoable entry', () => {
    const session = strokesSession();
    const project = projectWithDotWidth(3);
    useImageEditorStore.setState({ session });
    useStore.setState({ project });
    const check = computeKerfCheck(session, project, DEFAULT_OUTPUT_SCOPE);
    if (check === null) throw new Error('expected a check');
    applyThicken(check);
    const next = useImageEditorStore.getState().session;
    expect(next?.history.undoStack.at(-1)?.label).toBe('Thicken dot-width runs');
    // Re-checking the thickened document finds no thin strokes left.
    const recheck = computeKerfCheck(next ?? session, projectWithDotWidth(3), DEFAULT_OUTPUT_SCOPE);
    expect(recheck).toBeNull();
  });

  it('keeps another layer output loss warning-only for the active layer', () => {
    const layered = addLayerAboveActive(strokesSession(), 'upper');
    const check = computeKerfCheck(layered, projectWithDotWidth(3), DEFAULT_OUTPUT_SCOPE);
    expect(check?.removedPixels ?? 0).toBeGreaterThan(0);
    expect(check?.removedMask).toBeNull();
  });

  it('thickens an affected upper layer without editing the visible background', () => {
    const project = projectWithDotWidth(3);
    const layered = addLayerAboveActive(
      createSession('R1', 'source.png', createRgbaBuffer(60, 60), BOUNDS),
      'upper',
    );
    const upper = layered.layers.find((layer) => layer.id === 'upper');
    const background = layered.layers[0];
    if (upper === undefined || background === undefined) throw new Error('expected two layers');
    const backgroundBefore = Uint8ClampedArray.from(background.buffer.data);
    const undoCountBefore = layered.history.undoStack.length;
    for (let y = 5; y < 55; y += 1) {
      const base = (y * 60 + 20) * 4;
      upper.buffer.data[base + 3] = 255;
    }
    const upperBefore = Uint8ClampedArray.from(upper.buffer.data);
    const check = computeKerfCheck(layered, project, DEFAULT_OUTPUT_SCOPE);
    if (check === null) throw new Error('expected an upper-layer check');
    useStore.setState({ project });
    useImageEditorStore.setState({ session: layered });
    applyThicken(check);

    const next = useImageEditorStore.getState().session;
    const nextUpper = next?.layers.find((layer) => layer.id === 'upper');
    expect(next?.activeLayerId).toBe('upper');
    expect(next?.history.undoStack.at(-1)?.scope).toBe('upper');
    expect(next?.history.undoStack).toHaveLength(undoCountBefore + 1);
    expect(nextUpper?.buffer.data).not.toEqual(upperBefore);
    expect(background.buffer.data).toEqual(backgroundBefore);
  });

  it('does not apply a stale result to a different editor session', () => {
    const project = projectWithDotWidth(3);
    const check = computeKerfCheck(strokesSession(), project, DEFAULT_OUTPUT_SCOPE);
    if (check === null) throw new Error('expected a check');
    const nextSession = createSession('R2', 'other.png', createRgbaBuffer(60, 60), BOUNDS);
    useStore.setState({ project });
    useImageEditorStore.setState({ session: nextSession });

    applyThicken(check);

    expect(useImageEditorStore.getState().session).toBe(nextSession);
  });

  it('does not apply a result after the selected-output scope changes', () => {
    const project = projectWithDotWidth(3);
    const session = strokesSession();
    const check = computeKerfCheck(session, project, selectedScope(['R1']));
    if (check === null) throw new Error('expected a scoped check');
    useStore.setState({
      project,
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
      outputScopeSettings: DEFAULT_OUTPUT_SCOPE_SETTINGS,
    });
    useImageEditorStore.setState({ session });

    applyThicken(check);

    expect(useImageEditorStore.getState().session).toBe(session);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      message: expect.stringContaining('output selection changed'),
      variant: 'info',
    });
  });

  it('does not apply a result after captured Image sublayer settings change', () => {
    const project = projectWithImageSubLayer(3);
    const session = strokesSession();
    const check = computeKerfCheck(session, project, DEFAULT_OUTPUT_SCOPE);
    if (check === null || check.removedMask === null) {
      throw new Error('expected a repairable sublayer check');
    }
    const changedProject = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) => ({
          ...layer,
          subLayers: layer.subLayers.map((subLayer) => ({
            ...subLayer,
            settings: { ...subLayer.settings, dotWidthCorrectionMm: 2 },
          })),
        })),
      },
    };
    useStore.setState({ project: changedProject });
    useImageEditorStore.setState({ session });

    applyThicken(check);

    expect(useImageEditorStore.getState().session).toBe(session);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('output selection changed');
  });

  it('never applies a result after any captured editor owner changes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'session',
          'revision',
          'active-layer',
          'object',
          'layer',
          'correction',
          'output-scope',
          'output-placement',
        ),
        (changedOwner) => {
          const sourceProject = projectWithDotWidth(3);
          const sourceSession = strokesSession();
          const check = computeKerfCheck(sourceSession, sourceProject, DEFAULT_OUTPUT_SCOPE);
          if (check === null) throw new Error('expected a check');
          let currentSession = sourceSession;
          let currentProject = sourceProject;
          let selectedObjectId: string | null = null;
          let outputScopeSettings = DEFAULT_OUTPUT_SCOPE_SETTINGS;
          let jobPlacement: JobPlacementSettings = DEFAULT_JOB_PLACEMENT;

          if (changedOwner === 'session') {
            currentSession = createSession('R2', 'other.png', createRgbaBuffer(60, 60), BOUNDS);
          } else if (changedOwner === 'revision') {
            currentSession = { ...sourceSession, revision: sourceSession.revision + 1 };
          } else if (changedOwner === 'active-layer') {
            currentSession = { ...sourceSession, activeLayerId: 'different-layer' };
          } else if (changedOwner === 'object') {
            currentProject = {
              ...sourceProject,
              scene: {
                ...sourceProject.scene,
                objects: sourceProject.scene.objects.map((object) => ({ ...object })),
              },
            };
          } else if (changedOwner === 'layer') {
            currentProject = {
              ...sourceProject,
              scene: {
                ...sourceProject.scene,
                layers: sourceProject.scene.layers.map((layer) => ({ ...layer })),
              },
            };
          } else if (changedOwner === 'correction') {
            currentProject = projectWithDotWidth(2);
          } else if (changedOwner === 'output-scope') {
            selectedObjectId = 'R1';
            outputScopeSettings = {
              cutSelectedGraphics: true,
              useSelectionOrigin: false,
            };
          } else {
            jobPlacement = { startFrom: 'user-origin', anchor: 'front-left' };
          }

          useStore.setState({
            project: currentProject,
            selectedObjectId,
            additionalSelectedIds: new Set(),
            outputScopeSettings,
            jobPlacement,
          });
          useImageEditorStore.setState({ session: currentSession });
          applyThicken(check);

          expect(useImageEditorStore.getState().session).toBe(currentSession);
          for (const toast of useToastStore.getState().toasts) {
            useToastStore.getState().dismissToast(toast.id);
          }
        },
      ),
    );
  });
});
