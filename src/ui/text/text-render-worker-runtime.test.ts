import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TextBoxSettings } from '../../core/scene/text-box';
import {
  outlineFontMissingCharacters,
  parseOutlineFont,
  textToPolylines,
  type TextRenderResult,
} from '../../core/text/text-to-polylines';
import { prepareTextShaping } from '../../io/text/prepare-text-shaping';
import type { TextGeometryRequest } from './text-geometry-compute';
import { unpackTextRenderResult } from './text-render-result-transfer';
import type { TextWorkerRequest, TextWorkerResponse } from './text-render-worker-protocol';
import { createTextWorkerRuntime, type TextWorkerRuntime } from './text-render-worker-runtime';

function bytes(path: string): ArrayBuffer {
  const buffer = readFileSync(resolve(__dirname, path));
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

const PARAGRAPH =
  'The quick brown fox jumps over the lazy dog. Official flyers: AV To Wa.\n' +
  'Second line, shorter.\n\nAfter an empty line, 0123456789 & ?!';
const FRAME: TextBoxSettings = {
  mode: 'fixed',
  widthMm: 32,
  heightMm: 14,
  wrap: true,
  fit: 'shrink',
  minSizeMm: 1.5,
};
const OVERFLOW: TextBoxSettings = {
  mode: 'auto-height',
  widthMm: 18,
  heightMm: 5,
  wrap: true,
  fit: 'none',
  minSizeMm: 2,
};
const BASE = {
  fontKey: 'outline-under-test',
  sizeMm: 8,
  alignment: 'left',
  lineHeight: 1.25,
  letterSpacing: 0,
  color: '#123456',
} as const;

type Case = { readonly name: string; readonly input: TextGeometryRequest };

// Settings an operator reaches in the canvas editor, for one outline font.
function outlineCases(content: string): ReadonlyArray<Case> {
  return [
    { name: 'plain', input: { ...BASE, content } },
    {
      name: 'centred, tracked',
      input: { ...BASE, content, alignment: 'center', letterSpacing: 0.08 },
    },
    { name: 'right, tight', input: { ...BASE, content, alignment: 'right', letterSpacing: -0.04 } },
    { name: 'tall lines', input: { ...BASE, content, sizeMm: 3.5, lineHeight: 2.1 } },
    { name: 'frame, shrink', input: { ...BASE, content, textBox: FRAME } },
    {
      name: 'frame, overflow',
      input: { ...BASE, content, alignment: 'center', textBox: OVERFLOW },
    },
    { name: 'first word', input: { ...BASE, content: content.split(' ')[0] ?? content } },
  ];
}

// What renderTextGeometry did before ADR-631: parse the font for every render.
async function direct(input: TextGeometryRequest, fontBuffer?: ArrayBuffer) {
  const shared = {
    content: input.content,
    sizeMm: input.sizeMm,
    alignment: input.alignment,
    lineHeight: input.lineHeight,
    letterSpacing: input.letterSpacing,
    color: input.color,
    ...(input.textBox === undefined ? {} : { textBox: input.textBox }),
  };
  if (fontBuffer === undefined) {
    return textToPolylines({ ...shared, geometry: 'single-line', fontKey: input.fontKey });
  }
  const shaping = await prepareTextShaping(fontBuffer, input.content);
  return textToPolylines({ ...shared, fontBuffer, ...(shaping === undefined ? {} : { shaping }) });
}

// One request across the worker boundary, as postMessage carries it both ways.
async function roundTrip(
  runtime: TextWorkerRuntime,
  request: TextWorkerRequest,
): Promise<TextWorkerResponse> {
  const { response, transfer } = await runtime.respond(structuredClone(request));
  return structuredClone(response, { transfer });
}

function rendered(response: TextWorkerResponse): TextRenderResult {
  if (response.kind !== 'rendered') throw new Error(`unexpected ${response.kind} reply`);
  return unpackTextRenderResult(response.result);
}

function expectIdentical(actual: TextRenderResult, expected: TextRenderResult, name: string) {
  expect(actual, name).toStrictEqual(expected);
  expect(JSON.stringify(actual), name).toBe(JSON.stringify(expected));
}

// Sends the font with the first request only, then renders every case twice:
// in order, and again in reverse, so later renders meet a parsed font that has
// already drawn other text.
async function expectWorkerParity(
  fontBuffer: ArrayBuffer,
  cases: ReadonlyArray<Case>,
): Promise<{ readonly parses: number; readonly renders: number }> {
  let parses = 0;
  const runtime = createTextWorkerRuntime((buffer) => {
    parses += 1;
    return parseOutlineFont(buffer);
  });
  const sequence = [...cases, ...[...cases].reverse()];
  for (const [index, { name, input }] of sequence.entries()) {
    const request: TextWorkerRequest = {
      id: index + 1,
      task: { kind: 'render', input, fontToken: 7 },
      ...(index === 0 ? { font: { token: 7, buffer: fontBuffer } } : {}),
    };
    const actual = rendered(await roundTrip(runtime, request));
    expectIdentical(actual, await direct(input, fontBuffer), name);
  }
  return { parses, renders: sequence.length };
}

// Each case renders twice through the worker and twice directly, parsing fonts.
describe('text worker runtime parity (ADR-631)', { timeout: 60_000 }, () => {
  it.each([
    ['Roboto', 'fonts/Roboto-Regular.ttf'],
    ['Tinos', 'fonts/Tinos-Regular.ttf'],
    ['Great Vibes', 'fonts/GreatVibes-Regular.ttf'],
    ['Pacifico', 'fonts/Pacifico-Regular.ttf'],
    ['Inconsolata', 'fonts/Inconsolata-Regular.ttf'],
    ['Anton', 'fonts/Anton-Regular.ttf'],
    ['UnifrakturMaguntia', 'fonts/UnifrakturMaguntia-Book.ttf'],
    ['Stardos Stencil', 'fonts/StardosStencil-Regular.ttf'],
  ])('reuses one parse of %s and matches a fresh render every time', async (_name, path) => {
    const counts = await expectWorkerParity(bytes(path), [
      ...outlineCases(PARAGRAPH),
      // Straight-line glyphs travel as curves derived from their polylines.
      { name: 'straight glyphs', input: { ...BASE, content: 'ILT HIT LIT' } },
      // A combining mark and characters the font lacks go through HarfBuzz.
      { name: 'combining mark', input: { ...BASE, content: 'Café déjà vu' } },
      { name: 'missing glyphs', input: { ...BASE, content: 'Snow ☃ 漢字' } },
      { name: 'blank', input: { ...BASE, content: '   ' } },
    ]);
    expect(counts.parses).toBe(1);
  });

  it('parses a variable font again for every render, as before', async () => {
    const counts = await expectWorkerParity(
      bytes('fonts/DancingScript-Regular.ttf'),
      outlineCases(PARAGRAPH),
    );
    expect(counts.parses).toBe(counts.renders);
  });

  it('shapes Arabic and mixed-direction text through HarfBuzz in the worker', async () => {
    const arabic = bytes('../../core/text/__fixtures__/NotoSansArabic-Regular.ttf');
    const counts = await expectWorkerParity(arabic, [
      ...outlineCases('مرحبا بالعالم\nسلام عليكم'),
      { name: 'mixed', input: { ...BASE, content: 'KerfDesk مرحبا 123 (نص)' } },
      {
        name: 'mixed frame',
        input: { ...BASE, content: 'نص عربي طويل جدا للتجربة', textBox: FRAME },
      },
    ]);
    expect(counts.parses).toBe(1);
  });

  it('renders the bundled single-line fonts without a font file', async () => {
    const runtime = createTextWorkerRuntime();
    const inputs: TextGeometryRequest[] = [
      'ems-decorous-script',
      'ems-casual-hand',
      'relief-single-line',
    ].flatMap((fontKey) => [
      { ...BASE, fontKey, content: PARAGRAPH },
      { ...BASE, fontKey, content: PARAGRAPH, alignment: 'right', letterSpacing: 0.1 },
      { ...BASE, fontKey, content: PARAGRAPH, textBox: FRAME },
    ]);
    for (const [index, input] of inputs.entries()) {
      const actual = rendered(
        await roundTrip(runtime, { id: index + 1, task: { kind: 'render', input } }),
      );
      expectIdentical(actual, await direct(input), `${input.fontKey} ${index}`);
    }
  });

  it('reports the characters a font lacks, as the UI thread did', async () => {
    const roboto = bytes('fonts/Roboto-Regular.ttf');
    const runtime = createTextWorkerRuntime();
    const content = 'Snow ☃, 漢字 and Latin';
    const response = await roundTrip(runtime, {
      id: 1,
      font: { token: 3, buffer: roboto },
      task: { kind: 'missing-characters', content, fontToken: 3 },
    });
    expect(response).toStrictEqual({
      id: 1,
      kind: 'missing',
      characters: await outlineFontMissingCharacters(roboto, content),
    });
  });

  it('refuses a request for a font file it does not hold', async () => {
    const runtime = createTextWorkerRuntime();
    await expect(
      runtime.respond({
        id: 1,
        task: { kind: 'render', input: { ...BASE, content: 'x' }, fontToken: 4 },
      }),
    ).rejects.toThrow('The text worker lost its font file.');
  });
});
