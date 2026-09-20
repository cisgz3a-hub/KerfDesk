import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, jogAxisSignsForOrigin, type Origin } from '../devices';
import type { Job } from './job';
import {
  applyJobOrigin,
  JOB_ORIGIN_ANCHORS,
  jobOriginOffsetFromBounds,
  offsetJobBounds,
  USER_ORIGIN_JOB_PLACEMENT,
} from './job-origin';
import { computeJobBounds, type JobBounds } from './job-bounds';

const centeredJob: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 10,
      speed: 1500,
      passes: 1,
      airAssist: false,
      segments: [
        {
          closed: true,
          polyline: [
            { x: 175, y: 215 },
            { x: 225, y: 215 },
            { x: 225, y: 185 },
            { x: 175, y: 185 },
            { x: 175, y: 215 },
          ],
        },
      ],
    },
  ],
};

describe('applyJobOrigin', () => {
  it('moves the lower-left job bounds anchor to work coordinate 0,0 for user origin jobs', () => {
    const adjusted = applyJobOrigin(centeredJob, USER_ORIGIN_JOB_PLACEMENT);

    expect(computeJobBounds(adjusted)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 50,
      maxY: 30,
    });
    expect(adjusted.groups[0]?.kind).toBe('cut');
  });

  it('moves the selected anchor to the current work position for current-position jobs', () => {
    const adjusted = applyJobOrigin(centeredJob, {
      startFrom: 'current-position',
      anchor: 'center',
      currentPosition: { x: 120, y: 80 },
    });

    expect(computeJobBounds(adjusted)).toEqual({
      minX: 95,
      minY: 65,
      maxX: 145,
      maxY: 95,
    });
  });

  it('retains compile diagnostics while translating job geometry', () => {
    const diagnosticJob: Job = {
      ...centeredJob,
      diagnostics: [{ kind: 'offset-fill-pass-limit', layerName: 'Fill', passLimit: 2000 }],
    };

    expect(applyJobOrigin(diagnosticJob, USER_ORIGIN_JOB_PLACEMENT).diagnostics).toEqual(
      diagnosticJob.diagnostics,
    );
  });
});

describe('offsetJobBounds', () => {
  it('converts work-coordinate job bounds into physical machine bounds using WCO', () => {
    expect(offsetJobBounds({ minX: 0, minY: 0, maxX: 50, maxY: 30 }, { x: 380, y: 390 })).toEqual({
      minX: 380,
      minY: 390,
      maxX: 430,
      maxY: 420,
    });
  });
});

// ADR-324: an anchor names a PHYSICAL corner of the artwork (front = toward the
// operator, left = the operator's left) on every device origin. centeredJob spans
// machine X 175..225 / Y 185..215; front-right, rear-left and rear-right origins
// mirror an axis (origin-transform.ts), so the same physical corner is a
// different machine-frame corner on each.
describe('anchorPointForOrigin: anchors are physical corners on every device origin (ADR-324)', () => {
  const ORIGINS: ReadonlyArray<Origin> = [
    'front-left',
    'front-right',
    'rear-left',
    'rear-right',
    'center',
  ];

  it.each<[Origin, JobBounds]>([
    ['front-left', { minX: 0, minY: 0, maxX: 50, maxY: 30 }],
    ['center', { minX: 0, minY: 0, maxX: 50, maxY: 30 }],
    // machine +X points to the operator's LEFT: the physical left edge is maxX.
    ['front-right', { minX: -50, minY: 0, maxX: 0, maxY: 30 }],
    // machine +Y points toward the operator: the physical front edge is maxY.
    ['rear-left', { minX: 0, minY: -30, maxX: 50, maxY: 0 }],
    ['rear-right', { minX: -50, minY: -30, maxX: 0, maxY: 0 }],
  ])(
    'front-left anchor on a %s origin puts the physical front-left corner at work 0,0',
    (origin, expected) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, origin };
      expect(
        computeJobBounds(applyJobOrigin(centeredJob, USER_ORIGIN_JOB_PLACEMENT, device)),
      ).toEqual(expected);
    },
  );

  it.each<[Origin, JobBounds]>([
    ['front-left', { minX: -50, minY: -30, maxX: 0, maxY: 0 }],
    ['rear-right', { minX: 0, minY: 0, maxX: 50, maxY: 30 }],
  ])(
    'back-right anchor on a %s origin puts the physical back-right corner at work 0,0',
    (origin, expected) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, origin };
      expect(
        computeJobBounds(
          applyJobOrigin(centeredJob, { startFrom: 'user-origin', anchor: 'back-right' }, device),
        ),
      ).toEqual(expected);
    },
  );

  it.each(ORIGINS)(
    'every anchor lands its named physical edge on the work origin (%s origin)',
    (origin) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, origin };
      const signs = jogAxisSignsForOrigin(origin);
      for (const anchor of JOB_ORIGIN_ANCHORS) {
        const bounds = computeJobBounds(
          applyJobOrigin(centeredJob, { startFrom: 'user-origin', anchor }, device),
        );
        if (bounds === null) throw new Error('no bounds');
        const physical = {
          left: signs.x === 1 ? bounds.minX : bounds.maxX,
          right: signs.x === 1 ? bounds.maxX : bounds.minX,
          front: signs.y === 1 ? bounds.minY : bounds.maxY,
          back: signs.y === 1 ? bounds.maxY : bounds.minY,
          midX: (bounds.minX + bounds.maxX) / 2,
          midY: (bounds.minY + bounds.maxY) / 2,
        };
        const [row, column] = anchor === 'center' ? ['center', 'center'] : anchor.split('-');
        const x =
          column === 'left' ? physical.left : column === 'right' ? physical.right : physical.midX;
        const y = row === 'front' ? physical.front : row === 'back' ? physical.back : physical.midY;
        expect({ anchor, x, y }).toEqual({ anchor, x: 0, y: 0 });
      }
    },
  );

  it('jobOriginOffsetFromBounds honours the device origin and keeps the front-left mapping without one', () => {
    const bounds: JobBounds = { minX: 175, minY: 185, maxX: 225, maxY: 215 };
    const placement = { startFrom: 'user-origin', anchor: 'front-left' } as const;
    expect(jobOriginOffsetFromBounds(bounds, placement, { origin: 'rear-right' })).toEqual({
      x: -225,
      y: -215,
    });
    expect(jobOriginOffsetFromBounds(bounds, placement)).toEqual({ x: -175, y: -185 });
  });
});
