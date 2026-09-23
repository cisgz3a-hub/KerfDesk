import { applySvgMatrix, type SvgMatrix } from '../svg/svg-curve-transform';
import { multiplySvgMatrix } from '../svg/svg-transform-attribute';

type Operators = Readonly<Record<string, number>>;
type OperatorList = {
  readonly fnArray: readonly number[];
  readonly argsArray: readonly unknown[][];
};
type PaintState = { matrix: SvgMatrix; stroke: string; fill: string; width: number };
export type PdfVectorPage = { readonly svg: string | null; readonly reason: string | null };

// PDF.js 6.3 supplies constructPath as [paint operation, [packed DrawOPS], bounds].
// Interpret complete path geometry for editing. Strokes become centrelines,
// matching SVG import. Any text, image, clipping,
// transparency or unknown drawing operation selects the rendered-page route.
export function pdfVectorPage(
  list: OperatorList,
  operators: Operators,
  viewport: {
    readonly width: number;
    readonly height: number;
    readonly transform: readonly number[];
  },
): PdfVectorPage {
  try {
    return convertPage(list, operators, viewport);
  } catch (error) {
    return {
      svg: null,
      reason: error instanceof Error ? error.message : 'Unsupported page content',
    };
  }
}

function convertPage(
  list: OperatorList,
  ops: Operators,
  viewport: {
    readonly width: number;
    readonly height: number;
    readonly transform: readonly number[];
  },
): PdfVectorPage {
  const names = new Map(Object.entries(ops).map(([name, code]) => [code, name]));
  let state: PaintState = {
    matrix: matrix(viewport.transform),
    stroke: '#000000',
    fill: '#000000',
    width: 1,
  };
  const stack: PaintState[] = [];
  const paths: string[] = [];
  for (let index = 0; index < list.fnArray.length; index += 1) {
    const name = names.get(list.fnArray[index] ?? -1) ?? 'unknown';
    const args = list.argsArray[index] ?? [];
    if (name !== 'constructPath') {
      state = applyStateOperation(name, args, state, stack);
      continue;
    }
    if (args[0] === ops.endPath) continue;
    const path = paintedPath(args, ops, state, viewport);
    if (path !== '') paths.push(path);
  }
  if (stack.length !== 0) throw new Error('Unbalanced page graphics state');
  if (paths.length === 0) return { svg: null, reason: 'This page has no editable vector paths' };
  return {
    svg:
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      (viewport.width * 25.4) / 72 +
      'mm" height="' +
      (viewport.height * 25.4) / 72 +
      'mm" viewBox="0 0 ' +
      viewport.width +
      ' ' +
      viewport.height +
      '">' +
      paths.join('') +
      '</svg>',
    reason: null,
  };
}

const CENTRELINE_IGNORED_OPS = new Set([
  'dependency',
  'setLineCap',
  'setLineJoin',
  'setMiterLimit',
  'setRenderingIntent',
  'setFlatness',
  'beginCompat',
  'endCompat',
]);

function applyStateOperation(
  name: string,
  args: readonly unknown[],
  state: PaintState,
  stack: PaintState[],
): PaintState {
  if (CENTRELINE_IGNORED_OPS.has(name)) return state;
  switch (name) {
    case 'save':
      stack.push({ ...state });
      return state;
    case 'restore': {
      const previous = stack.pop();
      if (previous === undefined) throw new Error('Unbalanced page graphics state');
      return previous;
    }
    case 'transform':
      return { ...state, matrix: multiplySvgMatrix(state.matrix, matrix(args)) };
    case 'setStrokeRGBColor':
      return { ...state, stroke: rgb(args[0]) };
    case 'setFillRGBColor':
      return { ...state, fill: rgb(args[0]) };
    case 'setLineWidth':
      return { ...state, width: finite(args[0]) };
    case 'setDash':
      if (!Array.isArray(args[0]) || args[0].length !== 0) {
        throw new Error('Dashed strokes are preserved in the rendered image');
      }
      return state;
    default:
      throw new Error(contentReason(name));
  }
}

function paintedPath(
  args: readonly unknown[],
  ops: Operators,
  state: PaintState,
  viewport: { readonly width: number; readonly height: number },
): string {
  const { fill, stroke, closed, evenOdd } = paintFlags(args[0], ops, state);
  const packed = Array.isArray(args[1]) ? args[1][0] : undefined;
  if (!Array.isArray(packed) && !ArrayBuffer.isView(packed)) {
    throw new Error('Unsupported vector path representation');
  }
  const values = Array.from(packed as ArrayLike<number>);
  const d = pathData(values, state.matrix, viewport, closed);
  if (d === '') return '';
  const m = state.matrix;
  return (
    '<path d="' +
    d +
    '" transform="matrix(' +
    [m.a, m.b, m.c, m.d, m.e, m.f].join(' ') +
    ')" fill="' +
    (fill ? state.fill : 'none') +
    '" fill-rule="' +
    (evenOdd ? 'evenodd' : 'nonzero') +
    '" stroke="' +
    (stroke ? state.stroke : 'none') +
    '" stroke-width="' +
    state.width +
    '"/>'
  );
}

function paintFlags(paint: unknown, ops: Operators, state: PaintState) {
  const fill = [
    ops.fill,
    ops.eoFill,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
  ].includes(paint as number);
  const stroke = [
    ops.stroke,
    ops.closeStroke,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
  ].includes(paint as number);
  if (!fill && !stroke) throw new Error('Page clipping is preserved in the rendered image');
  if (fill && stroke && state.fill !== state.stroke) {
    throw new Error('Different fill and stroke colours are preserved in the rendered image');
  }
  const closed = {
    all: fill,
    last:
      fill ||
      [ops.closeStroke, ops.closeFillStroke, ops.closeEOFillStroke].includes(paint as number),
  };
  const evenOdd = [ops.eoFill, ops.eoFillStroke, ops.closeEOFillStroke].includes(paint as number);
  return { fill, stroke, closed, evenOdd };
}

function pathData(
  values: readonly number[],
  transform: SvgMatrix,
  viewport: { readonly width: number; readonly height: number },
  closed: { readonly all: boolean; readonly last: boolean },
): string {
  const commands = ['M', 'L', 'C', 'Q', 'Z'];
  const counts = [2, 2, 6, 4, 0];
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < values.length) {
    const op = finite(values[cursor++]);
    const count = counts[op];
    if (count === undefined || cursor + count > values.length)
      throw new Error('Invalid vector path');
    const coords = values.slice(cursor, cursor + count).map(finite);
    assertPagePoints(coords, transform, viewport);
    if (op === 0 && closed.all && parts.length > 0 && parts.at(-1) !== 'Z') parts.push('Z');
    parts.push((commands[op] ?? '') + coords.join(' '));
    cursor += count;
  }
  if (closed.last && parts.length > 0 && parts.at(-1) !== 'Z') parts.push('Z');
  return parts.join(' ');
}

function assertPagePoints(
  coords: readonly number[],
  transform: SvgMatrix,
  viewport: { readonly width: number; readonly height: number },
): void {
  for (let i = 0; i < coords.length; i += 2) {
    const point = applySvgMatrix(transform, { x: finite(coords[i]), y: finite(coords[i + 1]) });
    if (
      point.x < -0.001 ||
      point.y < -0.001 ||
      point.x > viewport.width + 0.001 ||
      point.y > viewport.height + 0.001
    ) {
      throw new Error('Artwork crossing the page edge is preserved in the rendered image');
    }
  }
}
function matrix(values: readonly unknown[]): SvgMatrix {
  if (values.length !== 6) throw new Error('Invalid page transformation');
  return {
    a: finite(values[0]),
    b: finite(values[1]),
    c: finite(values[2]),
    d: finite(values[3]),
    e: finite(values[4]),
    f: finite(values[5]),
  };
}

function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error('Invalid page coordinate');
  return value;
}

function rgb(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error('Complex page colour is preserved in the rendered image');
  }
  return value;
}

function contentReason(name: string | undefined): string {
  if (name?.toLowerCase().includes('text') || name === 'setFont') {
    return 'Text stays together in the rendered image; embedded fonts are used where available';
  }
  if (name?.toLowerCase().includes('image'))
    return 'Embedded images are preserved in the rendered image';
  return 'Page clipping, effects or other complex content are preserved in the rendered image';
}
