// Shared by the CSS transform import tests (ADR-574 Amendment 1): the three
// SVG import routes, and the imported artwork's bounds in millimetres.
import { Blob as NodeBlob } from 'node:buffer';
import { parseSvg, type ParseSvgResult } from './parse-svg';
import { readSvgDocumentFromBlob } from './parse-svg-blob';
import { parseSvgInWorker, parseSvgWorkerDocument } from './parse-svg-worker';

const identity = { id: 'css-transform', source: 'css-transform.svg' };

/** A 100 mm square whose viewBox makes one user unit (one CSS px) one millimetre. */
export const MM_ROOT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100">';

type Parser = (svgText: string) => Promise<ParseSvgResult>;
export const SVG_IMPORT_ROUTES: readonly (readonly [string, Parser])[] = [
  ['main-thread fallback', async (svgText) => parseSvg({ svgText, ...identity })],
  ['worker text', async (svgText) => parseSvgInWorker({ svgText, ...identity })],
  [
    'worker stream',
    async (svgText) =>
      parseSvgWorkerDocument(
        await readSvgDocumentFromBlob(new NodeBlob([svgText], { type: 'image/svg+xml' }) as Blob),
        identity,
      ),
  ],
];

export type Box = readonly [number, number, number, number];

const rounded = (value: number) => Math.round(value * 1000) / 1000 + 0;

/** [minX, minY, maxX, maxY] of every imported point, rounded to 0.001 mm. */
export function importedBox(result: ParseSvgResult): Box | null {
  const points = (result.object?.paths ?? []).flatMap((path) =>
    path.polylines.flatMap((line) => [...line.points]),
  );
  if (points.length === 0) return null;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return [rounded(minX), rounded(minY), rounded(maxX), rounded(maxY)];
}

export type TransformNote = 'invalid' | 'unresolved' | 'none';

/** Which transform disclosure the import made. */
export function transformNote(result: ParseSvgResult): TransformNote {
  if (result.notes.some((note) => note.includes('a browser also ignores as invalid')))
    return 'invalid';
  if (result.notes.some((note) => note.includes('could only approximate'))) return 'unresolved';
  return 'none';
}
