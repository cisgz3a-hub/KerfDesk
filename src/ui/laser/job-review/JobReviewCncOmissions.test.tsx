import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  changedCncArtwork,
  clearCncOmissionReview,
  cncReviewModel,
  cncReviewProject,
  prepareCncOmissionReview,
  resetCncOmissionReview,
  seededCncNavigationModel,
} from '../../../__fixtures__/cnc-omission-review';
import {
  CNC_OMISSION_CLOSED,
  CNC_OMISSION_OPEN_A,
  CNC_OMISSION_OPEN_B,
} from '../../../__fixtures__/cnc-open-contours';
import { LASER_MACHINE_CONFIG } from '../../../core/scene';
import { useLaserStore } from '../../state/laser-store';
import { useStore } from '../../state/store';
import { useUiStore } from '../../state/ui-store';
import { JobReviewDialog } from './JobReviewDialog';
import { useJobReviewStore } from './job-review-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalActions = {
  sendConsoleCommand: useLaserStore.getState().sendConsoleCommand,
  writeGrblSetting: useLaserStore.getState().writeGrblSetting,
  startJob: useLaserStore.getState().startJob,
};
const consoleWrite = vi.fn(async () => undefined);
const settingWrite = vi.fn(async () => undefined);
const startWrite = vi.fn(async () => undefined);
let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  resetCncOmissionReview();
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
  useLaserStore.setState(originalActions);
});

describe('C1 reveal the actual omitted CNC artwork from Job Review', () => {
  it('offers navigation for a real mixed pocket while leaving Start, selection and output unchanged on open', async () => {
    const bundle = await prepareCncOmissionReview();
    const before = useStore.getState();
    const frame = useLaserStore.getState().frameVerification;
    useJobReviewStore.getState().open(cncReviewModel(bundle));

    await renderReview();

    expect.soft(findButton('Show omitted artwork')).toBeDefined();
    expect(button('Start job').disabled).toBe(false);
    expect(useStore.getState().project).toBe(before.project);
    expect(selection()).toEqual(['control']);
    expect(useStore.getState().undoStack).toEqual(before.undoStack);
    expect(useStore.getState().dirty).toBe(false);
    expect(useUiStore.getState().zoomFactor).toBe(1);
    expect(useUiStore.getState().railPanelVisibility.layers).toBe(false);
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    expect(useLaserStore.getState().frameVerification).toBe(frame);
    expectNoSerialWrites();
    await act(async () => button('Start job').click());
    expect(useJobReviewStore.getState().pendingSignal).toBe('confirm');
    expectNoSerialWrites();
  });

  it('cancels review, selects only the two omitted sources, fits them and reveals Artwork without editing output', async () => {
    const bundle = await prepareCncOmissionReview();
    const project = useStore.getState().project;
    useJobReviewStore.getState().open(seededCncNavigationModel(bundle));
    await renderReview();
    const signal = useJobReviewStore.getState().nextSignal();

    await act(async () => button('Show omitted artwork').click());

    await expect(signal).resolves.toBe('cancel');
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
    expect(selection()).toEqual([CNC_OMISSION_OPEN_A.id, CNC_OMISSION_OPEN_B.id]);
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().dirty).toBe(false);
    expect(useUiStore.getState().zoomFactor).toBeGreaterThan(3);
    expect(useUiStore.getState().cutsLayersView).toBe('layers');
    expect(useUiStore.getState().railPanelVisibility.layers).toBe(true);
    expect(useUiStore.getState().railPanelFocusRequest?.panel).toBe('layers');
    expectNoSerialWrites();
  });

  it('rejects IDs reused by changed artwork instead of cancelling or selecting a different shape', async () => {
    const bundle = await prepareCncOmissionReview();
    useJobReviewStore.getState().open(seededCncNavigationModel(bundle));
    await renderReview();
    const show = button('Show omitted artwork');
    const changed = changedCncArtwork(
      changedCncArtwork(bundle.project, CNC_OMISSION_OPEN_A.id),
      CNC_OMISSION_OPEN_B.id,
    );
    await act(async () => useStore.setState({ project: changed }));

    await act(async () => show.click());

    expect(selection()).toEqual(['control']);
    expect(useStore.getState().project).toBe(changed);
    expect(useJobReviewStore.getState().state.kind).toBe('open');
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    expect(useUiStore.getState().zoomFactor).toBe(1);
    expect(useUiStore.getState().railPanelVisibility.layers).toBe(false);
    expectNoSerialWrites();
  });

  it('reveals the surviving omitted source while excluding both stale and successful pocket artwork', async () => {
    const bundle = await prepareCncOmissionReview();
    useJobReviewStore.getState().open(seededCncNavigationModel(bundle));
    await renderReview();
    const show = button('Show omitted artwork');
    const changed = changedCncArtwork(bundle.project, CNC_OMISSION_OPEN_B.id);
    await act(async () => useStore.setState({ project: changed }));

    await act(async () => show.click());

    expect(selection()).toEqual([CNC_OMISSION_OPEN_A.id]);
    expect(useStore.getState().project).toBe(changed);
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
    expect(useUiStore.getState().railPanelVisibility.layers).toBe(true);
    expectNoSerialWrites();
  });

  it('uses regenerated CNC omission sources after re-preparing the current review', async () => {
    const bundle = await prepareCncOmissionReview();
    useJobReviewStore.getState().open(seededCncNavigationModel(bundle));
    await renderReview();
    const repaired = {
      ...bundle.project,
      scene: {
        ...bundle.project.scene,
        objects: bundle.project.scene.objects.filter(
          (object) => object.id !== CNC_OMISSION_OPEN_A.id,
        ),
      },
    };
    await act(async () => {
      useJobReviewStore.getState().beginPrepare();
      const updated = await prepareCncOmissionReview(repaired);
      useJobReviewStore
        .getState()
        .completePrepare(seededCncNavigationModel(updated, [CNC_OMISSION_OPEN_B.id]));
    });

    await act(async () => button('Show omitted artwork').click());

    expect(selection()).toEqual([CNC_OMISSION_OPEN_B.id]);
    expect(useJobReviewStore.getState().state.kind).toBe('idle');
    expect(useJobReviewStore.getState().pendingSignal).toBe('cancel');
    expectNoSerialWrites();
  });

  it.each(['output-off', 'open-capable', 'laser-mode', 'hidden'] as const)(
    'does not navigate to CNC omissions when the current project is %s',
    async (change) => {
      const bundle = await prepareCncOmissionReview();
      useJobReviewStore.getState().open(cncReviewModel(bundle));
      await renderReview();
      const show = button('Show omitted artwork');
      const project = {
        ...bundle.project,
        ...(change === 'laser-mode' ? { machine: LASER_MACHINE_CONFIG } : {}),
        scene: {
          ...bundle.project.scene,
          layers: bundle.project.scene.layers.map((layer) => ({
            ...layer,
            ...(change === 'output-off' ? { output: false } : {}),
            ...(change === 'hidden' ? { visible: false } : {}),
            ...(change === 'open-capable' && layer.cnc !== undefined
              ? { cnc: { ...layer.cnc, cutType: 'engrave' as const } }
              : {}),
          })),
        },
      };
      await act(async () => useStore.setState({ project }));

      await act(async () => show.click());

      expect(selection()).toEqual(['control']);
      expect(useJobReviewStore.getState().state.kind).toBe('open');
      expect(useJobReviewStore.getState().pendingSignal).toBeNull();
      expect(useUiStore.getState().zoomFactor).toBe(1);
      expect(useUiStore.getState().railPanelVisibility.layers).toBe(false);
      expectNoSerialWrites();
    },
  );

  it.each(['preparing', 'blocked'] as const)(
    'does not navigate from a %s review whose displayed sources cannot be acted on',
    async (state) => {
      const bundle = await prepareCncOmissionReview();
      useJobReviewStore.getState().open(seededCncNavigationModel(bundle));
      await renderReview();
      const show = button('Show omitted artwork');
      await act(async () => {
        if (state === 'preparing') useJobReviewStore.getState().beginPrepare();
        else useJobReviewStore.getState().failPrepare(['The prepared artifact is unavailable.']);
      });

      await act(async () => show.click());

      expect(selection()).toEqual(['control']);
      expect(useJobReviewStore.getState().state.kind).toBe('open');
      expect(useJobReviewStore.getState().pendingSignal).toBeNull();
      expect(useUiStore.getState().zoomFactor).toBe(1);
      expect(useUiStore.getState().railPanelVisibility.layers).toBe(false);
      expectNoSerialWrites();
    },
  );

  it('control: archived warning counts never fabricate editable IDs by parsing warning text', async () => {
    const bundle = await prepareCncOmissionReview();
    const { openCncContourOmissions: _omissions, ...legacy } = seededCncNavigationModel(bundle);
    useJobReviewStore.getState().open({
      ...legacy,
      warnings: ['Archived pocket omitted 2 open contours for open-letter-a and fabricated-id.'],
    });

    await renderReview();

    expect(host.textContent).toContain('Archived pocket omitted 2 open contours');
    expect(findButton('Show omitted artwork')).toBeUndefined();
    expect(selection()).toEqual(['control']);
    expect(button('Start job').disabled).toBe(false);
    expectNoSerialWrites();
  });

  it('control: a real closed-only pocket keeps the ordinary Start confirmation available', async () => {
    const bundle = await prepareCncOmissionReview(cncReviewProject([CNC_OMISSION_CLOSED]));
    useJobReviewStore.getState().open(cncReviewModel(bundle));

    await renderReview();

    expect(findButton('Show omitted artwork')).toBeUndefined();
    expect(button('Start job').disabled).toBe(false);
    expect(useJobReviewStore.getState().pendingSignal).toBeNull();
    expectNoSerialWrites();
  });
});

async function renderReview(): Promise<void> {
  root = createRoot(host);
  await act(async () => root?.render(<JobReviewDialog />));
}
function findButton(text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
}
function button(text: string): HTMLButtonElement {
  const found = findButton(text);
  expect(found, 'Expected review button: ' + text).toBeDefined();
  if (found === undefined) throw new Error('Unreachable after button expectation');
  return found;
}
function selection(): ReadonlyArray<string> {
  const state = useStore.getState();
  return [
    ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
    ...state.additionalSelectedIds,
  ].sort();
}
function expectNoSerialWrites(): void {
  expect(consoleWrite).not.toHaveBeenCalled();
  expect(settingWrite).not.toHaveBeenCalled();
  expect(startWrite).not.toHaveBeenCalled();
}
