// Whether one opentype.js parse of a font may serve every later render, with
// output identical to parsing the font again for each render (ADR-624).
//
// opentype.js 2 completes a Font lazily while it draws, and some of that state
// feeds later layouts, so a reused Font can lay the same text out differently:
// - A CFF glyph takes its advance from its charstring once its outline is
//   read, replacing the hmtx advance an earlier measurement used.
// - In a variable font with HVAR, drawing a glyph rewrites its advance and
//   side bearing.
// - An SVG colour glyph decodes asynchronously. Once decoded, it draws as an
//   image layer and leaves the outline.
// - Composite glyphs that include each other resolve differently depending on
//   which of them was drawn first.
// COLR colour fonts are excluded as well, conservatively. A font is reusable
// only when it is a plain TrueType font (not WOFF) with none of those tables
// and no composite cycle. Any other font is parsed again for every render, as
// textToPolylines always did. Reading the tables directly costs a few
// milliseconds and never touches a parsed Font.
//
// Pure-core compliant: no clock, no random, no I/O.

const TRUETYPE_SIGNATURES: ReadonlyArray<number> = [0x00010000, 0x74727565]; // 1.0, 'true'
const EXCLUDED_TABLES: ReadonlySet<string> = new Set(['CFF ', 'CFF2', 'SVG ', 'COLR', 'fvar']);
const HEAD_INDEX_TO_LOC_FORMAT = 50;
const MAXP_NUM_GLYPHS = 4;
const GLYPH_HEADER_BYTES = 10;
// Composite glyph component flags (OpenType glyf table).
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;

type TableRecord = { readonly offset: number; readonly length: number };

/** True when a parsed copy of this font may be reused across renders. */
export function reusableOutlineFont(fontBuffer: ArrayBuffer): boolean {
  try {
    return reusable(new DataView(fontBuffer));
  } catch {
    // A truncated or malformed font is simply parsed for every render.
    return false;
  }
}

function reusable(data: DataView): boolean {
  if (!TRUETYPE_SIGNATURES.includes(data.getUint32(0))) return false;
  const tables = tableDirectory(data);
  for (const tag of tables.keys()) if (EXCLUDED_TABLES.has(tag)) return false;
  const head = tables.get('head');
  const maxp = tables.get('maxp');
  const loca = tables.get('loca');
  const glyf = tables.get('glyf');
  if (head === undefined || maxp === undefined || loca === undefined || glyf === undefined)
    return false;
  const shortOffsets = data.getInt16(head.offset + HEAD_INDEX_TO_LOC_FORMAT) === 0;
  const glyphCount = data.getUint16(maxp.offset + MAXP_NUM_GLYPHS);
  const offsets = glyphOffsets(data, loca, glyphCount, shortOffsets);
  return compositesAreAcyclic(data, glyf, offsets);
}

function tableDirectory(data: DataView): ReadonlyMap<string, TableRecord> {
  const count = data.getUint16(4);
  const tables = new Map<string, TableRecord>();
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(
      data.getUint8(record),
      data.getUint8(record + 1),
      data.getUint8(record + 2),
      data.getUint8(record + 3),
    );
    const offset = data.getUint32(record + 8);
    const length = data.getUint32(record + 12);
    if (offset + length > data.byteLength) throw new RangeError(`Table ${tag} is truncated.`);
    tables.set(tag, { offset, length });
  }
  return tables;
}

// The same glyph offsets opentype.js reads: glyphCount + 1 entries.
function glyphOffsets(
  data: DataView,
  loca: TableRecord,
  glyphCount: number,
  shortOffsets: boolean,
): ReadonlyArray<number> {
  const offsets: number[] = [];
  for (let index = 0; index <= glyphCount; index += 1) {
    offsets.push(
      shortOffsets
        ? data.getUint16(loca.offset + index * 2) * 2
        : data.getUint32(loca.offset + index * 4),
    );
  }
  return offsets;
}

function compositesAreAcyclic(
  data: DataView,
  glyf: TableRecord,
  offsets: ReadonlyArray<number>,
): boolean {
  const glyphCount = offsets.length - 1;
  const components = new Map<number, ReadonlyArray<number>>();
  for (let glyph = 0; glyph < glyphCount; glyph += 1) {
    const start = offsets[glyph] ?? 0;
    const end = offsets[glyph + 1] ?? start;
    if (start === end) continue;
    if (end < start || end > glyf.length) return false;
    if (data.getInt16(glyf.offset + start) >= 0) continue;
    const indexes = componentIndexes(data, glyf.offset + start + GLYPH_HEADER_BYTES);
    // opentype.js cannot resolve a component that does not exist.
    if (indexes.some((index) => index >= glyphCount)) return false;
    components.set(glyph, indexes);
  }
  return !hasCycle(components);
}

function componentIndexes(data: DataView, start: number): ReadonlyArray<number> {
  const indexes: number[] = [];
  let cursor = start;
  let flags = MORE_COMPONENTS;
  while ((flags & MORE_COMPONENTS) !== 0) {
    flags = data.getUint16(cursor);
    indexes.push(data.getUint16(cursor + 2));
    cursor += 4 + ((flags & ARG_1_AND_2_ARE_WORDS) !== 0 ? 4 : 2);
    if ((flags & WE_HAVE_A_SCALE) !== 0) cursor += 2;
    else if ((flags & WE_HAVE_AN_X_AND_Y_SCALE) !== 0) cursor += 4;
    else if ((flags & WE_HAVE_A_TWO_BY_TWO) !== 0) cursor += 8;
  }
  return indexes;
}

// Depth-first search without recursion; a glyph that includes itself counts.
function hasCycle(components: ReadonlyMap<number, ReadonlyArray<number>>): boolean {
  const done = new Set<number>();
  const onPath = new Set<number>();
  for (const root of components.keys()) {
    if (done.has(root)) continue;
    const stack: Array<{ readonly glyph: number; next: number }> = [{ glyph: root, next: 0 }];
    onPath.add(root);
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const children = components.get(top.glyph) ?? [];
      const child = children[top.next];
      if (child === undefined) {
        stack.pop();
        onPath.delete(top.glyph);
        done.add(top.glyph);
        continue;
      }
      top.next += 1;
      if (onPath.has(child)) return true;
      if (done.has(child) || !components.has(child)) continue;
      onPath.add(child);
      stack.push({ glyph: child, next: 0 });
    }
  }
  return false;
}
