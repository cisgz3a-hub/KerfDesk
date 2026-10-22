import { describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_PROJECT_VARIABLE_DATA,
  IDENTITY_TRANSFORM,
  type Project,
  type TextAlignment,
  type TextObject,
} from '../../core/scene';
import type { TextStyle } from '../../core/scene/text-settings';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { buildTextObject } from './build-text-object';
import { renderVariableText } from './render-variable-text';
import type { DialogValues } from './use-text-dialog-fields';

vi.mock('./font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Roboto-Regular.ttf')).buffer;
  },
}));

// Audit 15-P2-1 and 15-P3-3: a styled variable text (Max width, Bold,
// Italic) must engrave every record where the template was placed, as the
// unstyled text does. Measured on the emitted burn moves.
const TEMPLATE = '{{csv:name}}';
const SHORT = 'Al';
const DESCENDER = 'Aly';
// Wider than the Max width, so the record is squeezed too.
const LONG = 'Maximilian Alexander';
const NAMES = [SHORT, DESCENDER, LONG];
// The template renders about 55 mm wide at 10 mm, so the design is squeezed.
const MAX_WIDTH_MM = 40;
const PLACED = { ...IDENTITY_TRANSFORM, x: 100, y: 50 };
// Ink and advance differ by a few tenths of a millimetre at each end ('{'
// against 'A' or 'r'); the defect moved records 5 to 40 mm.
const INK_TOLERANCE_MM = 0.6;

type BurnRange = { readonly minX: number; readonly maxX: number };

describe('styled variable text lands on the placed anchor in G-code', () => {
  it.each(['left', 'center', 'right'] as const)(
    'keeps %s-aligned records with Max width on the template’s anchor, short or squeezed',
    async (alignment) => {
      const design = await variableText(alignment, { maxWidthMm: MAX_WIDTH_MM });
      const placed = await burnRange(design, null);
      expect(placed.maxX - placed.minX).toBeCloseTo(MAX_WIDTH_MM, 1);

      for (const [recordIndex, name] of NAMES.entries()) {
        const record = await burnRange(design, recordIndex);
        expect(record.maxX - record.minX, name).toBeLessThanOrEqual(MAX_WIDTH_MM + 0.01);
        expect(
          Math.abs(anchorX(record, alignment) - anchorX(placed, alignment)),
          name,
        ).toBeLessThan(INK_TOLERANCE_MM);
      }
      // The squeezed record fills the same width as the squeezed template.
      const long = await burnRange(design, NAMES.indexOf(LONG));
      expect(Math.abs(long.minX - placed.minX)).toBeLessThan(INK_TOLERANCE_MM);
      expect(Math.abs(long.maxX - placed.maxX)).toBeLessThan(INK_TOLERANCE_MM);
    },
  );

  it('moves Bold records only by the bold growth', async () => {
    const plain = await variableText('left', undefined);
    const bold = await variableText('left', { bold: true });
    const growth = 0.03 * 10;
    for (const recordIndex of NAMES.keys()) {
      const plainRecord = await burnRange(plain, recordIndex);
      const boldRecord = await burnRange(bold, recordIndex);
      expect(Math.abs(boldRecord.minX - (plainRecord.minX - growth))).toBeLessThan(0.03);
    }
  });

  it('starts Italic records on one line whether or not they have descenders', async () => {
    const italic = await variableText('left', { italic: true });
    // 'A' starts both names, and its foot on the baseline is their leftmost ink.
    const short = await burnRange(italic, NAMES.indexOf(SHORT));
    const descender = await burnRange(italic, NAMES.indexOf(DESCENDER));
    expect(Math.abs(descender.minX - short.minX)).toBeLessThan(0.01);
  });
});

async function variableText(
  alignment: TextAlignment,
  textStyle: TextStyle | undefined,
): Promise<TextObject> {
  const values: DialogValues = {
    content: TEMPLATE,
    fontKey: 'roboto-regular',
    sizeMm: 10,
    alignment,
    lineHeight: 1.2,
    letterSpacing: 0,
    bendDeg: 0,
    color: '#000000',
    embeddedFonts: [],
    weldOverlaps: false,
    variableTemplate: { tokens: [] },
    ...(textStyle === undefined ? {} : { textStyle }),
  };
  const built = await buildTextObject({ mode: 'add' }, values);
  return { ...built, transform: PLACED };
}

/** X extent of the burn moves; `null` emits the template as placed. */
async function burnRange(text: TextObject, recordIndex: number | null): Promise<BurnRange> {
  const { variableTemplate: _template, ...asPlaced } = text;
  const object = recordIndex === null ? asPlaced : text;
  const prepared = await prepareOutputSnapshot(nameTagProject(object), {
    clock: () => new Date('2026-10-22T00:00:00Z'),
    renderVariableText,
    recordIndex: recordIndex ?? 0,
  });
  if (!prepared.ok) throw new Error('name tag output was refused');
  return burnMovesX(emitPreparedGcode(prepared).gcode);
}

function nameTagProject(text: TextObject): Project {
  return {
    ...createProject(),
    variables: {
      ...DEFAULT_PROJECT_VARIABLE_DATA,
      csv: { sourceName: 'tags.csv', headers: ['name'], records: NAMES.map((name) => [name]) },
    },
    scene: {
      objects: [text],
      layers: [{ ...createLayer({ id: text.color, color: text.color }), mode: 'line' }],
      groups: [],
    },
  };
}

function burnMovesX(gcode: string): BurnRange {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const line of gcode.split('\n')) {
    if (!/^G1\b/.test(line)) continue;
    const x = /X(-?\d+(?:\.\d+)?)/.exec(line)?.[1];
    if (x === undefined) continue;
    minX = Math.min(minX, Number(x));
    maxX = Math.max(maxX, Number(x));
  }
  if (!Number.isFinite(minX)) throw new Error('no burn moves in the G-code');
  return { minX, maxX };
}

function anchorX(range: BurnRange, alignment: TextAlignment): number {
  if (alignment === 'left') return range.minX;
  return alignment === 'right' ? range.maxX : (range.minX + range.maxX) / 2;
}
