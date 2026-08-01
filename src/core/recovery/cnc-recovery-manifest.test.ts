import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../job';
import {
  buildCncRecoveryEventManifest,
  validateCncRecoveryLineSpans,
} from './cnc-recovery-manifest';

const group: CncGroup = {
  kind: 'cnc',
  layerId: 'layer-a',
  color: '#000000',
  cutType: 'profile-outside',
  toolId: 'tool-1',
  toolDiameterMm: 3.175,
  feedMmPerMin: 600,
  plungeMmPerMin: 180,
  spindleRpm: 12_000,
  spindleSpinupSec: 3,
  safeZMm: 5,
  passes: [
    {
      kind: 'contour',
      zMm: -1,
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      closed: false,
    },
    {
      kind: 'path3d',
      points: [
        { x: 10, y: 0, z: -1 },
        { x: 10, y: 5, z: -2 },
      ],
      closed: false,
    },
  ],
};

const job: Job = { groups: [group] };

describe('buildCncRecoveryEventManifest', () => {
  it('creates stable semantic identities for every native CNC pass', () => {
    const manifest = buildCncRecoveryEventManifest(job);
    expect(manifest).toEqual(buildCncRecoveryEventManifest(job));
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.events).toHaveLength(8);
    expect(manifest.events[0]).toMatchObject({
      id: 'cnc-op-1/pass-1/clearance',
      operationId: 'cnc-op-1',
      passId: 'cnc-op-1/pass-1',
      intent: 'clearance',
      source: { groupIndex: 0, passIndex: 0, passKind: 'contour' },
    });
    expect(manifest.events[2]).toMatchObject({
      id: 'cnc-op-1/pass-1/cut-1',
      intent: 'cut',
      source: { segmentIndex: 0 },
    });
  });

  it('limits runway-v1 support to simple contour and arc cuts', () => {
    const manifest = buildCncRecoveryEventManifest(job);
    const cuts = manifest.events.filter((event) => event.intent === 'cut');
    expect(cuts.map((event) => event.recoverySupport)).toEqual(['runway-v1', 'manual-only']);
  });

  it('grants runway-v1 to a FLAT led path3d but not a varying-Z path3d (ADR-250)', () => {
    const flatLead: CncGroup = {
      ...group,
      passes: [
        {
          kind: 'path3d',
          points: [
            { x: 0, y: 0, z: -1 },
            { x: 10, y: 0, z: -1 },
            { x: 20, y: 0, z: -1 },
          ],
          closed: false,
        },
      ],
    };
    const flatCuts = buildCncRecoveryEventManifest({ groups: [flatLead] }).events.filter(
      (event) => event.intent === 'cut',
    );
    expect(flatCuts.every((event) => event.recoverySupport === 'runway-v1')).toBe(true);
    // The module `group`'s second pass is a varying-Z path3d — stays manual-only.
    const variedCuts = buildCncRecoveryEventManifest(job).events.filter(
      (event) => event.intent === 'cut' && event.source.passKind === 'path3d',
    );
    expect(variedCuts.every((event) => event.recoverySupport === 'manual-only')).toBe(true);
  });

  it('refuses runway-v1 support for a multi-tool job', () => {
    const secondGroup: CncGroup = { ...group, layerId: 'layer-b', toolId: 'tool-2' };
    const manifest = buildCncRecoveryEventManifest({ groups: [group, secondGroup] });
    const cuts = manifest.events.filter((event) => event.intent === 'cut');
    expect(cuts.every((event) => event.recoverySupport === 'manual-only')).toBe(true);
  });

  it('treats one tool ID with conflicting diameters as a multi-tool job', () => {
    const conflictingGroup: CncGroup = { ...group, layerId: 'layer-b', toolDiameterMm: 6 };
    const manifest = buildCncRecoveryEventManifest({ groups: [group, conflictingGroup] });
    const cuts = manifest.events.filter((event) => event.intent === 'cut');
    expect(cuts.every((event) => event.recoverySupport === 'manual-only')).toBe(true);
  });

  it('assigns one cut identity to each contour segment', () => {
    const segmentedGroup: CncGroup = {
      ...group,
      passes: [
        {
          kind: 'contour',
          zMm: -1,
          polyline: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          closed: false,
        },
      ],
    };
    const cuts = buildCncRecoveryEventManifest({ groups: [segmentedGroup] }).events.filter(
      (event) => event.intent === 'cut',
    );
    expect(cuts.map((event) => [event.id, event.source.segmentIndex])).toEqual([
      ['cnc-op-1/pass-1/cut-1', 0],
      ['cnc-op-1/pass-1/cut-2', 1],
    ]);
  });
});

describe('validateCncRecoveryLineSpans', () => {
  it('accepts sorted, non-overlapping mappings to known events', () => {
    const manifest = buildCncRecoveryEventManifest(job);
    const result = validateCncRecoveryLineSpans(
      manifest,
      [
        { eventId: manifest.events[0]?.id ?? '', firstRawLine: 5, lastRawLine: 5 },
        { eventId: manifest.events[2]?.id ?? '', firstRawLine: 6, lastRawLine: 7 },
        { eventId: manifest.events[6]?.id ?? '', firstRawLine: 8, lastRawLine: 9 },
      ],
      20,
    );
    expect(result.kind).toBe('ok');
  });

  it('rejects unknown, overlapping, and out-of-range mappings', () => {
    const manifest = buildCncRecoveryEventManifest(job);
    const knownId = manifest.events[0]?.id ?? '';
    expect(
      validateCncRecoveryLineSpans(
        manifest,
        [{ eventId: 'missing', firstRawLine: 1, lastRawLine: 1 }],
        5,
      ).kind,
    ).toBe('error');
    expect(
      validateCncRecoveryLineSpans(
        manifest,
        [
          { eventId: knownId, firstRawLine: 2, lastRawLine: 4 },
          { eventId: knownId, firstRawLine: 4, lastRawLine: 5 },
        ],
        5,
      ).kind,
    ).toBe('error');
    expect(
      validateCncRecoveryLineSpans(
        manifest,
        [{ eventId: knownId, firstRawLine: 2, lastRawLine: 6 }],
        5,
      ).kind,
    ).toBe('error');
  });

  it('rejects a sidecar that omits any cut event', () => {
    const manifest = buildCncRecoveryEventManifest(job);
    const result = validateCncRecoveryLineSpans(
      manifest,
      [{ eventId: manifest.events[0]?.id ?? '', firstRawLine: 2, lastRawLine: 2 }],
      10,
    );
    expect(result).toEqual({ kind: 'error', reason: 'missing-cut-event' });
  });

  it('rejects an unsupported manifest schema at the runtime boundary', () => {
    const manifest = buildCncRecoveryEventManifest(job);
    // Runtime input can bypass TypeScript, so the validator must reject a future/forged schema.
    const invalidManifest = { ...manifest, schemaVersion: 2 } as unknown as typeof manifest;
    expect(validateCncRecoveryLineSpans(invalidManifest, [], 10)).toEqual({
      kind: 'error',
      reason: 'invalid-manifest-schema',
    });
  });
});
