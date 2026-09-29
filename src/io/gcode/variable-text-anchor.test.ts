import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  addLayer,
  addObject,
  applyTransform,
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { textToPolylines } from '../../core/text';
import { materializeVariableText, type VariableTextRenderer } from './prepare-output-snapshot';

const roboto = (() => {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts/Roboto-Regular.ttf'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
})();

const TEMPLATE = '{{csv:name}}';
const NAMES = ['Al', 'Alexander', 'anna', '\u00c9mile'];

describe('variable text output anchoring', () => {
  it('lands every record on the anchor of the placed text, keeping its centre and baseline', async () => {
    const renderer = robotoRenderer();
    const transform = { ...IDENTITY_TRANSFORM, x: 100, y: 50 };
    const { project, placed } = await nameTagProject(renderer, transform);
    // The braces mirror each other, so centring the design on a tag centres its anchor.
    expect(Math.abs(placed.x - designText(project).bounds.maxX / 2)).toBeLessThan(0.1);

    for (let recordIndex = 0; recordIndex < NAMES.length; recordIndex += 1) {
      const output = await materializedText(project, recordIndex, renderer);
      const record = await renderer({ text: output, content: output.content, project });

      expect(worldAnchor(record.anchor, output.transform)).toEqual(
        closeTo(worldAnchor(placed, transform)),
      );
      // None of these names has a descender, so the ink stands on the baseline;
      // round letters overshoot it by 0.1 mm, where the defect moved it 1.5 mm.
      const inkBottom = output.transform.y + output.bounds.maxY;
      expect(Math.abs(inkBottom - (50 + placed.y))).toBeLessThan(0.15);
      const inkCentre = output.transform.x + (output.bounds.minX + output.bounds.maxX) / 2;
      expect(Math.abs(inkCentre - (100 + placed.x))).toBeLessThan(0.5);
    }
  });

  it('moves the anchor through the text scale, mirror and rotation', async () => {
    const renderer = robotoRenderer();
    const transform: Transform = {
      x: 100,
      y: 50,
      scaleX: 2,
      scaleY: 0.5,
      rotationDeg: 30,
      mirrorX: true,
      mirrorY: false,
    };
    const { project, placed } = await nameTagProject(renderer, transform);

    const output = await materializedText(project, 1, renderer);
    const record = await renderer({ text: output, content: output.content, project });

    expect(worldAnchor(record.anchor, output.transform)).toEqual(
      closeTo(worldAnchor(placed, transform)),
    );
  });

  it('keeps the transform when the renderer gives no anchor or places the text itself', async () => {
    const placedByRenderer = { ...IDENTITY_TRANSFORM, x: 7, y: 9 };
    const withoutAnchor: VariableTextRenderer = () =>
      Promise.resolve({ bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 }, paths: [] });
    const onPath: VariableTextRenderer = () =>
      Promise.resolve({
        bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
        paths: [],
        anchor: { x: 3, y: 4 },
        transform: placedByRenderer,
      });
    const transform = { ...IDENTITY_TRANSFORM, x: 100, y: 50 };
    const project = nameTagScene(textObject(transform));

    expect((await materializedText(project, 0, withoutAnchor)).transform).toBe(transform);
    expect((await materializedText(project, 0, onPath)).transform).toBe(placedByRenderer);
  });

  it('renders the placed text once for a whole batch', async () => {
    const renderer = vi.fn(robotoRenderer());
    const { project } = await nameTagProject(renderer, { ...IDENTITY_TRANSFORM, x: 3, y: 4 });
    renderer.mockClear();

    for (let recordIndex = 0; recordIndex < NAMES.length; recordIndex += 1) {
      await materializedText(project, recordIndex, renderer);
    }

    const placedRenders = renderer.mock.calls.filter(([input]) => input.content === TEMPLATE);
    expect(placedRenders).toHaveLength(1);
  });

  it('keeps the transform when the stored geometry was not rendered from the content', async () => {
    const renderer = robotoRenderer();
    const transform = { ...IDENTITY_TRANSFORM, x: 100, y: 50 };
    const { project } = await nameTagProject(renderer, transform);
    const mismatched = { ...designText(project), content: 'Al' };
    const stale = { ...project, scene: { ...project.scene, objects: [mismatched] } };

    expect((await materializedText(stale, 1, renderer)).transform).toBe(transform);
  });
});

function robotoRenderer(): VariableTextRenderer {
  return ({ text, content }) =>
    textToPolylines({
      content,
      sizeMm: text.sizeMm,
      alignment: text.alignment,
      lineHeight: text.lineHeight,
      letterSpacing: text.letterSpacing,
      color: text.color,
      fontBuffer: roboto,
    });
}

/** A centred name tag whose design view holds the rendered template source. */
async function nameTagProject(
  renderer: VariableTextRenderer,
  transform: Transform,
): Promise<{ readonly project: Project; readonly placed: Vec2 }> {
  const text = textObject(transform);
  const source = await renderer({ text, content: TEMPLATE, project: createProject() });
  if (source.anchor === undefined) throw new Error('template render has no anchor');
  const project = nameTagScene({ ...text, bounds: source.bounds, paths: source.paths });
  return { project, placed: source.anchor };
}

function nameTagScene(text: TextObject): Project {
  const base = createProject();
  const layer = { ...createLayer({ id: '#000000', color: '#000000' }), mode: 'fill' as const };
  return {
    ...base,
    variables: {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      csv: { sourceName: 'tags.csv', headers: ['name'], records: NAMES.map((name) => [name]) },
    },
    scene: addObject(addLayer(base.scene, layer), text),
  };
}

function textObject(transform: Transform): TextObject {
  return {
    kind: 'text',
    id: 'NAME',
    content: TEMPLATE,
    variableTemplate: { tokens: [{ kind: 'csv', column: 'name' }] },
    fontKey: 'roboto-regular',
    sizeMm: 10,
    alignment: 'center',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform,
    paths: [],
  };
}

function designText(project: Project): TextObject {
  const text = project.scene.objects[0];
  if (text?.kind !== 'text') throw new Error('design text missing');
  return text;
}

async function materializedText(
  project: Project,
  recordIndex: number,
  renderer: VariableTextRenderer,
): Promise<TextObject> {
  const output = await materializeVariableText(
    project,
    { now: new Date(0), recordIndex },
    renderer,
  );
  if (!output.ok) throw new Error('variable text did not materialize');
  const text = output.project.scene.objects[0];
  if (text?.kind !== 'text') throw new Error('materialized text missing');
  return text;
}

function worldAnchor(anchor: Vec2 | undefined, transform: Transform): Vec2 {
  if (anchor === undefined) throw new Error('render has no anchor');
  return applyTransform(anchor, transform);
}

function closeTo(point: Vec2): Vec2 {
  return { x: expect.closeTo(point.x, 9), y: expect.closeTo(point.y, 9) } as unknown as Vec2;
}
