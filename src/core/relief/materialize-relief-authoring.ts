import type { ReliefHeightfield } from '../scene/relief/relief-heightfield';
import type { Vec2 } from '../scene/scene-object';
import type {
  ReliefAuthoringDocument,
  ReliefComponent,
  ReliefCombineMode,
  ReliefLevel,
  ReliefVectorMask,
} from '../scene/relief/relief-authoring';
import { createReliefHeightfield } from './relief-heightfield-factory';
import { createComponentSampler } from './relief-authoring-sampling';
import { reliefAuthoringError } from './relief-authoring-validation';
import { inverseReliefPoint, reliefBoundaryContains } from './relief-vector-boundary';
import { applyReliefSculptStrokes } from './relief-sculpt';
import { reliefVectorFootprintCovered } from './relief-vector-footprint';

export type ReliefAuthoringMaterializationResult =
  | {
      readonly kind: 'ok';
      readonly field: ReliefHeightfield;
      readonly warnings: ReadonlyArray<string>;
      readonly quantizationToleranceMm: number;
    }
  | { readonly kind: 'error'; readonly reason: string }
  | { readonly kind: 'cancelled' };
export type ReliefAuthoringMaterializationOptions = {
  readonly cancelled?: () => boolean;
  readonly progress?: (fraction: number) => void;
};

/** The sole retained-intent -> U16 boundary. Run large composition in its worker. */
export function materializeReliefAuthoring(
  document: ReliefAuthoringDocument,
  options: ReliefAuthoringMaterializationOptions = {},
): ReliefAuthoringMaterializationResult {
  const error = reliefAuthoringError(document);
  if (error !== null) return { kind: 'error', reason: error };
  const cancelled = options.cancelled ?? (() => false);
  if (cancelled()) return { kind: 'cancelled' };
  try {
    const exact = unchangedImportedReliefField(document);
    if (exact !== null) {
      // Validate payload even when avoiding conversion; preserves original codes and mapping.
      createComponentSampler({ kind: 'retained-field-v1', field: exact });
      return {
        kind: 'ok',
        field: { ...exact, revision: document.revision },
        warnings: [],
        quantizationToleranceMm: 0,
      };
    }
    const composed = composeComponents(document, cancelled, options.progress);
    if (cancelled()) return { kind: 'cancelled' };
    const encoded = encodeComposite(document, composed.heights, composed.coverage);
    const field = composedReliefField(document, encoded);
    if (cancelled()) return { kind: 'cancelled' };
    options.progress?.(1);
    return {
      kind: 'ok',
      field,
      warnings: compositionWarnings(encoded.clipped),
      quantizationToleranceMm: document.maxDepthMm / 65535 / 2,
    };
  } catch (failure) {
    if (cancelled()) return { kind: 'cancelled' };
    return {
      kind: 'error',
      reason: failure instanceof Error ? failure.message : 'Relief composition failed.',
    };
  }
}

function composeComponents(
  document: ReliefAuthoringDocument,
  cancelled: () => boolean,
  progress?: (fraction: number) => void,
): { heights: Float64Array; coverage: Uint8Array } {
  const count = document.width * document.height;
  const composed = new Float64Array(count).fill(document.baselineHeightMm),
    covered = new Uint8Array(count);
  const active = document.levels.flatMap((level) =>
    level.visible
      ? document.components
          .filter((c) => c.visible && c.levelId === level.id)
          .map((component) => ({ level, component }))
      : [],
  );
  for (const [index, entry] of active.entries()) {
    if (cancelled()) throw new Error('Relief authoring cancelled.');
    const sampled = componentGrid(document, entry.component, entry.level, cancelled);
    applyReliefSculptStrokes(
      sampled.heights,
      sampled.coverage,
      document,
      entry.component.id,
      cancelled,
    );
    for (let i = 0; i < count; i += 1) {
      if (sampled.coverage[i] === 0) continue;
      covered[i] = 255;
      composed[i] = combineReliefHeight(
        composed[i] ?? 0,
        sampled.heights[i] ?? 0,
        entry.component.combineMode,
      );
      if (!Number.isFinite(composed[i]))
        throw new Error('Composed relief exceeds the finite scalar range.');
    }
    progress?.(((index + 1) / Math.max(1, active.length)) * 0.9);
  }
  return { heights: composed, coverage: covered };
}
function composedReliefField(
  document: ReliefAuthoringDocument,
  encoded: { bytes: Uint8Array; mask: Uint8Array },
): ReliefHeightfield {
  return createReliefHeightfield({
    width: document.width,
    height: document.height,
    physicalWidthMm: document.physicalWidthMm,
    physicalHeightMm: document.physicalHeightMm,
    samples: encoded.bytes,
    inclusionMask: encoded.mask,
    mapping: {
      polarity: 'light-is-high',
      inputLowCode: 0,
      inputHighCode: 65535,
      curve: { kind: 'gamma-v1', gamma: 1 },
      maxDepthMm: document.maxDepthMm,
      crop: { kind: 'normalized-v1', x: 0, y: 0, width: 1, height: 1 },
      aspect: 'stretch',
      inclusionThreshold: 255,
      outsideMask: document.outsideMask,
    },
    provenance: {
      sourceKind: 'editable-relief-map',
      sourceName: 'Retained relief composition',
      sourceBitDepth: 16,
    },
    revision: document.revision,
  });
}

export function combineReliefHeight(
  baseline: number,
  height: number,
  mode: ReliefCombineMode,
): number {
  switch (mode) {
    case 'add':
      return baseline + height;
    case 'subtract':
      return baseline - height;
    case 'max':
      return Math.max(baseline, height);
    case 'min':
      return Math.min(baseline, height);
    case 'replace':
      return height;
  }
}

type ComponentSampleLocation = {
  readonly p: Vec2;
  readonly local: Vec2;
  readonly footprint: ReadonlyArray<Vec2>;
  readonly localFootprint: ReadonlyArray<Vec2>;
};

function componentGrid(
  doc: ReliefAuthoringDocument,
  component: ReliefComponent,
  level: ReliefLevel,
  cancelled: () => boolean,
): { heights: Float64Array; coverage: Uint8Array } {
  const count = doc.width * doc.height,
    heights = new Float64Array(count),
    coverage = new Uint8Array(count);
  const sample = createComponentSampler(component.source, doc.algorithmRevision);
  for (let y = 0; y < doc.height; y += 1) {
    if (cancelled()) throw new Error('Relief authoring cancelled.');
    for (let x = 0; x < doc.width; x += 1) {
      const location = componentSampleLocation(doc, component, x, y);
      if (!componentSampleCovered(doc, component, level, location)) continue;
      const value = sample(location.local),
        i = y * doc.width + x;
      if (!value.included) continue;
      const height = component.baseHeightMm + value.heightMm * component.heightScale;
      if (!Number.isFinite(height))
        throw new Error('Component height exceeds the finite scalar range.');
      heights[i] = height;
      coverage[i] = 255;
    }
  }
  return { heights, coverage };
}

function componentSampleLocation(
  doc: ReliefAuthoringDocument,
  component: ReliefComponent,
  x: number,
  y: number,
): ComponentSampleLocation {
  const p = reliefSamplePoint(doc, x, y);
  const footprint = usesWholeCellCoverage(doc) ? reliefCellFootprint(doc, x, y) : [];
  return {
    p,
    local: inverseReliefPoint(p, component.transform),
    footprint,
    localFootprint: footprint.map((corner) => inverseReliefPoint(corner, component.transform)),
  };
}

function componentSampleCovered(
  doc: ReliefAuthoringDocument,
  component: ReliefComponent,
  level: ReliefLevel,
  location: ComponentSampleLocation,
): boolean {
  const { p, local, footprint, localFootprint } = location;
  const wholeCell = usesWholeCellCoverage(doc);
  if (!maskSampleCovered(doc.clip, wholeCell, p, footprint)) return false;
  if (!maskSampleCovered(level.mask, wholeCell, p, footprint)) return false;
  if (!maskSampleCovered(component.mask, wholeCell, local, localFootprint)) return false;
  if (!wholeCell || component.source.kind !== 'vector-shape-v1') return true;
  return reliefVectorFootprintCovered(component.source.boundary, localFootprint);
}

function maskSampleCovered(
  mask: ReliefVectorMask | undefined,
  wholeCell: boolean,
  point: Vec2,
  footprint: ReadonlyArray<Vec2>,
): boolean {
  if (mask === undefined) return true;
  return wholeCell
    ? reliefVectorFootprintCovered(mask, footprint)
    : reliefBoundaryContains(mask, point);
}

function encodeComposite(
  doc: ReliefAuthoringDocument,
  heights: Float64Array,
  covered: Uint8Array,
): { bytes: Uint8Array; mask: Uint8Array; clipped: number } {
  const bytes = new Uint8Array(heights.length * 2),
    mask = new Uint8Array(heights.length);
  let clipped = 0;
  for (let y = 0; y < doc.height; y += 1)
    for (let x = 0; x < doc.width; x += 1) {
      const i = y * doc.width + x;
      const p = reliefSamplePoint(doc, x, y);
      const inside = documentSampleIncluded(
        doc,
        covered[i] ?? 0,
        p,
        usesWholeCellCoverage(doc) && doc.clip !== undefined ? reliefCellFootprint(doc, x, y) : [],
      );
      const height = encodedCompositeHeight(doc, heights[i] ?? 0, inside);
      if (inside && (height < 0 || height > doc.maxDepthMm)) clipped += 1;
      const code = Math.round(Math.min(1, Math.max(0, height / doc.maxDepthMm)) * 65535);
      bytes[i * 2] = code & 255;
      bytes[i * 2 + 1] = code >>> 8;
      mask[i] = inside ? 255 : 0;
    }
  return { bytes, mask, clipped };
}

function encodedCompositeHeight(
  doc: ReliefAuthoringDocument,
  height: number,
  inside: boolean,
): number {
  if (inside) return height;
  return doc.outsideMask === 'stock-top' ? doc.maxDepthMm : 0;
}

export function unchangedImportedReliefField(
  doc: ReliefAuthoringDocument,
): ReliefHeightfield | null {
  const c = doc.components[0],
    level = doc.levels[0];
  if (c === undefined || level === undefined || c.source.kind !== 'retained-field-v1') return null;
  const structure = [
    doc.components.length === 1,
    doc.levels.length === 1,
    doc.strokes.length === 0,
    doc.clip === undefined,
    doc.baselineHeightMm === 0,
    c.visible,
    level.visible,
    c.levelId === level.id,
    level.mask === undefined,
    c.mask === undefined,
    c.combineMode === 'replace',
    c.baseHeightMm === 0,
    c.heightScale === 1,
  ];
  if (!structure.every(Boolean)) return null;
  const t = c.transform,
    f = c.source.field;
  const binding = [
    t.x === 0,
    t.y === 0,
    t.scaleX === 1,
    t.scaleY === 1,
    t.rotationDeg === 0,
    !t.mirrorX,
    !t.mirrorY,
    doc.width === f.width,
    doc.height === f.height,
    doc.physicalWidthMm === f.physicalWidthMm,
    doc.physicalHeightMm === f.physicalHeightMm,
    doc.maxDepthMm === f.mapping.maxDepthMm,
    doc.outsideMask === f.mapping.outsideMask,
  ];
  return binding.every(Boolean) ? f : null;
}

function compositionWarnings(clipped: number): ReadonlyArray<string> {
  return clipped === 0
    ? []
    : [
        `${clipped} included samples exceeded the relief depth range and were clipped to floor/stock top.`,
      ];
}

function documentSampleIncluded(
  doc: ReliefAuthoringDocument,
  coverage: number,
  point: { x: number; y: number },
  footprint: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  return (
    maskSampleCovered(doc.clip, usesWholeCellCoverage(doc), point, footprint) &&
    (doc.outsideMask !== 'excluded' || coverage !== 0)
  );
}

function usesWholeCellCoverage(doc: ReliefAuthoringDocument): boolean {
  return doc.algorithmRevision === 'retained-relief-v2' && doc.outsideMask === 'excluded';
}

function reliefSamplePoint(doc: ReliefAuthoringDocument, x: number, y: number): Vec2 {
  // Preserve v1's floating-point evaluation order for exact persisted-field proofs.
  return doc.algorithmRevision === 'retained-relief-v1'
    ? {
        x: ((x + 0.5) * doc.physicalWidthMm) / doc.width,
        y: ((y + 0.5) * doc.physicalHeightMm) / doc.height,
      }
    : {
        x: ((x + 0.5) / doc.width) * doc.physicalWidthMm,
        y: ((y + 0.5) / doc.height) * doc.physicalHeightMm,
      };
}

function reliefCellFootprint(doc: ReliefAuthoringDocument, x: number, y: number) {
  const x0 = (x / doc.width) * doc.physicalWidthMm,
    x1 = ((x + 1) / doc.width) * doc.physicalWidthMm,
    y0 = (y / doc.height) * doc.physicalHeightMm,
    y1 = ((y + 1) / doc.height) * doc.physicalHeightMm;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}
