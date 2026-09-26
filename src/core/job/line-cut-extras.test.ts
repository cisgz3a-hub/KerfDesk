import { describe, expect, it } from 'vitest';
import { planRdMotion } from '../controllers/ruida/rd-motion-plan';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type Layer,
  type LayerOperationSettings,
  type SceneObject,
} from '../scene';
import { compileJob } from './compile-job';
import type { CutGroup, Job } from './job';
import { buildToolpath } from './toolpath';

const DEVICE = DEFAULT_DEVICE_PROFILE;

function squareObject(size = 10): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 10, minY: 10, maxX: 10 + size, maxY: 10 + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 10, y: 10 },
              { x: 10 + size, y: 10 },
              { x: 10 + size, y: 10 + size },
              { x: 10, y: 10 + size },
            ],
          },
        ],
      },
    ],
  };
}

function compileWith(settings: Partial<LayerOperationSettings>): Job {
  const layer: Layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), ...settings };
  return compileJob({ objects: [squareObject()], layers: [layer] }, DEVICE);
}

function cutGroup(job: Job): CutGroup {
  const group = job.groups[0];
  if (group?.kind !== 'cut') throw new Error('Expected one cut group.');
  return group;
}

describe('Line perforation and overcut (ADR-415)', () => {
  it('compiles byte-identically while perforation and overcut are off', () => {
    const baseline = compileWith({});
    const explicitOff = compileWith({
      perforationEnabled: false,
      perforationCutMm: 2,
      perforationSkipMm: 2,
      overcutMm: 0,
    });
    expect(explicitOff).toEqual(baseline);
    expect(grblStrategy.emit(explicitOff, DEVICE)).toBe(grblStrategy.emit(baseline, DEVICE));
    expect(cutGroup(baseline)).not.toHaveProperty('finalPassOvercutMm');
  });

  it('cuts a perforated square as dashes with a full gap before its start', () => {
    const group = cutGroup(
      compileWith({ perforationEnabled: true, perforationCutMm: 3, perforationSkipMm: 1 }),
    );
    expect(group.segments).toHaveLength(10);
    expect(group.segments.every((segment) => !segment.closed)).toBe(true);
    expect(group).not.toHaveProperty('finalPassOvercutMm');
  });

  it('perforates the pieces tabs leave, so tab gaps stay uncut', () => {
    const tabbed = cutGroup(compileWith({ tabsEnabled: true, tabSizeMm: 2, tabsPerShape: 4 }));
    const both = cutGroup(
      compileWith({
        tabsEnabled: true,
        tabSizeMm: 2,
        tabsPerShape: 4,
        perforationEnabled: true,
        perforationCutMm: 3,
        perforationSkipMm: 1,
      }),
    );
    // Each 8 mm tab-to-tab piece becomes dashes at 0-3 and 4-7 plus 8 (empty).
    expect(tabbed.segments).toHaveLength(4);
    expect(both.segments).toHaveLength(8);
  });

  it('overcuts closed contours on the final pass only', () => {
    const job = compileWith({ overcutMm: 2, passes: 2 });
    const group = cutGroup(job);
    expect(group.finalPassOvercutMm).toBe(2);
    const gcode = grblStrategy.emit(job, DEVICE);
    expect(gcode).toContain('passes 2 overcut 2.000 mm on final pass');
    const passes = gcode.split('; pass ').slice(1);
    const burnLines = (text: string): string[] =>
      text.split('\n').filter((line) => line.startsWith('G1 ') && !line.includes('S0'));
    expect(burnLines(passes[1] ?? '').length).toBe(burnLines(passes[0] ?? '').length + 1);
  });

  it('gives the preview route and the Ruida plan the same final-pass overcut', () => {
    const job = compileWith({ overcutMm: 2, passes: 2 });
    const cuts = buildToolpath(job).steps.filter((step) => step.kind === 'cut');
    expect(cuts).toHaveLength(2);
    expect(cuts[1]?.polyline.length).toBe((cuts[0]?.polyline.length ?? 0) + 1);
    const [part] = planRdMotion([cutGroup(job)]);
    const burns = part?.steps.filter((step) => step.cut) ?? [];
    // 4 edges on pass one, 4 plus the 2 mm overcut on the final pass.
    expect(burns).toHaveLength(9);
  });

  it('does not overcut shapes that tabs or perforation opened', () => {
    expect(
      cutGroup(compileWith({ overcutMm: 2, tabsEnabled: true, tabSizeMm: 2 })),
    ).not.toHaveProperty('finalPassOvercutMm');
    expect(cutGroup(compileWith({ overcutMm: 2, perforationEnabled: true }))).not.toHaveProperty(
      'finalPassOvercutMm',
    );
  });
});
