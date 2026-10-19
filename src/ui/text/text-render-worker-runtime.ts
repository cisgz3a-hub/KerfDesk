// What the text worker does with each request (ADR-643), kept apart from the
// worker entry so tests can run the full round trip without a Worker.
//
// The worker holds the last font file it was sent, so typing posts only the
// layout settings. It parses that file once and reuses the parsed font when
// reusableOutlineFont proves the reuse cannot change any result; otherwise it
// parses the file for every request, as the UI thread always did. HarfBuzz
// already keeps one shaping font per file (text-shaping.ts), and the held
// file is the same buffer every time.

import type * as opentype from 'opentype.js';
import { reusableOutlineFont } from '../../core/text/reusable-outline-font';
import { parseOutlineFont, parsedFontMissingCharacters } from '../../core/text/text-to-polylines';
import { computeTextGeometry, type OutlineFontParser } from './text-geometry-compute';
import { packTextRenderResult } from './text-render-result-transfer';
import type { TextWorkerRequest, TextWorkerResponse } from './text-render-worker-protocol';

type HeldFont = {
  readonly token: number;
  readonly buffer: ArrayBuffer;
  readonly reusable: boolean;
  parsed: opentype.Font | null;
};

export type TextWorkerReply = {
  readonly response: TextWorkerResponse;
  readonly transfer: ArrayBuffer[];
};

export type TextWorkerRuntime = {
  readonly respond: (request: TextWorkerRequest) => Promise<TextWorkerReply>;
};

export function createTextWorkerRuntime(
  parseFont: OutlineFontParser = parseOutlineFont,
): TextWorkerRuntime {
  let held: HeldFont | null = null;

  const fontFile = (token: number): HeldFont => {
    if (held?.token !== token) throw new Error('The text worker lost its font file.');
    return held;
  };

  const parse = async (font: HeldFont): Promise<opentype.Font> => {
    if (!font.reusable) return parseFont(font.buffer);
    font.parsed ??= await parseFont(font.buffer);
    return font.parsed;
  };

  const respond = async (request: TextWorkerRequest): Promise<TextWorkerReply> => {
    if (request.font !== undefined) {
      held = {
        token: request.font.token,
        buffer: request.font.buffer,
        reusable: reusableOutlineFont(request.font.buffer),
        parsed: null,
      };
    }
    const task = request.task;
    if (task.kind === 'missing-characters') {
      const font = await parse(fontFile(task.fontToken));
      const characters = parsedFontMissingCharacters(font, task.content);
      return { response: { id: request.id, kind: 'missing', characters }, transfer: [] };
    }
    const font = task.fontToken === undefined ? undefined : fontFile(task.fontToken);
    const rendered =
      font === undefined
        ? await computeTextGeometry(task.input, undefined, parseFont)
        : await computeTextGeometry(task.input, font.buffer, () => parse(font));
    const { message, transfer } = packTextRenderResult(rendered);
    return { response: { id: request.id, kind: 'rendered', result: message }, transfer };
  };

  return { respond };
}
