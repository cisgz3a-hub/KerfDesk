import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpOutputSchemas } from '../../../electron/mcp/output-schemas';
import type { TextObject } from '../../core/scene';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import { buildTextObject } from '../text/build-text-object';
import type { DialogValues } from '../text/use-text-dialog-fields';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { RemoteCommandResult, RemoteControlAdapter } from './types';

const FONT_FILES: Readonly<Record<string, string>> = {
  'pacifico-regular': 'Pacifico-Regular.ttf',
  'roboto-regular': 'Roboto-Regular.ttf',
};
vi.mock('../text/font-loader', () => ({
  loadFont: async (key: string) => {
    const { readFile } = await import('node:fs/promises');
    const file = FONT_FILES[key];
    if (file === undefined) throw new Error(`No fixture font for ${key}`);
    return Uint8Array.from(await readFile(`src/ui/text/fonts/${file}`)).buffer;
  },
}));

// Rolling audit v7 L3-P1-3, L3-P2-2 and L3-P3-3 (ADR-591 Amendment 1, ADR-321 Amendment 1).
const PACIFICO_LACKS = 'Pacifico has no 李; each engraves as a box, or not at all.';

let adapter: RemoteControlAdapter;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useToastStore.setState({ toasts: [] });
  adapter = testAdapter({ canShareArtwork: () => false });
});
afterEach(() => adapter.dispose());

function data(result: RemoteCommandResult): Record<string, unknown> {
  if (!result.ok) throw new Error(`Remote command failed: ${result.error.code}`);
  return result.data;
}
function texts(): TextObject[] {
  return useStore
    .getState()
    .project.scene.objects.filter((object): object is TextObject => object.kind === 'text');
}
function pcToasts(): string[] {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}
async function addText(text: string, fontId: string): Promise<Record<string, unknown>> {
  return data(
    await adapter.execute(
      'add_text',
      writeArgs(adapter, { text, fontId, xMm: 10, yMm: 10, widthMm: 200, fontSizeMm: 10 }),
    ),
  );
}

describe('remote text names the characters its font has no glyph for', () => {
  it('add_text warns in its receipt and on the PC, and the MCP output keeps the notice', async () => {
    const receipt = await addText('Café 李', 'pacifico-regular');
    expect(receipt['notices']).toEqual([{ level: 'warning', message: PACIFICO_LACKS }]);
    expect(pcToasts()).toEqual([`Remote text: ${PACIFICO_LACKS}`]);
    // The relay and the local MCP server re-parse results with these schemas.
    const parsed = mcpOutputSchemas.add_text.parse({ revision: adapter.getRevision(), ...receipt });
    expect(parsed.notices).toEqual([{ level: 'warning', message: PACIFICO_LACKS }]);
  });

  it('says nothing more when the font has every character', async () => {
    const receipt = await addText('Café', 'pacifico-regular');
    expect(receipt).not.toHaveProperty('notices');
    expect(pcToasts()).toEqual([]);
  });

  it('welds new remote text, as new desktop text is welded', async () => {
    await addText('Hello', 'pacifico-regular');
    expect(texts()[0]?.weldOverlaps).toBe(true);
  });

  it('update_text names characters of wording it sent, and only counts PC-made ones', async () => {
    await addText('Café', 'roboto-regular');
    const id = texts()[0]!.id;
    const named = data(
      await adapter.execute(
        'update_text',
        writeArgs(adapter, { artworkId: id, patch: { text: 'Café 李' } }),
      ),
    );
    expect(named['notices']).toEqual([
      { level: 'warning', message: 'Roboto has no 李; each engraves as a box, or not at all.' },
    ]);
    const counted = data(
      await adapter.execute(
        'update_text',
        writeArgs(adapter, { artworkId: id, patch: { alignment: 'center' } }),
      ),
    );
    expect(counted['notices']).toEqual([
      {
        level: 'warning',
        message:
          'Roboto has no glyph for one character of this text; each engraves as a box, or not ' +
          'at all. Check it on the PC.',
      },
    ]);
    expect(JSON.stringify(counted)).not.toContain('李');
    expect(mcpOutputSchemas.update_text.parse({ revision: 'r', ...counted }).notices).toHaveLength(
      1,
    );
    // The PC always names them.
    expect(pcToasts().at(-1)).toBe(
      'Remote text: Roboto has no 李; each engraves as a box, or not at all.',
    );
  });

  it('apply_edits carries the notice on its add_text item', async () => {
    const receipt = data(
      await adapter.execute(
        'apply_edits',
        writeArgs(adapter, {
          edits: [
            {
              command: 'add_text',
              args: {
                text: 'Café 李',
                fontId: 'pacifico-regular',
                xMm: 0,
                yMm: 0,
                widthMm: 100,
                fontSizeMm: 10,
              },
            },
          ],
        }),
      ),
    );
    const results = receipt['results'] as ReadonlyArray<Record<string, unknown>>;
    expect(results[0]?.['notices']).toEqual([{ level: 'warning', message: PACIFICO_LACKS }]);
    expect(pcToasts()).toEqual([`Remote text: ${PACIFICO_LACKS}`]);
    const parsed = mcpOutputSchemas.apply_edits.parse({ revision: 'r', ...receipt });
    expect(parsed.results?.[0]?.notices).toEqual([{ level: 'warning', message: PACIFICO_LACKS }]);
  });
});

describe('remote update_text keeps the desktop layout of a text box', () => {
  it('re-wraps inside the frame instead of running the words into one line', async () => {
    const values: DialogValues = {
      content: 'Happy birthday to you dear friend',
      fontKey: 'roboto-regular',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      bendDeg: 0,
      color: '#000000',
      embeddedFonts: [],
      weldOverlaps: false,
      textBox: { mode: 'fixed', widthMm: 40, heightMm: 40, wrap: true, fit: 'none', minSizeMm: 2 },
    };
    const boxed = await buildTextObject({ mode: 'add' }, values);
    useStore.getState().upsertTextObject(boxed, undefined, { placement: 'canvas' });
    expect(
      resultCode(
        await adapter.execute(
          'update_text',
          writeArgs(adapter, { artworkId: boxed.id, patch: { alignment: 'center' } }),
        ),
      ),
    ).toBe('ok');
    const desktop = await buildTextObject(
      { mode: 'add' },
      { ...values, alignment: 'center' as const },
    );
    const edited = texts().find((object) => object.id === boxed.id)!;
    const width = edited.bounds.maxX - edited.bounds.minX;
    const height = edited.bounds.maxY - edited.bounds.minY;
    expect(width).toBeLessThanOrEqual(40);
    expect(width).toBeCloseTo(desktop.bounds.maxX - desktop.bounds.minX, 3);
    expect(height).toBeCloseTo(desktop.bounds.maxY - desktop.bounds.minY, 3);
    expect(edited.textBox).toEqual(values.textBox);
  });
});
