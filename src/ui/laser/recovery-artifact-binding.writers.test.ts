import { describe, expect, it } from 'vitest';
import {
  buildLaserSecondPassProgram,
  parseLaserSecondPassSource,
} from '../../core/laser-second-pass';
import type { LaserSecondPassWriterVersion } from '../../core/laser-second-pass/types';
import { fingerprintGcode } from '../../core/recovery';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing';
import { recoveryArtifactPreparedProgramMatches } from './recovery-artifact-binding';

async function archivedWriter(writerVersion: LaserSecondPassWriterVersion | undefined) {
  const base = createProject();
  const prepared = prepareOutput({
    ...base,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'image', color: '#000000', mode: 'image' }),
          speed: 6000,
          imageOverscanMm: 1,
          autoOverscan: false,
          linesPerMm: 1,
        },
      ],
      objects: [
        {
          kind: 'raster-image',
          id: 'image',
          color: '#000000',
          source: 'test.png',
          dataUrl: 'data:image/png;base64,AA==',
          lumaBase64: 'AAA=',
          pixelWidth: 2,
          pixelHeight: 1,
          bounds: { minX: 20, maxX: 120, minY: 20, maxY: 21 },
          transform: IDENTITY_TRANSFORM,
          dither: 'grayscale',
          linesPerMm: 1,
        },
      ],
    },
  });
  if (!prepared.ok) throw new Error('Expected prepared raster fixture.');
  const source = emitPreparedGcode(prepared).gcode;
  const parsed = parseLaserSecondPassSource(source);
  if (parsed.kind !== 'ready') throw new Error(parsed.message);
  const burn = parsed.segments.find((segment) => segment.power > 0)!;
  const selection = {
    version: 1 as const,
    maxPowerS: prepared.project.device.maxPowerS,
    strokes: [
      {
        id: 'spot',
        mode: 'paint' as const,
        radiusMm: 1,
        powerScale: 1,
        points: [{ x: (burn.from.x + burn.to.x) / 2, y: burn.from.y }],
      },
    ],
  };
  const derived = buildLaserSecondPassProgram(source, selection, {
    writerVersion: writerVersion ?? 1,
  });
  if (derived.kind !== 'ready') throw new Error(derived.message);
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'saved-stage',
    gcode: derived.gcode,
    prepared,
  });
  return {
    ...artifact,
    laserSecondPassChain: [
      {
        sourceRunId: 'source',
        sourceFingerprint: fingerprintGcode(source),
        resumeChainBefore: [],
        selection,
        ...(writerVersion === undefined ? {} : { writerVersion }),
      },
    ],
  };
}

describe('recovery replays the archived second-pass writer', () => {
  it.each([undefined, 1, 2, 3] as const)(
    'reproduces writer %s after the default changes to 3',
    async (version) => {
      const artifact = await archivedWriter(version);
      expect(recoveryArtifactPreparedProgramMatches(artifact)).toBe(true);
    },
  );

  it('does not reinterpret a writer 2 archive as writer 3', async () => {
    const artifact = await archivedWriter(2);
    const changed = {
      ...artifact,
      laserSecondPassChain: artifact.laserSecondPassChain.map((stage) => ({
        ...stage,
        writerVersion: 3 as const,
      })),
    };
    expect(recoveryArtifactPreparedProgramMatches(changed)).toBe(false);
  });
});
