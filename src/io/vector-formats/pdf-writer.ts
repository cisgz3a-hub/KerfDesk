// Vector PDF writer (ADR-468), written from the published PDF Reference,
// sixth edition (PDF 1.7, ISO 32000-1) using only PDF 1.4 features.
//
// Structure (Reference section 3.4): header, body of five indirect objects
// (Catalog, Pages, one Page, its content stream and an Info dictionary),
// a cross-reference table with one 20-byte entry per object, the trailer,
// startxref and %%EOF. The file is pure 7-bit ASCII, so a character offset
// is a byte offset; the header therefore omits the optional binary comment.
//
// Page: MediaBox [0 0 w h] in points (1/72 in): the grid page in mm times
// 72/25.4 rounded outward to 0.0001 pt, plus half the stroke width on each
// side when hairlines are drawn on the artwork-extent page, and never below
// the 3 pt minimum (Appendix C); see paintedPageBox. The content stream
// first maps user space to millimetres and moves the artwork to its offset
// (cm), so every coordinate is printed in millimetres on the export grid: m/l/c build subpaths, h closes a closed contour, f* (or f
// for nonzero artwork such as text) fills a painted item and S strokes it
// with a 0.1 mm round-joined hairline. Colours are DeviceRGB (rg / RG).
// Nothing is compressed and no date is written, so output is deterministic.
//
// Appendix C also caps a page side at 14400 default units (200 in, 5080 mm).
// A larger page is written as PDF 1.6 with /UserUnit (section 3.6.2 of the
// Reference, a PDF 1.6 page attribute): the smallest integer unit that brings
// both sides within the cap, with the content scale divided by the same unit,
// so the physical size is unchanged.

import {
  itemPathCommands,
  paintedPageBox,
  PT_PER_MM,
  pointText,
  preparePage,
  rgbBytes,
  unitColorText,
  VECTOR_STROKE_WIDTH_MM,
  type PaintedPageBox,
  type VectorPaintItem,
  type VectorWriteOptions,
} from './vector-artwork';

/** Points per millimetre (72 / 25.4), printed in the content stream's cm. */
export const PT_PER_MM_TEXT = '2.834645669291339';

/** PDF 1.4 Reference, Appendix C: the largest page side in default units. */
export const MAX_PAGE_SIDE_UNITS = 14400;

export type PdfDocument = {
  readonly text: string;
  /** Physical page width and height in points (MediaBox times UserUnit). */
  readonly widthPt: number;
  readonly heightPt: number;
  /** 1 for PDF 1.4 pages; above 1 for oversized pages written as PDF 1.6. */
  readonly userUnit: number;
  readonly pathCount: number;
};

export function writePdfDocument(
  items: ReadonlyArray<VectorPaintItem>,
  options: VectorWriteOptions & { readonly title?: string } = {},
): PdfDocument {
  const page = preparePage(items, options);
  const box = paintedPageBox(items, options, page);
  const userUnit = Math.max(
    1,
    Math.ceil(Math.max(box.widthPt, box.heightPt) / MAX_PAGE_SIDE_UNITS - 1e-9),
  );
  const content = pdfContent(items, page, box, userUnit);
  const inUnits = (pt: number): string =>
    pointText(userUnit === 1 ? pt : Math.ceil((pt / userUnit) * 1e4 - 1e-6) / 1e4);
  const info =
    '<< /Producer (KerfDesk)' +
    (options.title === undefined ? '' : ' /Title ' + pdfString(options.title)) +
    ' >>';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
      inUnits(box.widthPt) +
      ' ' +
      inUnits(box.heightPt) +
      ']' +
      (userUnit === 1 ? '' : ' /UserUnit ' + userUnit) +
      ' /Resources << /ProcSet [/PDF] >> /Contents 4 0 R >>',
    '<< /Length ' + content.text.length + ' >>\nstream\n' + content.text + '\nendstream',
    info,
  ];
  let text = userUnit === 1 ? '%PDF-1.4\n' : '%PDF-1.6\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(text.length);
    text += index + 1 + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xref = text.length;
  text += 'xref\n0 ' + (objects.length + 1) + '\n';
  // Each entry is exactly 20 bytes: 10-digit offset, 5-digit generation, type, SP LF.
  text += '0000000000 65535 f \n';
  for (const offset of offsets) text += String(offset).padStart(10, '0') + ' 00000 n \n';
  text +=
    'trailer\n<< /Size ' +
    (objects.length + 1) +
    ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' +
    xref +
    '\n%%EOF\n';
  return {
    text,
    widthPt: box.widthPt,
    heightPt: box.heightPt,
    userUnit,
    pathCount: content.pathCount,
  };
}

function pdfContent(
  items: ReadonlyArray<VectorPaintItem>,
  page: ReturnType<typeof preparePage>,
  box: PaintedPageBox,
  userUnit: number,
): { text: string; pathCount: number } {
  const scale = userUnit === 1 ? PT_PER_MM_TEXT : String(PT_PER_MM / userUnit);
  const offset = (pt: number): string => (userUnit === 1 ? pointText(pt) : String(pt / userUnit));
  const lines: string[] = [
    'q',
    scale + ' 0 0 ' + scale + ' ' + offset(box.offsetXPt) + ' ' + offset(box.offsetYPt) + ' cm',
    VECTOR_STROKE_WIDTH_MM + ' w 1 J 1 j',
  ];
  let pathCount = 0;
  for (const item of items) {
    const rgb = rgbBytes(item.color).map(unitColorText).join(' ');
    const body = itemPathCommands(item, page);
    if (body.length === 0) continue;
    pathCount += 1;
    lines.push(rgb + (item.paint === 'fill' ? ' rg' : ' RG'), ...body);
    lines.push(item.paint === 'stroke' ? 'S' : item.fillRule === 'evenodd' ? 'f*' : 'f');
  }
  lines.push('Q');
  return { text: lines.join('\n'), pathCount };
}

/** A PDF literal string: printable ASCII with \ ( ) escaped; other characters dropped. */
function pdfString(value: string): string {
  let out = '(';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0x7e) continue;
    out += char === '\\' || char === '(' || char === ')' ? '\\' + char : char;
  }
  return out + ')';
}
