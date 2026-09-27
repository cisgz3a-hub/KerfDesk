// ADR-273 Amendment 2: a group records the layer's ramp angle only when its
// passes ramp. Before it, adaptive, inlay, drill and helical pocket groups
// copied the angle from the layer, so the G-code header said `; cnc entry:
// contour-ramp; max-angle-deg: 5.000` above helixes and straight plunges.
// Relief groups follow the same rule (compile-cnc-relief-entry-provenance).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, Job } from '../job';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Polyline,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const COLOR = '#2e8b57';

function square(minX: number, minY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + size, y: minY },
      { x: minX + size, y: minY + size },
      { x: minX, y: minY + size },
    ],
  };
}

const OPEN_PATH: Polyline = {
  closed: false,
  points: [
    { x: 20, y: 20 },
    { x: 60, y: 20 },
    { x: 60, y: 40 },
  ],
};

function compile(polylines: ReadonlyArray<Polyline>, settings: Partial<CncLayerSettings>): Job {
  const artwork: ImportedSvg = {
    kind: 'imported-svg',
    id: 'artwork',
    source: 'artwork.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: COLOR, polylines: [...polylines] }],
  };
  return compileCncJob(
    {
      objects: [artwork],
      layers: [
        {
          ...createLayer({ id: 'L1', color: COLOR }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, rampEntryDeg: 5, ...settings },
        },
      ],
    },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
}

type Descent = 'along the path' | 'helix' | 'plunge';

type Section = { readonly claims: ReadonlyArray<string>; readonly firstDescent?: Descent };

type Head = { x: number; y: number; z: number };

// Each group's header claims and how the program first takes the cutter below
// the stock top inside it.
function sections(job: Job): ReadonlyArray<Section> {
  const found: Array<{ claims: string[]; firstDescent?: Descent }> = [];
  const head: Head = { x: Number.NaN, y: Number.NaN, z: 0 };
  for (const line of cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE).split('\n')) {
    if (line.startsWith('; cnc layer-id')) found.push({ claims: [] });
    const current = found.at(-1);
    if (line.startsWith('; cnc entry')) current?.claims.push(line);
    const descent = moveHead(head, line);
    if (current !== undefined && current.firstDescent === undefined && descent !== null) {
      current.firstDescent = descent;
    }
  }
  return found;
}

// Move the head through one line and say how it went below the stock top, if
// it did. A peck restates X and Y without moving them, so the head position
// decides whether a descent travels along the path.
function moveHead(head: Head, line: string): Descent | null {
  const words = new Map(
    [...line.matchAll(/([GXYZ])(-?\d+(?:\.\d+)?)/g)].map((match) => [match[1], Number(match[2])]),
  );
  const x = words.get('X') ?? head.x;
  const y = words.get('Y') ?? head.y;
  const z = words.get('Z') ?? head.z;
  const motion = words.get('G');
  const descent =
    z >= Math.min(head.z, 0)
      ? null
      : motion === 2 || motion === 3
        ? 'helix'
        : x !== head.x || y !== head.y
          ? 'along the path'
          : 'plunge';
  head.x = x;
  head.y = y;
  head.z = z;
  return descent;
}

function cncGroups(job: Job): ReadonlyArray<CncGroup> {
  return job.groups.filter((group): group is CncGroup => group.kind === 'cnc');
}

const CASES: ReadonlyArray<{
  readonly name: string;
  readonly polylines: ReadonlyArray<Polyline>;
  readonly settings: Partial<CncLayerSettings>;
  readonly entries: ReadonlyArray<Descent>;
}> = [
  {
    // Roughing enters on its own helix; the finishing rings plunge.
    name: 'an adaptive pocket',
    polylines: [square(20, 20, 20)],
    settings: { cutType: 'pocket', pocketStrategy: 'adaptive', depthMm: 3 },
    entries: ['helix'],
  },
  {
    name: 'an inlay pocket and insert',
    polylines: [square(50, 50, 30)],
    settings: {
      cutType: 'inlay-pair',
      depthMm: 6.35,
      depthPerPassMm: 2,
      inlayPocketDepthMm: 3,
      inlayAllowanceMm: 0.1,
      inlayPairSpacingMm: 10,
    },
    entries: ['plunge', 'plunge'],
  },
  {
    name: 'drilled holes',
    polylines: [square(20, 20, 6), square(40, 20, 6)],
    settings: { cutType: 'drill', depthMm: 3 },
    entries: ['plunge'],
  },
  {
    // The layer card keeps helix and ramp exclusive; a saved project can
    // still carry both, and the pocket then enters on its helix.
    name: 'a helical pocket',
    polylines: [square(20, 20, 30)],
    settings: {
      cutType: 'pocket',
      depthMm: 3,
      helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
    },
    entries: ['helix'],
  },
  {
    name: 'an offset pocket',
    polylines: [square(20, 20, 30)],
    settings: { cutType: 'pocket', depthMm: 3 },
    entries: ['along the path'],
  },
  {
    // Rest machining ramps its roughing bit and its finishing bit.
    name: 'a rest-machined pocket',
    polylines: [square(20, 20, 30)],
    settings: { cutType: 'pocket', depthMm: 3, pocketRoughToolId: 'em-6350' },
    entries: ['along the path', 'along the path'],
  },
  {
    name: 'an outside profile',
    polylines: [square(20, 20, 30)],
    settings: { cutType: 'profile-outside', depthMm: 3, tabsEnabled: false },
    entries: ['along the path'],
  },
  {
    name: 'an engraved open path',
    polylines: [OPEN_PATH],
    settings: { cutType: 'engrave', depthMm: 1 },
    entries: ['along the path'],
  },
];

// Adaptive planning and its verifier take about a second of the budget.
describe('CNC entry provenance', { timeout: 30_000 }, () => {
  it.each(CASES)('records the layer ramp on $name only where it ramps', (entry) => {
    const job = compile(entry.polylines, entry.settings);
    const found = sections(job);
    expect(found.map((section) => section.firstDescent)).toEqual(entry.entries);
    // A group records the ramp, and its header names it, exactly when its
    // first descent travels along its path.
    for (const [index, group] of cncGroups(job).entries()) {
      const ramps = found[index]?.firstDescent === 'along the path';
      expect(group.rampEntryDeg).toBe(ramps ? 5 : undefined);
      expect(found[index]?.claims).toEqual(
        ramps ? ['; cnc entry: contour-ramp; max-angle-deg: 5.000'] : [],
      );
    }
  });
});
