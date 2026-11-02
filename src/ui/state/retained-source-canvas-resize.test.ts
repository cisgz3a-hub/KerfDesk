// L5-P1-1 (rolling audit v7): a constrained sketch or generated part resized on
// the canvas burned every later typed dimension at the canvas scale. Its editor
// now opens on the sizes that burn and regenerates at scale 1 (ADR-573
// Amendment 1).
import { beforeEach, describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job/compile-job';
import {
  applyTransform,
  buildSelectionTransformEdit,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
} from '../../core/scene';
import { retainedSourceScale } from '../../core/scene/retained-source-scale';
import { defaultConstrainedSketch } from '../../core/sketch-constraints/default-constrained-sketch';
import { editableConstrainedSketch } from '../../core/sketch-constraints/scale-constrained-sketch';
import type { ConstrainedSketch2d } from '../../core/sketch-constraints/constrained-sketch';
import { defaultPartGenerator, type GeneratedPartObject } from '../../core/parts/part-generator';
import { editablePartGeneratorDefinition } from '../../core/parts/scale-part-generator';
import { appendSketchPrimitive, sketchFromTemplate } from '../layers/sketch-geometry-draft';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);

type Size = { readonly w: number; readonly h: number };

/** Each path's size on the bed: what the compiler cuts once the transform is applied. */
function burnSizes(object: ImportedSvg): Size[] {
  return object.paths.map((path) => {
    const points = path.polylines.flatMap((polyline) =>
      polyline.points.map((point) => applyTransform(point, object.transform)),
    );
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const round = (value: number) => Math.round(value * 1000) / 1000;
    return {
      w: round(Math.max(...xs) - Math.min(...xs)),
      h: round(Math.max(...ys) - Math.min(...ys)),
    };
  });
}

function only(): ImportedSvg {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'imported-svg') throw new Error('Expected one vector');
  return object;
}

function resize(scaleX: number, scaleY: number): ImportedSvg {
  const object = only();
  useStore
    .getState()
    .applySelectionTransforms([
      { id: object.id, transform: { ...object.transform, scaleX, scaleY } },
    ]);
  return only();
}

/** The toolbar's W or H field, with the aspect lock off (its default). */
function typeSize(field: 'width' | 'height', value: number): ImportedSvg {
  const edit = buildSelectionTransformEdit([only()], {
    kind: 'resize',
    anchor: 'nw',
    [field]: value,
    preserveAspect: false,
  });
  if (edit.kind !== 'ok') throw new Error(edit.reason);
  useStore.getState().applySelectionTransforms(edit.transforms);
  return only();
}

/** The compiled outline's size on the bed. */
function compiledSize(): Size {
  const { scene, device } = useStore.getState().project;
  const points = compileJob(scene, device).groups.flatMap((group) =>
    group.kind === 'cut' ? group.segments.flatMap((segment) => segment.polyline) : [],
  );
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    w: round(Math.max(...xs) - Math.min(...xs)),
    h: round(Math.max(...ys) - Math.min(...ys)),
  };
}

function withParameters(
  sketch: ConstrainedSketch2d,
  values: Readonly<Record<string, number>>,
): ConstrainedSketch2d {
  return {
    ...sketch,
    parameters: sketch.parameters.map((parameter) => {
      const value = values[parameter.name];
      return value === undefined ? parameter : { ...parameter, value };
    }),
  };
}

function applySketch(sketch: ConstrainedSketch2d, opened?: ImportedSvg): void {
  const reviewed = useStore
    .getState()
    .reviewConstrainedSketch(sketch, opened?.id, opened?.transform);
  if (reviewed.kind !== 'ok') throw new Error(reviewed.reason);
  expect(useStore.getState().applyConstrainedSketch(reviewed.review)).toBe(true);
}

describe('a canvas-resized constrained sketch (ADR-573 Amendment 1)', () => {
  it('opens on the resized sizes and burns the typed width and hole', () => {
    applySketch(defaultConstrainedSketch());
    expect(burnSizes(only())).toEqual([
      { w: 60, h: 30 },
      { w: 4, h: 4 },
      { w: 4, h: 4 },
    ]);
    const resized = resize(2, 2);
    const opened = editableConstrainedSketch(resized);
    if (opened === undefined) throw new Error('Missing sketch');
    expect(opened.parameters.slice(0, 3).map((parameter) => parameter.value)).toEqual([120, 60, 8]);
    applySketch(withParameters(opened, { width: 80, hole_diameter: 6 }), resized);
    const after = only();
    expect(after.transform).toMatchObject({ scaleX: 1, scaleY: 1, x: resized.transform.x });
    expect(burnSizes(after)).toEqual([
      { w: 80, h: 60 },
      { w: 6, h: 6 },
      { w: 6, h: 6 },
    ]);
  });

  it('keeps round holes when a stretched sketch is edited, removing the stretch', () => {
    applySketch(defaultConstrainedSketch());
    const stretched = resize(2, 1);
    const opened = editableConstrainedSketch(stretched);
    if (opened === undefined) throw new Error('Missing sketch');
    expect(opened).toBe(stretched.constrainedSketch);
    applySketch(withParameters(opened, { width: 80, hole_diameter: 6 }), stretched);
    expect(burnSizes(only())).toEqual([
      { w: 80, h: 30 },
      { w: 6, h: 6 },
      { w: 6, h: 6 },
    ]);
  });

  it('asks for a reopen when the sketch was resized after its editor opened', () => {
    applySketch(defaultConstrainedSketch());
    const opened = only();
    resize(2, 2);
    const reviewed = useStore
      .getState()
      .reviewConstrainedSketch(defaultConstrainedSketch(), opened.id, opened.transform);
    expect(reviewed).toMatchObject({ kind: 'invalid' });
    expect(reviewed.kind === 'invalid' ? reviewed.reason : '').toMatch(/resized after this editor/);
  });

  // N5-P2-1 (rolling audit v8): a sub-millimetre change stops the solver about
  // 1e-6 mm short, so W and H typed as two fields left the factors 1e-8 apart.
  // The sketch read as stretched and Apply returned it to 60 x 30 (ADR-573
  // Amendment 2).
  it('folds W then H typed on a sketch solved from a sub-millimetre change', () => {
    const drawn = appendSketchPrimitive(
      sketchFromTemplate('custom'),
      'rectangle',
      [0, 0, 59.5, 29.5],
    );
    if (drawn === null) throw new Error('Rectangle refused');
    applySketch(drawn);
    const solved = only();
    if (solved.constrainedSketch === undefined) throw new Error('Missing sketch');
    applySketch(
      withParameters(solved.constrainedSketch, { outline1_width: 60, outline1_height: 30 }),
      solved,
    );
    typeSize('width', 120);
    const resized = typeSize('height', 60);
    expect(compiledSize()).toEqual({ w: 120, h: 60 });

    const opened = editableConstrainedSketch(resized);
    if (opened === undefined) throw new Error('Missing sketch');
    applySketch(opened, resized);
    expect(compiledSize()).toEqual({ w: 120, h: 60 });
    expect(only().transform).toMatchObject({ scaleX: 1, scaleY: 1 });
    expect(retainedSourceScale(resized)).toMatchObject({ kind: 'even' });
  });
});

// R6-P2-2 (rolling audit v9): the toolbar shows W and H to 3 decimals in mm
// and 4 in inches, so a size that does not divide evenly is typed rounded.
// 120 x 70 typed to W 100, H 58.333 read "stretched (83.33%, 83.33%)" and
// Apply returned it to 120 x 70 (ADR-573 Amendment 4).
describe('W then H typed as the toolbar shows them (ADR-573 Amendment 4)', () => {
  const MM_PER_INCH = 25.4;
  const asShown = {
    mm: (valueMm: number) => Number(valueMm.toFixed(3)),
    in: (valueMm: number) => Number((valueMm / MM_PER_INCH).toFixed(4)) * MM_PER_INCH,
  };

  function drawRectangle(widthMm: number, heightMm: number): ImportedSvg {
    const drawn = appendSketchPrimitive(sketchFromTemplate('custom'), 'rectangle', [0, 0, 10, 10]);
    if (drawn === null) throw new Error('Rectangle refused');
    applySketch(drawn);
    const first = only();
    if (first.constrainedSketch === undefined) throw new Error('Missing sketch');
    applySketch(
      withParameters(first.constrainedSketch, {
        outline1_width: widthMm,
        outline1_height: heightMm,
      }),
      first,
    );
    return only();
  }

  // Round sources with a factor that does not terminate, and sources that are
  // not round themselves (a hexagon's bounds, thirds, a root of two).
  const cases = [
    { w: 120, h: 70, toW: 100 },
    { w: 70, h: 45, toW: 100 },
    { w: 30, h: 17, toW: 100 },
    { w: 60, h: 30, toW: 100 },
    { w: 100, h: 86.60254, toW: 200 },
    { w: 100 / 3, h: 20, toW: (2 * 100) / 3 },
    { w: 70, h: 70 / 3, toW: 140 },
    { w: 41.4214, h: 12.5, toW: 41.4214 * 1.5 },
  ];
  for (const unit of ['mm', 'in'] as const) {
    for (const { w, h, toW } of cases) {
      it(`folds ${w.toFixed(3)} x ${h.toFixed(3)} typed in ${unit} to W ${toW.toFixed(3)}`, () => {
        drawRectangle(w, h);
        const typedW = asShown[unit](toW);
        const typedH = asShown[unit]((h * toW) / w);
        typeSize('width', typedW);
        const resized = typeSize('height', typedH);
        expect(retainedSourceScale(resized)).toMatchObject({ kind: 'even' });

        const opened = editableConstrainedSketch(resized);
        if (opened === undefined) throw new Error('Missing sketch');
        applySketch(opened, resized);
        expect(only().transform).toMatchObject({ scaleX: 1, scaleY: 1 });
        const burned = compiledSize();
        expect(Math.abs(burned.w - typedW)).toBeLessThanOrEqual(0.002);
        expect(Math.abs(burned.h - typedH)).toBeLessThanOrEqual(0.002);
      });
    }
  }

  it('keeps a 0.01 mm stretch typed into H as a stretch', () => {
    for (const { w, h, toW } of cases) {
      resetStore();
      drawRectangle(w, h);
      typeSize('width', asShown.mm(toW));
      const resized = typeSize('height', asShown.mm((h * toW) / w + 0.01));
      expect(retainedSourceScale(resized)).toMatchObject({ kind: 'stretched' });
    }
  });
});

describe('a canvas-resized generated part (ADR-573 Amendment 1)', () => {
  function createPanel(): GeneratedPartObject {
    const prepared = useStore.getState().preparePartGenerator(defaultPartGenerator('panel'));
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    expect(useStore.getState().acceptPartGenerator(prepared.value).kind).toBe('ok');
    return only() as GeneratedPartObject;
  }

  function applyPart(part: GeneratedPartObject, widthMm: number, holeDiameterMm: number): void {
    const definition = { ...editablePartGeneratorDefinition(part), widthMm, holeDiameterMm };
    const prepared = useStore.getState().preparePartGenerator(definition, part.id, part.transform);
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    expect(useStore.getState().acceptPartGenerator(prepared.value).kind).toBe('ok');
  }

  it('opens on the resized lengths and burns the typed ones', () => {
    createPanel();
    const resized = resize(2, 2) as GeneratedPartObject;
    expect(editablePartGeneratorDefinition(resized)).toMatchObject({
      widthMm: 120,
      heightMm: 80,
      holeDiameterMm: 8,
      edgeOffsetMm: 16,
    });
    applyPart(resized, 100, 6);
    const sizes = burnSizes(only());
    expect(only().transform).toMatchObject({ scaleX: 1, scaleY: 1 });
    expect(sizes[0]).toEqual({ w: 100, h: 80 });
    expect(sizes.slice(1).every((size) => size.w === 6 && size.h === 6)).toBe(true);
  });

  it('keeps round holes when a stretched part is edited', () => {
    createPanel();
    const stretched = resize(1, 2) as GeneratedPartObject;
    applyPart(stretched, 80, 6);
    const sizes = burnSizes(only());
    expect(sizes[0]).toEqual({ w: 80, h: 40 });
    expect(sizes.slice(1).every((size) => size.w === 6 && size.h === 6)).toBe(true);
  });

  it('leaves an unscaled part transform untouched', () => {
    const part = createPanel();
    expect(part.transform.scaleX).toBe(IDENTITY_TRANSFORM.scaleX);
    applyPart(part, 70, 5);
    expect(only().transform).toBe(part.transform);
  });
});
