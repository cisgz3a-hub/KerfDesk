import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type RasterImage,
  type ReliefObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import * as imageDecode from '../image-editor/image-editor-decode';
import { ArtworkRunOrderPanel } from './ArtworkRunOrderPanel';
import { OffsetPathsRow } from './OffsetPathsRow';
import { DogboneRow } from './DogboneRow';
import { SelectedSourceReimportControl } from './SelectedSourceReimportControl';
import { SelectedImageAdjustments } from './SelectedImageAdjustments';
import { SelectedReliefProperties } from './SelectedReliefProperties';
import {
  arrangeTwo,
  auditPlatform,
  button,
  change,
  click,
  input,
  mount,
} from './control-audit-test-support';

export function square(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
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
    ],
  };
}
describe('artwork control audit: utilities', () => {
  it('jumps to a numbered run selects through its native button and opens its settings', async () => {
    arrangeTwo();
    useUiStore.getState().setCutsLayersView('run-order');
    const host = await mount(<ArtworkRunOrderPanel />);
    await change(input(host, '[aria-label="Jump to run number"]'), '1');
    await click(button(host, 'Go'));
    expect(useStore.getState().selectedObjectId).toBe('First');
    expect(useUiStore.getState().artworkRunFocus).toMatchObject({
      position: 1,
      objectIds: ['First'],
    });
    await click(button(host, 'Select Second'));
    expect(useStore.getState().selectedObjectId).toBe('Second');
    const row = host.querySelector<HTMLElement>('article[aria-label="Run 1: First"]')!;
    await click(button(row, 'Edit settings'));
    expect(useStore.getState().selectedObjectId).toBe('First');
    expect(useUiStore.getState().cutsLayersView).toBe('layers');
  });

  it.each([
    ['Outward', -1, 21],
    ['Inward', 1, 19],
  ] as const)(
    'creates the %s one-millimeter offset while retaining its source',
    async (label, min, max) => {
      useStore.getState().importSvgObject(square());
      useStore.setState((state) => ({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            objects: state.project.scene.objects.map((object) => ({
              ...object,
              transform: IDENTITY_TRANSFORM,
            })),
          },
        },
      }));
      const source = useStore.getState().project.scene.objects[0];
      const host = await mount(<OffsetPathsRow />);
      await click(button(host, `${label} copy`));
      const objects = useStore.getState().project.scene.objects;
      expect(objects).toHaveLength(2);
      expect(objects[0]).toBe(source);
      expect(objects[1]?.bounds).toEqual({ minX: min, minY: min, maxX: max, maxY: max });
    },
  );

  it('relieves CNC square corners in place and restores the original with Undo', async () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().importSvgObject(square());
    const source = useStore.getState().project.scene.objects[0]!;
    const host = await mount(<DogboneRow />);
    await click(button(host, 'Relieve corners'));
    const objects = useStore.getState().project.scene.objects;
    expect(objects).toHaveLength(1);
    expect(objects[0]?.id).toBe(source.id);
    const relieved = objects[0];
    expect(relieved?.kind).toBe('imported-svg');
    if (relieved?.kind !== 'imported-svg') throw new Error('Missing relieved vector');
    expect(relieved.paths[0]?.polylines[0]?.points.length).toBeGreaterThan(4);
    expect(relieved.paths).not.toEqual((source as ImportedSvg).paths);
    await act(async () => useStore.getState().undo());
    expect(useStore.getState().project.scene.objects[0]).toEqual(source);
  });

  it('reimports selected SVG into its existing identity through a stub file picker', async () => {
    useStore.getState().importSvgObject(square());
    const target = useStore.getState().project.scene.objects[0]!;
    const host = await mount(<SelectedSourceReimportControl object={target} />, {
      ...auditPlatform,
      pickFilesForOpen: async () => [
        {
          name: 'square.svg',
          text: async () =>
            '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="10mm" viewBox="0 0 30 10"><path d="M0 0H30V10H0Z" stroke="black" fill="none"/></svg>',
        },
      ],
    });
    await click(button(host, 'Re-import selected source…'));
    const objects = useStore.getState().project.scene.objects;
    expect(objects).toHaveLength(1);
    expect(objects[0]?.id).toBe(target.id);
    expect(objects[0]?.bounds).toEqual({ minX: 0, minY: 0, maxX: 30, maxY: 10 });
  });

  it('opens Image Studio on the selected image using a stub pixel decoder', async () => {
    vi.spyOn(imageDecode, 'decodeRasterToBuffer').mockResolvedValue({
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(16),
    });
    const raster: RasterImage = {
      kind: 'raster-image',
      id: 'raster',
      source: 'audit.png',
      dataUrl: 'data:image/png;base64,AA==',
      pixelWidth: 2,
      pixelHeight: 2,
      color: '#808080',
      dither: 'floyd-steinberg',
      linesPerMm: 10,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      transform: IDENTITY_TRANSFORM,
    };
    useStore.getState().importRasterImage(raster);
    const owned = useStore.getState().project.scene.objects[0] as RasterImage;
    const host = await mount(<SelectedImageAdjustments image={owned} />);
    await click(button(host, 'Edit Image…'));
    expect(useImageEditorStore.getState().session?.objectId).toBe('raster');
    expect(useImageEditorStore.getState().sessionOwner?.sourceImage).toBe(owned);
    await act(async () => useImageEditorStore.getState().closeEditor());
  });

  it('opens the actual relief viewer and reports its unavailable worker boundary', async () => {
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
    const host = await mount(<SelectedReliefProperties />);
    await click(button(host, 'View 3D…'));
    expect(host.querySelector('[role="dialog"][aria-label="Relief 3D viewer"]')).not.toBeNull();
    expect(host.textContent).toContain('unavailable');
  });
});
