import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import { duplicateSceneSelection } from '../../ui/state/duplicate-scene-selection';
import { renderVariableText } from '../../ui/text/render-variable-text';
import { deserializeProject, deserializeProjectValue } from '../project/deserialize-project';
import { serializeProject } from '../project/serialize-project';
import { emitPreparedGcode } from './emit-gcode';
import { prepareOutputSnapshot } from './prepare-output-snapshot';

const NOW = new globalThis.Date('2026-09-04T00:00:00.000Z');

function migratedTextProject(): Project {
  const text: TextObject = {
    kind: 'text',
    id: 'label',
    content: 'fallback',
    color: '#ff0000',
    fontKey: 'relief-single-line',
    sizeMm: 3,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
        ],
      },
    ],
    powerScale: 25,
    operationOverride: { power: 80, speed: 500, passes: 3, airAssist: true },
    variableTemplate: {
      tokens: [
        { kind: 'cut-setting', field: 'power-percent' },
        { kind: 'literal', value: '/' },
        { kind: 'cut-setting', field: 'speed-mm-min' },
        { kind: 'literal', value: '/' },
        { kind: 'cut-setting', field: 'passes' },
        { kind: 'literal', value: '/' },
        { kind: 'cut-setting', field: 'air-assist' },
      ],
    },
  };
  const loaded = deserializeProjectValue({
    ...createProject(),
    schemaVersion: 2,
    scene: {
      objects: [text],
      layers: [{ ...createLayer({ id: 'red', color: text.color }), power: 10, speed: 1000 }],
    },
  });
  expect(loaded).toMatchObject({ kind: 'ok', migratedFrom: 2 });
  if (loaded.kind !== 'ok') throw new Error('legacy text fixture must load');
  expect(loaded.project.scene.objects[0]).toMatchObject({
    paths: [{ operationIds: ['red:artwork-label'] }],
  });
  return loaded.project;
}

describe('variable snapshot operation bindings', () => {
  it.each(['migrated', 'reopened', 'duplicated'] as const)(
    'preserves %s text ownership through real geometry and G-code',
    async (source) => {
      let project = migratedTextProject();
      if (source === 'reopened') {
        const reopened = deserializeProject(serializeProject(project));
        expect(reopened.kind).toBe('ok');
        if (reopened.kind !== 'ok') return;
        project = reopened.project;
      }
      if (source === 'duplicated') {
        const duplicated = duplicateSceneSelection(project.scene, ['label'], (id) => `${id}-copy`);
        project = { ...project, scene: duplicated.scene };
      }
      const before = serializeProject(project);
      const prepared = await prepareOutputSnapshot(project, {
        clock: () => NOW,
        renderVariableText,
      });
      expect(prepared.ok).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.job.groups.length).toBeGreaterThan(0);
      for (const group of prepared.job.groups) {
        expect(group).toMatchObject({ power: 20, speed: 500, passes: 3, airAssist: true });
      }
      for (const object of prepared.project.scene.objects) {
        expect(object).toMatchObject({
          content: '20/500/3/on',
          paths: [{ operationIds: ['red:artwork-label'] }],
        });
      }
      const emitted = emitPreparedGcode(prepared);
      expect(emitted.gcode).toContain('F500');
      expect(emitted.gcode).not.toContain('F1000');
      expect(emitted.gcode).toContain(`S${Math.round((project.device.maxPowerS * 20) / 100)}`);
      expect(serializeProject(project)).toBe(before);
    },
  );
});
