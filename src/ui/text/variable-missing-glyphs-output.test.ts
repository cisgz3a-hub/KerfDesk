import { describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { inspectPreparedStart } from '../laser/start-job-prepared-inspection';
import type { MachineStartSnapshot } from '../laser/start-job-readiness';
import { emitSavePreparedOutput } from '../laser/save-output-emission';
import { buildTextObject } from './build-text-object';
import { renderVariableText } from './render-variable-text';

vi.mock('./font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Pacifico-Regular.ttf')).buffer;
  },
}));

// Rolling audit v7 L3-P1-4 (ADR-591 Amendment 1): a record with a character the font lacks burns
// the font's box or nothing, so output says so in Job Review, Start and Save.
const NAMES = ['Zoe', 'Zoë 李'];
const WARNING =
  'Variable text “Zoë 李” (CSV record 2): Pacifico has no 李; each engraves as a box, or not at all.';

describe('variable records warn about characters their font lacks at output', () => {
  it('names the record and the characters in the prepared advisories, Start and Save', async () => {
    const project = nameTagProject(await nameTag());
    const prepared = await prepare(project, 1);
    if (!prepared.ok) throw new Error('name tag output was refused');
    expect(prepared.advisories).toContainEqual({
      code: 'variable-text-missing-glyphs',
      message: WARNING,
    });

    // Laser Start reads only the work-Z evidence a CNC tool check needs.
    const inspected = inspectPreparedStart(prepared, {} as MachineStartSnapshot);
    expect(inspected.ok && inspected.advisoryWarnings).toEqual([WARNING]);

    const saved = emitSavePreparedOutput(prepared, {});
    expect(saved.kind === 'emitted' && saved.machineWarnings).toEqual([WARNING]);
  });

  it('stays quiet for a record on a layer that does not output', async () => {
    const project = nameTagProject(await nameTag());
    const marker = createRectangle({
      id: 'marker',
      color: '#ff0000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
      transform: IDENTITY_TRANSFORM,
    });
    const silent: Project = {
      ...project,
      scene: {
        ...project.scene,
        objects: [...project.scene.objects, marker],
        layers: [
          ...project.scene.layers.map((layer) => ({ ...layer, output: false })),
          { ...createLayer({ id: marker.color, color: marker.color }), mode: 'line' },
        ],
      },
    };
    const prepared = await prepare(silent, 1);
    if (!prepared.ok) throw new Error('marker output was refused');
    expect(prepared.advisories ?? []).not.toContainEqual(
      expect.objectContaining({ code: 'variable-text-missing-glyphs' }),
    );
  });

  it('stays quiet for a record the font covers', async () => {
    const prepared = await prepare(nameTagProject(await nameTag()), 0);
    if (!prepared.ok) throw new Error('name tag output was refused');
    expect(
      (prepared.advisories ?? []).filter((issue) => issue.code === 'variable-text-missing-glyphs'),
    ).toEqual([]);
  });
});

async function nameTag(): Promise<TextObject> {
  const built = await buildTextObject(
    { mode: 'add' },
    {
      content: '{{csv:name}}',
      fontKey: 'pacifico-regular',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      bendDeg: 0,
      color: '#000000',
      embeddedFonts: [],
      weldOverlaps: true,
      variableTemplate: { tokens: [] },
    },
  );
  return { ...built, transform: { ...IDENTITY_TRANSFORM, x: 100, y: 50 } };
}

function prepare(project: Project, recordIndex: number) {
  return prepareOutputSnapshot(project, {
    clock: () => new Date('2026-10-28T00:00:00Z'),
    renderVariableText,
    recordIndex,
  });
}

function nameTagProject(text: TextObject): Project {
  return {
    ...createProject(),
    variables: {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      csv: { sourceName: 'guests.csv', headers: ['name'], records: NAMES.map((name) => [name]) },
    },
    scene: {
      objects: [text],
      layers: [{ ...createLayer({ id: text.color, color: text.color }), mode: 'line' }],
      groups: [],
    },
  };
}
