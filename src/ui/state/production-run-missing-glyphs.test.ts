import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { inspectPreparedStart } from '../laser/start-job-prepared-inspection';
import type { MachineStartSnapshot } from '../laser/start-job-readiness';
import { buildTextObject } from '../text/build-text-object';
import { outputTextRenderer } from '../text/output-text-renderer';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

vi.mock('../text/font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Pacifico-Regular.ttf')).buffer;
  },
}));

// Rolling audit v8 N4-P1-2 (ADR-591 Amendment 2): a production row is plain text with the record's
// geometry, so a character Pacifico lacks is missing from the row's burn. Opening and capturing
// the row say so, and Start says so for the opened row.
const NOW = new Date('2026-10-29T00:00:00Z');
const NAMES = ['Zoe', 'Zoë 李', '李'];
const ROW_2 =
  'Text “Zoë 李” (production row 2): Pacifico has no 李; each engraves as a box, or not at all.';

describe('a production row warns about characters its font lacks', () => {
  beforeEach(async () => {
    resetStore();
    useToastStore.setState({ toasts: [] });
    useStore.setState({ project: nameTagProject(await nameTag()), undoStack: [], redoStack: [] });
    expect(useStore.getState().createProductionRun('Guests', 3, NOW)).toBeNull();
  });

  it('warns when the row opens and when it is captured, and Start warns for the row', async () => {
    const row = useStore.getState().project.productionManifest!.rows[1]!;
    expect(await useStore.getState().openProductionRow(row.id, outputTextRenderer)).toBe(true);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'warning',
      message: ROW_2,
    });

    const prepared = await prepareOutputSnapshot(useStore.getState().project, {
      clock: () => NOW,
      renderVariableText: outputTextRenderer,
    });
    if (!prepared.ok) throw new Error('row output was refused');
    const inspected = inspectPreparedStart(prepared, {} as MachineStartSnapshot);
    expect(inspected.ok && inspected.advisoryWarnings).toEqual([
      'Text “Zoë 李”: Pacifico has no 李; each engraves as a box, or not at all.',
    ]);

    useToastStore.setState({ toasts: [] });
    expect(await useStore.getState().captureProductionVariant(outputTextRenderer, NOW)).toBeNull();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({
      variant: 'warning',
      message: ROW_2,
    });
  });

  it('warns for a row the font draws nothing of', async () => {
    const row = useStore.getState().project.productionManifest!.rows[2]!;
    expect(await useStore.getState().openProductionRow(row.id, outputTextRenderer)).toBe(true);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Text “李” (production row 3): Pacifico has no 李; each engraves as a box, or not at all.',
    );
  });

  it('stays quiet for a row the font covers', async () => {
    const row = useStore.getState().project.productionManifest!.rows[0]!;
    expect(await useStore.getState().openProductionRow(row.id, outputTextRenderer)).toBe(true);
    expect(useToastStore.getState().toasts).toEqual([]);
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
