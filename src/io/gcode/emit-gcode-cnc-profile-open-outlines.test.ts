// ADR-672 (meta audit v1 M6-P1-2): an outline drawn as open paths on a CNC
// Outside or Inside profile used to be cut on its line, so the part came out
// one cut width small (a hole one cut width large), with no warning that said
// so. These compile real SVG and DXF artwork through emitGcode and read the
// emitted cut back.

import { describe, expect, it } from 'vitest';
import { parseDxf } from '../dxf/parse-dxf';
import { parseSvg } from '../svg/parse-svg';
import { cncOmissionProject } from '../../__fixtures__/cnc-open-contours';
import type { CncCutType, ImportedSvg, Project } from '../../core/scene';
import { emitGcode } from './emit-gcode';

const ON_LINE = 'cnc-profile-open-path-on-line';
const CLOSED = 'cnc-profile-outline-closed';
// The shipped 1/8" end mill: its cut width at the fixture's 1 mm depth.
const CUT_WIDTH_MM = 3.175;
const HALF = CUT_WIDTH_MM / 2;

function svgArt(id: string, d: string): ImportedSvg {
  const parsed = parseSvg({
    id,
    source: `${id}.svg`,
    svgText: `<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="${d}" fill="none" stroke="#000000"/></svg>`,
  });
  if (parsed.object === null) throw new Error('svg empty');
  return parsed.object as ImportedSvg;
}

/** A 40 × 30 mm rectangle of four LINEs whose last corner misses by `gap`. */
function dxfRectangle(gap: number): ImportedSvg {
  const line = (x1: number, y1: number, x2: number, y2: number): string =>
    `0\nLINE\n8\n0\n62\n7\n10\n${x1}\n20\n${y1}\n11\n${x2}\n21\n${y2}\n`;
  const dxfText =
    '0\nSECTION\n2\nENTITIES\n' +
    line(10, 10, 50, 10) +
    line(50, 10, 50, 40) +
    line(50, 40, 10, 40) +
    line(10, 40, 10, 10 + gap) +
    '0\nENDSEC\n0\nEOF\n';
  const parsed = parseDxf({ dxfText, id: `dxf-${gap}`, source: `plate-${gap}.dxf` });
  if (parsed.kind !== 'ok' || parsed.object === null) throw new Error('dxf empty');
  return parsed.object as ImportedSvg;
}

function project(objects: ReadonlyArray<ImportedSvg>, cutType: CncCutType): Project {
  const base = cncOmissionProject(objects, cutType);
  return {
    ...base,
    device: { ...base.device, origin: 'front-left', bedWidth: 400, bedHeight: 400 },
  };
}

function cut(objects: ReadonlyArray<ImportedSvg>, cutType: CncCutType) {
  const result = emitGcode(project(objects, cutType));
  let minX = Infinity;
  let maxX = -Infinity;
  for (const line of result.gcode.split('\n')) {
    if (!/^G0?1\b/.test(line)) continue;
    const x = /X(-?\d+(\.\d+)?)/.exec(line);
    if (x === null) continue;
    minX = Math.min(minX, Number(x[1]));
    maxX = Math.max(maxX, Number(x[1]));
  }
  return { minX, maxX, issues: result.preflight.issues };
}

const CLOSED_RECTANGLE = 'M10 10 H50 V40 H10 Z';

describe('CNC Outside and Inside profiles close near-closed outlines (ADR-672)', () => {
  it('cuts an SVG outline open by 0.05 mm outside its line, as the closed one', () => {
    const closed = cut([svgArt('closed', CLOSED_RECTANGLE)], 'profile-outside');
    const open = cut([svgArt('open', 'M10 10 H50 V40 H10 V10.05')], 'profile-outside');
    expect(closed.minX).toBeCloseTo(10 - HALF, 2);
    expect(closed.maxX).toBeCloseTo(50 + HALF, 2);
    expect(open.minX).toBeCloseTo(closed.minX, 2);
    expect(open.maxX).toBeCloseTo(closed.maxX, 2);
    expect(open.issues.map((issue) => issue.code)).toContain(CLOSED);
    expect(open.issues.map((issue) => issue.code)).not.toContain(ON_LINE);
    expect(closed.issues.map((issue) => issue.code)).not.toContain(CLOSED);
  });

  it('cuts an Inside hole open by 0.05 mm inside its line, so the hole keeps its size', () => {
    const open = cut([svgArt('open', 'M10 10 H50 V40 H10 V10.05')], 'profile-inside');
    expect(open.minX).toBeCloseTo(10 + HALF, 2);
    expect(open.maxX).toBeCloseTo(50 - HALF, 2);
    const notice = open.issues.find((issue) => issue.code === CLOSED);
    expect(notice?.message).toContain('cut inside its line as a closed shape');
  });

  // DXF import already joins LINEs whose ends meet exactly (ADR-626 Amd 8), so
  // the plate is one chain open at its last corner. Import also moves it to the
  // origin, so widths are compared, not positions.
  it.each([0.01, 0.2, 0.45])(
    'joins a DXF plate of four LINEs whose corner misses by %s mm',
    (gap) => {
      const plate = cut([dxfRectangle(gap)], 'profile-outside');
      expect(plate.maxX - plate.minX).toBeCloseTo(40 + CUT_WIDTH_MM, 2);
      expect(plate.issues.map((issue) => issue.code)).toContain(CLOSED);
      expect(plate.issues.map((issue) => issue.code)).not.toContain(ON_LINE);
    },
  );

  it('cuts a wider gap on its line and says the part comes out one cut width small', () => {
    const open = cut([svgArt('open', 'M10 10 H50 V40 H10 V11')], 'profile-outside');
    expect(open.minX).toBeCloseTo(10, 2);
    expect(open.maxX).toBeCloseTo(50, 2);
    const warning = open.issues.find((issue) => issue.code === ON_LINE);
    expect(warning?.message).toBe(
      'Layer "pocket-main": 1 open path is cut on its line, not outside it: only a closed ' +
        'shape has an outside. A part it outlines comes out 3.17 mm smaller than drawn (one ' +
        'cut width). Close the outline with Tools > Join paths, or choose On path for this layer.',
    );
  });

  it('says an Inside hole cut on its line comes out one cut width large', () => {
    const open = cut([dxfRectangle(2)], 'profile-inside');
    expect(open.maxX - open.minX).toBeCloseTo(40, 2);
    const warning = open.issues.find((issue) => issue.code === ON_LINE);
    expect(warning?.message).toContain('1 open path is cut on its line, not inside it');
    expect(warning?.message).toContain('A hole it outlines comes out 3.17 mm larger');
    const twoOpen = cut(
      [svgArt('two', 'M10 10 H50 V40 H10 V12 M60 10 H90 V40 H60 V12')],
      'profile-inside',
    );
    expect(twoOpen.issues.find((issue) => issue.code === ON_LINE)?.message).toContain(
      '2 open paths are cut on their line, not inside them',
    );
  });

  it('leaves On path layers and open lines that close nothing alone', () => {
    const onPath = cut([svgArt('open', 'M10 10 H50 V40 H10 V10.05')], 'profile-on-path');
    expect(onPath.minX).toBeCloseTo(10, 2);
    expect(onPath.issues.map((issue) => issue.code)).not.toContain(CLOSED);
    expect(onPath.issues.map((issue) => issue.code)).not.toContain(ON_LINE);
    const line = cut([svgArt('line', 'M10 10 H50')], 'profile-outside');
    expect(line.issues.find((issue) => issue.code === ON_LINE)?.message).toContain(
      '1 open path is cut on its line',
    );
  });
});
