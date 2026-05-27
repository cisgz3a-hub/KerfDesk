// End-to-end snapshot tests for the SVG → G-code pipeline (Phase A
// acceptance: "five fixture SVGs produce byte-identical G-code to recorded
// snapshots"). Each fixture flows through:
//   sanitizeSvg → parseSvg → compileJob → grblStrategy.emit
// and asserts byte-identity against a committed snapshot.
//
// First run with VITEST_UPDATE=1 records the snapshots. After that, any
// pipeline change that alters G-code surfaces as a snapshot diff in CI —
// PR description must carry the line
//     Snapshot change acknowledged: <reason>
// (CLAUDE.md "Tests — co-located, written first for bug fixes").

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  collectG1SValues,
  expectedS,
  findLaserOnTravelIssues,
  findOutOfBoundsCoords,
} from '../../core/invariants';
import { compileJob } from '../../core/job';
import { grblStrategy } from '../../core/output';
import { createLayer, EMPTY_SCENE, type SceneObject } from '../../core/scene';
import { parseSvg } from './parse-svg';

import rectangleSingleColor from '../../__fixtures__/svg/rectangle-single-color.svg?raw';
import twoColorPaths from '../../__fixtures__/svg/two-color-paths.svg?raw';
import multiShape from '../../__fixtures__/svg/multi-shape.svg?raw';
import closedPolygon from '../../__fixtures__/svg/closed-polygon.svg?raw';
import zigzag from '../../__fixtures__/svg/zigzag.svg?raw';

const dev = DEFAULT_DEVICE_PROFILE;

function pipeline(svgText: string, id: string): string {
  const result = parseSvg({ svgText, id, source: `${id}.svg` });
  if (result.object === null) throw new Error('no geometry');
  return runPipelineOn(result.object);
}

function runPipelineOn(object: SceneObject): string {
  const colors = object.kind === 'imported-svg' ? object.paths.map((p) => p.color) : [];
  const layers = colors.map((color, i) => createLayer({ id: `L${i + 1}`, color }));
  const scene = { ...EMPTY_SCENE, objects: [object], layers };
  const job = compileJob(scene, dev);
  return grblStrategy.emit(job, dev);
}

const FIXTURES: ReadonlyArray<{ id: string; svg: string }> = [
  { id: 'rectangle-single-color', svg: rectangleSingleColor },
  { id: 'two-color-paths', svg: twoColorPaths },
  { id: 'multi-shape', svg: multiShape },
  { id: 'closed-polygon', svg: closedPolygon },
  { id: 'zigzag', svg: zigzag },
];

describe('Phase A pipeline — fixture snapshots', () => {
  for (const { id, svg } of FIXTURES) {
    it(`${id} produces stable G-code`, () => {
      expect(pipeline(svg, id)).toMatchSnapshot();
    });
  }
});

describe('Phase A pipeline — invariants on every fixture', () => {
  for (const { id, svg } of FIXTURES) {
    it(`${id} — no laser-on-travel issues`, () => {
      const out = pipeline(svg, id);
      expect(findLaserOnTravelIssues(out)).toEqual([]);
    });

    it(`${id} — all coords in bed`, () => {
      const out = pipeline(svg, id);
      expect(
        findOutOfBoundsCoords(out, {
          width: dev.bedWidth,
          height: dev.bedHeight,
        }),
      ).toEqual([]);
    });

    it(`${id} — every G1 S value == expected for default layer power (30%)`, () => {
      const out = pipeline(svg, id);
      const want = expectedS(30, dev.maxPowerS);
      const got = collectG1SValues(out);
      for (const s of got) expect(s).toBe(want);
    });

    it(`${id} — determinism (two runs byte-identical)`, () => {
      expect(pipeline(svg, id)).toBe(pipeline(svg, id));
    });
  }
});
