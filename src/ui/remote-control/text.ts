import { IDENTITY_TRANSFORM, type TextObject } from '../../core/scene';
import {
  DEFAULT_FONT_KEY,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_ALIGNMENT,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_LETTER_SPACING,
  findFontEntry,
} from '../../core/text';
import { renderTextGeometry } from '../text/render-text-geometry';
import type { RemoteWrite } from './types';
import { RemoteFault } from './fault';
import { remoteBounds } from './projections';
import { transformedBBox } from '../../core/scene/hit-test';

type TextArgs = Extract<RemoteWrite, { command: 'add_text' }>['args'];
/** Same bundled-font renderer as local text; width is a maximum, never a bed-fit request. */
export async function prepareRemoteText(args: TextArgs, signal: AbortSignal): Promise<TextObject> {
  signal.throwIfAborted();
  const content = args.text.normalize('NFC');
  if (content.trim() === '') throw new RemoteFault('invalid_arguments');
  const fontKey = args.fontId ?? DEFAULT_FONT_KEY;
  if (findFontEntry(fontKey) === null) throw new RemoteFault('invalid_arguments');
  const geometry = await renderTextGeometry({
    fontKey,
    embeddedFonts: undefined,
    content,
    sizeMm: args.fontSizeMm,
    alignment: DEFAULT_TEXT_ALIGNMENT,
    lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
    letterSpacing: DEFAULT_TEXT_LETTER_SPACING,
    color: DEFAULT_TEXT_COLOR,
  });
  signal.throwIfAborted();
  const width = geometry.bounds.maxX - geometry.bounds.minX;
  if (!Number.isFinite(width) || width <= 0) throw new RemoteFault('unsupported_operation');
  const scale = Math.min(1, args.widthMm / width);
  const object: TextObject = {
    kind: 'text',
    id: crypto.randomUUID(),
    content,
    fontKey,
    sizeMm: args.fontSizeMm,
    alignment: DEFAULT_TEXT_ALIGNMENT,
    lineHeight: DEFAULT_TEXT_LINE_HEIGHT,
    letterSpacing: DEFAULT_TEXT_LETTER_SPACING,
    bendDeg: 0,
    weldOverlaps: false,
    color: DEFAULT_TEXT_COLOR,
    paths: geometry.paths,
    bounds: geometry.bounds,
    transform: {
      ...IDENTITY_TRANSFORM,
      x: args.xMm - geometry.bounds.minX * scale,
      y: args.yMm - geometry.bounds.minY * scale,
      scaleX: scale,
      scaleY: scale,
    },
  };
  if (remoteBounds(transformedBBox(object)) === undefined)
    throw new RemoteFault('unsupported_operation');
  return object;
}
