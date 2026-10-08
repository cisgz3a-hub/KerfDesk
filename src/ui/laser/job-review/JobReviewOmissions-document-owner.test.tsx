import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearFillReviewState,
  prepareReview,
  resetFillReviewState,
  reviewModel,
  reviewProject,
} from '../../../__fixtures__/fill-omission-review';
import {
  clearCncOmissionReview,
  cncReviewModel,
  cncReviewProject,
  prepareCncOmissionReview,
  resetCncOmissionReview,
} from '../../../__fixtures__/cnc-omission-review';
import type { Project } from '../../../core/scene';
import { deserializeProject, serializeProject } from '../../../io/project';
import { DEFAULT_JOB_PLACEMENT } from '../../job-placement';
import { useLaserStore } from '../../state/laser-store';
import { useStore } from '../../state/store';
import { useUiStore } from '../../state/ui-store';
import type { JobReviewModel } from './job-review-model';
import { useJobReviewStore } from './job-review-store';
import { matchingReviewArtworkIds } from './review-artwork-sources';
import { ShowOmittedFillArtworkButton } from './ShowOmittedFillArtworkButton';
import { ShowOmittedCncArtworkButton } from './ShowOmittedCncArtworkButton';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Machine = 'laser' | 'cnc';
const originalActions = {
  sendConsoleCommand: useLaserStore.getState().sendConsoleCommand,
  writeGrblSetting: useLaserStore.getState().writeGrblSetting,
  startJob: useLaserStore.getState().startJob,
};
const consoleWrite = vi.fn(async () => undefined);
const settingWrite = vi.fn(async () => undefined);
const startWrite = vi.fn(async () => undefined);
let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  resetFillReviewState();
  vi.clearAllMocks();
  useLaserStore.setState({
    sendConsoleCommand: consoleWrite,
    writeGrblSetting: settingWrite,
    startJob: startWrite,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  clearCncOmissionReview();
  clearFillReviewState();
  useLaserStore.setState(originalActions);
});

function canonical(project: Project): Project {
  const saved = { ...project, jobSetup: { ...project.jobSetup, placement: DEFAULT_JOB_PLACEMENT } };
  const result = deserializeProject(serializeProject(saved));
  if (result.kind !== 'ok')
    throw new Error('Expected canonical sheet fixture: ' + JSON.stringify(result));
  return result.project;
}
async function preparedModel(machine: Machine, project: Project): Promise<JobReviewModel> {
  return machine === 'laser'
    ? reviewModel(await prepareReview(project))
    : cncReviewModel(await prepareCncOmissionReview(project));
}
async function sourceModel(machine: Machine, sheetBook: boolean): Promise<JobReviewModel> {
  if (machine === 'cnc') resetCncOmissionReview();
  // Canonicalize before review so a real sheet archive/reopen retains identical
  // source content; correspondence alone must not disguise a new document owner.
  const source = machine === 'laser' ? reviewProject() : cncReviewProject();
  // The original in-memory Fill fixture repeats its black operation colour.
  // Persisted sheets require unique operation colours; explicit path bindings
  // keep this disabled operation disabled after giving it its own colour.
  const persistable =
    machine === 'laser'
      ? {
          ...source,
          scene: {
            ...source.scene,
            layers: source.scene.layers.map((layer) =>
              layer.id === 'off' ? { ...layer, color: '#777777' } : layer,
            ),
          },
        }
      : source;
  const project = canonical(persistable);
  expect(useStore.getState().setProject(project).kind).not.toBe('desktop-required');
  if (sheetBook) expect(useStore.getState().addProjectSheet('Reviewed copy', true)).not.toBeNull();
  return preparedModel(machine, useStore.getState().project);
}
function omission(model: JobReviewModel, machine: Machine) {
  const sources = machine === 'laser' ? model.openFillOmissions : model.openCncContourOmissions;
  if (sources === undefined) throw new Error('Expected actual prepared omission sources');
  expect(sources.objectIds.length).toBeGreaterThan(1);
  return sources;
}
async function renderAction(model: JobReviewModel, machine: Machine): Promise<void> {
  root ??= createRoot(host);
  await act(async () => {
    if (machine === 'laser') {
      const omissions = model.openFillOmissions;
      if (omissions === undefined) throw new Error('Expected Fill sources');
      root?.render(<ShowOmittedFillArtworkButton omissions={omissions} />);
    } else {
      const omissions = model.openCncContourOmissions;
      if (omissions === undefined) throw new Error('Expected CNC sources');
      root?.render(<ShowOmittedCncArtworkButton omissions={omissions} />);
    }
  });
}
async function clickReveal(): Promise<void> {
  const button = host.querySelector('button');
  if (button === null) throw new Error('Expected actual omission button');
  await act(async () => button.click());
}
function selectedIds(): string[] {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ].sort();
}
function assertCorrespondence(model: JobReviewModel, machine: Machine): void {
  const sources = omission(model, machine);
  expect(
    matchingReviewArtworkIds(sources.sources, useStore.getState().project.scene.objects).sort(),
  ).toEqual([...sources.objectIds].sort());
}
function expectNoHardware(): void {
  expect(consoleWrite).not.toHaveBeenCalled();
  expect(settingWrite).not.toHaveBeenCalled();
  expect(startWrite).not.toHaveBeenCalled();
}
async function expectOldReviewDoesNotReveal(): Promise<void> {
  const before = useStore.getState();
  const selection = selectedIds();
  const frame = useLaserStore.getState().frameVerification;
  const zoom = useUiStore.getState().zoomFactor;
  await clickReveal();
  expect(useJobReviewStore.getState().state.kind).toBe('open');
  expect(useJobReviewStore.getState().pendingSignal).toBeNull();
  expect(selectedIds()).toEqual(selection);
  expect(useStore.getState().project).toBe(before.project);
  expect(useStore.getState().undoStack).toBe(before.undoStack);
  expect(useStore.getState().dirty).toBe(before.dirty);
  expect(useUiStore.getState().zoomFactor).toBe(zoom);
  expect(useUiStore.getState().railPanelVisibility.layers).toBe(false);
  expect(useLaserStore.getState().frameVerification).toBe(frame);
  expectNoHardware();
}

for (const machine of ['laser', 'cnc'] as const) {
  describe(machine + ' omission navigation document ownership', () => {
    it.each(['switch', 'duplicate'] as const)(
      'rejects a pending old review after a real %s with identical source IDs and content',
      async (change) => {
        const model = await sourceModel(machine, change === 'switch');
        const beforeEpoch = useStore.getState().projectDocumentEpoch;
        const sheetId = useStore.getState().project.sheetBook?.inactive[0]?.id;
        expect(useJobReviewStore.getState().open(model)).toBe(true);
        await renderAction(model, machine);
        await act(async () => {
          if (change === 'switch') {
            if (sheetId === undefined) throw new Error('Expected alternate archived sheet');
            expect(useStore.getState().switchProjectSheet(sheetId)).toBe(true);
          } else expect(useStore.getState().addProjectSheet('New duplicate', true)).not.toBeNull();
        });
        expect(useStore.getState().projectDocumentEpoch).toBe(beforeEpoch + 1);
        assertCorrespondence(model, machine);
        await expectOldReviewDoesNotReveal();
      },
    );

    it('does not rebind an old request when its displayed model is rebuilt for a new duplicate sheet', async () => {
      const model = await sourceModel(machine, false);
      expect(useJobReviewStore.getState().open(model)).toBe(true);
      await renderAction(model, machine);
      const request = useJobReviewStore.getState().requestOwner;
      expect(useStore.getState().addProjectSheet('New duplicate', true)).not.toBeNull();
      const rebuilt = await preparedModel(machine, useStore.getState().project);
      useJobReviewStore.getState().beginPrepare();
      useJobReviewStore.getState().completePrepare(rebuilt);
      expect(useJobReviewStore.getState().requestOwner).toBe(request);
      await renderAction(rebuilt, machine);
      assertCorrespondence(rebuilt, machine);
      await expectOldReviewDoesNotReveal();
      // A newly opened review of this document can navigate normally.
      useJobReviewStore.getState().close();
      expect(useJobReviewStore.getState().open(rebuilt)).toBe(true);
      await renderAction(rebuilt, machine);
      await clickReveal();
      expect(selectedIds()).toEqual([...omission(rebuilt, machine).objectIds].sort());
      expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
      expectNoHardware();
    });

    it('allows same-document content-preserving updates and sheet renames without changing Start signals or output', async () => {
      const model = await sourceModel(machine, true);
      const state = useStore.getState();
      const epoch = state.projectDocumentEpoch;
      const activeId = state.project.sheetBook?.activeId;
      expect(activeId).toBeDefined();
      expect(useJobReviewStore.getState().open(model)).toBe(true);
      await renderAction(model, machine);
      await act(async () => {
        useStore.setState({
          project: structuredClone({ ...useStore.getState().project, notes: 'Same document edit' }),
        });
        if (activeId !== undefined)
          useStore.getState().renameProjectSheet(activeId, 'Same owner, new name');
      });
      expect(useStore.getState().projectDocumentEpoch).toBe(epoch);
      assertCorrespondence(model, machine);
      const before = useStore.getState();
      const frame = useLaserStore.getState().frameVerification;
      const signal = useJobReviewStore.getState().nextSignal();
      await clickReveal();
      await expect(signal).resolves.toBe('cancel');
      expect(selectedIds()).toEqual([...omission(model, machine).objectIds].sort());
      expect(useStore.getState().project).toBe(before.project);
      expect(useStore.getState().undoStack).toBe(before.undoStack);
      expect(useStore.getState().dirty).toBe(before.dirty);
      expect(useJobReviewStore.getState().state.kind).toBe('idle');
      expect(useUiStore.getState().railPanelVisibility.layers).toBe(true);
      expect(useLaserStore.getState().frameVerification).toBe(frame);
      expect(JSON.stringify(model)).not.toContain('requestDocumentEpoch');
      expect(serializeProject(before.project)).not.toContain('requestDocumentEpoch');
      expectNoHardware();
    });
  });
}
