import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSvg } from '../svg/parse-svg';
import { convertPostscript } from './convert-postscript';
import { PS_LIMITS, PS_STEP_MESSAGE, psTimeMessage } from './ps-budget';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const golden = (name: string): Uint8Array =>
  readFileSync(fileURLToPath(new URL('../vector-formats/__golden__/' + name, import.meta.url)));

function ok(text: string | Uint8Array) {
  const result = convertPostscript(typeof text === 'string' ? bytes(text) : text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result;
}

function pathData(svg: string): string[] {
  return [...svg.matchAll(/ d="([^"]*)"/g)].map((m) => m[1] ?? '');
}

const EPS = (body: string, box = '0 0 100 100'): string =>
  `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: ${box}\n%%EndComments\n${body}\nshowpage\n%%EOF\n`;

describe('EPS written by KerfDesk itself (round trip)', () => {
  it('reads the sample artwork golden back as its filled and stroked paths', () => {
    const result = ok(golden('sample-artwork.eps'));
    expect(result.illustrator).toBe(false);
    expect(result.notes).toEqual([]);
    // The HiResBoundingBox, 85.323 × 107.6799 pt, in millimetres.
    expect(result.svg).toContain('width="30.100058mm" height="37.987076mm"');
    expect(result.svg).toContain('fill="#1a2b3c" fill-rule="evenodd"');
    expect(result.svg).toContain('stroke="#ff0000"');
    // First point: 0.1418 + 5 × 2.8346… pt, flipped against the 107.6799 pt top.
    expect(pathData(result.svg)[0]).toMatch(/^M14\.315028 0\.14188 /);
    expect(result.pathCount).toBe(5);
  });

  it('imports through the SVG importer at the size the EPS declares', () => {
    const result = ok(golden('sample-artwork.eps'));
    const parsed = parseSvg({ svgText: result.svg, id: 'eps', source: 'sample-artwork.eps' });
    const object = parsed.object;
    if (object === null || object.kind !== 'imported-svg') throw new Error('no artwork');
    expect(object.bounds.maxX - object.bounds.minX).toBeCloseTo(30, 0);
    expect(object.paths.map((p) => p.color).sort()).toEqual(['#1a2b3c', '#ff0000']);
  });

  it('reads the traced-page golden', () => {
    expect(ok(golden('traced-image-page.eps')).pathCount).toBeGreaterThan(0);
  });
});

describe('artwork with no height or width (audit C2 D1-P2-4)', () => {
  const PS = (body: string, box = ''): string =>
    `%!PS-Adobe-3.0\n${box === '' ? '' : `%%BoundingBox: ${box}\n`}${body}\nshowpage\n`;

  function imported(text: string) {
    const result = ok(text);
    const parsed = parseSvg({ svgText: result.svg, id: 'ps', source: 'rule.ps' });
    if (parsed.object === null || parsed.object.kind !== 'imported-svg')
      throw new Error('nothing imported from ' + result.svg);
    return { svg: result.svg, object: parsed.object };
  }

  it('imports a horizontal rule, its viewBox as tall as the minimum 1 pt', () => {
    const { svg, object } = imported(PS('1 setlinewidth 10 50 moveto 90 50 lineto stroke'));
    expect(svg).toContain('viewBox="0 0 80 1"');
    expect(object.bounds.maxX - object.bounds.minX).toBeCloseTo(80 * (25.4 / 72), 3);
  });

  it('imports a vertical rlineto rule', () => {
    const { svg } = imported(PS('20 10 moveto 0 60 rlineto stroke'));
    expect(svg).toContain('viewBox="0 0 1 60"');
  });

  it('imports two collinear horizontal rules as two paths', () => {
    const { object } = imported(PS('0 0 moveto 30 0 lineto stroke 50 0 moveto 80 0 lineto stroke'));
    expect(object.paths.length).toBe(2);
  });

  it('makes a thick rule’s canvas as tall as its stroke', () => {
    const { svg } = imported(PS('10 setlinewidth 0 20 moveto 72 20 lineto stroke'));
    expect(svg).toContain('viewBox="0 0 72 10"');
    expect(svg).toContain('height="3.527778mm"');
  });

  it('imports a rule whose declared BoundingBox is itself zero-height', () => {
    const { svg } = imported(PS('0 30 moveto 72 30 lineto stroke', '0 30 72 30'));
    expect(svg).toContain('viewBox="0 0 72 1"');
  });

  it('leaves artwork with both dimensions unchanged', () => {
    expect(ok(PS('0 0 moveto 72 36 lineto stroke')).svg).toContain('viewBox="0 0 72 36"');
  });
});

describe('PostScript language subset', () => {
  it('runs procedures, loops and transforms', () => {
    const result = ok(
      EPS(
        '/sq { newpath 0 0 moveto 10 0 rlineto 0 10 rlineto -10 0 rlineto closepath fill } bind def\n' +
          '0 1 2 { gsave 20 mul 0 translate sq grestore } for',
      ),
    );
    const d = pathData(result.svg);
    expect(d).toHaveLength(3);
    expect(d[2]).toBe('M40 100 L50 100 L50 90 L40 90 Z');
  });

  it('draws a full circle with arc as four quarter Béziers', () => {
    const d = pathData(ok(EPS('newpath 50 50 40 0 360 arc closepath stroke')).svg);
    expect(d[0]?.match(/C/g)).toHaveLength(4);
    expect(d[0]).toMatch(/^M90 50 /);
  });

  it('keeps colours per paint and converts CMYK', () => {
    const svg = ok(
      EPS('0 1 1 0 setcmykcolor 0 0 10 10 rectfill 0 0 1 setrgbcolor 20 20 10 10 rectstroke'),
    ).svg;
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('stroke="#0000ff"');
  });

  it('applies rotate and scale to path points and line widths', () => {
    const svg = ok(
      EPS('50 50 translate 90 rotate 2 2 scale 3 setlinewidth 0 0 moveto 10 0 lineto stroke'),
    ).svg;
    expect(pathData(svg)[0]).toBe('M50 50 L50 30');
    expect(svg).toContain('stroke-width="6"');
  });

  it('reads an Inkscape/cairo style prolog with feature probes', () => {
    const prolog =
      '%%BeginProlog\n50 dict begin\n/q { gsave } bind def /Q { grestore } bind def\n' +
      '/cm { 6 array astore concat } bind def /m { moveto } bind def /l { lineto } bind def\n' +
      '/h { closepath } bind def /f { fill } bind def /rg { setrgbcolor } bind def\n' +
      '/re { exch dup neg 3 1 roll 5 3 roll moveto 0 rlineto 0 exch rlineto 0 rlineto closepath } bind def\n' +
      '/pdfmark where { pop globaldict /?pdfmark /exec load put }\n' +
      '{ globaldict begin /?pdfmark /pop load def /pdfmark /cleartomark load def end } ifelse\n' +
      '/BDC { mark 3 1 roll /BDC pdfmark } bind def\n%%EndProlog\n';
    const body = 'q 0 0 100 100 rectclip 1 0 0 -1 0 100 cm 0 1 0 rg 10 10 30 20 re f Q';
    const result = ok(EPS(prolog + body));
    expect(pathData(result.svg)[0]).toBe('M10 10 L40 10 L40 30 L10 30 Z');
    expect(result.svg).toContain('fill="#00ff00"');
    expect(result.notes).toContain('Clipping masks are ignored; the full shapes were imported.');
  });

  it('skips text and an embedded encrypted font, and says so', () => {
    const font = 'currentfile eexec\nA1B2C3D4E5F6\n' + '0'.repeat(64) + '\ncleartomark\n';
    const result = ok(
      EPS(
        `mark ${font}/Helvetica findfont 12 scalefont setfont 10 10 moveto (Hi) show 0 0 5 5 rectfill`,
      ),
    );
    expect(result.notes[0]).toMatch(/^1 text item was skipped/);
    expect(pathData(result.svg)).toHaveLength(1);
  });

  it('refuses embedded images and unknown operators with a reason', () => {
    const image = convertPostscript(bytes(EPS('1 1 8 [1 0 0 1 0 0] {<ff>} image')));
    expect(image).toEqual({ kind: 'error', reason: expect.stringMatching(/embedded image/) });
    const unknown = convertPostscript(bytes(EPS('0 0 moveto frobnicate')));
    expect(unknown).toEqual({ kind: 'error', reason: expect.stringMatching(/"frobnicate"/) });
  });

  it('stops a file that loops forever instead of hanging', () => {
    const looping = convertPostscript(bytes(EPS('{ 1 pop } loop')));
    expect(looping).toEqual({ kind: 'error', reason: expect.stringMatching(/loop forever/) });
  });

  describe('bounds every run in work and time (ADR-700 Amd 2, 3)', () => {
    const stepLimit = { kind: 'error', reason: PS_STEP_MESSAGE };
    const anyLimit = { kind: 'error', reason: expect.any(String) };
    const timed = (program: string) => {
      const started = performance.now();
      const result = convertPostscript(bytes(program));
      return { result, ms: performance.now() - started };
    };
    const PATH = (points: number): string => `0 0 moveto 1 1 ${points} { dup lineto } for `;
    const DICT = (entries: number): string =>
      `/a 1 dict def /b 1 dict def 0 1 ${entries} { a exch 0 put } for `;

    it.each([
      EPS('{} loop'),
      EPS('{ {} loop } stopped pop'),
      EPS('1e15 {} repeat'),
      EPS('{ 100000 array pop } loop'),
      EPS('/s 100000 string def { s 0 100000 getinterval pop } loop'),
      '%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator(R) 8.0\n%%EndProlog\n{} loop\n',
    ])('ends step-bound program %# with the step limit', (program) => {
      const { result, ms } = timed(program);
      expect(result).toEqual(stepLimit);
      expect(ms).toBeLessThan(PS_LIMITS.milliseconds);
    });

    it.each([
      EPS(PATH(200_000) + '{ pathbbox clear } loop'),
      EPS(PATH(200_000) + '{ gsave grestore } loop'),
      EPS(PATH(50_000) + '{ gsave stroke grestore } loop'),
      EPS(PATH(300_000) + '{ gsave } loop'),
      EPS(DICT(50_000) + '{ a b copy pop } loop'),
      EPS(DICT(50_000) + '{ a { pop pop exit } forall } loop'),
      EPS('0 1 99980 {} for { 99980 1 roll } loop'),
      EPS('/a 99000 array def { a aload clear } loop'),
      EPS('/a 99000 array def /b 99000 array def { b 0 a putinterval } loop'),
    ])('ends size-bound program %# with a limit, well inside the time limit', (program) => {
      const { result, ms } = timed(program);
      expect(result).toEqual(anyLimit);
      expect(ms).toBeLessThan(PS_LIMITS.milliseconds);
    });

    it('caps the entries of one dictionary', () => {
      expect(convertPostscript(bytes(EPS(DICT(150_000))))).toEqual({
        kind: 'error',
        reason: expect.stringMatching(/dictionary is too large/),
      });
    });

    it('still reads a file that fills and then strokes one large path', () => {
      const program = EPS(PATH(1_000_000) + 'gsave fill grestore stroke');
      const result = convertPostscript(bytes(program), { milliseconds: 60_000 });
      expect(result.kind).toBe('ok');
    });

    it('ends a run that outlasts its time limit with its own message', () => {
      const program = bytes(EPS('2000000 { 1 pop } repeat 0 0 moveto 1 1 lineto stroke'));
      expect(convertPostscript(program).kind).toBe('ok');
      let now = 0;
      const clock = (): number => (now += 1_000);
      expect(convertPostscript(program, { clock })).toEqual({
        kind: 'error',
        reason: psTimeMessage(PS_LIMITS.milliseconds),
      });
      expect(convertPostscript(program, { clock, milliseconds: 30_000 })).toEqual({
        kind: 'error',
        reason: psTimeMessage(30_000),
      });
    });
  });

  it('rejects files that are not PostScript', () => {
    expect(convertPostscript(bytes('%PDF-1.4'))).toMatchObject({ kind: 'error' });
  });

  it('reads the PostScript section of a DOS EPS file with a preview', () => {
    const ps = bytes(EPS('0 0 10 10 rectfill'));
    const preview = new Uint8Array(16).fill(7);
    const header = new Uint8Array(30);
    header.set([0xc5, 0xd0, 0xd3, 0xc6]);
    const view = new DataView(header.buffer);
    view.setUint32(4, 30 + preview.length, true);
    view.setUint32(8, ps.length, true);
    const file = new Uint8Array([...header, ...preview, ...ps]);
    expect(pathData(ok(file).svg)).toEqual(['M0 100 L10 100 L10 90 L0 90 Z']);
  });
});
