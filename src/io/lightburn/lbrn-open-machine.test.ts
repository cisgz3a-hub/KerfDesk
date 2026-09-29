import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import type { SceneObject } from '../../core/scene';
import { importLightBurnProject } from './lbrn-import';

// A LightBurn project carries no KerfDesk machine, so it opens on the machine
// already open in KerfDesk, and that machine's bed places it (ADR-388).
const MY_MACHINE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'my-diode',
  name: 'My 300x200 diode',
  bedWidth: 300,
  bedHeight: 200,
};

// A 10 mm circle 50 mm right of and 50 mm in from a front-left origin.
const COASTER = `<LightBurnProject AppVersion="1.7.08" FormatVersion="1">
  <Shape Type="Ellipse" CutIndex="0" Rx="5" Ry="5"><XForm>1 0 0 1 50 50</XForm></Shape>
</LightBurnProject>`;

describe('the machine a LightBurn project opens on', () => {
  it('is the machine it is opened on, whose bed places the artwork', () => {
    const result = importLightBurnProject(COASTER, 'coaster.lbrn2', undefined, MY_MACHINE);
    if (!result.ok) throw new Error(result.reason);
    expect(result.project.device).toBe(MY_MACHINE);
    expect(result.project.workspace).toMatchObject({ width: 300, height: 200 });
    // 50 mm in from the front of a 200 mm deep bed.
    const centre = centreOf(result.project.scene.objects[0]);
    expect(centre.x).toBeCloseTo(50, 6);
    expect(centre.y).toBeCloseTo(150, 6);
  });
});

function centreOf(object: SceneObject | undefined): { readonly x: number; readonly y: number } {
  if (object?.kind !== 'imported-svg') throw new Error('circle missing');
  return {
    x: (object.bounds.minX + object.bounds.maxX) / 2,
    y: (object.bounds.minY + object.bounds.maxY) / 2,
  };
}
