import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { burnMetrics, type BurnMetrics } from '../../__fixtures__/returning-user/burn-metrics';
import type { RotarySetup } from '../../core/devices';
import { rotaryAxisNeedsConfirmation, rotaryAxisOf } from '../../core/devices/rotary-axis';
import { rotaryOutputAxis, type JobOriginPlacement } from '../../core/job';
import type { Project } from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutputSnapshot } from '../../io/gcode/prepare-output-snapshot';
import { deserializeProject } from '../../io/project/deserialize-project';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { renderVariableText } from '../text/render-variable-text';
import { startRotaryEdit } from './rotary-setup-edit';
import { rotaryReviewSummary } from './rotary-summary';

// ADR-693: a project the published 1.0.29 (`df2279e26`) saved with its rotary
// on (Creality chuck preset, Ø80, a line square and a 90° fill), built through
// 1.0.29's own store and measured there; see the folder's README. It has no
// rotary axis, so it opens on Y and burns what 1.0.29 burned.
const FOLDER = 'src/__fixtures__/returning-user';
const NAME = '1.0.29-rotary';

type Sidecar = {
  readonly rotary: RotarySetup;
  readonly burns: Readonly<Record<string, BurnMetrics>>;
};

const PLACEMENTS: Readonly<Record<string, JobOriginPlacement | undefined>> = {
  absolute: undefined,
  'current-position-center': {
    startFrom: 'current-position',
    anchor: 'center',
    currentPosition: { x: 120, y: 80 },
  },
  'user-origin-front-left': { startFrom: 'user-origin', anchor: 'front-left' },
};

function fileText(): string {
  return gunzipSync(readFileSync(resolve(FOLDER, `${NAME}.lf2.gz`))).toString('utf8');
}

function sidecar(): Sidecar {
  return JSON.parse(readFileSync(resolve(FOLDER, `${NAME}.burns.json`), 'utf8'));
}

function opened(): Project {
  const result = deserializeProject(fileText());
  if (result.kind !== 'ok') throw new Error(`${NAME} did not open: ${JSON.stringify(result)}`);
  expect(result.migratedFrom).toBeUndefined();
  expect(result.oldProjectBurn).toBeUndefined();
  return result.project;
}

async function gcodeOf(project: Project, placement: JobOriginPlacement | undefined) {
  const prepared = await prepareOutputSnapshot(project, {
    clock: () => new Date('2026-11-02T00:00:00Z'),
    renderVariableText,
    ...(placement === undefined ? {} : { jobOrigin: placement }),
  });
  if (!prepared.ok) throw new Error('output refused');
  return emitPreparedGcode(prepared, placement === undefined ? {} : { jobOrigin: placement }).gcode;
}

describe('a rotary project saved by 1.0.29', () => {
  it('opens on the Y axis with its rotary exactly as saved', () => {
    const rotary = opened().device.rotary;
    expect(rotary).toEqual(sidecar().rotary);
    expect(rotaryAxisOf(rotary)).toBe('Y');
    expect(rotaryAxisNeedsConfirmation(rotary ?? {})).toBe(false);
    if (rotary === undefined) throw new Error('no rotary');
    expect(startRotaryEdit(rotary).setup).toEqual(rotary);
    expect(rotaryReviewSummary(rotary)).toBe(
      'Enabled · Chuck, Ø80 mm · Y ×0.16, one revolution = 40 machine mm',
    );
  });

  it.each(Object.keys(PLACEMENTS))('burns what 1.0.29 burned from %s', async (placement) => {
    const project = opened();
    expect(rotaryOutputAxis(project.device, project.machine)).toBeNull();
    const gcode = await gcodeOf(project, PLACEMENTS[placement]);
    expect(gcode).not.toMatch(/^G92/m);
    expect(gcode).not.toMatch(/^[^;]*A-?\d/m);
    const wanted = sidecar().burns[placement];
    if (wanted === undefined) throw new Error(`no sidecar burn for ${placement}`);
    const actual = burnMetrics(gcode);
    for (const key of ['width', 'height', 'minX', 'minY', 'length', 'dose'] as const)
      expect(actual[key], `${placement} ${key}`).toBeCloseTo(wanted[key], 2);
  });

  it('saves again without an axis field', () => {
    const saved = prepareProjectForPersistence(opened());
    if (saved.kind !== 'ok') throw new Error('did not save');
    const again = deserializeProject(saved.json);
    if (again.kind !== 'ok') throw new Error('did not reopen');
    expect(again.project.device.rotary).toEqual(sidecar().rotary);
  });
});
