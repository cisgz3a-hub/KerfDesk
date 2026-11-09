import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { JobOriginPlacement } from '../../core/job';
import type { Project } from '../../core/scene';
import { deserializeProject } from '../project/deserialize-project';
import { emitGcode } from './emit-gcode';

// ADR-694 returning user: rotary projects saved by the published 1.0.30
// (ffd9fe66b, schema 21) — chuck, reversed chuck, scaled roller,
// surface-calibrated roller and a disabled rotary, each with a cut, a fill and
// an image — open on this build and emit the same bytes 1.0.30 emitted, for
// Absolute, Current Position and User Origin. The fixture holds the files and
// a SHA-256 of each program with its comment lines dropped; 1.0.30 itself
// produced both.

type Golden = {
  readonly projects: Readonly<Record<string, string>>;
  readonly gcodeSha256: Readonly<Record<string, string>>;
};

const GOLDEN: Golden = JSON.parse(
  gunzipSync(
    readFileSync(resolve('src/__fixtures__/returning-user', '1.0.30-rotary.golden.json.gz')),
  ).toString('utf8'),
);

const PLACEMENTS: Readonly<Record<string, JobOriginPlacement | undefined>> = {
  absolute: undefined,
  'current-position': {
    startFrom: 'current-position',
    anchor: 'center',
    currentPosition: { x: 100, y: 80 },
  },
  'user-origin': { startFrom: 'user-origin', anchor: 'front-left' },
};

function opened(name: string): Project {
  const saved = GOLDEN.projects[name];
  if (saved === undefined) throw new Error(`Missing golden project ${name}`);
  expect(JSON.parse(saved).schemaVersion).toBe(21);
  const result = deserializeProject(saved);
  if (result.kind !== 'ok') throw new Error(`${name} did not open: ${result.kind}`);
  return result.project;
}

function programSha(project: Project, placement: JobOriginPlacement | undefined): string {
  const { gcode } = emitGcode(project, placement === undefined ? {} : { jobOrigin: placement });
  const burn = gcode
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(';'))
    .join('\n');
  return createHash('sha256').update(burn).digest('hex');
}

describe('rotary projects saved by 1.0.30 (ADR-694 returning user)', () => {
  const cases = Object.keys(GOLDEN.projects).flatMap((name) =>
    Object.keys(PLACEMENTS).map((placement) => [name, placement] as const),
  );

  it('covers five setups and three placements', () => {
    expect(cases).toHaveLength(15);
  });

  it.each(cases)('%s with %s emits what 1.0.30 emitted', (name, placement) => {
    const project = opened(name);
    expect(project.device.rotary).not.toHaveProperty('taper');
    expect(programSha(project, PLACEMENTS[placement])).toBe(
      GOLDEN.gcodeSha256[`${name}/${placement}`],
    );
  });

  it.each(Object.keys(GOLDEN.projects))('%s with the taper saved off emits the same', (name) => {
    const project = opened(name);
    const rotary = project.device.rotary;
    if (rotary === undefined) throw new Error('rotary missing');
    const taperOff: Project = {
      ...project,
      device: {
        ...project.device,
        rotary: {
          ...rotary,
          taper: {
            enabled: false,
            topDiameterMm: 80,
            bottomDiameterMm: 70,
            lengthMm: 100,
            topSide: 'left',
            artworkFromTopMm: 0,
          },
        },
      },
    };
    expect(programSha(taperOff, PLACEMENTS['current-position'])).toBe(
      GOLDEN.gcodeSha256[`${name}/current-position`],
    );
  });
});
