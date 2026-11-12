// C2 verification E2-P2-2 (ADR-703 Amendment 2): on a K40 Y-port chuck, Fill
// rows land on whole 1/1000 in steps of machine Y, as a Moshiboard's land on
// mils. With a 40 mm/turn chuck and an Ø80 glass one step turns the part
// 0.16 mm, so 0.1 mm hatch rows share steps and burn twice. The decoded
// stream shows it, and the K40 job and Save .egv now carry the row warning
// Job Review gives G-code, on the K40's grid.
import { describe, expect, it } from 'vitest';
import { LhyDecoder } from '../../../__fixtures__/controllers/lihuiyu-decoder';
import type { RotarySetup } from '../../../core/devices';
import { K40_M2_NANO_PROFILE } from '../../../core/devices/lihuiyu-profiles';
import type { JobPlacementSettings } from '../../../core/job';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../../core/scene';
import { prepareOutput } from '../../../io/gcode';
import { egvPreparationOptions } from '../../../io/egv';
import { emitPreparedEgvWithJobWarnings } from '../../laser/egv-job-warnings';
import { useStore } from '..';
import { linkJobRequest } from '../link-job-request';
import { prepareLihuiyuUsbJob } from './lihuiyu-usb-job';

const CHUCK: RotarySetup = {
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm: 80,
};

function fillProject(rotary: RotarySetup | undefined): Project {
  const square: SceneObject = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'a.svg',
    bounds: { minX: 100, minY: 150, maxX: 120, maxY: 170 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 100, y: 150 },
              { x: 120, y: 150 },
              { x: 120, y: 170 },
              { x: 100, y: 170 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
  const base = createProject({
    ...K40_M2_NANO_PROFILE,
    ...(rotary === undefined ? {} : { rotary }),
  });
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    name: 'Glass fill',
    mode: 'fill' as const,
    hatchSpacingMm: 0.1,
    hatchAngleDeg: 0,
  };
  return { ...base, scene: addLayer(addObject(base.scene, square), layer) };
}

const ABSOLUTE = {
  ...useStore.getState().jobPlacement,
  startFrom: 'absolute',
} as JobPlacementSettings;

/** Burn rows and the distinct machine-Y steps they land on. */
async function burnRows(
  p: Project,
): Promise<{ rows: number; steps: number; advisories: string[] }> {
  const result = await prepareLihuiyuUsbJob(linkJobRequest(p, ABSOLUTE), { x: 0, y: 0 });
  if (!result.ok) throw new Error(result.messages.join(' '));
  const decoder = new LhyDecoder();
  decoder.writeStream(result.job.stream);
  const ys = decoder.moves
    .filter((move) => move.laser && move.from.y === move.to.y)
    .map((move) => move.to.y);
  return { rows: ys.length, steps: new Set(ys).size, advisories: [...result.job.advisories] };
}

const rowWarning = (texts: ReadonlyArray<string>) =>
  texts.find((text) => text.startsWith('Fill layer Glass fill on this rotary'));

describe('K40 Y-chuck fill rows on the 1/1000 in grid', () => {
  it('rows share steps on the chuck, and the K40 job says so', async () => {
    const { rows, steps, advisories } = await burnRows(fillProject(CHUCK));
    expect(steps).toBeLessThan(rows);
    const warning = rowWarning(advisories);
    expect(warning).toContain(
      'one K40 position (1/1000 in, 0.0254 mm of machine Y) turns the part 0.1596 mm',
    );
    expect(warning).toContain('land on the row before and burn twice');
  });

  it('Save .egv carries the same warning', () => {
    const p = fillProject(CHUCK);
    const result = emitPreparedEgvWithJobWarnings(prepareOutput(p, egvPreparationOptions({})));
    if (!result.ok) throw new Error(result.messages.join(' '));
    expect(rowWarning(result.jobWarnings)).toBeDefined();
  });

  it('a flat bed warns nothing of rows', async () => {
    const { advisories } = await burnRows(fillProject(undefined));
    expect(advisories.some((text) => text.includes('on this rotary'))).toBe(false);
  });
});
