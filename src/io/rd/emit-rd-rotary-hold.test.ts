// Code quality audit C2 verify E1-P3-2 (ADR-127 Amendment 7): on a k > 1
// roller a stroke round the part needs more feed than the Max feed, so it is
// held there and burns more than the set dose. The .rd advisory put that on
// the speed classes ("98–367 %"); it now names the Max feed and the speed to
// set, as the G-code warning does.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitRdFile } from './emit-rd';

/** A pen in a roller: 360 mm per turn on Ø25 rollers, k = 4.58. */
function penRollerProject(): Project {
  return {
    ...createProject(),
    device: {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'ruida',
      maxFeed: 1500,
      rotary: {
        enabled: true,
        type: 'roller',
        mmPerRotation: 360,
        objectDiameterMm: 12,
        rollerDiameterMm: 25,
      },
    },
    scene: {
      layers: [
        {
          ...createLayer({ id: '#000000', color: '#000000', mode: 'line' }),
          name: 'Pen',
          speed: 1000,
        },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'round',
          source: 'round.svg',
          bounds: { minX: 10, minY: 10, maxX: 10, maxY: 30 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 10, y: 10 },
                    { x: 10, y: 30 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('Ruida rotary Max-feed hold advisory (ADR-127 Amd 7)', () => {
  it('names the Max feed and the speed to set, not the speed classes', () => {
    const result = emitRdFile(penRollerProject());
    if (!result.ok) throw new Error(result.messages.join(' '));
    const messages = result.advisories
      .filter((issue) => issue.code === 'rotary-rd-speed-classes')
      .map((issue) => issue.message);
    // 1000 mm/min round the part needs 4,584 mm/min; held at 1,500 the
    // surface moves at 327 mm/min, so the stroke burns 306 % of the set dose.
    const k = 360 / (Math.PI * 25);
    const rise = (1000 * k) / 1500;
    expect(messages).toEqual([
      'Layer Pen: on this rotary its strokes round the part need more feed than the Max ' +
        'feed (1500 mm/min), so they are held there and burn up to ' +
        `${Math.round(rise * 100)} % of the energy you set. For an even burn, set this layer ` +
        `to ${Math.floor(1000 / rise)} mm/min or less.`,
    ]);
    expect(messages.join(' ')).not.toContain('a few surface speeds');
  });
});
