// Rolling audit v14 Z4-P2-1 (ADR-705 Amendment 2): on a Moshiboard Y-port
// chuck, Fill rows round to whole mils of machine Y. With a 40 mm/turn chuck
// and an Ø80 glass one mil turns the part 0.16 mm, so 0.1 mm hatch rows share
// mils and burn twice. The decoded programs show it, and the job now carries
// the same row-step warning Job Review gives G-code, on the mil grid.
import { describe, expect, it } from 'vitest';
import { decodeMoshiProgram } from '../../../core/controllers/moshi';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../../core/devices';
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
import { useStore } from '..';
import { prepareMoshiUsbJob } from './moshi-usb-job';
import { linkJobRequest } from '../link-job-request';

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
    ...DEFAULT_DEVICE_PROFILE,
    controllerKind: 'moshi',
    origin: 'rear-left',
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

/** Rows of burn per distinct machine-Y mil, from the decoded programs. */
async function burnRows(p: Project): Promise<{ rows: number; mils: number; advisories: string[] }> {
  const result = await prepareMoshiUsbJob(linkJobRequest(p, ABSOLUTE));
  if (!result.ok) throw new Error(result.messages.join(' '));
  const ys: number[] = [];
  for (const bytes of result.job.programs) {
    const decoded = decodeMoshiProgram(bytes);
    if (!decoded.ok) throw new Error(decoded.error);
    let at = decoded.program.steps[0];
    for (const step of decoded.program.steps.slice(1)) {
      if (step.cut && at !== undefined && step.y === at.y) ys.push(step.y);
      at = step;
    }
  }
  return { rows: ys.length, mils: new Set(ys).size, advisories: [...result.job.advisories] };
}

describe('Moshi Y-chuck fill rows on the mil grid', () => {
  it('rows share mils on the chuck, and the job says so with intervals that fit', async () => {
    const { rows, mils, advisories } = await burnRows(fillProject(CHUCK));
    expect(mils).toBeLessThan(rows);
    const warning = advisories.find((text) =>
      text.startsWith('Fill layer Glass fill on this rotary'),
    );
    expect(warning).toContain(
      'one Moshiboard position (1 mil, 0.0254 mm of machine Y) turns the part 0.1596 mm',
    );
    expect(warning).toContain('land on the row before and burn twice');
    expect(warning).toMatch(/set the Interval to|comes closest/);
  });

  it('a flat bed lands every row on its own mil and warns nothing', async () => {
    const { rows, mils, advisories } = await burnRows(fillProject(undefined));
    expect(mils).toBe(rows);
    expect(advisories.some((text) => text.includes('on this rotary'))).toBe(false);
  });
});
