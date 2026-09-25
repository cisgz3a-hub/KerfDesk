// A CNC project on the Ruida profile is refused as a router job, not as an
// unsupported raster layer (controller audit 2026-09-25 CN-3). The .rd layer
// model is laser power and speed; meerk40t's Ruida code has no spindle or RPM
// concept (meerk40t @7e82652f meerk40t/ruida/*.py).

import { describe, expect, it } from 'vitest';

import { profileCatalogEntryById } from '../../core/devices/profile-catalog';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitRdFile } from './emit-rd';

function square(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'cn-ruida.svg',
    bounds: { minX: 10, minY: 10, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x: 10, y: 10 },
              { x: 60, y: 10 },
              { x: 60, y: 60 },
              { x: 10, y: 60 },
            ],
            closed: true,
          },
        ],
      },
    ],
  };
}

function ruidaCncProject(): Project {
  const entry = profileCatalogEntryById('generic-ruida-rd-export');
  if (entry === undefined) throw new Error('missing Ruida catalog profile');
  const base = createProject(entry.profile);
  const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), cnc: DEFAULT_CNC_LAYER_SETTINGS };
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: addLayer(addObject(base.scene, square()), layer),
  };
}

describe('CN: CNC project saved on a Ruida profile', () => {
  it('refuses to produce an .rd file', () => {
    const result = emitRdFile(ruidaCncProject());
    expect(result.ok).toBe(false);
  });

  it('names the CNC/router reason, not raster', () => {
    const result = emitRdFile(ruidaCncProject());
    if (result.ok) throw new Error('expected a refusal');
    const text = result.messages.join('\n');
    expect(text).not.toMatch(/Fill\/Image raster/);
    expect(text).toMatch(/CNC|router/i);
  });
});
