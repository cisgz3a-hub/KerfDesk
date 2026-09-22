import { act } from 'react';
import { beforeEach, expect, it } from 'vitest';
import { sketchLayers } from '../../../core/design/layers';
import type { CncTool } from '../../../core/scene';
import {
  clickControl,
  clickElement,
  control,
  mountControl,
} from '../../image-editor/control-audit-test-support';
import { resetStore } from '../../state/test-helpers';
import { createDesignSession } from '../design-session';
import { useDesignStudioStore as studio } from '../design-studio-store';
import { DesignLayersCard } from './DesignLayersCard';

const tool: CncTool = { id: 'flat', name: 'Flat', kind: 'end-mill', diameterMm: 3 };
beforeEach(() => {
  resetStore();
  studio.setState({ session: createDesignSession(), stash: null });
  studio.getState().drawEntity({
    kind: 'rect',
    id: 'shape',
    origin: { x: 0, y: 0 },
    widthMm: 10,
    heightMm: 10,
    cornerRadiusMm: 0,
  });
  studio.getState().setSelection([]);
});
const layers = () => sketchLayers(studio.getState().session!.history.present);

it('adds, selects, assigns, reorders and deletes carve layers with correct edge availability', async () => {
  const host = await mountControl(
    <DesignLayersCard tools={[tool]} activeTool={tool} stockThicknessMm={12} />,
  );
  const initial = layers()[0]!;
  expect(control(host, 'Assign').disabled).toBe(true);
  expect(control(host, 'Move this layer up the list').disabled).toBe(true);
  expect(control(host, 'Move this layer down the list').disabled).toBe(true);
  expect(control(host, 'A sketch always keeps one layer').disabled).toBe(true);
  await clickControl(host, '+ New');
  const added = layers()[1]!;
  await act(async () => studio.getState().setSelection(['shape']));
  await clickControl(host, `Draw on "${added.name}" — new shapes land on the active layer`);
  expect(studio.getState().session?.activeLayerId).toBe(added.id);
  await clickControl(host, 'Assign');
  expect(studio.getState().session?.history.present.entities[0]?.layerId).toBe(added.id);
  await clickControl(host, 'Move this layer down the list');
  expect(layers().map((layer) => layer.id)).toEqual([added.id, initial.id]);
  const lowerUp = host.querySelectorAll<HTMLButtonElement>(
    '[title="Move this layer up the list"]',
  )[1]!;
  await clickElement(lowerUp);
  expect(layers().map((layer) => layer.id)).toEqual([initial.id, added.id]);
  const remove = host.querySelectorAll<HTMLButtonElement>(
    '[title="Remove this layer — its shapes move to the first layer"]',
  )[1]!;
  await clickElement(remove);
  expect(layers()).toHaveLength(1);
  expect(studio.getState().session?.history.present.entities[0]?.layerId).toBe(initial.id);
});

it('sets through depth from stock and toggles V-carve flat depth', async () => {
  const host = await mountControl(
    <DesignLayersCard tools={[tool]} activeTool={tool} stockThicknessMm={12} />,
  );
  await clickControl(host, 'Through');
  expect(layers()[0]?.depthMm).toBe(12);
  await act(async () =>
    studio
      .getState()
      .patchLayer(layers()[0]!.id, { cutType: 'v-carve', vCarveFlatDepthEnabled: false }),
  );
  const flat = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
  await clickElement(flat);
  expect(layers()[0]?.vCarveFlatDepthEnabled).toBe(true);
  await clickElement(flat);
  expect(layers()[0]?.vCarveFlatDepthEnabled).toBe(false);
});
