import { describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { inspectPreparedStart } from '../laser/start-job-prepared-inspection';
import type { MachineStartSnapshot } from '../laser/start-job-readiness';
import { emitSavePreparedOutput } from '../laser/save-output-emission';
import { renderJigText } from '../workspace/registration-jig/jig-text-object';
import { buildTextObject } from './build-text-object';
import { outputTextRenderer } from './output-text-renderer';

const FONT_FILES: Readonly<Record<string, string>> = {
  'pacifico-regular': 'Pacifico-Regular.ttf',
  'roboto-regular': 'Roboto-Regular.ttf',
};
vi.mock('./font-loader', () => ({
  loadFont: async (key: string) => {
    const { readFile } = await import('node:fs/promises');
    const file = FONT_FILES[key];
    if (file === undefined) throw new Error(`No fixture font for ${key}`);
    return Uint8Array.from(await readFile(`src/ui/text/fonts/${file}`)).buffer;
  },
}));

// Rolling audit v8 N4-P1-2 and N4-P1-3 (ADR-591 Amendment 2): plain text burns the geometry it was
// made with, so a character its font lacks is missing from the burn whichever route made it. Output
// checks every text it burns, not only variable records, and says so in Job Review, Start and Save.
const PACIFICO_WARNING =
  'Text “Café 李”: Pacifico has no 李; each engraves as a box, or not at all.';

describe('plain text warns about characters its font lacks at output', () => {
  it('names the main editor’s text and the character in the advisories, Start and Save', async () => {
    const prepared = await prepare(
      projectWith(await mainEditorText('Café 李', 'pacifico-regular')),
    );
    expectWarned(prepared, PACIFICO_WARNING);
  });

  it('names text the registration-jig editor made', async () => {
    const jig = await renderJigText({
      project: createProject(),
      existing: undefined,
      content: 'Café 李',
      fontKey: 'pacifico-regular',
      sizeMm: 10,
    });
    expectWarned(await prepare(projectWith(jig)), PACIFICO_WARNING);
  });

  it('says a single-line font engraves the character as ?', async () => {
    const text = await mainEditorText('Café 李', 'relief-single-line');
    expectWarned(
      await prepare(projectWith(text)),
      'Text “Café 李”: Relief SingleLine has no 李; each engraves as ?.',
    );
  });

  it('stays quiet for text the font covers and for text on a layer that does not output', async () => {
    const covered = await prepare(projectWith(await mainEditorText('Café', 'pacifico-regular')));
    expect(glyphAdvisories(covered)).toEqual([]);

    const unburned = projectWith(await mainEditorText('Café 李', 'pacifico-regular'));
    const silent: Project = {
      ...unburned,
      scene: {
        ...unburned.scene,
        layers: unburned.scene.layers.map((layer) => ({ ...layer, output: false })),
      },
    };
    expect(glyphAdvisories(await prepare(silent))).toEqual([]);
  });
});

type Prepared = Awaited<ReturnType<typeof prepare>>;

function expectWarned(prepared: Prepared, warning: string): void {
  if (!prepared.ok) throw new Error('text output was refused');
  expect(prepared.advisories).toContainEqual({ code: 'text-missing-glyphs', message: warning });

  // Laser Start reads only the work-Z evidence a CNC tool check needs.
  const inspected = inspectPreparedStart(prepared, {} as MachineStartSnapshot);
  expect(inspected.ok && inspected.advisoryWarnings).toEqual([warning]);

  const saved = emitSavePreparedOutput(prepared, {});
  expect(saved.kind === 'emitted' && saved.machineWarnings).toEqual([warning]);
}

function glyphAdvisories(prepared: Prepared) {
  if (!prepared.ok) throw new Error('text output was refused');
  return (prepared.advisories ?? []).filter((issue) => issue.code === 'text-missing-glyphs');
}

async function mainEditorText(content: string, fontKey: string): Promise<TextObject> {
  const built = await buildTextObject(
    { mode: 'add' },
    {
      content,
      fontKey,
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      bendDeg: 0,
      color: '#000000',
      embeddedFonts: [],
      weldOverlaps: true,
    },
  );
  return { ...built, transform: { ...IDENTITY_TRANSFORM, x: 100, y: 50 } };
}

function prepare(project: Project) {
  return prepareOutputSnapshot(project, {
    clock: () => new Date('2026-10-29T00:00:00Z'),
    renderVariableText: outputTextRenderer,
  });
}

function projectWith(text: TextObject): Project {
  return {
    ...createProject(),
    scene: {
      objects: [text],
      layers: [{ ...createLayer({ id: text.color, color: text.color }), mode: 'line' }],
      groups: [],
    },
  };
}
