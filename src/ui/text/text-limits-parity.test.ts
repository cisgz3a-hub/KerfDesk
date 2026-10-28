import { describe, expect, it, vi } from 'vitest';
import { MCP_TEXT_LIMITS, mcpTextPatchSchema } from '../../../electron/mcp/authoring-schemas';
import { mcpBatchEditSchemas } from '../../../electron/mcp/design-schemas';
import { mcpInputSchemas } from '../../../electron/mcp/input-schemas';
import {
  TEXT_LETTER_SPACING_MAX,
  TEXT_LETTER_SPACING_MIN,
  TEXT_LINE_HEIGHT_MAX,
  TEXT_LINE_HEIGHT_MIN,
  TEXT_SIZE_MAX_MM,
  TEXT_SIZE_MIN_MM,
} from '../../core/text/text-limits';
import { batchItemSchemas } from '../remote-control/design-validation';
import { validTextPatch } from '../remote-control/text-validation';
import { buildTextObject } from './build-text-object';
import { sanitizeTextDialogNumericValues } from './TextDialogNumericFields';
import type { DialogValues } from './use-text-dialog-fields';

vi.mock('./font-loader', () => ({
  loadFont: async () => {
    const { readFile } = await import('node:fs/promises');
    return Uint8Array.from(await readFile('src/ui/text/fonts/Roboto-Regular.ttf')).buffer;
  },
}));

// Rolling audit v7 L3-P2-3 (ADR-564 Amendment 1): one text range for the desktop and the remote,
// so a desktop edit never clamps what the remote set.
const EDGES = [
  { sizeMm: TEXT_SIZE_MAX_MM, lineHeight: TEXT_LINE_HEIGHT_MAX, letterSpacing: 5 },
  { sizeMm: TEXT_SIZE_MIN_MM, lineHeight: TEXT_LINE_HEIGHT_MIN, letterSpacing: -1 },
  { sizeMm: 500, lineHeight: 10, letterSpacing: TEXT_LETTER_SPACING_MAX },
];

describe('desktop and remote text share one range', () => {
  it('keeps every value the remote accepts through the desktop clamp', () => {
    for (const edge of EDGES) {
      expect(sanitizeTextDialogNumericValues({ ...edge, bendDeg: 0 })).toEqual({
        ...edge,
        bendDeg: 0,
      });
      const patch = {
        fontSizeMm: edge.sizeMm,
        lineHeight: edge.lineHeight,
        letterSpacing: edge.letterSpacing,
      };
      expect(validTextPatch(patch)).toBe(true);
      expect(mcpTextPatchSchema.safeParse(patch).success).toBe(true);
    }
    expect(
      sanitizeTextDialogNumericValues({
        sizeMm: TEXT_SIZE_MAX_MM + 1,
        lineHeight: TEXT_LINE_HEIGHT_MIN / 2,
        letterSpacing: TEXT_LETTER_SPACING_MIN - 1,
        bendDeg: 0,
      }),
    ).toEqual({
      sizeMm: TEXT_SIZE_MAX_MM,
      lineHeight: TEXT_LINE_HEIGHT_MIN,
      letterSpacing: TEXT_LETTER_SPACING_MIN,
      bendDeg: 0,
    });
  });

  it('refuses remotely what the desktop would clamp', () => {
    for (const patch of [
      { fontSizeMm: TEXT_SIZE_MIN_MM / 2 },
      { fontSizeMm: TEXT_SIZE_MAX_MM + 1 },
      { lineHeight: TEXT_LINE_HEIGHT_MAX + 1 },
      { letterSpacing: TEXT_LETTER_SPACING_MIN - 0.5 },
    ]) {
      expect(validTextPatch(patch), JSON.stringify(patch)).toBe(false);
      expect(mcpTextPatchSchema.safeParse(patch).success, JSON.stringify(patch)).toBe(false);
    }
    const add = { xMm: 0, yMm: 0, widthMm: 50, text: 'A' };
    for (const fontSizeMm of [TEXT_SIZE_MIN_MM / 2, TEXT_SIZE_MAX_MM + 1]) {
      expect(batchItemSchemas.add_text.safeParse({ ...add, fontSizeMm }).success).toBe(false);
      expect(mcpBatchEditSchemas.add_text.safeParse({ ...add, fontSizeMm }).success).toBe(false);
    }
    expect(
      mcpInputSchemas.add_text.safeParse({
        ...add,
        fontSizeMm: TEXT_SIZE_MIN_MM,
        expectedRevision: 'r',
        requestId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
  });

  it('names the same numbers on the MCP side', () => {
    expect(MCP_TEXT_LIMITS).toEqual({
      fontSizeMm: { min: TEXT_SIZE_MIN_MM, max: TEXT_SIZE_MAX_MM },
      lineHeight: { min: TEXT_LINE_HEIGHT_MIN, max: TEXT_LINE_HEIGHT_MAX },
      letterSpacing: { min: TEXT_LETTER_SPACING_MIN, max: TEXT_LETTER_SPACING_MAX },
    });
  });

  it('keeps a remote 500 mm sign at 500 mm when one word is edited on the PC', async () => {
    const values: DialogValues = {
      content: 'Signs',
      fontKey: 'roboto-regular',
      sizeMm: 500,
      alignment: 'left',
      lineHeight: 10,
      letterSpacing: 5,
      bendDeg: 0,
      color: '#000000',
      embeddedFonts: [],
      weldOverlaps: false,
    };
    const edited = await buildTextObject({ mode: 'add' }, values);
    expect(edited).toMatchObject({ sizeMm: 500, lineHeight: 10, letterSpacing: 5 });
  });
});
