import type { PathSegment, SubPath, TextGeometry } from '../core/scene/SceneObject';
import hersheyData from './data/hersheytext.min.json';

const HERSHEY_CAP_HEIGHT = 21;
const HERSHEY_ASCII_OFFSET = 33;

interface HersheyGlyphData {
  d: string;
  o: number;
}

interface HersheyFont {
  name: string;
  chars: HersheyGlyphData[];
}

const HERSHEY_FONTS = hersheyData as Record<string, HersheyFont>;

function parseHersheyPathD(d: string): SubPath[] {
  const subPaths: SubPath[] = [];
  let current: SubPath | null = null;
  const tokens = d.match(/[ML][^ML]*/g) ?? [];

  for (const tok of tokens) {
    const cmd = tok[0];
    const nums = tok.slice(1).trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i];
      const y = nums[i + 1];
      if (cmd === 'M' && i === 0) {
        if (current) subPaths.push(current);
        current = { segments: [{ type: 'move', to: { x, y } }], closed: false };
      } else if (current) {
        current.segments.push({ type: 'line', to: { x, y } });
      }
    }
  }

  if (current) subPaths.push(current);
  return subPaths;
}

export function textToPathHershey(
  geometry: TextGeometry,
  hersheyFamily: string,
): SubPath[] {
  const { text, fontSize } = geometry;
  if (!text || fontSize <= 0) return [];

  const scale = fontSize / HERSHEY_CAP_HEIGHT;
  const fontData = HERSHEY_FONTS[hersheyFamily];
  if (!fontData || !Array.isArray(fontData.chars)) {
    console.warn(`[Hershey] Unknown family: ${hersheyFamily}`);
    return [];
  }

  const subPaths: SubPath[] = [];
  let cursorX = 0;
  const baselineY = 0;

  for (const ch of text) {
    if (ch === '\n') {
      cursorX = 0;
      continue;
    }
    const glyph = getHersheyGlyph(fontData, ch) ?? getHersheyGlyph(fontData, '?');
    if (!glyph || !glyph.d) continue;

    const glyphPaths = parseHersheyPathD(glyph.d);
    for (const sp of glyphPaths) {
      const translated: SubPath = {
        segments: sp.segments.map((seg): PathSegment => {
          if (seg.type === 'close') return seg;
          return {
            ...seg,
            to: {
              x: cursorX + seg.to.x * scale,
              y: baselineY + seg.to.y * scale,
            },
          } as PathSegment;
        }),
        closed: false,
      };
      subPaths.push(translated);
    }

    cursorX += (glyph.width ?? HERSHEY_CAP_HEIGHT) * scale;
  }

  return subPaths;
}

function getHersheyGlyph(fontData: HersheyFont, ch: string): { d: string; width: number } | null {
  if (ch === ' ') {
    return { d: '', width: HERSHEY_CAP_HEIGHT * 0.6 };
  }
  const code = ch.charCodeAt(0) - HERSHEY_ASCII_OFFSET;
  if (code < 0 || code >= fontData.chars.length) return null;
  const item = fontData.chars[code];
  if (!item) return null;
  return {
    d: item.d || '',
    width: Number.isFinite(item.o) ? item.o : HERSHEY_CAP_HEIGHT,
  };
}
