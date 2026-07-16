import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CoreText from '../../core/text';

const textMocks = vi.hoisted(() => ({
  textToPolylines: vi.fn(async (input: { readonly color: string }) => ({
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
    paths: [
      {
        color: input.color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 5 },
              { x: 0, y: 5 },
            ],
          },
        ],
      },
    ],
  })),
}));

vi.mock('./font-loader', () => ({
  cssFamilyForFont: (key: string) => `lf2-${key}`,
  ensureFontCss: vi.fn(async () => undefined),
  isTracedScriptFontKey: () => false,
  loadFont: vi.fn(async () => new ArrayBuffer(8)),
}));

vi.mock('../../core/text', async (importOriginal) => {
  const actual = await importOriginal<typeof CoreText>();
  return { ...actual, textToPolylines: textMocks.textToPolylines };
});

import { compileCncJob } from '../../core/cnc';
import type { CncGroup, CncPass } from '../../core/job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  primaryOperationForObject,
  type CncMachineConfig,
  type Layer,
  type Project,
  type TextObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { AddTextDialog } from './AddTextDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  useStore.getState().newProject();
  useUiStore.setState({ activeLayerColor: null, textDialog: null });
});

afterEach(() => {
  useStore.getState().newProject();
  useUiStore.setState({ activeLayerColor: null, textDialog: null });
});

describe('text layer machining workflow', () => {
  it('keeps a through-cut box separate from shallow V-carved text through save and compile', async () => {
    const machine = arrangeThroughCutBox();
    useUiStore.setState({ activeLayerColor: '#ff0000', textDialog: { mode: 'add' } });
    const { host, root } = await renderDialog();

    try {
      expect(host.textContent).not.toContain('Output layer');
      expect(host.querySelector('select[aria-label="Text output layer"]')).toBeNull();

      await enterAndSubmit(host, 'NAME');

      let project = useStore.getState().project;
      const text = requireText(project);
      const box = project.scene.objects.find((object) => object.id === 'box');
      if (box === undefined) throw new Error('Box artwork missing');
      const boxOperation = requireOperation(project, box);
      const textOperation = requireOperation(project, text);
      expect(textOperation.id).not.toBe(boxOperation.id);
      expect(text.paths.every((path) => path.color === text.color)).toBe(true);
      expect(boxOperation.cnc).toMatchObject({
        cutType: 'profile-outside',
        depthMm: machine.stock.thicknessMm,
      });
      expect(textOperation.cnc).toMatchObject({ cutType: 'v-carve' });

      useStore.getState().setLayerParam(textOperation.id, {
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...textOperation.cnc, depthMm: 0.75 },
      });
      project = useStore.getState().project;
      expect(
        project.scene.layers.find((operation) => operation.id === textOperation.id)?.cnc,
      ).toMatchObject({
        cutType: 'v-carve',
        depthMm: 0.75,
      });

      const loaded = roundTrip(project);
      expect(
        loaded.scene.layers.find((operation) => operation.id === textOperation.id)?.cnc,
      ).toMatchObject({
        cutType: 'v-carve',
        depthMm: 0.75,
      });

      const groups = cncGroups(project, machine);
      const vCarve = groups.find((group) => group.cutType === 'v-carve');
      const profile = groups.find((group) => group.cutType === 'profile-outside');
      expect(minimumZ(vCarve?.passes ?? [])).toBeGreaterThanOrEqual(-0.75);
      expect(minimumZ(profile?.passes ?? [])).toBe(-machine.stock.thicknessMm);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

function arrangeThroughCutBox(): CncMachineConfig {
  useStore.getState().setMachineKind('cnc');
  useStore.getState().updateCncMachine({ toolId: 'vb-60' });
  useStore.getState().drawShape(
    createRectangle({
      id: 'box',
      color: '#ff0000',
      spec: { widthMm: 40, heightMm: 30, cornerRadiusMm: 0 },
    }),
  );
  const project = useStore.getState().project;
  const machine = requireCncMachine(project);
  const box = project.scene.objects.find((object) => object.id === 'box');
  if (box === undefined) throw new Error('Box artwork missing');
  const boxOperation = requireOperation(project, box);
  useStore.getState().setLayerParam(boxOperation.id, {
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside',
      toolId: 'em-3175',
      depthMm: machine.stock.thicknessMm,
      depthPerPassMm: 2,
    },
  });
  return machine;
}

async function renderDialog() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<AddTextDialog />));
  return { host, root };
}

async function enterAndSubmit(host: HTMLElement, content: string): Promise<void> {
  await act(async () => {
    const textarea = host.querySelector('textarea[aria-label="Text content"]');
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Text content missing');
    textarea.value = content;
    Simulate.change(textarea);
  });
  await act(async () => {
    const form = host.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Text form missing');
    Simulate.submit(form);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function requireCncMachine(project: Project): CncMachineConfig {
  if (project.machine?.kind !== 'cnc') throw new Error('CNC machine missing');
  return project.machine;
}

function requireText(project: Project): TextObject {
  const text = project.scene.objects.find((object) => object.kind === 'text');
  if (text?.kind !== 'text') throw new Error('Text object missing');
  return text;
}

function requireOperation(project: Project, object: Project['scene']['objects'][number]): Layer {
  const operation = primaryOperationForObject(object, project.scene.layers);
  if (operation === null) throw new Error(`Operation missing for ${object.id}`);
  return operation;
}

function roundTrip(project: Project): Project {
  const result = deserializeProject(serializeProject(project));
  if (result.kind !== 'ok') throw new Error(`Round-trip failed: ${JSON.stringify(result)}`);
  return result.project;
}

function cncGroups(project: Project, machine: CncMachineConfig): ReadonlyArray<CncGroup> {
  return compileCncJob(project.scene, project.device, machine).groups.filter(
    (group): group is CncGroup => group.kind === 'cnc',
  );
}

function minimumZ(passes: ReadonlyArray<CncPass>): number {
  return Math.min(
    ...passes.flatMap((pass) => {
      if (pass.kind === 'path3d') return pass.points.map((point) => point.z);
      if (pass.kind === 'helical-contour') return [pass.startZMm, pass.zMm];
      return [pass.zMm];
    }),
  );
}
