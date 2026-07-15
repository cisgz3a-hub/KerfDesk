import { beforeEach, describe, expect, it } from 'vitest';
import { createRectangle } from '../../core/shapes';
import { DEFAULT_SNAP_SETTINGS, type SnapGuide } from '../workspace/snapping';
import { useUiStore } from './ui-store';

const ONE_VERTEX = { vertices: [{ x: 1, y: 2 }], cursor: null };
const MEASURE_DRAFT = { start: { x: 0, y: 0 }, end: { x: 12, y: 8 } };

describe('ui-store pen draft lifecycle (ADR-051 B6)', () => {
  beforeEach(() => {
    useUiStore.getState().setRailPanelVisible('layers', true);
    useUiStore.getState().setRailPanelVisible('machine', true);
    useUiStore.getState().setCutsLayersView('layers');
    useUiStore.getState().setToolMode({ kind: 'select' });
    useUiStore.getState().setPenDraft(null);
    useUiStore.getState().setSelectionMarquee(null);
    useUiStore.getState().setMeasureDraft(null);
    useUiStore.getState().setActiveLayerColor(null);
    useUiStore.getState().setShowPreviewTravel(true);
    useUiStore.getState().setPreviewPlaying(false);
    useUiStore.getState().setPreviewPlaybackSpeed('normal');
    useUiStore.getState().closeWorkspaceContextBar();
    useUiStore.getState().setSnapSettings(DEFAULT_SNAP_SETTINGS);
    useUiStore.getState().setSnapGuides([]);
  });

  it('tracks the two right-rail visibility choices independently', () => {
    useUiStore.getState().toggleRailPanel('layers');
    expect(useUiStore.getState().railPanelVisibility).toEqual({
      layers: false,
      machine: true,
    });

    useUiStore.getState().setRailPanelVisible('machine', false);
    expect(useUiStore.getState().railPanelVisibility).toEqual({
      layers: false,
      machine: false,
    });
  });

  it('tracks the selected Cuts / Layers view outside the panel component', () => {
    useUiStore.getState().setCutsLayersView('materials');
    expect(useUiStore.getState().cutsLayersView).toBe('materials');
  });

  it('setToolMode clears the pen draft when switching to a non-pen draw tool', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    useUiStore.getState().setPenDraft(ONE_VERTEX);
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });
    expect(useUiStore.getState().penDraft).toBeNull();
  });

  it('setToolMode clears the pen draft when switching to Select', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    useUiStore.getState().setPenDraft(ONE_VERTEX);
    useUiStore.getState().setToolMode({ kind: 'select' });
    expect(useUiStore.getState().penDraft).toBeNull();
  });

  it('setToolMode clears the pen draft when switching to node edit', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    useUiStore.getState().setPenDraft(ONE_VERTEX);
    useUiStore.getState().setToolMode({ kind: 'node' });
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'node' });
    expect(useUiStore.getState().penDraft).toBeNull();
  });

  it('setToolMode keeps the pen draft when the pen is re-selected', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    useUiStore.getState().setPenDraft(ONE_VERTEX);
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    expect(useUiStore.getState().penDraft).toEqual(ONE_VERTEX);
  });

  it('resetToolMode returns to Select and clears the pen draft', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'polyline' });
    useUiStore.getState().setPenDraft(ONE_VERTEX);
    useUiStore.getState().resetToolMode();
    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
    expect(useUiStore.getState().penDraft).toBeNull();
  });

  it('resetToolMode clears a live shape draft', () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });
    useUiStore.getState().setDraftShape(
      createRectangle({
        id: 'draft',
        color: '#000000',
        spec: { widthMm: 10, heightMm: 5, cornerRadiusMm: 0 },
      }),
    );

    useUiStore.getState().resetToolMode();

    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
    expect(useUiStore.getState().draftShape).toBeNull();
  });

  it('tracks and clears temporary measure drafts outside project history', () => {
    useUiStore.getState().setToolMode({ kind: 'measure' });
    useUiStore.getState().setMeasureDraft(MEASURE_DRAFT);

    expect(useUiStore.getState().measureDraft).toEqual(MEASURE_DRAFT);

    useUiStore.getState().resetToolMode();

    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
    expect(useUiStore.getState().measureDraft).toBeNull();
  });

  it('tracks the current drawing layer color outside undoable project data', () => {
    useUiStore.getState().setActiveLayerColor('#00FF00');
    expect(useUiStore.getState().activeLayerColor).toBe('#00ff00');

    useUiStore.getState().setActiveLayerColor(null);
    expect(useUiStore.getState().activeLayerColor).toBeNull();
  });

  it('keeps the preview traversal toggle as ephemeral UI state', () => {
    expect(useUiStore.getState().showPreviewTravel).toBe(true);

    useUiStore.getState().setShowPreviewTravel(false);

    expect(useUiStore.getState().showPreviewTravel).toBe(false);
  });

  it('tracks route preview playback as ephemeral UI state', () => {
    expect(useUiStore.getState().previewPlaying).toBe(false);
    expect(useUiStore.getState().previewPlaybackSpeed).toBe('normal');

    useUiStore.getState().setPreviewPlaying(true);
    useUiStore.getState().setPreviewPlaybackSpeed('fast');

    expect(useUiStore.getState().previewPlaying).toBe(true);
    expect(useUiStore.getState().previewPlaybackSpeed).toBe('fast');
  });

  it('tracks a live selection marquee outside project history', () => {
    const marquee = { start: { x: 1, y: 2 }, end: { x: 3, y: 4 } };

    useUiStore.getState().setSelectionMarquee(marquee);

    expect(useUiStore.getState().selectionMarquee).toEqual(marquee);
  });

  it('tracks the workspace right-click quick bar outside project history', () => {
    const quickBar = { x: 200, y: 120, context: 'workspace-selection' as const };

    useUiStore.getState().openWorkspaceContextBar(quickBar);

    expect(useUiStore.getState().workspaceContextBar).toEqual(quickBar);

    useUiStore.getState().closeWorkspaceContextBar();

    expect(useUiStore.getState().workspaceContextBar).toBeNull();
  });

  it('tracks snapping settings and transient guides outside project history', () => {
    const guide: SnapGuide = { axis: 'x', positionMm: 20, fromMm: 0, toMm: 10 };

    useUiStore.getState().setSnapSettings({ enabled: false });
    useUiStore.getState().setSnapGuides([guide]);

    expect(useUiStore.getState().snapSettings).toEqual({
      ...DEFAULT_SNAP_SETTINGS,
      enabled: false,
    });
    expect(useUiStore.getState().snapGuides).toEqual([guide]);
  });
});
