// Rolling audit v9 R3-P1-1 (ADR-494 Amendment 4): Design Studio parts and sketches
// are rebuilt from their dimensions but kept each tab's fraction, so a typed width
// moved a tab along the part or onto another edge. Each tab now follows its own
// contour. These go through the real prepare and accept, and review and apply.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  defaultPartGenerator,
  type GeneratedPartObject,
  type HoleGridGenerator,
  type PartGeneratorDefinition,
} from '../../core/parts/part-generator';
import { generatedPart } from '../../core/parts/part-generator.test-fixture';
import { IDENTITY_TRANSFORM, type ImportedSvg, type Vec2 } from '../../core/scene';
import { defaultConstrainedSketch } from '../../core/sketch-constraints/default-constrained-sketch';
import { materializeConstrainedSketch } from '../../core/sketch-constraints/materialize-constrained-sketch';
import type { ConstrainedSketch2d } from '../../core/sketch-constraints/constrained-sketch';
import { deserializeProject } from '../../io/project';
import {
  TAB_COLOR,
  cncTabRises,
  expectSamePoints,
  expectSpansAt,
  expectTabsAt,
  p,
  tabPlaces,
  tabbedProject,
  withPlacedTabs,
} from './placed-tabs.test-support';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import savedBy1028 from '../../__fixtures__/older-projects/part-with-tabs-saved-by-1.0.28.json';

beforeEach(resetStore);

const PANEL = { ...defaultPartGenerator('panel'), widthMm: 100, heightMm: 50 };

// A generated part at (150, 175) with every path on the tab layer.
function part(definition: PartGeneratorDefinition, tabs: ReadonlyArray<Vec2>): GeneratedPartObject {
  const generated = generatedPart(definition);
  return withPlacedTabs(
    {
      ...generated,
      id: 'part',
      transform: { ...IDENTITY_TRANSFORM, x: 150, y: 175 },
      operationIds: ['cut'],
      paths: generated.paths.map((path) => ({
        ...path,
        color: TAB_COLOR,
        operationIds: ['cut'],
      })),
    },
    tabs,
  );
}

function load(object: ImportedSvg): void {
  useStore.setState({
    project: tabbedProject([object]),
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    dirty: false,
  });
}

function current(): ImportedSvg {
  const object = useStore.getState().project.scene.objects[0];
  if (object?.kind !== 'imported-svg') throw new Error('the part is gone');
  return object;
}

function prepare(definition: PartGeneratorDefinition) {
  const prepared = useStore.getState().preparePartGenerator(definition, 'part');
  if (prepared.kind !== 'ok') throw new Error(prepared.reason);
  return prepared.value;
}

function applyPart(definition: PartGeneratorDefinition) {
  const prepared = prepare(definition);
  expect(useStore.getState().acceptPartGenerator(prepared).kind).toBe('ok');
  return prepared;
}

describe('a Design Studio part keeps its tabs on a typed size', () => {
  // Mid-right and mid-top, the report's numbers, plus two near corners.
  const TABS = [p(250, 200), p(200, 225), p(250, 180), p(150, 220), p(240, 175)];
  const STRETCHED = [p(350, 200), p(250, 225), p(350, 180), p(150, 220), p(330, 175)];

  it('Panel W 100 to W 200 puts each tab on its stretched place', () => {
    load(part(PANEL, TABS));
    const before = current();

    const prepared = applyPart({ ...PANEL, widthMm: 200 });

    // Before the fix: (350, 183.333) and (266.667, 225), 16.67 mm each, and
    // (250, 180) landed on the bottom edge at (325, 175).
    expectTabsAt(current(), STRETCHED);
    expectSpansAt(useStore.getState().project, STRETCHED);
    expect(prepared.movedTabs).toBe(0);
    expect(prepared.removedTabs).toBe(0);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(current()).toEqual(before);
    useStore.getState().redo();
    expectTabsAt(current(), STRETCHED);
  });

  it('rises the CNC cut where a part drawn at that size with its tabs there rises', () => {
    load(part(PANEL, TABS));

    applyPart({ ...PANEL, widthMm: 200 });

    const twin = part({ ...PANEL, widthMm: 200 }, STRETCHED);
    const cut = (object: ImportedSvg) => cncTabRises(boundaryOnly(object));
    expectSamePoints(cut(current()), cut(twin), 1e-6);
  });

  it('keeps a tab on a hole on that hole, wherever the width moves it', () => {
    const generated = part(PANEL, []);
    const hole = generated.paths[1]?.polylines[0]?.points ?? [];
    const west = hole[0] as Vec2;
    const onHole = p(150 + west.x, 175 + west.y);
    load(part(PANEL, [onHole]));
    const anchorPath = current().laserTabAnchors?.[0]?.pathIndex;
    expect(anchorPath).toBe(1);

    applyPart({ ...PANEL, widthMm: 200 });

    const moved = current().paths[1]?.polylines[0]?.points[0] as Vec2;
    expectTabsAt(current(), [p(150 + moved.x, 175 + moved.y)], 1e-3);
  });

  it('follows a part already stretched on the canvas: the place on the bed stays', () => {
    const stretched: GeneratedPartObject = {
      ...part(PANEL, []),
      transform: { ...IDENTITY_TRANSFORM, x: 150, y: 175, scaleX: 2 },
    };
    load(withPlacedTabs(stretched, [p(350, 200), p(250, 225)]));

    applyPart({ ...PANEL, widthMm: 200 });

    expectTabsAt(current(), [p(350, 200), p(250, 225)]);
  });

  it('holds a tab on its own edge where the width is no plain stretch', () => {
    const bracket = { ...defaultPartGenerator('bracket'), widthMm: 100, heightMm: 60 };
    if (bracket.kind !== 'bracket') throw new Error('expected a bracket');
    const leg = bracket.legWidthMm;
    // The inner wall stays at the leg width, and a stretch would take the tab off it.
    const wall = p(150 + leg, 175 + (leg + 60) / 2);
    const shelf = p(150 + (leg + 100) / 2, 175 + leg);
    load(part(bracket, [wall, shelf]));

    const prepared = applyPart({ ...bracket, widthMm: 200 });

    expectTabsAt(current(), [wall, p(150 + leg + 100, 175 + leg)]);
    expect(prepared.movedTabs).toBe(0);
  });

  it('names a tab on a removed hole in the review, and Undo restores it', () => {
    const grid = {
      ...(defaultPartGenerator('hole-grid') as HoleGridGenerator),
      rows: 2,
      columns: 2,
    };
    const generated = part(grid, []);
    const lastHole = generated.paths.at(-1)?.polylines[0]?.points[0] as Vec2;
    load(part(grid, [p(150 + lastHole.x, 175 + lastHole.y)]));
    const before = current();

    const prepared = applyPart({ ...grid, columns: 1 });

    expect(prepared.removedTabs).toBe(2);
    expect(current().laserTabAnchors).toEqual([]);
    useStore.getState().undo();
    expect(current()).toEqual(before);
  });
});

describe('a constrained sketch keeps its tabs on a typed size', () => {
  // The default 60 × 30 sketch at (200, 185): mid-right, mid-top, near a corner.
  const TABS = [p(260, 200), p(230, 215), p(260, 188)];
  const STRETCHED = [p(320, 200), p(260, 215), p(320, 188)];

  function sketchObject(tabs: ReadonlyArray<Vec2>): ImportedSvg {
    const built = materializeConstrainedSketch(defaultConstrainedSketch(), TAB_COLOR);
    if (built.paths === undefined || built.bounds === undefined || built.result.kind !== 'solved')
      throw new Error('expected an analytic sketch');
    return withPlacedTabs(
      {
        kind: 'imported-svg',
        id: 'sketch',
        source: 'sketch',
        transform: { ...IDENTITY_TRANSFORM, x: 200, y: 185 },
        constrainedSketch: built.result.sketch,
        operationIds: ['cut'],
        paths: built.paths.map((path) => ({ ...path, operationIds: ['cut'] })),
        bounds: built.bounds,
      },
      tabs,
    );
  }

  function widened(object: ImportedSvg, width: number): ConstrainedSketch2d {
    const sketch = object.constrainedSketch;
    if (sketch === undefined) throw new Error('missing the sketch');
    return {
      ...sketch,
      parameters: sketch.parameters.map((parameter) =>
        parameter.name === 'width' ? { ...parameter, value: width } : parameter,
      ),
    };
  }

  function applySketch(sketch: ConstrainedSketch2d) {
    const reviewed = useStore.getState().reviewConstrainedSketch(sketch, 'sketch');
    if (reviewed.kind !== 'ok') throw new Error(reviewed.reason);
    expect(useStore.getState().applyConstrainedSketch(reviewed.review)).toBe(true);
    return reviewed.review;
  }

  it('width 60 to 120 puts each tab on its stretched place', () => {
    load(sketchObject(TABS));
    const before = current();

    const review = applySketch(widened(before, 120));

    // Before the fix: (290, 190) and (240, 215), 10 mm each, and (260, 188)
    // landed on the bottom edge.
    expectTabsAt(current(), STRETCHED);
    expectSpansAt(useStore.getState().project, STRETCHED);
    expect(review.movedTabs).toBe(0);
    expect(review.removedTabs).toBe(0);
    useStore.getState().undo();
    expect(current()).toEqual(before);
    useStore.getState().redo();
    expectTabsAt(current(), STRETCHED);
  });

  it('rises the CNC cut where a sketch drawn at that size with its tabs there rises', () => {
    load(sketchObject(TABS));

    applySketch(widened(current(), 120));

    const twin = current();
    const { laserTabAnchors: _laser, cncTabAnchors: _cnc, ...plain } = twin;
    const drawn = withPlacedTabs(plain, STRETCHED);
    expectSamePoints(cncTabRises(boundaryOnly(twin)), cncTabRises(boundaryOnly(drawn)), 1e-6);
  });

  it('says when a profile gained a corner and a tab has no matching edge', () => {
    load(sketchObject(TABS));
    const source = current();
    const sketch = source.constrainedSketch;
    if (sketch === undefined) throw new Error('missing the sketch');
    // A new point dents the right edge, inside the old box, so that edge is gone.
    const dented: ConstrainedSketch2d = {
      ...sketch,
      points: [...sketch.points, { id: 'dent', x: 52, y: 8 }],
      profiles: sketch.profiles.map((profile) => ({
        ...profile,
        pointIds: ['a', 'b', 'dent', 'c', 'd'],
      })),
    };
    const review = applySketch(dented);
    expect(current().laserTabAnchors).toHaveLength(TABS.length);
    // The two tabs on the right edge, laser and CNC; the one on top stays.
    expect(review.movedTabs).toBe(4);
    expect(review.removedTabs).toBe(0);
    expect(tabPlaces(current())[1]?.x).toBeCloseTo(230, 6);
    expect(tabPlaces(current())[1]?.y).toBeCloseTo(215, 6);
  });

  it('names a tab on a removed circle in the review', () => {
    const hole = p(200 + 15 + 2, 185 + 15);
    load(sketchObject([hole]));
    const source = current();
    const sketch = source.constrainedSketch;
    if (sketch === undefined) throw new Error('missing the sketch');

    const review = applySketch({
      ...sketch,
      circles: sketch.circles.filter((circle) => circle.id !== 'mount1'),
      constraints: sketch.constraints.filter((item) => item.id !== 'mount1-diameter'),
    });

    expect(review.removedTabs).toBe(2);
    expect(current().laserTabAnchors).toEqual([]);
  });
});

describe('controls', () => {
  it('an unchanged part keeps its anchors exactly', () => {
    const TABS = [p(250, 200), p(200, 225)];
    load(part(PANEL, TABS));
    const before = current();

    applyPart({ ...PANEL });

    expect(current().laserTabAnchors).toEqual(before.laserTabAnchors);
  });

  it('a part with no placed tabs gets none, and says nothing', () => {
    const plain = part(PANEL, []);
    const { laserTabAnchors: _laser, cncTabAnchors: _cnc, ...bare } = plain;
    load(bare as GeneratedPartObject);

    const prepared = applyPart({ ...PANEL, widthMm: 200 });

    expect(prepared.movedTabs).toBe(0);
    expect(prepared.removedTabs).toBe(0);
    expect('laserTabAnchors' in current()).toBe(false);
    expect('cncTabAnchors' in current()).toBe(false);
  });
});

describe('a project saved by 1.0.28', () => {
  // Saved by the real code at 33bc394c6: a Panel 100 × 50 at (150, 175) with laser
  // and CNC tabs placed at mid-right and mid-top through the store's tab actions.
  it('opens, burns as it did, and its tabs follow an edit on main', () => {
    const result = deserializeProject(JSON.stringify(savedBy1028));
    if (!('project' in result)) throw new Error('the saved project did not open');
    const opened = result.project;
    useStore.setState({
      project: opened,
      selectedObjectId: opened.scene.objects[0]?.id ?? null,
      additionalSelectedIds: new Set(),
      dirty: false,
    });
    const before = current();
    expectTabsAt(before, [p(250, 200), p(200, 225)]);
    expectSpansAt(opened, [p(250, 200), p(200, 225)]);

    const definition = (before as GeneratedPartObject).partGenerator.definition;
    const prepared = useStore
      .getState()
      .preparePartGenerator({ ...definition, widthMm: 200 }, before.id);
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    expect(useStore.getState().acceptPartGenerator(prepared.value).kind).toBe('ok');

    expectTabsAt(current(), [p(350, 200), p(250, 225)]);
    expectSpansAt(useStore.getState().project, [p(350, 200), p(250, 225)]);
    useStore.getState().undo();
    expect(current()).toEqual(before);
  });
});

function boundaryOnly(object: ImportedSvg): ImportedSvg {
  return { ...object, paths: object.paths.slice(0, 1) };
}
