import type { TextGeometry } from '../core/scene/SceneObject';

export interface TextLayoutGlyph {
  ch: string;
  x: number;
  y: number;
  lineIndex: number;
}

export interface TextLayoutLine {
  text: string;
  x: number;
  y: number;
  width: number;
  lineIndex: number;
}

export interface TextLayout {
  fontSize: number;
  blockWidth: number;
  blockHeight: number;
  lineSpacing: number;
  letterSpacing: number;
  wordSpacingExtra: number;
  lines: TextLayoutLine[];
  glyphs: TextLayoutGlyph[];
}

export function textPctOrDefault(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function textLetterSpacing(g: TextGeometry, fontSize: number): number {
  return (textPctOrDefault(g.letterSpacing, 0) / 100) * fontSize;
}

export function textLineSpacing(g: TextGeometry, fontSize: number): number {
  return (textPctOrDefault(g.lineSpacing, 120) / 100) * fontSize;
}

export function textWordSpacingExtra(g: TextGeometry, fontSize: number): number {
  return ((textPctOrDefault(g.wordSpacing, 100) - 100) / 100) * fontSize * 0.3;
}

export function splitTextGeometryLines(g: TextGeometry): string[] {
  return (g.text ?? '').split('\n');
}

export function measureTextLayoutLineWidth(
  g: TextGeometry,
  measureCharWidth: (ch: string) => number,
): number {
  const fontSize = Math.max(0.01, g.fontSize || 10);
  const ls = textLetterSpacing(g, fontSize);
  const ws = textWordSpacingExtra(g, fontSize);
  const line = g.text ?? '';
  let x = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    x += measureCharWidth(ch) + ls;
    if (ch === ' ') x += ws;
  }
  return line.length === 0 ? 0 : x - ls;
}

export function layoutTextGeometry(
  g: TextGeometry,
  measureCharWidth: (ch: string) => number,
): TextLayout {
  const fontSize = Math.max(0.01, g.fontSize || 10);
  const letterSpacing = textLetterSpacing(g, fontSize);
  const lineSpacing = textLineSpacing(g, fontSize);
  const wordSpacingExtra = textWordSpacingExtra(g, fontSize);
  const rawLines = splitTextGeometryLines(g);
  const lineWidths = rawLines.map(line =>
    measureTextLayoutLineWidth({ ...g, text: line }, measureCharWidth),
  );
  const blockWidth = lineWidths.reduce((max, width) => Math.max(max, width), 0);
  const blockHeight = rawLines.length === 0 ? fontSize * 1.25 : (rawLines.length - 1) * lineSpacing + fontSize * 1.25;
  const align = g.textAlign || 'left';
  const lines: TextLayoutLine[] = [];
  const glyphs: TextLayoutGlyph[] = [];

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex++) {
    const text = rawLines[lineIndex];
    const width = lineWidths[lineIndex] ?? 0;
    let startX = 0;
    if (align === 'center') startX = (blockWidth - width) / 2;
    else if (align === 'right') startX = blockWidth - width;
    const y = lineIndex * lineSpacing;
    lines.push({ text, x: startX, y, width, lineIndex });

    let x = startX;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      glyphs.push({ ch, x, y, lineIndex });
      x += measureCharWidth(ch) + letterSpacing;
      if (ch === ' ') x += wordSpacingExtra;
    }
  }

  return {
    fontSize,
    blockWidth,
    blockHeight,
    lineSpacing,
    letterSpacing,
    wordSpacingExtra,
    lines,
    glyphs,
  };
}
