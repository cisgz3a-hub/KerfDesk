import { type TextGeometry } from '../core/scene/SceneObject';

/** Stable key for text outline / potrace cache; must include every field that affects outlines. */
export function textOutlineFingerprint(g: TextGeometry): string {
  return JSON.stringify({
    t: g.text,
    fs: g.fontSize,
    ff: g.fontFamily,
    b: !!g.bold,
    i: !!g.italic,
    ta: g.textAlign ?? 'left',
    ls: g.letterSpacing ?? 0,
    lh: g.lineSpacing ?? 120,
    ws: g.wordSpacing ?? 100,
  });
}
