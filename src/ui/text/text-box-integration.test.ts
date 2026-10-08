import type { TextBoxSettings } from '../../core/scene/text-box';
import { describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { serializeProject } from '../../io/project/serialize-project';
import { deserializeProject } from '../../io/project/deserialize-project';
import { buildTextObject } from './build-text-object';
import { renderTextGeometry } from './render-text-geometry';
import { renderVariableText } from './render-variable-text';
import type { DialogValues } from './use-text-dialog-fields';
vi.mock('./font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Roboto-Regular.ttf')).buffer;
  },
}));
const frame: TextBoxSettings = {
  mode: 'fixed',
  widthMm: 20,
  heightMm: 10,
  wrap: true,
  fit: 'shrink',
  minSizeMm: 2,
};
function values(patch: Partial<DialogValues> = {}): DialogValues {
  return {
    content: 'An unusually long label',
    fontKey: 'roboto-regular',
    sizeMm: 12,
    alignment: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    bendDeg: 0,
    color: '#000000',
    embeddedFonts: [],
    weldOverlaps: false,
    textBox: frame,
    ...patch,
  };
}
describe('editable frame text through geometry, persistence and output', () => {
  it.each(['roboto-regular', 'ems-decorous-script'])(
    'fits %s using original native curves',
    async (fontKey) => {
      const input = values({ fontKey });
      const rendered = await renderTextGeometry(input);
      expect(rendered.textBoxLayout).toMatchObject({ overflow: false, widthMm: 20, heightMm: 10 });
      expect(rendered.textBoxLayout!.sizeMm).toBeGreaterThanOrEqual(2);
      expect(rendered.textBoxLayout!.sizeMm).toBeLessThan(12);
      expect(rendered.bounds.maxX).toBeLessThanOrEqual(20 + 1e-7);
      expect(rendered.bounds.maxY).toBeLessThanOrEqual(10 + 1e-7);
      expect(rendered.paths[0]?.curves?.length).toBeGreaterThan(0);
      const object = await buildTextObject({ mode: 'add' }, input);
      expect(object.content).toBe(input.content);
      expect(object.sizeMm).toBe(12);
      expect(object.textBox).toEqual(frame);
      const project = {
        ...createProject(),
        scene: {
          objects: [object],
          layers: [createLayer({ id: 'cut', color: object.color })],
          groups: [],
        },
      };
      const loaded = deserializeProject(serializeProject(project));
      expect(loaded.kind).toBe('ok');
      if (loaded.kind === 'ok')
        expect(loaded.project.scene.objects[0]).toMatchObject({
          content: input.content,
          textBox: frame,
        });
    },
  );
  it('retains each evaluated row in the same transformed frame with real executable geometry', async () => {
    const object = await buildTextObject(
      { mode: 'add' },
      values({ content: '{{csv:name}}', variableTemplate: { tokens: [] } }),
    );
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 55,
      y: 40,
      scaleX: 1.5,
      scaleY: 0.8,
      mirrorX: true,
      rotationDeg: 25,
    };
    const text = { ...object, transform, operationIds: ['cut'] };
    const project = {
      ...createProject(),
      variables: {
        ...DEFAULT_PROJECT_VARIABLE_DATA,
        csv: {
          sourceName: 'names.csv',
          headers: ['name'],
          records: [['Ada'], ['A substantially longer second name']],
        },
      },
      scene: {
        objects: [text],
        layers: [createLayer({ id: 'cut', color: object.color })],
        groups: [],
      },
    };
    const before = serializeProject(project);
    for (const recordIndex of [0, 1]) {
      const prepared = await prepareOutputSnapshot(project, {
        clock: () => new Date('2026-10-07T00:00:00Z'),
        renderVariableText,
        recordIndex,
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) continue;
      expect(prepared.project.scene.objects[0]).toMatchObject({
        transform,
        content: project.variables.csv.records[recordIndex]![0],
      });
      expect(prepared.project.scene.objects[0]!.bounds.maxX).toBeLessThanOrEqual(20 + 1e-7);
      expect(prepared.job.groups.length).toBeGreaterThan(0);
      expect(emitPreparedGcode(prepared).gcode).toMatch(/G[0123].*X/);
    }
    expect(serializeProject(project)).toBe(before);
  });
  it('keeps overflowing text in output and rejects incompatible frame intent', async () => {
    const input = values({
      content: 'MMMMMMMMMMMM',
      textBox: { ...frame, widthMm: 1, heightMm: 1, minSizeMm: 8 },
    });
    const rendered = await renderTextGeometry(input);
    expect(rendered.textBoxLayout).toMatchObject({ sizeMm: 8, overflow: true });
    expect(rendered.bounds.maxY).toBeGreaterThan(1);
    const object = await buildTextObject({ mode: 'add' }, input);
    expect(object.paths[0]?.polylines.length).toBeGreaterThan(0);
    const project = {
      ...createProject(),
      scene: {
        objects: [object],
        layers: [createLayer({ id: 'cut', color: object.color })],
        groups: [],
      },
    };
    for (const patch of [
      { bendDeg: 10 },
      { pathText: { guideObjectId: 'missing', offsetMm: 0, reverse: false } },
      { textBox: { ...frame, minSizeMm: -1 } },
    ]) {
      expect(
        deserializeProject(
          JSON.stringify({
            ...project,
            scene: { ...project.scene, objects: [{ ...object, ...patch }] },
          }),
        ),
      ).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('textBox') });
    }
    await expect(buildTextObject({ mode: 'add' }, values({ bendDeg: 10 }))).rejects.toThrow(
      'cannot also follow',
    );
  });
});
