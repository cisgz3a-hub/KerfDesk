// Controller audit 2026-09-25 RU-7: the .rd export ran no post-compile check,
// so a Ruida profile (whose only output is this export) never warned about a
// no-go zone, the bed edge or laser travel. It now runs the runPreflight a
// G-code save runs, over the moves the file commands, as advisories only
// (rule 7 / ADR-228: an export is never refused for them).

import { describe, expect, it } from 'vitest';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitGcode } from '../gcode/emit-gcode';
import { emitRdFile, type EmitRdOptions } from './emit-rd';

// Generic Ruida profile: rear-right origin, 900 × 600 bed, so the 40 × 20 mm
// square drawn at x = sceneX lands at machine x = 900 − sceneX.
function ruidaSquare(sceneX: number, noGoZones: Project['device']['noGoZones'] = []): Project {
  const entry = profileCatalogEntryById('generic-ruida-rd-export');
  if (entry === undefined) throw new Error('missing generic Ruida profile');
  return {
    ...createProject(),
    device: { ...entry.profile, noGoZones },
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'sq',
          source: 'sq.svg',
          bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
          transform: { ...IDENTITY_TRANSFORM, x: sceneX, y: 50 },
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 40, y: 0 },
                    { x: 40, y: 20 },
                    { x: 0, y: 20 },
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

// Machine x 750..810, y 40..80: the square at sceneX 100 (x 760..800) is inside.
const CLAMP = { id: 'clamp', name: 'Clamp', enabled: true, x: 750, y: 40, width: 60, height: 40 };

function advisories(project: Project, options: EmitRdOptions = {}) {
  const result = emitRdFile(project, options);
  if (!result.ok) throw new Error(result.messages.join('\n'));
  return result.advisories;
}

describe('.rd export post-compile checks', () => {
  it('reports a cut through an enabled no-go zone, by layer', () => {
    // Machine frame (no placement): the file's coordinates are bed positions.
    expect(advisories(ruidaSquare(100, [CLAMP]))).toEqual([
      {
        code: 'no-go-zone-collision',
        message: 'Layer #000000: motion crosses no-go zone "Clamp".',
      },
    ]);
  });

  it('says a zone cannot be checked when the placement has no known bed offset', () => {
    const userOrigin: EmitRdOptions = {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    };
    const codes = advisories(ruidaSquare(100, [CLAMP]), userOrigin).map((issue) => issue.code);
    expect(codes).toEqual(['no-go-zone-collision']);
    expect(advisories(ruidaSquare(100, [CLAMP]), userOrigin)[0]?.message).toMatch(
      /cannot be checked/,
    );
  });

  it('warns about the same zone Save G-code warns about, in the same frame', () => {
    const project = ruidaSquare(100, [CLAMP]);
    const options = { jobOrigin: { startFrom: 'absolute', anchor: 'front-left' } } as const;
    const gcodeZoneIssues = emitGcode(project, options)
      .preflight.issues.filter((issue) => issue.code === 'no-go-zone-collision')
      .map((issue) => issue.message);
    const rdZoneIssues = advisories(project, options)
      .filter((issue) => issue.code === 'no-go-zone-collision')
      .map((issue) => issue.message);
    expect(rdZoneIssues).toEqual(gcodeZoneIssues);
    expect(rdZoneIssues).toHaveLength(1);
  });

  it('reports a move past the bed edge without refusing the export', () => {
    // sceneX −30 puts the square's left edge at machine x 930 on a 900 mm bed.
    const result = emitRdFile(ruidaSquare(-30));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outOfBed = result.advisories.filter((issue) => issue.code === 'out-of-bed');
    expect(outOfBed.length).toBeGreaterThan(0);
    for (const issue of outOfBed) expect(issue.message).toBe('Layer #000000: X out of bed: 930');
  });

  it('reports nothing for a job inside the bed and clear of every zone', () => {
    expect(advisories(ruidaSquare(400, [CLAMP]))).toEqual([]);
  });

  it('gives no G-code line numbers, which the .rd file does not have', () => {
    const messages = [
      ...advisories(ruidaSquare(100, [CLAMP])),
      ...advisories(ruidaSquare(-30)),
    ].map((issue) => issue.message);
    expect(messages.filter((message) => message.startsWith('Line '))).toEqual([]);
  });
});
