import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type ReliefObject,
} from '../../core/scene';
import { useStore } from '../state';
import { svgObj } from '../state/test-helpers';
import { useTutorialStore } from '../tutorials/tutorial-store';
import { MaterialPresetWizard } from '../material-library/wizard/MaterialPresetWizard';
import { ArtworkRunOrderPanel } from './ArtworkRunOrderPanel';
import { CncLayerFields } from './CncLayerFields';
import { CutsLayersPanel } from './CutsLayersPanel';
import { MaterialLibraryPanel } from './MaterialLibraryPanel';
import { SelectedReliefProperties } from './SelectedReliefProperties';
import { button, click, layer, mount } from './control-audit-test-support';

async function lesson(host: HTMLElement, id: string) {
  const trigger = host.querySelector<HTMLButtonElement>(`[data-tutorial-id="${id}"]`);
  if (!trigger) throw new Error(`Missing contextual trigger ${id}`);
  const project = useStore.getState().project;
  const history = useStore.getState().undoStack;
  await click(trigger);
  expect(useTutorialStore.getState()).toMatchObject({ isOpen: true, tutorialId: id });
  expect(useStore.getState().project).toBe(project);
  expect(useStore.getState().undoStack).toBe(history);
}
describe('artwork control audit: contextual lesson bindings', () => {
  it('opens the run order lesson from its toolbar', async () => {
    useStore.getState().importSvgObject(svgObj('Part', ['#000000']));
    await lesson(await mount(<ArtworkRunOrderPanel />), 'operations');
  });
  it.each(['line', 'fill', 'image'] as const)(
    'opens the selected %s process lesson',
    async (mode) => {
      useStore.getState().importSvgObject(svgObj('Part', ['#000000']));
      useStore.getState().setLayerParam(layer().id, { mode });
      const id = mode === 'line' ? 'laser-cut' : mode === 'fill' ? 'laser-fill' : 'laser-image';
      await lesson(await mount(<CutsLayersPanel />), id);
    },
  );
  it.each(['profile-outside', 'pocket', 'v-carve'] as const)(
    'opens the CNC %s cut type lesson',
    async (cutType) => {
      useStore.getState().setMachineKind('cnc');
      useStore.getState().importSvgObject(svgObj('Part', ['#000000']));
      useStore
        .getState()
        .setLayerParam(layer().id, { cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType } });
      const id =
        cutType === 'profile-outside'
          ? 'cnc-profile'
          : cutType === 'pocket'
            ? 'cnc-pocket'
            : 'cnc-vcarve';
      await lesson(await mount(<CncLayerFields layer={layer()} />), id);
    },
  );
  it('opens the holding tabs lesson from the profile fields', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().importSvgObject(svgObj('Part', ['#000000']));
    const host = await mount(<CncLayerFields layer={layer()} />);
    const summary = [...host.querySelectorAll('summary')].find((element) =>
      element.textContent?.startsWith('Holding tabs'),
    );
    if (summary === undefined) throw new Error('Missing Holding tabs disclosure');
    await click(summary);
    expect(summary.closest('details')?.open).toBe(true);
    await lesson(host, 'cnc-tabs');
  });
  it('opens the material library lesson from the panel and the preset wizard', async () => {
    await lesson(await mount(<MaterialLibraryPanel />), 'materials');
    useTutorialStore.getState().closeTutorial();
    await lesson(await mount(<MaterialPresetWizard onClose={() => undefined} />), 'materials');
  });
  it('opens the offset and dogbone lessons beside eligible geometry tools', async () => {
    const object = svgObj('Part', ['#000000']);
    const paths = [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
          },
        ],
      },
    ];
    useStore.getState().setMachineKind('cnc');
    useStore.getState().importSvgObject({ ...object, paths });
    const host = await mount(<CutsLayersPanel />);
    await click(button(host, 'Artwork'));
    await lesson(host, 'offset');
    useTutorialStore.getState().closeTutorial();
    await lesson(host, 'dogbone');
  });
  it('opens the selected relief lesson', async () => {
    const relief: ReliefObject = {
      kind: 'relief',
      id: 'relief',
      source: 'audit.stl',
      targetWidthMm: 10,
      reliefDepthMm: 2,
      reliefSource: {
        kind: 'legacy-mesh',
        meshPositions: [0, 0, 0, 10, 0, 0, 0, 10, 2],
        emptyCells: 'floor',
      },
      color: '#000000',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
    };
    useStore.getState().setMachineKind('cnc');
    useStore.setState((state) => ({
      project: { ...state.project, scene: { ...state.project.scene, objects: [relief] } },
      selectedObjectId: relief.id,
    }));
    await lesson(await mount(<SelectedReliefProperties />), 'cnc-relief');
  });
});
