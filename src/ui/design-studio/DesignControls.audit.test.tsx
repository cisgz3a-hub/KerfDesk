import { act } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SketchRectangle } from '../../core/design';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useTutorialStore } from '../tutorials/tutorial-store';
import { clickControl, control, mountControl } from '../image-editor/control-audit-test-support';
import { createDesignSession } from './design-session';
import { useDesignStudioStore as studio } from './design-studio-store';
import { DesignToolRails } from './DesignToolRails';
import { DesignOptionsBar } from './DesignOptionsBar';
import { DesignTopBar } from './DesignTopBar';
import { ShapeInspector } from './ShapeInspector';
import { DesignViewportToolbar } from './viewport3d/DesignViewportToolbar';

const rect: SketchRectangle = {
  kind: 'rect',
  id: 'audit-rect',
  origin: { x: 0, y: 0 },
  widthMm: 30,
  heightMm: 20,
  cornerRadiusMm: 0,
};
beforeEach(() => {
  resetStore();
  studio.setState({ session: createDesignSession(), stash: null });
});

it('arms all eight shipped tools', async () => {
  const host = await mountControl(
    <>
      <DesignToolRails />
      <DesignOptionsBar />
    </>,
  );
  const choices = [
    ['Select', 'select'],
    ['Line', 'line'],
    ['Polyline', 'path'],
    ['Rectangle', 'rect'],
    ['Circle', 'circle'],
    ['Arc', 'arc'],
    ['Fillet', 'fillet'],
    ['Chamfer', 'chamfer'],
  ];
  expect(host.querySelectorAll('aside button')).toHaveLength(8);
  for (const [label, kind] of choices) {
    await clickControl(host, label!);
    expect(studio.getState().session?.tool).toBe(kind);
    expect(control(host, label!).getAttribute('aria-pressed')).toBe('true');
  }
});

it('top bar restores geometry with Undo and Redo, changes each view toggle, and requests Fit', async () => {
  const fit = vi.fn();
  const host = await mountControl(<DesignTopBar onFit={fit} />);
  expect(control(host, 'Undo').disabled).toBe(true);
  expect(control(host, 'Redo').disabled).toBe(true);
  await act(async () => studio.getState().drawEntity(rect));
  await clickControl(host, 'Undo');
  expect(studio.getState().session?.history.present.entities).toHaveLength(0);
  await clickControl(host, 'Redo');
  expect(studio.getState().session?.history.present.entities).toEqual([
    expect.objectContaining(rect),
  ]);
  for (const [label, key] of [
    ['Snap', 'snapEnabled'],
    ['Ortho', 'orthoEnabled'],
    ['Grid', 'showGrid'],
    ['3D', 'surface3d'],
  ] as const) {
    const previous = studio.getState().session?.[key];
    await clickControl(host, label);
    expect(studio.getState().session?.[key]).toBe(!previous);
    await clickControl(host, label);
    expect(studio.getState().session?.[key]).toBe(previous);
  }
  await clickControl(host, 'Fit');
  expect(fit).toHaveBeenCalledTimes(1);
  await clickControl(host, 'Tutorial');
  expect(useTutorialStore.getState().tutorialId).toBe('design-studio');
});

it('top bar Apply writes project artwork once, Apply and Close updates it, and Close only stashes', async () => {
  const host = await mountControl(<DesignTopBar onFit={() => undefined} />);
  expect(control(host, 'Apply').disabled).toBe(true);
  expect(control(host, 'Apply & Close').disabled).toBe(true);
  await act(async () => studio.getState().drawEntity(rect));
  await clickControl(host, 'Apply');
  expect(useStore.getState().project.scene.objects).toHaveLength(1);
  expect(studio.getState().session).not.toBeNull();
  expect(control(host, 'Apply').disabled).toBe(true);
  await act(async () => studio.getState().updateEntity({ ...rect, widthMm: 40 }));
  await clickControl(host, 'Apply & Close');
  expect(studio.getState().session).toBeNull();
  expect(studio.getState().stash?.history.present.entities[0]).toMatchObject({ widthMm: 40 });
  expect(useStore.getState().project.scene.objects).toHaveLength(1);
  await act(async () => studio.getState().openStudio());
  await act(async () => studio.getState().drawEntity({ ...rect, id: 'unapplied' }));
  const project = useStore.getState().project;
  await clickControl(host, 'Close');
  expect(studio.getState().session).toBeNull();
  expect(studio.getState().stash?.history.present.entities).toHaveLength(2);
  expect(useStore.getState().project).toBe(project);
});

it('precision inspector duplicates with offset, toggles construction and deletes the selected shape', async () => {
  studio.getState().drawEntity(rect);
  studio.getState().setSelection([rect.id]);
  const host = await mountControl(<ShapeInspector />);
  await clickControl(host, 'Guide');
  expect(studio.getState().session?.history.present.entities[0]?.construction).toBe(true);
  await clickControl(host, 'Guide');
  expect(studio.getState().session?.history.present.entities[0]?.construction).toBe(false);
  await clickControl(host, 'Duplicate');
  const entities = studio.getState().session?.history.present.entities;
  expect(entities).toHaveLength(2);
  expect(entities?.[1]).toMatchObject({ origin: { x: 5, y: 5 }, widthMm: 30, heightMm: 20 });
  await clickControl(host, 'Delete');
  expect(studio.getState().session?.history.present.entities).toHaveLength(1);
  expect(host.querySelector('aside')).toBeNull();
});

it('3D toolbar dispatches each preset and tier, gates absent simulation, and requests simulation', async () => {
  const onPreset = vi.fn();
  const onTier = vi.fn();
  const onSimulate = vi.fn();
  const callbacks = { onPreset, onTier, onSimulate };
  const host = await mountControl(
    <DesignViewportToolbar
      {...callbacks}
      tier="design"
      canShowBits={false}
      isStale={false}
      failReason={null}
    />,
  );
  await clickControl(host, 'Top');
  await clickControl(host, 'Iso');
  expect(onPreset.mock.calls).toEqual([['top'], ['iso']]);
  expect(control(host, 'Bits').disabled).toBe(true);
  await clickControl(host, 'Bits');
  expect(onTier).not.toHaveBeenCalled();
  await clickControl(host, 'Design');
  expect(onTier).toHaveBeenLastCalledWith('design');
  await clickControl(host, 'Simulate');
  expect(onSimulate).toHaveBeenCalledTimes(1);
  const ready = await mountControl(
    <DesignViewportToolbar {...callbacks} tier="bits" canShowBits isStale failReason={null} />,
  );
  await clickControl(ready, 'Bits (stale)');
  expect(onTier).toHaveBeenLastCalledWith('bits');
  expect(control(ready, 'Bits (stale)').getAttribute('aria-pressed')).toBe('true');
});
