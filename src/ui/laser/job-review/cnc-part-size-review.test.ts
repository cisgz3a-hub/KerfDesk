// Meta audit v1 M6-P1-2, M6-P2-2 and M6-P2-3, through the real Start path:
// prepareCurrentStartJob compiles the job and buildJobReviewModel lists what
// the operator reads. Each case is a CNC job that used to come out the wrong
// size, or cut into a part, with no Job Review line that said so.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCncOmissionReview,
  cncReviewModel,
  cncReviewProject,
  prepareCncOmissionReview,
  resetCncOmissionReview,
} from '../../../__fixtures__/cnc-omission-review';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type Project,
} from '../../../core/scene';
import { parseSvg } from '../../../io/svg/parse-svg';

beforeEach(() => resetCncOmissionReview());
afterEach(() => clearCncOmissionReview());

function svgArt(id: string, d: string): ImportedSvg {
  const parsed = parseSvg({
    id,
    source: `${id}.svg`,
    svgText: `<svg xmlns="http://www.w3.org/2000/svg" width="300mm" height="300mm" viewBox="0 0 300 300"><path d="${d}" fill="none" stroke="#000000"/></svg>`,
  });
  if (parsed.object === null) throw new Error('svg empty');
  return parsed.object as ImportedSvg;
}

function rect(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function part(id: string, color: string, outline: Polyline): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
    paths: [{ color, polylines: [outline] }],
  };
}

async function warnings(project: Project): Promise<ReadonlyArray<string>> {
  const bundle = await prepareCncOmissionReview(project);
  return cncReviewModel(bundle).warnings;
}

describe('CNC parts that come out the wrong size are named in Job Review', () => {
  it('M6-P1-2: an Outside outline open by 0.05 mm is closed and cut outside, and says so', async () => {
    const review = await warnings(
      cncReviewProject([svgArt('open', 'M100 100 H140 V130 H100 V100.05')], 'profile-outside'),
    );
    expect(review).toContain(
      'Layer "pocket-main": 1 outline is drawn as open paths whose ends meet within 0.5 mm; ' +
        'it is closed and cut outside its line as a closed shape.',
    );
    // The gap is closed, so ADR-433 no longer reports a sliver there.
    expect(review.some((line) => line.includes('gap between cut shapes'))).toBe(false);
  });

  it('M6-P1-2: an Outside outline open wider than 0.5 mm warns the part comes out small', async () => {
    const review = await warnings(
      cncReviewProject([svgArt('open', 'M100 100 H140 V130 H100 V105')], 'profile-outside'),
    );
    expect(review.some((line) => line.includes('comes out 3.17 mm smaller than drawn'))).toBe(true);
  });

  it('M6-P2-2: a closed hole under half the bit is named, not dropped', async () => {
    const holes = [
      svgArt('one-mm', 'M150 150 h1 v1 h-1 Z'),
      svgArt('control', 'M200 150 h10 v10 h-10 Z'),
    ];
    const review = await warnings(cncReviewProject(holes, 'pocket'));
    const line = review.find((warning) => warning.startsWith('Layer "pocket-main": 1 area'));
    expect(line).toContain('narrower than the 3.17 mm bit');
    expect(line).toContain('stays uncut; narrowest 1 mm at X 150.5');
  });

  it('M6-P2-3: parts on two profile operations 2.5 mm apart say one cuts into the other', async () => {
    const base = cncReviewProject(
      [part('plate', '#000000', rect(100, 100, 40, 30))],
      'profile-outside',
    );
    const brackets = {
      ...createLayer({ id: 'brackets', color: '#0000ff' }),
      name: 'brackets',
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-outside' as const,
        tabsEnabled: false,
      },
    };
    const project: Project = {
      ...base,
      scene: {
        objects: [...base.scene.objects, part('bracket', '#0000ff', rect(110, 132.5, 20, 10))],
        layers: [...base.scene.layers, brackets],
      },
    };
    const review = await warnings(project);
    expect(
      review.some((line) =>
        /^Layer "pocket-main": its 3\.17 mm cut reaches 1 part that layer "brackets" keeps and cuts up to 0\.6[78] mm into it/.test(
          line,
        ),
      ),
    ).toBe(true);
    expect(review.some((line) => line.startsWith('Layer "brackets": its 3.17 mm cut'))).toBe(true);
  });
});
