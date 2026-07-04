import { describe, expect, it } from 'vitest';
import { parseSvg, SVG_IMPORT_LIMITS } from './parse-svg';

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

  // H9 (AUDIT-2026-06-10): when width/height AND viewBox both exist, user
  // units must be scaled by physical / viewBox — the standard Inkscape /
  // Illustrator export shape (`width="50mm" viewBox="0 0 500 500"`) was
  // importing 10× too large because viewBox units were taken as raw mm.
  describe('physical size + viewBox scaling (H9)', () => {
    it('scales user units by physicalWidth/viewBoxWidth — geometry and bounds', () => {
      const result = parseSvg(
        args(`<svg xmlns="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 500 500">
  <line x1="0" y1="0" x2="500" y2="0" stroke="red"/>
</svg>`),
      );
      expect(result.object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 50 });
      const points = result.object?.paths[0]?.polylines[0]?.points ?? [];
      expect(points[points.length - 1]).toEqual({ x: 50, y: 0 });
    });

    it('scales each axis independently when width and height disagree', () => {
      const result = parseSvg(
        args(`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 200">
  <line x1="200" y1="200" x2="0" y2="0" stroke="red"/>
</svg>`),
      );
      expect(result.object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 50 });
      const points = result.object?.paths[0]?.polylines[0]?.points ?? [];
      expect(points[0]).toEqual({ x: 100, y: 50 });
    });

    it('uses the width scale for both axes when only width is declared', () => {
      const result = parseSvg(
        args(`<svg xmlns="http://www.w3.org/2000/svg" width="1in" viewBox="0 0 96 96">
  <line x1="96" y1="96" x2="0" y2="0" stroke="red"/>
</svg>`),
      );
      expect(result.object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 25.4, maxY: 25.4 });
    });

    it('converts px user units at 96 DPI when no viewBox exists (LightBurn parity)', () => {
      // A 96 px square is 1 inch = 25.4 mm, not 96 mm.
      const result = parseSvg(
        args(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
  <line x1="0" y1="0" x2="96" y2="0" stroke="red"/>
</svg>`),
      );
      expect(result.object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 25.4, maxY: 25.4 });
      const points = result.object?.paths[0]?.polylines[0]?.points ?? [];
      expect(points[points.length - 1]?.x).toBeCloseTo(25.4);
    });

    it('keeps the 1-user-unit = 1 mm assumption for viewBox-only files', () => {
      const result = parseSvg(
        args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <line x1="0" y1="0" x2="100" y2="0" stroke="red"/>
</svg>`),
      );
      expect(result.object?.bounds).toEqual({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
      const points = result.object?.paths[0]?.polylines[0]?.points ?? [];
      expect(points[points.length - 1]).toEqual({ x: 100, y: 0 });
    });
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

// H4 (AUDIT-2026-06-10): the transform stack landed translate/scale/rotate but
// skewX/skewY fell through to identity (silently dropped), and rotate(deg,cx,cy)
// and matrix() had zero coverage. Pin all four.
describe('parseSvg — transform stack (H4)', () => {
  const lastPoint = (svg: string) => {
    const pts = parseSvg(args(svg)).object?.paths[0]?.polylines[0]?.points ?? [];
    return pts[pts.length - 1];
  };
  const vb = (inner: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`;

  it('applies skewX (was silently ignored)', () => {
    // skewX(45): x' = x + tan(45)·y. (0,10) → (10,10).
    const p = lastPoint(
      vb('<line x1="0" y1="0" x2="0" y2="10" stroke="red" transform="skewX(45)"/>'),
    );
    expect(p?.x).toBeCloseTo(10, 6);
    expect(p?.y).toBeCloseTo(10, 6);
  });

  it('applies skewY (was silently ignored)', () => {
    // skewY(45): y' = tan(45)·x + y. (10,0) → (10,10).
    const p = lastPoint(
      vb('<line x1="0" y1="0" x2="10" y2="0" stroke="red" transform="skewY(45)"/>'),
    );
    expect(p?.x).toBeCloseTo(10, 6);
    expect(p?.y).toBeCloseTo(10, 6);
  });

  it('applies rotate(deg, cx, cy) about a center', () => {
    // rotate 90° about (5,5): (10,5) → (5,10).
    const p = lastPoint(
      vb('<line x1="5" y1="5" x2="10" y2="5" stroke="red" transform="rotate(90 5 5)"/>'),
    );
    expect(p?.x).toBeCloseTo(5, 6);
    expect(p?.y).toBeCloseTo(10, 6);
  });

  it('applies a raw matrix()', () => {
    // matrix(2,0,0,3,5,7): (2,2) → (2·2+5, 3·2+7) = (9,13).
    const p = lastPoint(vb('<path d="M1 1 L2 2" stroke="red" transform="matrix(2,0,0,3,5,7)"/>'));
    expect(p?.x).toBeCloseTo(9, 6);
    expect(p?.y).toBeCloseTo(13, 6);
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

describe('parseSvg — denial-of-service guards', () => {
  it('does not stack-overflow on circular <use> references', () => {
    // <use id="a" href="#b"/> and <use id="b" href="#a"/> reference each other;
    // without a recursion guard, resolving them recurses until the JS stack
    // overflows (RangeError). The walk-depth cap must let parsing finish.
    const svgText = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <use id="a" href="#b"/>
  <use id="b" href="#a"/>
  <path d="M 0 0 L 10 10" stroke="#ff0000"/>
</svg>`;
    expect(() => parseSvg(args(svgText))).not.toThrow();
  });

  it('rejects SVGs that exceed the imported color-group budget', () => {
    const lines = Array.from({ length: SVG_IMPORT_LIMITS.coloredPaths + 1 }, (_, index) => {
      const color = `#${(index + 1).toString(16).padStart(6, '0')}`;
      return `<line x1="0" y1="${index}" x2="1" y2="${index}" stroke="${color}"/>`;
    }).join('');

    expect(() =>
      parseSvg(args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 300">${lines}</svg>`)),
    ).toThrow(/color group/);
  });

  it('rejects SVGs with unsupported extreme coordinates', () => {
    expect(() =>
      parseSvg(
        args(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
  <line x1="0" y1="0" x2="1000001" y2="0" stroke="red"/>
</svg>`),
      ),
    ).toThrow(/coordinates/);
  });
});
