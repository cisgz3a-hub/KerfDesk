// Audit track RU, finding RU-7 — FAILS on current code.
//
// Defect: the .rd export never checks the profile's enabled no-go zones.
// io/rd/emit-rd.ts returns only `prepared.advisories` (pre-emit findings) and,
// as its own comment says, "The .rd path runs no post-compile preflight". The
// no-go-zone check lives only in the post-compile runPreflight
// (core/preflight/preflight.ts appendNoGoZoneIssues), which Save G-code runs and
// reports as advisories (ui/app/prepare-gcode-save.ts + save-preflight-policy.ts).
// The generic Ruida profile advertises the 'no-go-zones' capability
// (core/devices/profile-catalog.ts GENERIC_RUIDA_PROFILE), and for a Ruida
// profile the export is the only output path (no Frame/Start), so a
// motion-through-zone warning is never shown for Ruida.
//
// Correct behaviour (parity with Save G-code; ADR-228 keeps it a warning, not a
// refusal): exporting a job whose cut crosses an enabled no-go zone returns a
// 'no-go-zone-collision' advisory. No upstream firmware is involved; Ruida
// controllers have no notion of KerfDesk no-go zones (meerk40t rdjob.py has no
// keep-out command), so the host-side warning is the only protection.
import { describe, expect, it } from 'vitest';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { emitRdFile } from '../../io/rd';

function ruidaProjectWithClampZone(): Project {
  const entry = profileCatalogEntryById('generic-ruida-rd-export');
  if (entry === undefined) throw new Error('missing generic Ruida profile');
  return {
    ...createProject(),
    // Machine-space zone (rear-right origin, 900 mm bed): the artwork below
    // lands at machine x 760..800, y 50..70.
    device: {
      ...entry.profile,
      noGoZones: [
        { id: 'clamp', name: 'Clamp', enabled: true, x: 750, y: 40, width: 60, height: 40 },
      ],
    },
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'sq',
          source: 'sq.svg',
          bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
          transform: { ...IDENTITY_TRANSFORM, x: 100, y: 50 },
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

describe('RU-7: .rd export reports no-go zone collisions like Save G-code', () => {
  it('the G-code pipeline flags the collision for this project (control)', () => {
    const gcode = emitGcode(ruidaProjectWithClampZone(), {
      jobOrigin: { startFrom: 'absolute', anchor: 'front-left' },
    });
    expect(gcode.preflight.issues.map((issue) => issue.code)).toContain('no-go-zone-collision');
  });

  it('the .rd export carries the same no-go-zone-collision advisory', () => {
    const rd = emitRdFile(ruidaProjectWithClampZone(), {
      jobOrigin: { startFrom: 'absolute', anchor: 'front-left' },
    });
    if (!rd.ok) throw new Error(rd.messages.join('\n'));
    expect(rd.advisories.map((issue) => issue.code)).toContain('no-go-zone-collision');
  });
});
