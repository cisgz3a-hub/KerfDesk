import { describe, expect, it } from 'vitest';
import { parseSvg } from './parse-svg';

const args = (svgText: string) => ({ svgText, id: 'O1', source: 'test.svg' });

describe('parseSvg — happy path', () => {
  it('produces an ImportedSvg with one color group from a one-color SVG', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M 10 10 L 90 90" stroke="#ff0000" fill="none"/>
</svg>`),
    );
    expect(result.object).not.toBeNull();
    expect(result.object?.kind).toBe('imported-svg');
    expect(result.object?.id).toBe('O1');
    expect(result.object?.source).toBe('test.svg');
    expect(result.object?.paths).toHaveLength(1);
    expect(result.object?.paths[0]?.color).toBe('#ff0000');
  });

  it('groups elements by stroke color (one path per unique color)', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <path d="M 0 0 L 10 0" stroke="#ff0000"/>
  <path d="M 0 10 L 10 10" stroke="#0000ff"/>
  <path d="M 0 20 L 10 20" stroke="#ff0000"/>
</svg>`),
    );
    expect(result.object?.paths).toHaveLength(2);
    const reds = result.object?.paths.find((p) => p.color === '#ff0000');
    expect(reds?.polylines).toHaveLength(2);
  });

  it('reads viewBox into bounds', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 10 20 30">
  <line x1="5" y1="10" x2="25" y2="40" stroke="red"/>
</svg>`),
    );
    expect(result.object?.bounds).toEqual({ minX: 5, minY: 10, maxX: 25, maxY: 40 });
  });

  it('converts physical width/height units to millimetre bounds when no viewBox exists', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" width="1in" height="25.4mm">
  <rect x="0" y="0" width="10" height="10" fill="red"/>
</svg>`),
    );
    expect(result.object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 25.4, maxY: 25.4 });
  });

  it('normalizes color forms: 3-digit hex, named, rgb()', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <line x1="0" y1="0" x2="1" y2="0" stroke="#f00"/>
  <line x1="0" y1="1" x2="1" y2="1" stroke="red"/>
  <line x1="0" y1="2" x2="1" y2="2" stroke="rgb(255,0,0)"/>
</svg>`),
    );
    expect(result.object?.paths).toHaveLength(1);
    expect(result.object?.paths[0]?.color).toBe('#ff0000');
    expect(result.object?.paths[0]?.polylines).toHaveLength(3);
  });
});

describe('parseSvg — empty / no geometry', () => {
  it('returns object=null when no strokes match (e.g., text-only SVG)', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <text x="5" y="5">hello</text>
</svg>`),
    );
    expect(result.object).toBeNull();
    expect(result.notes.join(' ')).toMatch(/no drawable/);
  });

  it('counts ignored <text> and <image> elements (WORKFLOW.md F-A3 edge)', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <text x="0" y="5">A</text>
  <text x="0" y="6">B</text>
  <image href="x.png" width="10" height="10"/>
  <path d="M0 0 L 10 0" stroke="red"/>
</svg>`),
    );
    expect(result.ignoredTextElements).toBe(2);
    expect(result.ignoredImageElements).toBe(1);
    expect(result.object).not.toBeNull(); // there's still a red path
  });
});

describe('parseSvg — error paths', () => {
  it('throws on non-SVG content (root element check)', () => {
    expect(() => parseSvg(args('<not-svg xmlns="urn:x-test"><child/></not-svg>'))).toThrow();
  });
  // Note: "SVG fails to parse" (WORKFLOW.md F-A3 error case) depends on the
  // underlying DOMParser's tolerance. jsdom's parser silently recovers from
  // many forms of malformed markup, so the failing path is verified instead
  // by the F-A3 integration tests against crafted fixtures in
  // src/__fixtures__/svg/malicious/ rather than at the unit level.
});

describe('parseSvg — surfaces sanitize counts', () => {
  it('surfaces script-strip count from sanitize', () => {
    const result = parseSvg(
      args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <script>alert(1)</script>
  <path d="M 0 0 L 10 10" stroke="red"/>
</svg>`),
    );
    expect(result.stripped.scripts).toBe(1);
    expect(result.object).not.toBeNull();
  });
});
