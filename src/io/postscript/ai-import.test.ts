import { describe, expect, it } from 'vitest';
import { parseSvg } from '../svg/parse-svg';
import { convertPostscript } from './convert-postscript';

// Hand-written from the Adobe Illustrator File Format Specification (1998):
// an Illustrator 3 file whose prolog only names a procset it does not carry.
const AI3 = `%!PS-Adobe-2.0 EPSF-1.2
%%Creator:Adobe Illustrator(TM) 3.2
%%BoundingBox:0 0 200 100
%%DocumentProcSets:Adobe_Illustrator_1.1 0 0
%%EndComments
%%BeginProlog
%%IncludeProcSet:Adobe_Illustrator_1.1 0 0
/notArtwork { currentfile readline } def frobnicate
%%EndProlog
%%BeginSetup
Adobe_Illustrator_1.1 begin
n
%%EndSetup
0 g 0 G 1 w
10 10 m 90 10 L 90 90 L 10 90 L 10 10 L f
0 1 1 0 k
*u
110 10 m 190 10 l 190 90 l 110 90 l f
130 30 m 130 70 l 170 70 l 170 30 l f
*U
1 0 0 0 (Cyan) 0.5 X
2 w
100 50 m 120 60 140 60 v S
0 To 1 0 0 1 20 20 0 Tp TP 0 Tr /_Helvetica 12 Tf (Hello) Tx TX TO
%%PageTrailer
gsave annotatepage grestore showpage
%%Trailer
Adobe_Illustrator_1.1 /terminate get exec
%%EOF
`;

// Illustrator 8 EPS: RGB fills (Xa), the even-odd fill rule (XR), the y
// curve shorthand, a gradient and a placed image, all inside the script.
const AI8 = `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: Adobe Illustrator(R) 8.0
%%AI8_CreatorVersion: 8.0
%%BoundingBox: 0 0 100 100
%%HiResBoundingBox: 0 0 100 100
%%EndComments
%%BeginProlog
userdict /Adobe_level2_AI5 26 dict dup begin put /packedarray where not { } if
%%EndProlog
%%BeginSetup
Adobe_level2_AI5 /initialize get exec
%%EndSetup
%AI5_BeginLayer
1 1 1 1 0 0 1 255 79 79 Lb
(Layer 1) Ln
0 0 1 Xa
1 XR
*u
0 0 m 100 0 l 100 100 l 0 100 l 0 0 l f
25 25 m 25 75 l 75 75 l 75 25 l 25 25 l f
*U
0 XR
1 0 0 Xa
0 Bb 2 (Linear) 50 50 0 100 1 0 0 1 0 0 Bg 0 BB
10 10 m 30 40 50 10 y f
%AI5_BeginRaster
() 1 XI
%FFFF
%AI5_EndRaster
LB
%AI5_EndLayer--
%%PageTrailer
%%Trailer
%%EOF
`;

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

function ok(text: string) {
  const result = convertPostscript(encode(text));
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result;
}

const paths = (svg: string): string[] => [...svg.matchAll(/<path [^>]*\/>/g)].map((m) => m[0]);

describe('Adobe Illustrator 3–8 artwork', () => {
  it('reads AI 3 paths, a compound path and custom colours without its procset', () => {
    const result = ok(AI3);
    expect(result.illustrator).toBe(true);
    const drawn = paths(result.svg);
    expect(drawn).toHaveLength(3);
    expect(drawn[0]).toContain('fill="#000000"');
    // The compound path is one filled shape holding both rings.
    expect(drawn[1]).toContain('fill="#ff0000"');
    expect(drawn[1]?.match(/M/g)).toHaveLength(2);
    // A 50 % tint of process cyan, on the stroke only.
    expect(drawn[2]).toContain('fill="none"');
    expect(drawn[2]).toContain('stroke="#80ffff"');
    expect(drawn[2]).toContain('stroke-width="2"');
    // v: the first control point is the current point (100, 50 → y 50 flipped).
    expect(drawn[2]).toContain('d="M100 50 C100 50 120 40 140 40"');
    expect(result.notes).toEqual([
      '1 text item was skipped. Convert text to outlines before saving the file.',
    ]);
  });

  it('reads AI 8 RGB colour, even-odd compounds, gradients and placed images', () => {
    const result = ok(AI8);
    const drawn = paths(result.svg);
    expect(drawn).toHaveLength(2);
    expect(drawn[0]).toContain('fill="#0000ff" fill-rule="evenodd"');
    expect(drawn[1]).toContain('fill="#ff0000" fill-rule="nonzero"');
    // y: the second control point is the end point.
    expect(drawn[1]).toContain('C30 60 50 90 50 90');
    expect(result.notes).toEqual([
      'Gradient fills were imported as a solid colour.',
      'Placed or embedded images were skipped.',
    ]);
  });

  it('imports an AI 8 compound as a shape with a hole', () => {
    const result = ok(AI8);
    const parsed = parseSvg({ svgText: result.svg, id: 'ai', source: 'logo.ai' });
    const object = parsed.object;
    if (object === null || object.kind !== 'imported-svg') throw new Error('no artwork');
    const blue = object.paths.find((p) => p.color === '#0000ff');
    expect(blue?.polylines).toHaveLength(2);
    expect(blue?.fillRule).toBe('evenodd');
  });
});
