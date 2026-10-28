import { describe, expect, it, vi } from 'vitest';
import { createProject, type TextObject } from '../../../core/scene';
import type { TextStyle } from '../../../core/scene/text-settings';
import type { TextBoxSettings } from '../../../core/scene/text-box';
import { buildTextObject } from '../../text/build-text-object';
import type { DialogValues } from '../../text/use-text-dialog-fields';
import { isAdvancedJigText, renderJigText } from './jig-text-object';

const FONT_FILES: Readonly<Record<string, string>> = {
  'pacifico-regular': 'Pacifico-Regular.ttf',
  'roboto-regular': 'Roboto-Regular.ttf',
};
vi.mock('../../text/font-loader', () => ({
  loadFont: async (key: string) => {
    const { readFile } = await import('node:fs/promises');
    const file = FONT_FILES[key];
    if (file === undefined) throw new Error(`No fixture font for ${key}`);
    return Uint8Array.from(await readFile(`src/ui/text/fonts/${file}`)).buffer;
  },
}));

// Rolling audit v7 L3-P2-4 (ADR-321 Amendment 1): the jig editor re-renders a text with the
// style, text box and weld the main editor gave it, so the burn matches the settings it keeps.
type Case = {
  readonly name: string;
  readonly content: string;
  readonly fontKey: string;
  readonly textStyle?: TextStyle;
  readonly textBox?: TextBoxSettings;
  readonly weldOverlaps?: boolean;
};
const CASES: ReadonlyArray<Case> = [
  {
    name: 'Max width',
    content: 'Hello world',
    fontKey: 'roboto-regular',
    textStyle: { maxWidthMm: 30 },
  },
  { name: 'Bold', content: 'Hello world', fontKey: 'roboto-regular', textStyle: { bold: true } },
  {
    name: 'Upper case',
    content: 'name tag',
    fontKey: 'roboto-regular',
    textStyle: { uppercase: true },
  },
  { name: 'Weld overlaps', content: 'Hello', fontKey: 'pacifico-regular', weldOverlaps: true },
  {
    name: 'Text box',
    content: 'Happy birthday to you dear friend',
    fontKey: 'roboto-regular',
    textBox: { mode: 'fixed', widthMm: 30, heightMm: 40, wrap: true, fit: 'none', minSizeMm: 2 },
  },
];

describe('the jig text editor keeps a text’s style', () => {
  it.each(CASES)('re-renders $name text as the main editor drew it', async (test) => {
    const built = await mainEditorText(test);
    expect(isAdvancedJigText(built)).toBe(false);
    const jig = await renderJigText({
      project: createProject(),
      existing: built,
      content: built.content,
      fontKey: built.fontKey,
      sizeMm: built.sizeMm,
    });
    expect(size(jig).width).toBeCloseTo(size(built).width, 3);
    expect(size(jig).height).toBeCloseTo(size(built).height, 3);
    expect(contours(jig)).toBe(contours(built));
    expect(jig.textStyle).toEqual(built.textStyle);
    expect(jig.textBox).toEqual(built.textBox);
    expect(jig.weldOverlaps).toBe(built.weldOverlaps);
  });

  it('welds new jig text, as new desktop text is welded', async () => {
    const jig = await renderJigText({
      project: createProject(),
      existing: undefined,
      content: 'Hello',
      fontKey: 'pacifico-regular',
      sizeMm: 10,
    });
    const welded = await mainEditorText({
      name: 'new',
      content: 'Hello',
      fontKey: 'pacifico-regular',
      weldOverlaps: true,
    });
    expect(jig.weldOverlaps).toBe(true);
    expect(contours(jig)).toBe(contours(welded));
  });
});

async function mainEditorText(test: Case): Promise<TextObject> {
  const values: DialogValues = {
    content: test.content,
    fontKey: test.fontKey,
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    bendDeg: 0,
    color: '#000000',
    embeddedFonts: [],
    weldOverlaps: test.weldOverlaps ?? false,
    ...(test.textStyle === undefined ? {} : { textStyle: test.textStyle }),
    ...(test.textBox === undefined ? {} : { textBox: test.textBox }),
  };
  return buildTextObject({ mode: 'add' }, values);
}

function size(text: TextObject): { readonly width: number; readonly height: number } {
  return {
    width: text.bounds.maxX - text.bounds.minX,
    height: text.bounds.maxY - text.bounds.minY,
  };
}

function contours(text: TextObject): number {
  return text.paths.reduce((sum, path) => sum + path.polylines.length, 0);
}
