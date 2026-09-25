// Exploration helper for audit track RU (not a regression test): dumps the
// bytes KerfDesk's .rd encoder produces for a few jobs so they can be decoded
// by meerk40t's own rdjob.py (scratchpad RU/decode_with_m40t.py). Writes only
// to the audit scratchpad and skips itself anywhere that directory is absent.
import { existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { it } from 'vitest';
import { encodeRdJob } from '../../core/controllers/ruida';
import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import type { Job } from '../../core/job';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitRdFile } from '../../io/rd';

const OUT =
  '/tmp/claude-0/-home-user-KerfDesk/e081095c-c1d0-530d-a0e1-2a645748ec6e/scratchpad/RU/kerfdesk-rd-dump.json';

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const ruida = profileCatalogEntryById('generic-ruida-rd-export');

const TWO_LAYER: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 20,
      speed: 3000,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
          ],
          closed: true,
        },
      ],
    },
    {
      kind: 'cut',
      layerId: 'L2',
      color: '#0000ff',
      power: 80,
      speed: 300,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 50, y: 10 },
            { x: 60, y: 30 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function lineProject(): Project {
  if (ruida === undefined) throw new Error('missing ruida profile');
  return {
    ...createProject(),
    device: ruida.profile,
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

it.skipIf(!existsSync(dirname(OUT)))('dumps KerfDesk .rd bytes for decoding with meerk40t', () => {
  if (ruida === undefined) throw new Error('missing ruida profile');
  const device = ruida.profile;
  const out: Record<string, unknown> = {};
  const two = encodeRdJob(TWO_LAYER, device);
  out['twoLayer'] = two.ok ? hex(two.bytes) : two.error;
  const project = lineProject();
  const abs = emitRdFile(project, { jobOrigin: { startFrom: 'absolute', anchor: 'front-left' } });
  out['projectAbsolute'] = abs.ok ? hex(abs.bytes) : abs.messages;
  const user = emitRdFile(project, {
    jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
  });
  out['projectUserOriginFrontLeft'] = user.ok ? hex(user.bytes) : user.messages;
  const none = emitRdFile(project);
  out['projectNoPlacement'] = none.ok ? hex(none.bytes) : none.messages;
  out['profile'] = {
    origin: device.origin,
    homing: device.homing,
    bedWidth: device.bedWidth,
    bedHeight: device.bedHeight,
    baudRate: device.baudRate ?? null,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 2));
});
