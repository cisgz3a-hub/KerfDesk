import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, DEFAULT_CNC_LAYER_SETTINGS, type TracedImage } from '../../core/scene';
import { carriedSubpathParents, withSubpathNesting } from '../../core/scene/subpath-nesting';
import { HYBRID_STROKE_COLOR } from '../../core/trace/hybrid/hybrid-paths';
import { detachTracePartGeometry, tracePartGroups } from './trace-part-geometry';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';
import { actions, load, pieces, rings, square, trace } from './trace-part.test-support';
import { setActiveEdition, UNRESTRICTED_EDITION } from '../licensing/edition';

describe('edit individual trace parts', () => {
  beforeEach(resetStore);
  afterEach(() => setActiveEdition(null));

  it('asks for Pro before splitting an existing V-carve trace in Free (ADR-592)', () => {
    load(trace());
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: state.project.scene.layers.map((layer) => ({
            ...layer,
            cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' as const },
          })),
        },
      },
    }));
    const requestPro = vi.fn(() => false);
    setActiveEdition({ ...UNRESTRICTED_EDITION, pro: false, requestPro });
    const before = useStore.getState().project;
    useStore.getState().detachTracePart('trace', 0, 1);
    expect(useStore.getState().project).toBe(before);
    expect(requestPro).toHaveBeenCalledWith('vcarve', expect.any(Function));
  });

  it('picks an outer with its hole, preserving exact curves, chords, nesting, metadata and tabs', () => {
    const path = rings();
    const object: TracedImage = {
      ...trace([path]),
      name: 'Logo',
      operationIds: ['cut'],
      powerScale: 70,
      operationOverride: { power: 42 },
      cncTabAnchors: [
        { layerColor: '#000000', pathIndex: 0, polylineIndex: 1, pathT: 0.2 },
        { layerColor: '#000000', pathIndex: 0, polylineIndex: 2, pathT: 0.6 },
      ],
      laserTabAnchors: [{ layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.4 }],
    };
    load(object);
    const id = actions.detachTracePart('trace', 0, 1);
    const remainder = pieces()[0]!;
    const picked = pieces()[1]!;
    expect(id).toBe('trace__part_1');
    expect(remainder.paths[0]!.curves).toEqual([path.curves![2]]);
    expect(picked.paths[0]!.curves).toEqual(path.curves!.slice(0, 2));
    expect(picked.paths[0]!.polylines[0]).toBe(path.polylines[0]);
    expect(picked.paths[0]!.curves![0]).toBe(path.curves![0]);
    expect(carriedSubpathParents(picked.paths[0]!)).toEqual([-1, 0]);
    expect(carriedSubpathParents(remainder.paths[0]!)).toEqual([-1]);
    expect(picked.bounds).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 40 });
    expect(remainder.bounds).toEqual({ minX: 80, minY: 80, maxX: 100, maxY: 100 });
    for (const piece of pieces()) {
      expect(piece.transform).toBe(object.transform);
      expect(piece).toMatchObject({
        name: 'Logo',
        powerScale: 70,
        operationOverride: { power: 42 },
        tracePixelWidth: 200,
        tracePixelHeight: 200,
      });
      expect(piece.traceSourceId).toBeUndefined();
      expect(piece.paths[0]).toMatchObject({
        operationIds: ['cut'],
        fillRule: 'evenodd',
        strokeWidthMm: 0.4,
      });
    }
    expect(picked.cncTabAnchors).toEqual([object.cncTabAnchors![0]]);
    expect(remainder.cncTabAnchors).toEqual([{ ...object.cncTabAnchors![1], polylineIndex: 0 }]);
    expect(picked.laserTabAnchors).toEqual(object.laserTabAnchors);
    expect(remainder.laserTabAnchors).toEqual([]);
  });

  it('remaps path and subpath indices when removing one complete colour path', () => {
    const object: TracedImage = {
      ...trace([
        { color: '#ff0000', polylines: [square(0)] },
        { color: '#000000', polylines: [square(20), square(40)] },
      ]),
      cncTabAnchors: [
        { layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 0.1 },
        { layerColor: '#000000', pathIndex: 1, polylineIndex: 1, pathT: 0.3 },
      ],
    };
    const split = detachTracePartGeometry(object, 0, 0, 'part');
    expect(split?.remainder?.paths).toEqual([object.paths[1]]);
    expect(split?.remainder?.cncTabAnchors).toEqual([
      { ...object.cncTabAnchors![1], pathIndex: 0 },
    ]);
    expect(split?.part.cncTabAnchors).toEqual([object.cncTabAnchors![0]]);
  });

  it('keeps centerline and hybrid closed strokes separate, while hybrid fills retain holes', () => {
    const filled = trace();
    const centerline: TracedImage = { ...filled, traceMode: 'centerline' };
    expect(tracePartGroups(centerline, 0)).toEqual([[0], [1], [2]]);
    expect(tracePartGroups(filled, 0)).toEqual([[0, 1], [2]]);
    const hybrid: TracedImage = {
      ...filled,
      traceMode: 'hybrid',
      paths: [rings(), { ...rings(), color: HYBRID_STROKE_COLOR }],
    };
    expect(tracePartGroups(hybrid, 0)).toEqual([[0, 1], [2]]);
    expect(tracePartGroups(hybrid, 1)).toEqual([[0], [1], [2]]);
    expect(detachTracePartGeometry(centerline, 0, 1, 'stroke')?.part.paths[0]?.polylines).toEqual([
      filled.paths[0]?.polylines[1],
    ]);
  });

  it('adds only one object for a trace with more than ten thousand independent shapes', () => {
    const polylines = Array.from({ length: 10_001 }, (_, index) => square(index * 20));
    const path = withSubpathNesting(
      { color: '#000000', polylines },
      polylines.map(() => -1),
    );
    load(trace([path]));
    expect(actions.detachTracePart('trace', 0, 7777)).toBe('trace__part_1');
    expect(pieces()).toHaveLength(2);
    expect(pieces()[0]?.paths[0]?.polylines).toHaveLength(10_000);
    expect(pieces()[1]?.paths[0]?.polylines).toEqual([polylines[7777]]);
  });

  it('preserves artwork and design order, groups and one-step undo/redo', () => {
    const object = trace();
    load(object);
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          groups: [{ id: 'group', name: 'Artwork', objectIds: ['trace'] }],
          artworkOrder: ['trace'],
          designTreeOrder: [{ kind: 'object', id: 'trace' }],
        },
      },
      selectedObjectId: 'trace',
    }));
    const before = useStore.getState().project;
    actions.detachTracePart('trace', 0, 2);
    const after = useStore.getState().project;
    expect(after.scene.groups?.[0]?.objectIds).toEqual(['trace', 'trace__part_1']);
    expect(after.scene.artworkOrder).toEqual(['trace', 'trace__part_1']);
    expect(after.scene.designTreeOrder).toContainEqual({ kind: 'object', id: 'trace__part_1' });
    expect(useStore.getState().selectedObjectId).toBe('trace');
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(after);
  });

  it('shares a drag snapshot so moving a newly detached part is one undo and cancel restores the complete trace', () => {
    load(trace());
    const before = useStore.getState().project;
    useStore.getState().beginInteraction();
    const id = actions.detachTracePart('trace', 0, 2)!;
    actions.selectTracePart(id);
    useStore.getState().setObjectTransform(id, { ...pieces()[1]!.transform, x: 150 });
    expect(useStore.getState().undoStack).toHaveLength(0);
    useStore.getState().cancelInteraction();
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().selectedObjectId).toBeNull();
    useStore.getState().beginInteraction();
    const nextId = actions.detachTracePart('trace', 0, 2)!;
    useStore.getState().setObjectTransform(nextId, { ...pieces()[1]!.transform, x: 150 });
    useStore.getState().endInteraction();
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });

  it('selects just the part within a group and keeps Selected artwork output scope current', () => {
    load(trace());
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          groups: [{ id: 'group', name: 'Artwork', objectIds: ['trace'] }],
        },
      },
      outputScopeSettings: { cutSelectedGraphics: true, useSelectionOrigin: false },
    }));
    const id = actions.detachTracePart('trace', 0, 2)!;
    actions.selectTracePart(id);
    expect(useStore.getState().selectedObjectId).toBe(id);
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
    expect(useStore.getState().project.jobSetup?.outputScope.selectedObjectIds).toEqual([id]);
    actions.selectTracePart('trace', { toggle: true });
    expect([...useStore.getState().additionalSelectedIds]).toEqual(['trace']);
    actions.selectTracePart(id, { toggle: true });
    expect(useStore.getState().selectedObjectId).toBe('trace');
    actions.selectTracePart(null);
    expect(useStore.getState().project.jobSetup?.outputScope.selectedObjectIds).toEqual([]);
  });

  it('drops a restored whole-remainder selection when adding another individual part', () => {
    load(trace([rings(), { color: '#000000', polylines: [square(130)] }]));
    const id = actions.detachTracePart('trace', 0, 1)!;
    useStore.setState({ selectedObjectId: 'trace', additionalSelectedIds: new Set() });
    actions.selectTracePart(id, { toggle: true });
    expect(useStore.getState().selectedObjectId).toBe(id);
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
  });

  it('returns the existing object without a mutation when it is already one shape', () => {
    load(trace([{ color: '#000000', polylines: [square(0)] }]));
    const before = useStore.getState().project;
    expect(actions.detachTracePart('trace', 0, 0)).toBe('trace');
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('ignores locked, hidden and invalid targets, including a hidden path within visible artwork', () => {
    load({ ...trace(), locked: true });
    expect(actions.detachTracePart('trace', 0, 0)).toBeNull();
    load(trace([{ ...rings(), operationIds: ['hidden'] }, rings()]));
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [
            ...state.project.scene.layers,
            { ...createLayer({ color: '#ff0000', id: 'hidden' }), visible: false },
          ],
        },
      },
    }));
    const before = useStore.getState().project;
    expect(actions.detachTracePart('trace', 0, 0)).toBeNull();
    for (const [pathIndex, subpathIndex] of [
      [-1, 0],
      [1, -1],
      [1, 99],
      [1, 1.5],
      [0.5, 0],
    ]) {
      expect(actions.detachTracePart('trace', pathIndex!, subpathIndex!)).toBeNull();
    }
    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('refuses a scene object limit overrun atomically', () => {
    load(trace());
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: Array.from({ length: 10_000 }, (_, index) => ({
            ...trace(),
            id: index === 0 ? 'trace' : `copy-${index}`,
          })),
        },
      },
    }));
    const before = useStore.getState().project;
    expect(actions.detachTracePart('trace', 0, 2)).toBeNull();
    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('10000 objects');
  });
});
