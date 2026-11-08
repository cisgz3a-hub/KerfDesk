// Rolling audit v10 V7-P2-1 (ADR-686 Amendment 1): only flat, opaque,
// unmasked white is paper. The parser marks every other white fill, so the
// knock-out treats it as ink. Both parsers walk the same tree.

import { Blob as NodeBlob } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import type { WhiteInk } from '../../core/scene/colored-path';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgWorkerDocument } from './parse-svg-worker';

const identity = { id: 'probe', source: 'probe.svg' };
const svg = (content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="40mm" height="40mm" viewBox="0 0 40 40">` +
  `<rect width="40" height="40" fill="#000"/>${content}</svg>`;
const WHITE_SQUARE = 'x="10" y="10" width="20" height="20"';

type Parser = (svgText: string) => ParseSvgResult | Promise<ParseSvgResult>;
const parsers: readonly (readonly [string, Parser])[] = [
  ['browser fallback', (svgText) => parseSvg({ svgText, ...identity })],
  [
    'worker stream',
    async (svgText) =>
      parseSvgWorkerDocument(
        await readSvgDocumentFromBlob(new NodeBlob([svgText], { type: 'image/svg+xml' }) as Blob),
        identity,
      ),
  ],
];

/** The white fill entries' marks, in paint order. */
function whiteMarks(result: ParseSvgResult): (WhiteInk | null)[] {
  return (result.fragment?.entries ?? []).flatMap((entry) =>
    'paths' in entry
      ? entry.paths.filter((path) => path.color === '#ffffff').map((path) => path.whiteInk ?? null)
      : [],
  );
}

// The audit's probes (V7 report, "Scenario" table) plus the spellings it lists.
const CASES: readonly (readonly [string, string, WhiteInk | null])[] = [
  ['fill="#fff" (paper)', `<rect ${WHITE_SQUARE} fill="#fff"/>`, null],
  ['fill="white" in a style (paper)', `<rect ${WHITE_SQUARE} style="fill:white"/>`, null],
  ['fill-opacity="1" (paper)', `<rect ${WHITE_SQUARE} fill="#fff" fill-opacity="1"/>`, null],
  ['fill-opacity="0.3"', `<rect ${WHITE_SQUARE} fill="#fff" fill-opacity="0.3"/>`, 'translucent'],
  [
    'a group opacity of 0.2',
    `<g opacity="0.2"><rect ${WHITE_SQUARE} fill="#fff"/></g>`,
    'translucent',
  ],
  [
    'rgba(255,255,255,0.25)',
    `<rect ${WHITE_SQUARE} fill="rgba(255,255,255,0.25)"/>`,
    'translucent',
  ],
  ['#ffffff80', `<rect ${WHITE_SQUARE} fill="#ffffff80"/>`, 'translucent'],
  [
    'a CSS class with fill-opacity .15',
    `<style>.w{fill:#fff;fill-opacity:.15}</style><rect class="w" ${WHITE_SQUARE}/>`,
    'translucent',
  ],
  [
    'a radial gradient from white to blue',
    `<defs><radialGradient id="g"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#0040ff"/></radialGradient></defs>` +
      `<rect ${WHITE_SQUARE} fill="url(#g)"/>`,
    'gradient',
  ],
  [
    'a mask showing its left half',
    `<defs><mask id="m"><rect x="0" y="0" width="20" height="40" fill="#fff"/></mask></defs>` +
      `<rect ${WHITE_SQUARE} fill="#fff" mask="url(#m)"/>`,
    'masked',
  ],
  [
    'a mask on the group around it',
    `<defs><mask id="m"><rect width="20" height="40" fill="#fff"/></mask></defs>` +
      `<g mask="url(#m)"><rect ${WHITE_SQUARE} fill="#fff"/></g>`,
    'masked',
  ],
];

describe.each(parsers)('%s', (_name, parse) => {
  it.each(CASES)('marks a white fill written as %s', async (_case, content, expected) => {
    expect(whiteMarks(await parse(svg(content)))).toEqual([expected]);
  });

  it('marks no other colour, and no white stroke', async () => {
    const result = await parse(
      svg(
        `<rect ${WHITE_SQUARE} fill="#00aa00" fill-opacity="0.3"/>` +
          `<rect ${WHITE_SQUARE} fill="none" stroke="#fff" stroke-opacity="0.3"/>`,
      ),
    );
    const marks = (result.fragment?.entries ?? []).flatMap((entry) =>
      'paths' in entry ? entry.paths.map((path) => path.whiteInk) : [],
    );
    expect(marks.every((mark) => mark === undefined)).toBe(true);
  });
});
