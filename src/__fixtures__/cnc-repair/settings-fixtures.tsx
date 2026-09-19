// Reusable forms of the independent 2026-09-12 audit fixtures. These helpers
// neither operate hardware nor write into the preserved audit directory.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileCncJob } from '../../core/cnc/compile-cnc-job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type ImportedSvg,
  type Layer,
  type Project,
} from '../../core/scene';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import { CncLayerFields } from '../../ui/layers/CncLayerFields';
import { useStore } from '../../ui/state';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

export const twoMmTool: CncTool = {
  id: 'repair-tool',
  name: 'Fixture 2 mm',
  kind: 'end-mill',
  diameterMm: 2,
  fluteCount: 2,
};
export const machine: CncMachineConfig = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [twoMmTool],
  toolId: twoMmTool.id,
};
export const profile = { ...DEFAULT_DEVICE_PROFILE, maxFeed: 20000 };

export function layerWith(patch: Partial<CncLayerSettings> = {}): Layer {
  return {
    ...createLayer({ id: 'repair-op', color: '#000000' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      tabsEnabled: false,
      profileLead: { shape: 'none' },
      ...patch,
    },
  };
}

export function rectangle(): ImportedSvg {
  return {
    id: 'repair-square',
    kind: 'imported-svg',
    source: 'fixture-square.svg',
    operationIds: ['repair-op'],
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: 50, minY: 50, maxX: 60, maxY: 56 },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 50, y: 50 },
              { x: 60, y: 50 },
              { x: 60, y: 56 },
              { x: 50, y: 56 },
            ],
          },
        ],
      },
    ],
  };
}

export function projectFor(layer: Layer, cncMachine: CncMachineConfig = machine): Project {
  return {
    ...createProject(),
    device: profile,
    machine: cncMachine,
    scene: { layers: [layer], objects: [rectangle()] },
  };
}

export function settingsFor(project: Project): CncLayerSettings {
  const settings = project.scene.layers[0]?.cnc;
  if (settings === undefined) throw new Error('Missing fixture CNC settings');
  return settings;
}

export function roundTrip(project: Project): Project {
  const result = deserializeProject(serializeProject(project));
  if (result.kind !== 'ok') throw new Error(`Expected valid project: ${JSON.stringify(result)}`);
  return result.project;
}

export function compileProject(project: Project) {
  if (project.machine?.kind !== 'cnc') throw new Error('Missing CNC machine');
  return compileCncJob(project.scene, project.device, project.machine);
}

export function onlyGroup(project: Project) {
  const job = compileProject(project);
  if (job.groups.length !== 1 || job.groups[0]?.kind !== 'cnc') {
    throw new Error('Expected one CNC group');
  }
  return job.groups[0];
}

function ConnectedFields(): JSX.Element {
  const layer = useStore((state) => state.project.scene.layers[0]);
  if (layer === undefined) throw new Error('Missing fixture operation');
  return <CncLayerFields layer={layer} />;
}

export async function renderFields(project: Project) {
  useStore.setState({ project, dirty: false, undoStack: [], redoStack: [] });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ConnectedFields />));
  return {
    host,
    dispose: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

export function field(host: HTMLElement, label: string): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label} for #000000"]`);
  if (input === null) throw new Error(`Missing ${label}`);
  return input;
}

export async function editNumber(host: HTMLElement, label: string, value: string): Promise<void> {
  const input = field(host, label);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('Missing input value setter');
  await act(async () => {
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => input.blur());
}

export async function selectOption(host: HTMLElement, label: string, value: string): Promise<void> {
  const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label} for #000000"]`);
  if (select === null) throw new Error(`Missing ${label}`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
