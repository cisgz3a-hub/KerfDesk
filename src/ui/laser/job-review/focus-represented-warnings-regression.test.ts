import { expect, it } from 'vitest';
import type { CutGroup } from '../../../core/job';
import { createProject } from '../../../core/scene';
import { grblStrategy } from '../../../core/output/grbl-strategy';
import { compiledFocusTestWarnings } from './focus-test-warnings';
it('warns only for focus samples whose represented burn emits a Z pair', () => {
  const project = createProject();
  const collapsed: CutGroup = {
    kind: 'cut',
    layerId: 'collapsed',
    color: '#000000',
    power: 10,
    speed: 1200,
    passes: 2,
    airAssist: false,
    focusTest: { offsetMm: 99, travelFeedMmPerMin: 300 },
    segments: [0, 20].map((x) => ({
      closed: false,
      polyline: [
        { x, y: 0 },
        { x: x + 0.0001, y: 0 },
      ],
    })),
  };
  const empty = { job: { groups: [collapsed] }, project };
  expect(grblStrategy.emit(empty.job, project.device)).not.toContain('G1 Z');
  expect(compiledFocusTestWarnings(empty)).toEqual([]);
  const represented: CutGroup = {
    ...collapsed,
    layerId: 'real',
    focusTest: { offsetMm: 1, travelFeedMmPerMin: 300 },
    segments: [
      {
        closed: false,
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ],
  };
  const mixed = { job: { groups: [collapsed, represented] }, project };
  expect(grblStrategy.emit(mixed.job, project.device)).not.toContain('Z99');
  expect(
    compiledFocusTestWarnings(mixed).find((value) => value.startsWith('Focus Test moves Z')),
  ).toContain('from 1.000 to 1.000');
});

it('discloses only non-Z details for represented zero-offset Focus samples', () => {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'zero',
    color: '#000000',
    power: 10,
    speed: 1200,
    passes: 1,
    airAssist: false,
    focusTest: { offsetMm: 0, travelFeedMmPerMin: 300 },
    segments: [
      {
        closed: false,
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
    ],
  };
  const project = createProject();
  const job = { groups: [group] };
  expect(grblStrategy.emit(job, project.device)).not.toContain('G1 Z');
  const warnings = compiledFocusTestWarnings({ project, job }).join(' ');
  expect(warnings).not.toMatch(/moves Z|Z travel|controllable Z axis|both Z directions/);
  expect(warnings).toContain('laser-off returns');
  expect(warnings).toContain('Sample labels are operation names, not engraved marks');
});
