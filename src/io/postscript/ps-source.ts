// Locating the PostScript program inside an EPS or legacy AI file, and the
// DSC comments the import reads (Adobe DSC 3.0 and EPSF 3.0 specifications,
// technical notes #5001 and #5002).

import { PsError } from './ps-types';

export type PsBox = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

const DOS_EPS_MAGIC = [0xc5, 0xd0, 0xd3, 0xc6] as const;

/** The PostScript text of a plain or DOS-binary (preview-carrying) EPS file. */
export function postscriptText(bytes: Uint8Array): string {
  let start = 0;
  let end = bytes.length;
  if (DOS_EPS_MAGIC.every((b, i) => bytes[i] === b)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 12) throw new PsError('syntaxerror', 'The EPS file header is cut short.');
    start = view.getUint32(4, true);
    end = start + view.getUint32(8, true);
    if (start >= bytes.length || end > bytes.length)
      throw new PsError('syntaxerror', 'The EPS file header points outside the file.');
  }
  const text = new TextDecoder('latin1').decode(bytes.subarray(start, end));
  if (!text.startsWith('%!'))
    throw new PsError('syntaxerror', 'This is not a PostScript, EPS or Illustrator 3–8 file.');
  return text;
}

/** True for files written by Adobe Illustrator (AI files and Illustrator EPS). */
export function isIllustratorFile(text: string): boolean {
  const header = headerOf(text);
  return /^%%Creator:\s*Adobe Illustrator/im.test(header) || /^%AI[0-9]_/m.test(header);
}

/**
 * The script (artwork) part of an Illustrator file: after the setup, before
 * the trailer. The prolog's procsets are skipped; ai-ops.ts defines the
 * operators the script uses.
 */
export function illustratorScript(text: string): string {
  const setupEnd = text.search(/^%%EndSetup\b/m);
  const prologEnd = text.search(/^%%EndProlog\b/m);
  const from = setupEnd >= 0 ? setupEnd : prologEnd >= 0 ? prologEnd : 0;
  const rest = text.slice(from);
  const lineEnd = rest.search(/[\r\n]/);
  const body = lineEnd < 0 ? '' : rest.slice(lineEnd);
  const trailer = body.search(/^%%(?:PageTrailer|Trailer|EOF)\b/m);
  return trailer < 0 ? body : body.slice(0, trailer);
}

/** The artwork's bounding box in points, if the file declares one. */
export function boundingBox(text: string): PsBox | null {
  return declaredBox(text, 'HiResBoundingBox') ?? declaredBox(text, 'BoundingBox') ?? null;
}

function declaredBox(text: string, key: string): PsBox | null {
  const pattern = new RegExp(`^%%${key}:[ \\t]*([^\\r\\n]*)`, 'gm');
  for (const match of text.matchAll(pattern)) {
    const values = (match[1] ?? '').trim().split(/\s+/).map(Number);
    if (values.length !== 4 || !values.every(Number.isFinite)) continue; // e.g. (atend)
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = values;
    if (x2 > x1 && y2 > y1) return { minX: x1, minY: y1, maxX: x2, maxY: y2 };
  }
  return null;
}

function headerOf(text: string): string {
  const end = text.search(/^%%EndComments\b/m);
  return text.slice(0, end < 0 ? Math.min(text.length, 4096) : end);
}
