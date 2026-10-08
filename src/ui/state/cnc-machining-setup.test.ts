import { beforeEach, describe, expect, it } from 'vitest';
import { projectWithLine } from '../../__fixtures__/file-actions';
import { DEFAULT_CNC_MACHINE_CONFIG, PROJECT_SCHEMA_VERSION } from '../../core/scene';
import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import { deserializeProject, serializeProject } from '../../io/project';
import { emitGcode } from '../../io/gcode';
import { deviceSetupReducer, initDeviceSetup } from '../laser/device-setup/device-setup-flow';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);
const setup = {
  ...defaultCncMachiningSetup(),
  name: 'Sign face',
  notes: 'Clamp at back',
  fixtures: [
    {
      id: 'clamp-1',
      name: 'Back clamp',
      xMm: 20,
      yMm: 30,
      widthMm: 12,
      heightMm: 18,
      bottomZMm: 0,
      topZMm: 14,
    },
  ],
};
function project() {
  return { ...projectWithLine(), machine: DEFAULT_CNC_MACHINE_CONFIG };
}

describe('retained CNC machining setup', () => {
  it('migrates legacy CNC coordinates without altering emitted G-code', () => {
    const original = project();
    const raw = JSON.parse(serializeProject(original)) as Record<string, unknown>;
    raw['schemaVersion'] = 14;
    const opened = deserializeProject(JSON.stringify(raw));
    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') throw new Error('open failed');
    expect(opened.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(opened.project.cncSetup).toEqual(defaultCncMachiningSetup());
    expect(opened.project.machine).toEqual(original.machine);
    expect(emitGcode(opened.project).gcode).toEqual(emitGcode(original).gcode);
  });
  it('round trips setup identity and program-coordinate fixtures', () => {
    const original = { ...project(), cncSetup: setup };
    const opened = deserializeProject(serializeProject(original));
    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') throw new Error('open failed');
    expect(opened.project.cncSetup).toEqual(setup);
    expect(emitGcode(opened.project).gcode).toEqual(emitGcode(project()).gcode);
  });
  it('rejects malformed and duplicate fixture envelopes', () => {
    for (const fixtures of [
      [{ ...setup.fixtures[0]!, widthMm: -1 }],
      [{ ...setup.fixtures[0]!, topZMm: 0 }],
      [setup.fixtures[0], setup.fixtures[0]],
    ]) {
      const raw = { ...project(), cncSetup: { ...setup, fixtures } };
      expect(deserializeProject(JSON.stringify(raw)).kind).toBe('invalid');
    }
  });
  it('keeps edits in the setup draft until atomic Save and restores them on Undo', () => {
    const original = project();
    useStore.setState({ project: original });
    const initialized = initDeviceSetup(original.device, null, { machine: original.machine });
    const draft = deviceSetupReducer(initialized, { kind: 'edit-cnc-setup', setup });
    expect(useStore.getState().project).toBe(original);
    useStore.getState().replaceCncStartupSetup(draft.draft, draft.draftMachine, draft.cncDraft, {
      cncSetup: draft.cncSetupDraft,
      operationDrafts: [],
      customTools: [],
      materialApplyRequested: false,
    });
    expect(useStore.getState().project.cncSetup).toEqual(setup);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.cncSetup).toBeUndefined();
    useStore.getState().redo();
    expect(useStore.getState().project.cncSetup).toEqual(setup);
  });
  it('parks named setup metadata through Laser save and returns it to CNC', () => {
    const original = { ...project(), cncSetup: setup };
    useStore.setState({ project: original, cachedCncMachine: DEFAULT_CNC_MACHINE_CONFIG });
    useStore.getState().setMachineKind('laser');
    const opened = deserializeProject(serializeProject(useStore.getState().project));
    expect(opened.kind).toBe('ok');
    if (opened.kind !== 'ok') throw new Error('open failed');
    expect(opened.project.cncSetup).toEqual(setup);
    useStore.setState({ project: opened.project });
    useStore.getState().setMachineKind('cnc');
    expect(useStore.getState().project.cncSetup).toEqual(setup);
  });
});
