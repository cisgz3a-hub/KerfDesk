import { describe, expect, it } from 'vitest';
import type { CurveSubpath } from '../scene';
import { renderStrokeFontText, type StrokeFont } from './stroke-font-text';

// A square-cut "H" on an 8-unit advance with 1-unit side bearings, drawn
// y-up from the baseline to a cap height of 10, so one unit is 1 mm at Size 10.
const H_FONT: StrokeFont = {
  capHeight: 10,
  yAxis: 'up',
  glyphs: new Map([
    ['H', { advance: 8, paths: [stroke(1, 0, 1, 10), stroke(7, 0, 7, 10), stroke(1, 5, 7, 5)] }],
    [' ', { advance: 4, paths: [] }],
    ['?', { advance: 6, paths: [stroke(3, 0, 3, 1), stroke(3, 3, 3, 10)] }],
  ]),
};

describe('renderStrokeFontText alignment anchor', () => {
  it('sits on the first baseline at the line start, centre or end', () => {
    const anchors = (['left', 'center', 'right'] as const).map(
      (alignment) => render('HH', alignment).anchor,
    );

    // "HH" is 16 mm of advance; its ink starts 1 mm in and rises 10 mm.
    expect(anchors).toEqual([
      { x: -1, y: 10 },
      { x: 7, y: 10 },
      { x: 15, y: 10 },
    ]);
  });

  it('keeps the first baseline and the widest line centre when more lines follow', () => {
    const rendered = render('H\nHHH', 'center');

    expect(rendered.bounds).toEqual({ minX: 0, minY: 0, maxX: 22, maxY: 22 });
    expect(rendered.anchor).toEqual({ x: 11, y: 10 });
  });

  it('has no anchor when there is no ink', () => {
    expect(render('', 'left').anchor).toBeUndefined();
  });
});

describe('renderStrokeFontText characters the font cannot draw', () => {
  it('reports each missing character once while still drawing "?" for it', () => {
    const rendered = render('H\u2713H\u2713', 'left');

    expect(rendered.missingCharacters).toEqual(['\u2713']);
    expect(rendered.bounds).toEqual(render('H?H?', 'left').bounds);
    expect(render('H H', 'left').missingCharacters).toBeUndefined();
  });

  it('lays out a CRLF line break as LF and a TAB as a space', () => {
    expect(render('H\r\nH', 'left')).toEqual(render('H\nH', 'left'));
    expect(render('H\tH', 'left')).toEqual(render('H H', 'left'));
  });
});

function render(content: string, alignment: 'left' | 'center' | 'right') {
  return renderStrokeFontText(
    { content, sizeMm: 10, alignment, lineHeight: 1.2, color: '#000000' },
    H_FONT,
  );
}

function stroke(x1: number, y1: number, x2: number, y2: number): CurveSubpath {
  return {
    start: { x: x1, y: y1 },
    closed: false,
    segments: [{ kind: 'line', to: { x: x2, y: y2 } }],
  };
}
