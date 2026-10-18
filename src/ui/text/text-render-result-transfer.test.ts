import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { textToPolylines, type TextRenderResult } from '../../core/text/text-to-polylines';
import { packTextRenderResult, unpackTextRenderResult } from './text-render-result-transfer';

function roundTrip(result: TextRenderResult) {
  const { message, transfer } = packTextRenderResult(result);
  return {
    kinds: message.paths.map((path) => path.kind),
    transferred: transfer.length,
    result: unpackTextRenderResult(structuredClone(message, { transfer })),
  };
}

function expectIdentical(actual: TextRenderResult, expected: TextRenderResult): void {
  expect(actual).toStrictEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

const BOUNDS = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
const line = {
  closed: false,
  points: [
    { x: -0, y: 1 },
    { x: 2, y: 3 },
  ],
};

describe('text render result transfer (ADR-624)', () => {
  it('packs rendered text into transferred buffers and rebuilds it exactly', async () => {
    const file = await readFile('src/ui/text/fonts/GreatVibes-Regular.ttf');
    const rendered = await textToPolylines({
      fontBuffer: file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength,
      ) as ArrayBuffer,
      content: 'Packed geometry\nIL straight',
      sizeMm: 10,
      alignment: 'center',
      lineHeight: 1.3,
      color: '#112233',
    });
    const sent = roundTrip(rendered);
    expect(sent.kinds).toEqual(['packed']);
    expect(sent.transferred).toBeGreaterThan(0);
    expectIdentical(sent.result, rendered);
  });

  it.each<[string, ColoredPath]>([
    ['polylines written {closed, points}', { color: '#000000', polylines: [line] }],
    [
      'a key after the geometry',
      {
        color: '#000000',
        polylines: [{ points: line.points, closed: false }],
        fillRule: 'evenodd',
      },
    ],
    [
      'an elliptical arc',
      {
        color: '#000000',
        polylines: [{ points: line.points, closed: false }],
        curves: [
          {
            start: { x: 0, y: 0 },
            segments: [
              {
                kind: 'elliptical-arc',
                radiusX: 1,
                radiusY: 1,
                rotationDeg: 0,
                largeArc: false,
                sweep: true,
                to: { x: 2, y: 0 },
              },
            ],
            closed: false,
          },
        ],
      },
    ],
    [
      'curves present but undefined',
      // The type forbids it, but untyped data could carry the key.
      {
        color: '#000000',
        polylines: [{ points: line.points, closed: false }],
        curves: undefined,
      } as unknown as ColoredPath,
    ],
  ])('sends a path with %s unchanged', (_name, path) => {
    const result: TextRenderResult = { paths: [path], bounds: BOUNDS };
    const sent = roundTrip(result);
    expect(sent.kinds).toEqual(['plain']);
    expectIdentical(sent.result, result);
  });

  it('keeps operation bindings and negative zero when it packs', () => {
    const result: TextRenderResult = {
      paths: [
        {
          color: '#000000',
          operationIds: ['op-1'],
          polylines: [{ points: line.points, closed: true }],
          curves: [
            {
              start: { x: -0, y: 1 },
              segments: [{ kind: 'line', to: { x: 2, y: 3 } }],
              closed: true,
            },
          ],
        },
      ],
      bounds: BOUNDS,
      anchor: { x: 0.5, y: 0 },
      missingCharacters: ['☃'],
    };
    const sent = roundTrip(result);
    expect(sent.kinds).toEqual(['packed']);
    expectIdentical(sent.result, result);
    expect(Object.is(sent.result.paths[0]?.polylines[0]?.points[0]?.x, -0)).toBe(true);
  });
});
