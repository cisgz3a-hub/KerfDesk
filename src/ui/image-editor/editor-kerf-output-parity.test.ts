import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import { collectG1SValues } from '../../core/invariants';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type DitherAlgorithm,
  type Layer,
  type OutputScope,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import { computeKerfOutputParity } from './editor-kerf-output-parity';
import { appliedBounds, createSession, type EditorSession } from './editor-session';
import { compositeSession } from './editor-session-layers';
import { kerfCheckContext } from './kerf-check-context';

const DEFAULT_BOUNDS = { minX: 10, minY: 10, maxX: 12, maxY: 11 };
const OVER_REPAIR_MASK_BUDGET_WIDTH = 250_001;
// Black and S608 grey, each a one-pixel burned line between white: the 0.75 mm
// correction shortens both ends of each line and removes it (ADR-458 Amd 1).
const TWO_GREY_DOTS = {
  luma: [0, 255, 100],
  bounds: { minX: 10, minY: 10, maxX: 13, maxY: 11 },
};

type FixtureOptions = {
  readonly luma: ReadonlyArray<number>;
  readonly storedLuma?: ReadonlyArray<number>;
  readonly width?: number;
  readonly height?: number;
  readonly bounds?: RasterImage['bounds'];
  readonly dither?: DitherAlgorithm;
  readonly object?: Partial<RasterImage>;
  readonly layer?: Partial<Layer>;
  readonly extraObjects?: ReadonlyArray<SceneObject>;
};

function fixture(options: FixtureOptions): {
  readonly project: Project;
  readonly session: EditorSession;
} {
  const width = options.width ?? options.luma.length;
  const height = options.height ?? 1;
  const bounds = options.bounds ?? DEFAULT_BOUNDS;
  const dither = options.dither ?? 'grayscale';
  const doc = createRgbaBuffer(width, height);
  for (let index = 0; index < options.luma.length; index += 1) {
    const value = options.luma[index] ?? 255;
    doc.data.set([value, value, value, 255], index * 4);
  }
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'R1',
    source: 'gray.png',
    dataUrl: 'data:image/png;base64,gray',
    pixelWidth: width,
    pixelHeight: height,
    bounds,
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither,
    linesPerMm: 1,
    lumaBase64: encodeLuma(options.storedLuma ?? options.luma),
    ...options.object,
  };
  const layer: Layer = {
    ...createLayer({ id: 'L1', color: '#808080', mode: 'image' }),
    ditherAlgorithm: dither,
    passThrough: true,
    linesPerMm: 1,
    imageBidirectional: false,
    power: 100,
    minPower: 0,
    dotWidthCorrectionMm: 0.75,
    ...options.layer,
  };
  const base = createProject();
  return {
    session: createSession(image.id, image.source, doc, bounds),
    project: {
      ...base,
      scene: {
        objects: [image, ...(options.extraObjects ?? [])],
        layers: [layer],
      },
    },
  };
}

function outputParity(
  session: EditorSession,
  project: Project,
  outputScope: OutputScope = DEFAULT_OUTPUT_SCOPE,
) {
  const context = kerfCheckContext(session, project, outputScope, DEFAULT_JOB_PLACEMENT);
  if (context === null) throw new Error('Expected an Image-mode kerf context.');
  return computeKerfOutputParity({
    composite: compositeSession(session),
    object: context.object,
    layers: context.layers,
    maskObject: context.maskObject,
    device: context.device,
    appliedBounds: appliedBounds(session) ?? context.object.bounds,
  });
}

function encodeLuma(values: ReadonlyArray<number>): string {
  return Buffer.from(values).toString('base64');
}

function withLayers(project: Project, layers: ReadonlyArray<Layer>): Project {
  return { ...project, scene: { ...project.scene, layers } };
}

describe('computeKerfOutputParity', () => {
  it('matches exact grayscale power runs erased from the prepared output', () => {
    const { project, session } = fixture(TWO_GREY_DOTS);
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const group = prepared.job.groups.find((candidate) => candidate.kind === 'raster');
    expect(group?.kind === 'raster' ? [...group.sValues] : []).toEqual([1000, 0, 608]);
    expect(collectG1SValues(emitPreparedGcode(prepared).gcode).filter((s) => s > 0)).toEqual([]);

    const parity = outputParity(session, project);
    expect(parity?.removedPixels).toBe(2);
    expect(parity?.minCorrectionMm).toBe(0.75);
    expect(parity?.maxCorrectionMm).toBe(0.75);
    expect(parity?.thickenCandidate?.removed.mask?.alpha).toEqual(new Uint8Array([255, 0, 255]));
  });

  it('reports no loss for adjacent grayscale powers the output keeps (ADR-458 Amd 1)', () => {
    const { project, session } = fixture({ luma: [0, 100] });
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    // One two-millimetre burned line: only its ends are shortened.
    expect(collectG1SValues(emitPreparedGcode(prepared).gcode).filter((s) => s > 0)).toEqual([
      1000, 608,
    ]);
    expect(outputParity(session, project)).toMatchObject({
      removedPixels: 0,
      thickenCandidate: null,
    });
  });

  it('compiles the raster operation override before evaluating exact run loss', () => {
    const { project, session } = fixture({
      luma: [0],
      bounds: { minX: 10, minY: 10, maxX: 11, maxY: 11 },
      layer: { dotWidthCorrectionMm: 0 },
      object: {
        operationOverride: {
          mode: 'image',
          dotWidthCorrectionMm: 0.75,
        },
      },
    });

    expect(outputParity(session, project)).toMatchObject({
      removedPixels: 1,
      minCorrectionMm: 0.75,
      maxCorrectionMm: 0.75,
    });
  });

  it('carries compiler black power above Uint16 into the repair proof', () => {
    const { project, session } = fixture({
      luma: [0],
      bounds: { minX: 10, minY: 10, maxX: 11, maxY: 11 },
    });
    const wrappedPowerProject = {
      ...project,
      device: { ...project.device, maxPowerS: 65_537 },
    };

    expect(outputParity(session, wrappedPowerProject)?.thickenCandidate?.group.blackS).toBe(65_537);
  });

  it('prepares the dirty editor composite instead of the stale stored luma', () => {
    const { project, session } = fixture({
      ...TWO_GREY_DOTS,
      storedLuma: [255, 255, 255],
    });
    expect(outputParity(session, project)?.removedPixels).toBe(2);
  });

  it('keeps an over-budget loss advisory while omitting its repair mask', () => {
    const luma = Array.from({ length: OVER_REPAIR_MASK_BUDGET_WIDTH }, (_, index) =>
      index % 2 === 0 ? 0 : 255,
    );
    const { project, session } = fixture({ luma });

    expect(outputParity(session, project)).toMatchObject({
      removedPixels: Math.ceil(OVER_REPAIR_MASK_BUDGET_WIDTH / 2),
      thickenCandidate: null,
    });
  });

  it('does not attribute a controller-coordinate-only collapse to dot-width correction', () => {
    const { project, session } = fixture({
      luma: [127],
      bounds: { minX: 1, minY: 1, maxX: 1.041667, maxY: 1.1 },
      layer: { dotWidthCorrectionMm: 0.0207 },
    });
    const prepared = prepareOutput(project);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(collectG1SValues(emitPreparedGcode(prepared).gcode).filter((s) => s > 0)).toEqual([]);
    expect(outputParity(session, project)).toMatchObject({
      removedPixels: 0,
      minCorrectionMm: 0,
      maxCorrectionMm: 0,
      thickenCandidate: null,
    });
  });

  it.each([
    ['threshold', 0],
    ['ordered', 0],
    ['grayscale', 100],
    ['floyd-steinberg', 0],
  ] as const)('uses the compiled %s S schedule', (dither, luma) => {
    const { project, session } = fixture({
      luma: [luma],
      bounds: { minX: 10, minY: 10, maxX: 11, maxY: 11 },
      dither,
    });
    const parity = outputParity(session, project);
    expect(parity?.removedPixels).toBe(1);
    expect(parity?.thickenCandidate).not.toBeNull();
  });

  it('captures a mirrored direct output sample on the compiled output grid', () => {
    const { project, session } = fixture({
      luma: [0, 255],
      dither: 'threshold',
      object: { transform: { ...IDENTITY_TRANSFORM, mirrorX: true } },
    });
    const parity = outputParity(session, project);
    expect(parity?.removedPixels).toBe(1);
    expect(parity?.thickenCandidate?.removed.mask).not.toBeNull();
  });

  it('reports resampled and rotated output loss before editor repair mapping', () => {
    const resampled = fixture({
      luma: [0, 0, 255, 255, 100, 100],
      width: 6,
      bounds: TWO_GREY_DOTS.bounds,
      layer: { passThrough: false },
    });
    const rotated = fixture({
      luma: [0, 100],
      object: { transform: { ...IDENTITY_TRANSFORM, rotationDeg: 90 } },
    });
    expect(outputParity(resampled.session, resampled.project)?.removedPixels).toBe(2);
    expect(outputParity(resampled.session, resampled.project)?.thickenCandidate).not.toBeNull();
    expect(outputParity(rotated.session, rotated.project)?.removedPixels).toBeGreaterThan(0);
    expect(outputParity(rotated.session, rotated.project)?.thickenCandidate).not.toBeNull();
  });

  it('honors the prepared image mask before editor repair mapping', () => {
    const mask = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 1, heightMm: 1, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
    });
    const { project, session } = fixture({
      luma: [0, 0],
      dither: 'threshold',
      object: { imageMaskId: mask.id },
      extraObjects: [mask],
    });
    expect(outputParity(session, project)?.removedPixels).toBe(1);
    expect(outputParity(session, project)?.thickenCandidate).not.toBeNull();
  });

  it('honors an unselected mask dependency in selected-only output parity', () => {
    const mask = createRectangle({
      id: 'M1',
      color: '#000000',
      spec: { widthMm: 1, heightMm: 1, cornerRadiusMm: 0 },
      transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
    });
    const { project, session } = fixture({
      luma: [0, 0],
      dither: 'threshold',
      object: { imageMaskId: mask.id },
      extraObjects: [mask],
    });
    const selectedOnly: OutputScope = {
      cutSelectedGraphics: true,
      useSelectionOrigin: false,
      selectedObjectIds: ['R1'],
    };

    expect(outputParity(session, project, selectedOnly)?.removedPixels).toBe(1);
  });

  it('honors adjustments, power, pass-through, and row direction', () => {
    const adjusted = fixture({ ...TWO_GREY_DOTS, object: { brightness: 100 } });
    const inverted = fixture({
      luma: [255],
      bounds: { minX: 10, minY: 10, maxX: 11, maxY: 11 },
      layer: { negativeImage: true },
    });
    const powerOff = fixture({ ...TWO_GREY_DOTS, layer: { power: 0 } });
    const forward = fixture(TWO_GREY_DOTS);
    const bidirectional = fixture({
      ...TWO_GREY_DOTS,
      layer: { imageBidirectional: true },
    });
    // Pass-through keeps original luma: the black and grey dots still lose
    // their one-pixel lines, while an original white pixel stays white despite
    // the stored negative flag.
    expect(outputParity(adjusted.session, adjusted.project)?.removedPixels).toBe(2);
    expect(outputParity(inverted.session, inverted.project)?.removedPixels).toBe(0);
    expect(outputParity(powerOff.session, powerOff.project)?.removedPixels).toBe(0);
    expect(outputParity(forward.session, forward.project)?.removedPixels).toBe(
      outputParity(bidirectional.session, bidirectional.project)?.removedPixels,
    );
  });

  it('keeps a zero-correction Image parent in scope beside a lossy Image sublayer', () => {
    const base = fixture({ ...TWO_GREY_DOTS, layer: { dotWidthCorrectionMm: 0 } });
    const parent = base.project.scene.layers[0];
    if (parent === undefined) throw new Error('expected a parent operation');
    const subLayer = createLayerSubLayer(parent, {
      id: 'positive',
      label: 'Positive correction',
      settings: {
        ...captureLayerOperationSettings(parent),
        mode: 'image',
        dotWidthCorrectionMm: 0.75,
      },
    });
    const project = withLayers(base.project, [{ ...parent, subLayers: [subLayer] }]);

    expect(outputParity(base.session, project)).toMatchObject({
      removedPixels: 2,
      minCorrectionMm: 0.75,
      maxCorrectionMm: 0.75,
      thickenCandidate: null,
    });
  });

  it('offers one output-grid candidate for a Line parent with one lossy Image sublayer', () => {
    const base = fixture({
      ...TWO_GREY_DOTS,
      layer: { mode: 'line', dotWidthCorrectionMm: 0 },
    });
    const parent = base.project.scene.layers[0];
    if (parent === undefined) throw new Error('expected a parent operation');
    const subLayer = createLayerSubLayer(parent, {
      id: 'image-pass',
      label: 'Image pass',
      settings: {
        ...captureLayerOperationSettings(parent),
        mode: 'image',
        dotWidthCorrectionMm: 0.75,
      },
    });
    const project = withLayers(base.project, [{ ...parent, subLayers: [subLayer] }]);
    const parity = outputParity(base.session, project);

    expect(parity).toMatchObject({
      removedPixels: 2,
      minCorrectionMm: 0.75,
      maxCorrectionMm: 0.75,
    });
    expect(parity?.thickenCandidate?.group.layerId).toBe('L1:image-pass');
  });

  it('sums losses and reports the correction range across parent and sublayer operations', () => {
    const base = fixture({ ...TWO_GREY_DOTS, layer: { dotWidthCorrectionMm: 0.6 } });
    const parent = base.project.scene.layers[0];
    if (parent === undefined) throw new Error('expected a parent operation');
    const subLayer = createLayerSubLayer(parent, {
      id: 'detail',
      label: 'Detail',
      settings: {
        ...captureLayerOperationSettings(parent),
        mode: 'image',
        dotWidthCorrectionMm: 0.75,
      },
    });
    const project = withLayers(base.project, [{ ...parent, subLayers: [subLayer] }]);

    expect(outputParity(base.session, project)).toMatchObject({
      removedPixels: 4,
      minCorrectionMm: 0.6,
      maxCorrectionMm: 0.75,
      thickenCandidate: null,
    });
  });

  it('keeps separately bound zero-correction output in the multi-operation topology', () => {
    const base = fixture({
      ...TWO_GREY_DOTS,
      object: { operationIds: ['zero', 'positive'] },
    });
    const template = base.project.scene.layers[0];
    if (template === undefined) throw new Error('expected an operation template');
    const zero = { ...template, id: 'zero', dotWidthCorrectionMm: 0 };
    const positive = { ...template, id: 'positive', dotWidthCorrectionMm: 0.75 };
    const project = withLayers(base.project, [zero, positive]);

    expect(outputParity(base.session, project)).toMatchObject({
      removedPixels: 2,
      minCorrectionMm: 0.75,
      maxCorrectionMm: 0.75,
      thickenCandidate: null,
    });
  });
});
