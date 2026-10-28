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
import { applyTextWeldInWorker } from '../text/text-weld-worker-client';
import type { RemoteWrite } from './types';
import { RemoteFault } from './fault';
import { remoteBounds } from './projections';
import { transformedBBox } from '../../core/scene/hit-test';

type TextArgs = Extract<RemoteWrite, { command: 'add_text' }>['args'];
export type PreparedRemoteText = {
  readonly object: TextObject;
  /** Characters the font has no glyph for (ADR-591 Amendment 1). */
  readonly missingCharacters: readonly string[];
};

/** Same bundled-font renderer as local text; width is a maximum, never a bed-fit request. */
export async function prepareRemoteText(
  args: TextArgs,
  signal: AbortSignal,
): Promise<PreparedRemoteText> {
  signal.throwIfAborted();
  const content = args.text.normalize('NFC');
  if (content.trim() === '') throw new RemoteFault('invalid_arguments');
  const fontKey = args.fontId ?? DEFAULT_FONT_KEY;
  if (findFontEntry(fontKey) === null) throw new RemoteFault('invalid_arguments');
  const rendered = await renderTextGeometry({
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
  // ADR-321 Amendment 1: new remote text welds its overlaps, as new desktop text does.
  const geometry = await applyTextWeldInWorker(rendered, fontKey, true, signal);
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
    weldOverlaps: true,
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
  return { object, missingCharacters: rendered.missingCharacters ?? [] };
}
