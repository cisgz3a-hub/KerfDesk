// emitRdFile coverage (CTL-10). The encoder's typed refusals (empty-job,
// raster-unsupported) are exercised at the encoder layer in
// core/controllers/ruida/ruida.test.ts; here we cover the emit wrapper's own
// seams: the prepareOutput success path yields bytes, and a project with no
// output geometry is refused with a message (never reaching the encoder).

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { splitRdCommands } from '../../__fixtures__/controllers/ruida-decoder';
import { emitRdFile, type EmitRdOptions } from './emit-rd';

function ruidaLineProject(offsetX = 0): Project {
  return {
    ...createProject(),
    device: { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' },
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-1',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: { ...IDENTITY_TRANSFORM, x: offsetX },
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
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

describe('emitRdFile', () => {
  it('emits a non-empty byte stream for a line job', () => {
    const result = emitRdFile(ruidaLineProject());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes.length).toBeGreaterThan(0);
  });

  it('refuses a project with no output geometry with a message', () => {
    const result = emitRdFile(createProject());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.messages.length).toBeGreaterThan(0);
  });

  it('is deterministic across calls', () => {
    const project = ruidaLineProject();
    const a = emitRdFile(project);
    const b = emitRdFile(project);
    if (!a.ok || !b.ok) throw new Error('fixture should emit ok');
    expect([...a.bytes]).toEqual([...b.bytes]);
  });

  it('does not make configured bed bounds an export refusal', () => {
    const result = emitRdFile(ruidaLineProject(405));
    expect(result.ok).toBe(true);
  });

  // Rule 7 / ADR-228: prepareOutput used to refuse on ANY pre-emit finding,
  // including heuristic policy codes, so an unusable controlled laser-off
  // travel feed refused the whole .rd export for a finding that merely warns
  // on Start. The export must proceed; the finding rides along as an advisory.
  it('does not make a pre-emit policy finding an export refusal', () => {
    const base = ruidaLineProject();
    const result = emitRdFile({
      ...base,
      device: { ...base.device, controlledLaserOffTravelFeedMmPerMin: 0 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes.length).toBeGreaterThan(0);
  });

  // The .rd path runs no post-compile preflight, so this field is the only way
  // a pre-emit finding can reach the operator (handleSaveRd toasts it).
  it('carries the policy finding out as an advisory', () => {
    const base = ruidaLineProject();
    const result = emitRdFile({
      ...base,
      device: { ...base.device, controlledLaserOffTravelFeedMmPerMin: 0 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.advisories).toEqual([expect.objectContaining({ code: 'speed-out-of-range' })]);
  });

  it('reports no advisories for a clean project', () => {
    const result = emitRdFile(ruidaLineProject());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.advisories).toEqual([]);
  });
});

// Controller audit 2026-09-25 RU-2: every file used to declare D8 12 "Ref Point
// Mode 0 — Current Position". The reference point now follows the placement
// (meerk40t rdjob.py L135-137: D8 10 machine zero, D8 11 anchor point, D8 12
// current position), in meerk40t's write_header preamble (L1409-1414).
describe('emitRdFile reference point', () => {
  function genericRuidaSquare(): Project {
    const entry = profileCatalogEntryById('generic-ruida-rd-export');
    if (entry === undefined) throw new Error('missing generic Ruida profile');
    return { ...ruidaLineProject(100), device: entry.profile };
  }

  function commands(bytes: Uint8Array): ReadonlyArray<string> {
    return splitRdCommands(bytes).map((command) =>
      command
        .slice(0, 2)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    );
  }

  const cases: ReadonlyArray<readonly [string, EmitRdOptions, string]> = [
    ['no placement', {}, 'd810'],
    ['Absolute', { jobOrigin: { startFrom: 'absolute', anchor: 'front-left' } }, 'd810'],
    ['User Origin', { jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' } }, 'd811'],
    ['Verified Origin', { jobOrigin: { startFrom: 'verified-origin', anchor: 'center' } }, 'd811'],
    [
      'Current Position',
      {
        jobOrigin: {
          startFrom: 'current-position',
          anchor: 'front-left',
          currentPosition: { x: 0, y: 0 },
        },
      },
      'd812',
    ],
  ];

  it.each(cases)('%s writes %s, then Set Absolute ... Start Process', (_label, options, mode) => {
    const result = emitRdFile(genericRuidaSquare(), options);
    if (!result.ok) throw new Error(result.messages.join('\n'));
    const codes = commands(result.bytes);
    expect(codes.slice(0, 5)).toEqual([mode, 'e601', 'f0', 'f102', 'd800']);
    expect(codes.filter((code) => code.startsWith('d81'))).toEqual([mode]);
  });
});
