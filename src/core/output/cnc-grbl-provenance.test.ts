import { describe, expect, it } from 'vitest';
import { isSendableGcodeLine } from '../controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup } from '../job';
import { cncGrblStrategy } from './cnc-grbl-strategy';

function squareLoop(at: number, size: number): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x: at, y: at },
    { x: at + size, y: at },
    { x: at + size, y: at + size },
    { x: at, y: at + size },
    { x: at, y: at },
  ];
}

function group(overrides: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'profile-on-path',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [
      { kind: 'contour', zMm: -1.5, polyline: squareLoop(10, 20), closed: true },
      { kind: 'contour', zMm: -3, polyline: squareLoop(10, 20), closed: true },
    ],
    ...overrides,
  };
}

describe('CNC G-code provenance comments', () => {
  it('emits incident-grade provenance without changing sendable motion', () => {
    const plain = group();
    const enriched = group({
      toolId: 'custom-v-3mm-90',
      toolName: 'Custom 3 mm 90 degree V-bit',
      toolKind: 'v-bit',
      toolTipAngleDeg: 90,
      requestedDepthMm: 1.191,
      depthPerPassMm: 0.5,
      vResolutionMm: 0,
      rampEntryDeg: 3,
      feedSource: { kind: 'machine-starter', starterId: 'neotronics-4040-safe', revision: 2 },
    });
    const plainGcode = cncGrblStrategy.emit({ groups: [plain] }, DEFAULT_DEVICE_PROFILE);
    const enrichedGcode = cncGrblStrategy.emit({ groups: [enriched] }, DEFAULT_DEVICE_PROFILE);

    expect(enrichedGcode).toContain('; cnc layer-id: L1');
    expect(enrichedGcode).toContain('; cnc operation: profile-on-path; passes: 2');
    expect(enrichedGcode).toContain('; cnc tool-id: custom-v-3mm-90');
    expect(enrichedGcode).toContain('; cnc tool-name: Custom 3 mm 90 degree V-bit');
    expect(enrichedGcode).toContain('; cnc tool: v-bit; diameter-mm: 3.175; angle-deg: 90.000');
    expect(enrichedGcode).toContain('; cnc depth: requested-mm: 1.191; per-pass-mm: 0.500');
    expect(enrichedGcode).toContain('; cnc v-resolution-mm: auto');
    expect(enrichedGcode).toContain('; cnc entry: contour-ramp; max-angle-deg: 3.000');
    expect(enrichedGcode).toContain('; cnc feed-source: machine-starter');
    expect(enrichedGcode).toContain('; cnc starter-id: neotronics-4040-safe; revision: 2');
    expect(sendableLines(enrichedGcode)).toEqual(sendableLines(plainGcode));
  });

  it('keeps untrusted layer and tool labels inside comments', () => {
    const injected = cncGrblStrategy.emit(
      {
        groups: [
          group({
            layerId: 'safe-layer\nG0 X399.000 Y399.000',
            toolId: 'safe-tool\nM3 S99999',
            toolName: 'safe name\r\nG1 Z-99 F99999',
            toolKind: 'v-bit',
            toolTipAngleDeg: 90,
          }),
          group({
            layerId: 'next-layer\nG0 X398.000 Y398.000',
            toolId: 'next-tool\nM3 S99998',
            toolName: 'next name\r\nG1 Z-98 F99998',
            passes: [{ kind: 'contour', zMm: -1, polyline: squareLoop(40, 10), closed: true }],
          }),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(sendableLines(injected)).not.toContain('G0 X399.000 Y399.000');
    expect(sendableLines(injected)).not.toContain('M3 S99999');
    expect(sendableLines(injected)).not.toContain('G1 Z-99 F99999');
    expect(sendableLines(injected)).not.toContain('G0 X398.000 Y398.000');
    expect(sendableLines(injected)).not.toContain('M3 S99998');
    expect(sendableLines(injected)).not.toContain('G1 Z-98 F99998');
    expect(injected).toContain('; cnc layer-id: safe-layer G0 X399.000 Y399.000');
    expect(injected).toContain('; cnc tool-id: safe-tool M3 S99999');
    expect(injected).toContain('; cnc tool-name: safe name  G1 Z-99 F99999');
    expect(injected).toContain('; tool: safe name  G1 Z-99 F99999 (load before starting)');
    expect(injected).toContain('; tool change: load next name  G1 Z-98 F99998');
    for (const line of injected.split('\n').filter((candidate) => candidate.startsWith('; cnc '))) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(96);
    }
  });

  it('discloses V-carve fallback and a tiled entry that starts below stock top', () => {
    const fallback = cncGrblStrategy.emit(
      { groups: [group({ cutType: 'v-carve', rampEntryDeg: 3 })] },
      DEFAULT_DEVICE_PROFILE,
    );
    expect(fallback).toContain('; cnc entry: stepped-plunge-fallback; max-angle-deg: 3.000');

    const clipped = cncGrblStrategy.emit(
      {
        groups: [
          group({
            cutType: 'v-carve',
            rampEntryDeg: 3,
            rampEntryTiled: true,
            passes: [
              {
                kind: 'path3d',
                closed: false,
                lateralFeed: 'plunge',
                points: [
                  { x: 10, y: 10, z: -0.25 },
                  { x: 20, y: 10, z: -0.5 },
                ],
              },
            ],
          }),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );
    expect(clipped).toContain('; cnc entry: contour-ramp; requested-max-angle-deg: 3.000');
    expect(clipped).toContain(
      '; cnc entry-advisory: tiled output does not retain the max-angle guarantee',
    );
    expect(clipped).toContain('; cnc entry-advisory: tiled ramp starts below stock top');
  });
});

function sendableLines(gcode: string): ReadonlyArray<string> {
  return gcode.split('\n').filter(isSendableGcodeLine);
}
