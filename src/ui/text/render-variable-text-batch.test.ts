import { describe, expect, it, vi } from 'vitest';
import { createProject, IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import type { TextBoxSettings } from '../../core/scene/text-box';
import { parseOutlineFont } from '../../core/text/text-to-polylines';
import { batchVariableTextRenderer, renderVariableText } from './render-variable-text';

// Like font-loader, one ArrayBuffer per font for the whole session.
vi.mock('./font-loader', () => {
  const buffers = new Map<string, Promise<ArrayBuffer>>();
  const read = async (key: string): Promise<ArrayBuffer> => {
    const { readFile } = await import('node:fs/promises');
    const name = key === 'dancing-script-regular' ? 'DancingScript-Regular' : 'Roboto-Regular';
    return Uint8Array.from(await readFile(`src/ui/text/fonts/${name}.ttf`)).buffer;
  };
  return {
    loadFont: (key: string) => {
      const known = buffers.get(key) ?? read(key);
      buffers.set(key, known);
      return known;
    },
  };
});

const SHRINK_FRAME: TextBoxSettings = {
  mode: 'fixed',
  widthMm: 60,
  heightMm: 20,
  wrap: true,
  fit: 'shrink',
  minSizeMm: 1,
};
const RECORDS = [
  'Ada Lovelace',
  'Grace Hopper',
  'Katherine Johnson',
  'Hedy Lamarr',
  'Ida',
  'SN-0042',
];

function textObject(fontKey: string, textBox?: TextBoxSettings): TextObject {
  return {
    kind: 'text',
    id: 'badge',
    content: 'Template name',
    fontKey,
    sizeMm: 10,
    alignment: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    paths: [],
    transform: IDENTITY_TRANSFORM,
    operationIds: ['op'],
    ...(textBox === undefined ? {} : { textBox }),
  };
}

async function renderBoth(text: TextObject) {
  const project = createProject();
  let parses = 0;
  const counted = (buffer: ArrayBuffer) => {
    parses += 1;
    return parseOutlineFont(buffer);
  };
  const batch = batchVariableTextRenderer(counted);
  const batched = [];
  const single = [];
  for (const content of RECORDS) {
    batched.push(await batch({ text, content, project }));
    single.push(await renderVariableText({ text, content, project }));
  }
  return { batched, single, parses };
}

// Performance audit S7-P2-1: an array's copies parsed the font again for every record.
describe('batchVariableTextRenderer', () => {
  it.each([
    ['plain text', undefined],
    ['a shrink-to-fit frame', SHRINK_FRAME],
  ])(
    'parses a reusable font once for a batch of records in %s, with the same output',
    async (_name, frame) => {
      const { batched, single, parses } = await renderBoth(textObject('roboto-regular', frame));
      expect(batched).toEqual(single);
      expect(parses).toBe(1);
    },
  );

  it('parses a variable font again for every render, as before', async () => {
    const { batched, single, parses } = await renderBoth(textObject('dancing-script-regular'));
    expect(batched).toEqual(single);
    expect(parses).toBe(RECORDS.length);
  });

  it('does not share parses between batches', async () => {
    const project = createProject();
    const text = textObject('roboto-regular');
    let parses = 0;
    const counted = (buffer: ArrayBuffer) => {
      parses += 1;
      return parseOutlineFont(buffer);
    };
    await batchVariableTextRenderer(counted)({ text, content: 'one', project });
    await batchVariableTextRenderer(counted)({ text, content: 'two', project });
    expect(parses).toBe(2);
  });
});
