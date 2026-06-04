import { describe, expect, it } from 'vitest';

import { parseSvg } from './parse-svg';

const args = (svgText: string) => ({ svgText, id: 'O1', source: 'test.svg' });

describe('parseSvg presentation state', () => {
  it('imports fill-only geometry using its fill color', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <rect x="1" y="1" width="8" height="8" fill="red"/>
</svg>`),
    );

    expect(result.object).not.toBeNull();
    expect(result.object?.paths[0]?.color).toBe('#ff0000');
    expect(result.object?.paths[0]?.polylines[0]?.closed).toBe(true);
  });

  it('resolves inherited and inline-style stroke colors', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <g stroke="#00ff00">
    <line x1="0" y1="0" x2="1" y2="0"/>
  </g>
  <line x1="0" y1="1" x2="1" y2="1" style="stroke: #ff0000; fill: none"/>
</svg>`),
    );

    expect(result.object?.paths.map((p) => p.color).sort()).toEqual(['#00ff00', '#ff0000']);
  });

  it('applies accumulated group and element transforms to imported geometry', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30">
  <g stroke="red" transform="translate(10 20)">
    <line x1="0" y1="0" x2="5" y2="0" transform="scale(2)"/>
  </g>
</svg>`),
    );

    const points = result.object?.paths[0]?.polylines[0]?.points;
    expect(points?.[0]).toEqual({ x: 10, y: 20 });
    expect(points?.[1]).toEqual({ x: 20, y: 20 });
  });

  it('skips hidden or fully transparent stroked geometry', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <line x1="0" y1="0" x2="1" y2="0" stroke="red" display="none"/>
  <line x1="0" y1="1" x2="1" y2="1" stroke="red" visibility="hidden"/>
  <line x1="0" y1="2" x2="1" y2="2" stroke="red" opacity="0"/>
  <line x1="0" y1="3" x2="1" y2="3" stroke="red" stroke-opacity="0"/>
  <line x1="0" y1="4" x2="1" y2="4" stroke="red" style="display:none"/>
  <line x1="0" y1="5" x2="1" y2="5" stroke="red" style="visibility:hidden"/>
  <line x1="0" y1="6" x2="1" y2="6" stroke="red" style="opacity:0"/>
  <line x1="0" y1="7" x2="1" y2="7" stroke="red" style="stroke-opacity:0"/>
  <g display="none">
    <line x1="0" y1="8" x2="1" y2="8" stroke="red"/>
  </g>
  <line x1="0" y1="9" x2="1" y2="9" stroke="red"/>
</svg>`),
    );

    expect(result.object?.paths).toHaveLength(1);
    expect(result.object?.paths[0]?.polylines).toHaveLength(1);
    expect(result.object?.paths[0]?.polylines[0]?.points).toEqual([
      { x: 0, y: 9 },
      { x: 1, y: 9 },
    ]);
  });

  it('expands safe local <use> references at their x/y placement', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 30">
  <defs>
    <rect id="tile" x="0" y="0" width="5" height="5" fill="blue"/>
  </defs>
  <use href="#tile" x="10" y="20"/>
</svg>`),
    );

    const points = result.object?.paths[0]?.polylines[0]?.points;
    expect(result.object?.paths).toHaveLength(1);
    expect(points?.[0]).toEqual({ x: 10, y: 20 });
    expect(points?.[1]).toEqual({ x: 15, y: 20 });
  });
});
