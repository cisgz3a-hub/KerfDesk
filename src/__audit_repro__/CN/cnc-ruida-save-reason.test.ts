// Audit track CN (2026-09-25) — Save of a CNC project on a Ruida (.rd export)
// profile.
//
// Correct behaviour: the refusal is factual (the .rd encoder cannot represent
// a CNC router job, ADR-097), so refusing is right, but the message must name
// that reason — a CNC (router) job cannot be exported as a Ruida .rd laser
// file — not blame "Fill/Image raster output" and advise "Use Line mode layers",
// which a CNC layer does not have. rd-encoder.ts:68-71 maps every group whose
// kind is not 'cut' (including kind 'cnc') to the 'raster-unsupported' error.
// (Ruida: laser-only DSP controllers; meerk40t ruida/ driver/emulator in the
// pinned upstream tree has no router/spindle concept.)
//
// Expected result on current code: the "correct behaviour" test FAILS.

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
import { emitRdFile } from '../../io/rd';

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
  it('refuses to produce an .rd file (fact, correct)', () => {
    const result = emitRdFile(ruidaCncProject());
    expect(result.ok).toBe(false);
  });

  it('correct: the refusal names the CNC/router reason, not raster (FAILS on current code)', () => {
    const result = emitRdFile(ruidaCncProject());
    if (result.ok) throw new Error('expected a refusal');
    const text = result.messages.join('\n');
    expect(text).not.toMatch(/Fill\/Image raster/);
    expect(text).toMatch(/CNC|router/i);
  });
});
