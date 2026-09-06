import { beforeEach, describe, expect, it } from 'vitest';
import { effectiveOperationForObject } from '../../core/effective-output';
import { compileJob } from '../../core/job';
import { grblStrategy } from '../../core/output/grbl-strategy';
import { createLayer, createProject, type LayerMode, type Project } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { readCutSettingsPatch } from '../layers/cut-settings-draft';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);

describe('artwork override power-mode authoring', () => {
  it.each(['line', 'fill'] as const)(
    'preserves Constant, Dynamic and Auto from the %s form through output and reopening',
    (mode) => {
      useStore.setState({ project: projectWithOverride(mode) });

      for (const [choice, word] of [
        ['dynamic', 'M4'],
        ['constant', 'M3'],
        ['auto', 'M4'],
      ] as const) {
        applyFormPowerMode(choice);
        const project = useStore.getState().project;
        expect(project.scene.objects[0]?.operationOverride?.byOperation?.operation).toMatchObject({
          power: 40,
          powerMode: choice,
        });
        expect(poweredMotionModes(project)).toEqual([word]);

        const reopened = reopen(project);
        expect(reopened.scene.objects[0]?.operationOverride).toEqual(
          project.scene.objects[0]?.operationOverride,
        );
        expect(poweredMotionModes(reopened)).toEqual([word]);
        useStore.setState({ project: reopened });
      }

      // Auto remains tied to the current device default, not the profile that
      // was active when the artwork override was authored.
      const project = useStore.getState().project;
      expect(
        poweredMotionModes({
          ...project,
          device: { ...project.device, gcodeDialect: { dialectId: 'grbl-compatible' } },
        }),
      ).toEqual(['M3']);
    },
  );

  it('keeps an edited power mode scoped to its artwork and operation', () => {
    const project = projectWithOverride('line');
    const operation = project.scene.layers[0];
    const object = project.scene.objects[0];
    if (operation === undefined || object === undefined) throw new Error('Missing fixture');
    const otherOperation = { ...operation, id: 'other-operation' };
    const sharedObject = { ...object, operationIds: ['operation', 'other-operation'] };
    const untouchedObject = { ...object, id: 'untouched' };
    useStore.setState({
      project: {
        ...project,
        scene: {
          layers: [operation, otherOperation],
          objects: [sharedObject, untouchedObject],
        },
      },
    });

    applyFormPowerMode('dynamic');

    const [updated, untouched] = useStore.getState().project.scene.objects;
    if (updated === undefined || untouched === undefined) throw new Error('Missing artwork');
    expect(effectiveOperationForObject(operation, updated).powerMode).toBe('dynamic');
    expect(effectiveOperationForObject(otherOperation, updated).powerMode).toBe('constant');
    expect(untouched).toBe(untouchedObject);
  });

  it('supports legacy selected-artwork changes and keeps omitted power mode unchanged', () => {
    useStore.setState({ project: projectWithOverride('fill'), selectedObjectId: 'artwork' });
    useStore.getState().setSelectedObjectsOperationOverride({ power: 35 });
    expect(useStore.getState().project.scene.objects[0]?.operationOverride).not.toHaveProperty(
      'powerMode',
    );
    expect(poweredMotionModes(useStore.getState().project)).toEqual(['M3']);
    useStore.getState().setSelectedObjectsOperationOverride({ powerMode: 'dynamic' });
    expect(poweredMotionModes(useStore.getState().project)).toEqual(['M4']);

    useStore.getState().setSelectedObjectsOperationOverride({ power: 35 });
    expect(useStore.getState().project.scene.objects[0]?.operationOverride).toMatchObject({
      power: 35,
      powerMode: 'dynamic',
    });
    useStore.getState().setSelectedObjectsOperationOverride({ powerMode: undefined });
    const reopened = reopen(useStore.getState().project);
    expect(reopened.scene.objects[0]?.operationOverride).toMatchObject({ powerMode: 'auto' });
    expect(poweredMotionModes(reopened)).toEqual(['M4']);
  });
});

function projectWithOverride(mode: LayerMode): Project {
  const layer = {
    ...createLayer({ id: 'operation', color: '#000000', mode }),
    powerMode: 'constant' as const,
    hatchSpacingMm: 1,
    passes: 2,
  };
  const object = {
    ...createRectangle({
      id: 'artwork',
      color: '#000000',
      spec: { widthMm: 8, heightMm: 5, cornerRadiusMm: 0 },
    }),
    operationIds: ['operation'],
    operationOverride: { power: 40 },
  };
  return { ...createProject(), scene: { layers: [layer], objects: [object] } };
}

function applyFormPowerMode(value: 'constant' | 'dynamic' | 'auto'): void {
  const project = useStore.getState().project;
  const layer = project.scene.layers[0];
  const object = project.scene.objects[0];
  if (layer === undefined || object === undefined) throw new Error('Missing form context');
  const effective = effectiveOperationForObject(layer, object);
  const form = new FormData();
  form.set('mode', effective.mode);
  form.set('powerMode', value);
  const patch = readCutSettingsPatch(form, effective);
  useStore.getState().setObjectsOperationOverrideForOperation([object.id], layer.id, patch);
}

function poweredMotionModes(project: Project): string[] {
  const output = grblStrategy.emit(compileJob(project.scene, project.device), project.device);
  const modes = new Set<string>();
  let mode = '';
  let power = 0;
  for (const line of output.split('\n')) {
    const nextMode = /^(M[345])\b/.exec(line)?.[1];
    if (nextMode !== undefined) mode = nextMode;
    const nextPower = /\bS([\d.]+)/.exec(line)?.[1];
    if (nextPower !== undefined) power = Number(nextPower);
    if (/^G1\b/.test(line) && power > 0) modes.add(mode);
  }
  expect(modes.size).toBeGreaterThan(0);
  return [...modes];
}

function reopen(project: Project): Project {
  const result = deserializeProject(serializeProject(project));
  if (result.kind !== 'ok') throw new Error(JSON.stringify(result));
  return result.project;
}
