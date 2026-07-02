import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { triangleCount } from '../../core/relief';
import { parseStl } from './parse-stl';

// ── Synthetic fixture builders (the corpus is generated, not stored) ────────

function binaryStl(
  triangles: ReadonlyArray<ReadonlyArray<number>>,
  headerText = 'synthetic fixture',
): ArrayBuffer {
  const bytes = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(bytes);
  const encoder = new TextEncoder();
  const header = encoder.encode(headerText).slice(0, 80);
  new Uint8Array(bytes, 0, header.length).set(header);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((tri, t) => {
    const base = 84 + t * 50;
    // Normal left zero (parsers must ignore it).
    for (let f = 0; f < 9; f += 1) {
      view.setFloat32(base + 12 + f * 4, tri[f] ?? 0, true);
    }
    view.setUint16(base + 48, 0, true);
  });
  return bytes;
}

function asciiStl(triangles: ReadonlyArray<ReadonlyArray<number>>): string {
  const facets = triangles
    .map((tri) => {
      const v = (i: number): string => `vertex ${tri[i]} ${tri[i + 1]} ${tri[i + 2]}`;
      return `  facet normal 0 0 1\n    outer loop\n      ${v(0)}\n      ${v(3)}\n      ${v(6)}\n    endloop\n  endfacet`;
    })
    .join('\n');
  return `solid fixture\n${facets}\nendsolid fixture\n`;
}

const TRI_A = [0, 0, 0, 10, 0, 0, 0, 10, 5];
const TRI_B = [1, 2, 3, 4, 5, 6, 7, 8, 9];

describe('parseStl', () => {
  it('parses a binary STL and ignores normals/attributes', () => {
    const result = parseStl(binaryStl([TRI_A, TRI_B]));
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.format).toBe('binary');
    expect(triangleCount(result.mesh)).toBe(2);
    expect([...result.mesh.positions.slice(0, 9)]).toEqual(TRI_A);
  });

  it('parses an ASCII STL', () => {
    const bytes = new TextEncoder().encode(asciiStl([TRI_A])).buffer as ArrayBuffer;
    const result = parseStl(bytes);
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.format).toBe('ascii');
    expect(triangleCount(result.mesh)).toBe(1);
    expect([...result.mesh.positions]).toEqual(TRI_A);
  });

  it('treats a binary file whose header starts with "solid" as binary (the trap)', () => {
    const result = parseStl(binaryStl([TRI_A], 'solid but actually binary'));
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.format).toBe('binary');
  });

  it('rejects a truncated binary STL with a clear reason', () => {
    const whole = binaryStl([TRI_A, TRI_B]);
    const truncated = whole.slice(0, whole.byteLength - 10);
    const result = parseStl(truncated);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.reason).toContain('truncated');
  });

  it('rejects ASCII with a partial facet', () => {
    const text =
      'solid x\n facet normal 0 0 1\n outer loop\n vertex 1 2 3\n endloop\n endfacet\nendsolid';
    const result = parseStl(new TextEncoder().encode(text).buffer as ArrayBuffer);
    expect(result.kind).toBe('error');
  });

  it('rejects ASCII with non-numeric vertices', () => {
    const text = asciiStl([TRI_A]).replace('vertex 0 0 0', 'vertex zero 0 0');
    const result = parseStl(new TextEncoder().encode(text).buffer as ArrayBuffer);
    expect(result.kind).toBe('error');
  });

  it('rejects non-STL bytes', () => {
    const result = parseStl(new TextEncoder().encode('<svg></svg>').buffer as ArrayBuffer);
    expect(result.kind).toBe('error');
  });

  it('property: serialize → parse round-trips positions exactly (binary + ascii, 100 seeds)', () => {
    // f32-representable grid values so binary f32 storage is lossless.
    const coord = fc.integer({ min: -1000, max: 1000 }).map((n) => n / 4);
    const triangle = fc.array(coord, { minLength: 9, maxLength: 9 });
    const mesh = fc.array(triangle, { minLength: 1, maxLength: 12 });
    fc.assert(
      fc.property(mesh, (tris) => {
        const binary = parseStl(binaryStl(tris));
        if (binary.kind !== 'ok') throw new Error(binary.reason);
        expect([...binary.mesh.positions]).toEqual(tris.flat());

        const ascii = parseStl(new TextEncoder().encode(asciiStl(tris)).buffer as ArrayBuffer);
        if (ascii.kind !== 'ok') throw new Error(ascii.reason);
        expect([...ascii.mesh.positions]).toEqual(tris.flat());
      }),
      { numRuns: 100 },
    );
  });
});
