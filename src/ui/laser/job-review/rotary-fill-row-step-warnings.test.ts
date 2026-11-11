import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../../core/devices';
import type { FillGroup, Job } from '../../../core/job';
import { detectRotaryRowStepWarnings } from './rotary-row-step-warnings';

// Rolling audit v14 Z3-P2-1 / Z3-P3-4 (ADR-315 Amendment 3): a 0° Fill's
// hatch rows run round the part like an image's rows, so they meet the same
// step grid. A 30 mm tall square filled at 0° in the Creality chuck
// (40 mm per turn); the refuter's table, own reader and step model.

const chuck = (objectDiameterMm: number): RotarySetup => ({
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm,
});

function fillJob(spacingMm: number, rows = Math.round(30 / spacingMm)): Job {
  const segments = Array.from({ length: rows }, (_, i) => ({
    polyline: [
      { x: 0, y: 20 + i * spacingMm },
      { x: 30, y: 20 + i * spacingMm },
    ],
    closed: false,
    reverse: i % 2 === 1,
  }));
  const fill = {
    kind: 'fill',
    layerId: 'operation-name-fill',
    color: '#00ff00',
    power: 50,
    speed: 3000,
    passes: 1,
    airAssist: false,
    overscanMm: 0,
    segments,
  } as unknown as FillGroup;
  return { groups: [fill] };
}

function project(rotary: RotarySetup) {
  return {
    device: { ...DEFAULT_DEVICE_PROFILE, rotary },
    scene: { layers: [{ id: 'operation-name-fill', name: 'Name fill' }] as never },
  };
}

describe('rotary Fill hatch rows against the steps (ADR-315 Amd 3)', () => {
  it.each([
    [150, 0.1, 96, 300],
    [80, 0.05, 218, 600],
    [120, 0.1, 45, 300],
  ])(
    'Ø%i, %f mm hatch: %i of %i rows burn twice, and Job Review says so',
    (d, hatch, doubled, rows) => {
      const [warning, ...rest] = detectRotaryRowStepWarnings(project(chuck(d)), fillJob(hatch), {
        stepsPerMmY: 80,
      });
      expect(rest).toEqual([]);
      expect(warning).toMatch(/^Fill layer Name fill on this rotary: one Y step/);
      expect(warning).toContain(
        `so ${doubled} of its ${rows} rows land on the row before and burn twice`,
      );
      expect(warning).toContain('Interval');
      expect(warning).not.toContain('line interval');
    },
  );

  it('names the Interval that lands evenly, and that Interval is silent when typed', () => {
    // Ø80 at the default 0.1 mm hatch: gaps of 1 and 2 steps (banding).
    const [warning] = detectRotaryRowStepWarnings(project(chuck(80)), fillJob(0.1), {
      stepsPerMmY: 80,
    });
    expect(warning).toContain('so its rows land 0.0785 or 0.1571 mm apart and band');
    const offered = [...(warning ?? '').matchAll(/(\d+\.\d{4}) mm \(\d/g)].map((m) => Number(m[1]));
    expect(offered.length).toBeGreaterThan(0);
    for (const interval of offered) {
      expect(
        detectRotaryRowStepWarnings(project(chuck(80)), fillJob(interval), { stepsPerMmY: 80 }),
      ).toEqual([]);
    }
  });

  it('ignores a Fill whose hatch is not along X', () => {
    const diagonal = fillJob(0.1);
    const group = diagonal.groups[0] as FillGroup;
    const turned: Job = {
      groups: [
        {
          ...group,
          segments: group.segments.map((segment) => ({
            ...segment,
            polyline: [segment.polyline[0] ?? { x: 0, y: 0 }, { x: 30, y: 50 }],
          })),
        },
      ],
    };
    expect(detectRotaryRowStepWarnings(project(chuck(150)), turned, { stepsPerMmY: 80 })).toEqual(
      [],
    );
  });
});
