import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, Job } from '../job';
import { cncGrblStrategy } from '../output';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncTiling } from '../scene';
import type { CncTileRegistration } from '../scene/machine';
import { tileJobs } from './tile-plan';
import { tileRegistrationPasses } from './tile-registration-passes';
import { resolveTileRegistration } from './tile-registration-plan';

const PLAN: CncTileRegistration = {
  toolId: 'registration-2',
  holeDiameterMm: 3,
  depthMm: 3.7,
  depthPerPassMm: 1.1,
  feedMmPerMin: 543,
  plungeMmPerMin: 123,
  spindleRpm: 9876,
};
const MACHINE = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [
    {
      id: 'registration-2',
      name: '2 mm registration cutter',
      kind: 'end-mill' as const,
      diameterMm: 2,
    },
  ],
};
const TILING: CncTiling = {
  tileWidthMm: 100,
  tileHeightMm: 100,
  overlapMm: 10,
  registrationHoles: true,
  registration: PLAN,
};
const PROFILE: CncGroup = {
  kind: 'cnc',
  layerId: 'profile',
  color: '#000000',
  cutType: 'profile-outside',
  toolId: 'profile-4',
  toolKind: 'end-mill',
  toolName: '4 mm profile cutter',
  toolDiameterMm: 4,
  feedMmPerMin: 999,
  plungeMmPerMin: 456,
  spindleRpm: 12000,
  spindleSpinupSec: 0,
  safeZMm: 4,
  passes: [
    {
      kind: 'contour',
      closed: true,
      zMm: -6,
      polyline: [
        { x: 0, y: 0 },
        { x: 190, y: 0 },
        { x: 190, y: 190 },
        { x: 0, y: 190 },
      ],
    },
  ],
};
const JOB: Job = { groups: [PROFILE] };
const CONTEXT = { machine: MACHINE, device: DEFAULT_DEVICE_PROFILE };

function emittedFloorRadii(gcode: string): Map<number, number[]> {
  let x = 0,
    y = 0,
    z = 0;
  const floors = new Map<number, number[]>();
  for (const line of gcode.split(/\r?\n/)) {
    const words = new Map(
      [...line.matchAll(/([XYZIJ])(-?\d+(?:\.\d+)?)/g)].map((match) => [
        match[1],
        Number(match[2]),
      ]),
    );
    if (/^G[23]\s/.test(line)) {
      const radius = Math.hypot(words.get('I') ?? 0, words.get('J') ?? 0);
      expect(x + (words.get('I') ?? 0)).toBeCloseTo(10, 3);
      expect(y + (words.get('J') ?? 0)).toBeCloseTo(10, 3);
      const rings = floors.get(z) ?? [0];
      rings.push(radius);
      floors.set(z, rings);
    }
    x = words.get('X') ?? x;
    y = words.get('Y') ?? y;
    z = words.get('Z') ?? z;
  }
  return floors;
}

describe('owned registration plan and per-file order (O3/O5)', () => {
  it('uses the saved registration cutter/feeds and orders it before profiles in every tile', () => {
    const result = tileJobs(JOB, TILING, CONTEXT);
    if (result.kind !== 'ready') throw new Error(result.kind);
    expect(result.tiles).toHaveLength(4);
    for (const { job } of result.tiles) {
      const registration = job.groups[0];
      expect(registration).toMatchObject({
        layerId: 'tile-registration',
        toolId: PLAN.toolId,
        toolDiameterMm: 2,
        cutType: 'pocket',
        feedMmPerMin: 543,
        plungeMmPerMin: 123,
        spindleRpm: 9876,
        requestedDepthMm: 3.7,
        depthPerPassMm: 1.1,
      });
      expect(job.groups.at(-1)).toMatchObject({ layerId: 'profile', cutType: 'profile-outside' });
      const emitted = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
      expect(emitted.indexOf('2 mm registration cutter')).toBeLessThan(
        emitted.indexOf('4 mm profile cutter'),
      );
      const onlyRegistration = cncGrblStrategy.emit(
        { groups: [registration!] },
        DEFAULT_DEVICE_PROFILE,
      );
      const levels = [
        ...new Set(
          [...onlyRegistration.matchAll(/Z(-\d+\.\d+)/g)].map((match) => Number(match[1])),
        ),
      ];
      expect(levels).toEqual([-1.1, -2.2, -3.3, -3.7]);
    }
    const changed = tileJobs(
      { groups: [{ ...PROFILE, toolDiameterMm: 12, plungeMmPerMin: 42, spindleRpm: 8000 }] },
      TILING,
      CONTEXT,
    );
    if (changed.kind !== 'ready') throw new Error(changed.kind);
    expect(changed.tiles.map(({ job }) => job.groups[0])).toEqual(
      result.tiles.map(({ job }) => job.groups[0]),
    );
  });

  it('matches the requested bore diameter and continuous radial coverage at every emitted floor', () => {
    // A 2 mm flat mill making a 7 mm bore needs multiple circles; the tool
    // footprint, rather than the commanded center radius, defines the hole.
    const passes = tileRegistrationPasses({ x: 10, y: 10 }, { ...PLAN, holeDiameterMm: 7 }, 2);
    const gcode = cncGrblStrategy.emit(
      { groups: [{ ...PROFILE, cutType: 'pocket', toolDiameterMm: 2, passes }] },
      DEFAULT_DEVICE_PROFILE,
    );
    const floors = emittedFloorRadii(gcode);
    expect([...floors.keys()]).toEqual([-1.1, -2.2, -3.3, -3.7]);
    for (const rings of floors.values()) {
      expect(Math.max(...rings) + 1).toBeCloseTo(3.5, 3);
      for (let sample = 0; sample <= 700; sample += 1) {
        const radialPosition = (3.5 * sample) / 700;
        expect(
          Math.min(...rings.map((radius) => Math.abs(radius - radialPosition))),
        ).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it('emits one-peck and equal-size holes with explicit stock-top/depth points', () => {
    const passes = tileRegistrationPasses(
      { x: 0, y: 0 },
      { ...PLAN, holeDiameterMm: 2, depthMm: 0.2 },
      2,
    );
    expect(passes).toEqual([
      {
        kind: 'path3d',
        closed: false,
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: -0.2 },
        ],
      },
    ]);
    const emitted = cncGrblStrategy.emit(
      { groups: [{ ...PROFILE, cutType: 'drill', passes }] },
      DEFAULT_DEVICE_PROFILE,
    );
    expect(emitted).toContain('Z-0.200');
  });

  it('does not invent a plan for legacy checkbox-only multi-tile exports', () => {
    const { registration: _registration, ...legacy } = TILING;
    expect(tileJobs(JOB, legacy, CONTEXT)).toMatchObject({
      kind: 'registration-invalid',
      message: expect.stringContaining('Set a registration cutter'),
    });
    expect(tileJobs(JOB, { ...legacy, registrationHoles: false }, CONTEXT).kind).toBe('ready');
    expect(tileJobs(JOB, { ...legacy, tileWidthMm: 400, tileHeightMm: 400 }, CONTEXT).kind).toBe(
      'ready',
    );
  });

  it('names missing, unsupported, too-wide and malformed cutting plans without substituting tools', () => {
    expect(resolveTileRegistration({ ...PLAN, toolId: 'missing' }, MACHINE)).toContain(
      'existing registration cutter',
    );
    expect(resolveTileRegistration({ ...PLAN, holeDiameterMm: 1.5 }, MACHINE)).toContain(
      'cannot produce',
    );
    expect(
      resolveTileRegistration(PLAN, {
        ...MACHINE,
        tools: [{ ...MACHINE.tools[0]!, kind: 'v-bit' }],
      }),
    ).toContain('flat end mill');
    expect(resolveTileRegistration({ ...PLAN, depthPerPassMm: 0 }, MACHINE)).toContain(
      'depth per pass',
    );
  });
});
