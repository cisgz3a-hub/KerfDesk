// Encapsulated PostScript writer (ADR-444), written from Adobe's published
// Encapsulated PostScript File Format Specification 3.0 and the PostScript
// Language Reference, third edition (Level 2 operators only).
//
// The file is one page, conforming to the Document Structuring Conventions:
// "%!PS-Adobe-3.0 EPSF-3.0", %%BoundingBox in integer points (the required
// comment, rounded outward from the exact page), %%HiResBoundingBox with the
// exact page in points, %%LanguageLevel: 2, a prolog that binds short names
// to moveto / lineto / curveto / closepath, and a setup that scales user
// space to millimetres after moving the artwork to its offset on the page
// (half the stroke width when hairlines are drawn on the artwork-extent
// page; the page never falls below 3 pt, see paintedPageBox). Each painted item is a path filled with eofill (or
// fill for nonzero artwork such as text) or stroked as a 0.1 mm round-joined
// hairline, in DeviceRGB. The page's lower-left corner is the origin, so the
// bounding box starts at 0 0. Output is 7-bit ASCII and deterministic.

import {
  itemPathCommands,
  paintedPageBox,
  pointText,
  preparePage,
  rgbBytes,
  unitColorText,
  VECTOR_STROKE_WIDTH_MM,
  type VectorPaintItem,
  type VectorWriteOptions,
} from './vector-artwork';
import { PT_PER_MM_TEXT } from './pdf-writer';

export type EpsDocument = {
  readonly text: string;
  /** Exact page size in points (%%HiResBoundingBox). */
  readonly widthPt: number;
  readonly heightPt: number;
  readonly pathCount: number;
};

// PostScript lines should stay under 255 characters (DSC 3.0).
const MAX_LINE = 250;

export function writeEpsDocument(
  items: ReadonlyArray<VectorPaintItem>,
  options: VectorWriteOptions & { readonly title?: string } = {},
): EpsDocument {
  const page = preparePage(items, options);
  const box = paintedPageBox(items, options, page);
  const { widthPt, heightPt } = box;
  const lines: string[] = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    '%%BoundingBox: 0 0 ' + Math.ceil(widthPt) + ' ' + Math.ceil(heightPt),
    '%%HiResBoundingBox: 0 0 ' + pointText(widthPt) + ' ' + pointText(heightPt),
    '%%Creator: KerfDesk',
    ...(options.title === undefined ? [] : ['%%Title: ' + dscText(options.title)]),
    '%%LanguageLevel: 2',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '/m /moveto load def /l /lineto load def /c /curveto load def /h /closepath load def',
    '%%EndProlog',
    '%%Page: 1 1',
    'gsave',
    ...(box.offsetXPt === 0 && box.offsetYPt === 0
      ? []
      : [pointText(box.offsetXPt) + ' ' + pointText(box.offsetYPt) + ' translate']),
    PT_PER_MM_TEXT + ' ' + PT_PER_MM_TEXT + ' scale',
    VECTOR_STROKE_WIDTH_MM + ' setlinewidth 1 setlinecap 1 setlinejoin',
  ];
  let pathCount = 0;
  for (const item of items) {
    const tokens = itemPathCommands(item, page);
    if (tokens.length === 0) continue;
    pathCount += 1;
    lines.push(rgbBytes(item.color).map(unitColorText).join(' ') + ' setrgbcolor newpath');
    lines.push(...wrapTokens(tokens));
    lines.push(
      item.paint === 'stroke' ? 'stroke' : item.fillRule === 'evenodd' ? 'eofill' : 'fill',
    );
  }
  lines.push('grestore', 'showpage', '%%Trailer', '%%EOF', '');
  return { text: lines.join('\n'), widthPt, heightPt, pathCount };
}

function wrapTokens(tokens: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line.length > 0 && line.length + 1 + token.length > MAX_LINE) {
      out.push(line);
      line = token;
    } else line = line.length === 0 ? token : line + ' ' + token;
  }
  if (line.length > 0) out.push(line);
  return out;
}

/** DSC comment text: printable ASCII only, no line breaks. */
function dscText(value: string): string {
  return [...value].filter((char) => /[\x20-\x7e]/.test(char)).join('');
}
