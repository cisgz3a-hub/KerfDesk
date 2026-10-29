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
import { emitSavePreparedOutput } from '../laser/save-output-emission';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { buildTextObject } from '../text/build-text-object';
import { outputTextRenderer } from '../text/output-text-renderer';
import { bakeSelectedVariableText } from './bake-variable-text';

vi.mock('../text/font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Pacifico-Regular.ttf')).buffer;
  },
}));

// Rolling audit v8 N4-P1-2 (ADR-591 Amendment 2): Bake turns a record into plain text that keeps
// the record's geometry, so a character Pacifico lacks is missing from every burn of it. Bake says
// so at once, and Start and Save say so for the baked text.
const NOW = new Date('2026-10-29T00:00:00Z');
const NAMES = ['Zoe', 'Zoë 李', '李'];

describe('Bake warns about characters the font lacks', () => {
  beforeEach(() => {
    resetStore();
    useToastStore.setState({ toasts: [] });
  });

  it('names the dropped character in its toast, and output names it for the baked text', async () => {
    await bake(1);

    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast?.variant).toBe('warning');
    expect(toast?.message).toContain('Baked 1 object');
    expect(toast?.message).toContain(
      'Variable text “Zoë 李” (CSV record 2): Pacifico has no 李; each engraves as a box, or not at all.',
    );

    const baked = useStore.getState().project.scene.objects[0];
    expect(baked?.kind === 'text' && baked.variableTemplate).toBeUndefined();
    const warning = 'Text “Zoë 李”: Pacifico has no 李; each engraves as a box, or not at all.';
    const prepared = await prepareOutputSnapshot(useStore.getState().project, {
      clock: () => NOW,
      renderVariableText: outputTextRenderer,
    });
    if (!prepared.ok) throw new Error('baked output was refused');
    const inspected = inspectPreparedStart(prepared, {} as MachineStartSnapshot);
    expect(inspected.ok && inspected.advisoryWarnings).toEqual([warning]);
    const saved = emitSavePreparedOutput(prepared, {});
    expect(saved.kind === 'emitted' && saved.machineWarnings).toEqual([warning]);
  });

  it('warns for a record the font draws nothing of', async () => {
    await bake(2);

    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast?.variant).toBe('warning');
    expect(toast?.message).toContain('Variable text “李” (CSV record 3): Pacifico has no 李;');
  });

  it('still reports plain success for a record the font covers', async () => {
    await bake(0);

    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast?.variant).toBe('success');
    expect(toast?.message).not.toContain('has no');
  });
});

async function bake(recordIndex: number): Promise<void> {
  const tag = await nameTag();
  useStore.setState({
    project: nameTagProject(tag, recordIndex),
    selectedObjectId: tag.id,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
  });
  await bakeSelectedVariableText({ now: () => NOW });
}

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

function nameTagProject(text: TextObject, recordIndex: number): Project {
  return {
    ...createProject(),
    variables: {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      recordIndex,
      csv: { sourceName: 'guests.csv', headers: ['name'], records: NAMES.map((name) => [name]) },
    },
    scene: {
      objects: [text],
      layers: [{ ...createLayer({ id: text.color, color: text.color }), mode: 'line' }],
      groups: [],
    },
  };
}
