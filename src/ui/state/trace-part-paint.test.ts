import { describe, expect, it } from 'vitest';
import {
  captureLayerOperationSettings,
  createLayer,
  type Layer,
  type TracedImage,
} from '../../core/scene';
import { HYBRID_STROKE_COLOR } from '../../core/trace/hybrid/hybrid-paths';
import { isSingleTracePart, tracePartGroups } from '../../core/trace/trace-part-groups';
import { detachTracePartGeometry } from './trace-part-geometry';
import { splitTracedImage } from './trace-break-apart';
import { actions, rings, trace } from './trace-part.test-support';
import { resetStore } from './test-helpers';
import { useStore } from './store';

function strokeTrace(traceMode: 'centerline' | 'hybrid' = 'centerline'): TracedImage {
  return {
    ...trace([{ ...rings(), color: traceMode === 'hybrid' ? HYBRID_STROKE_COLOR : '#000000' }]),
    traceMode,
  };
}

function operation(mode: 'line' | 'fill', id = 'cut'): Layer {
  return createLayer({ id, color: '#000000', mode });
}

describe('trace grouping after operation paint changes', () => {
  it.each(['direct', 'break-apart'] as const)(
    'passes Fill operations through the %s store action',
    (action) => {
      resetStore();
      const object = strokeTrace();
      useStore.setState((state) => ({
        project: { ...state.project, scene: { objects: [object], layers: [operation('fill')] } },
      }));
      const original = useStore.getState().project;
      if (action === 'direct') actions.detachTracePart(object.id, 0, 1);
      else {
        useStore.getState().selectObject(object.id);
        useStore.getState().breakApartSelection();
      }
      const contours = useStore
        .getState()
        .project.scene.objects.map((part) =>
          part.kind === 'traced-image' ? part.paths[0]?.polylines.length : 0,
        )
        .sort();
      expect(contours).toEqual([1, 2]);
      expect(useStore.getState().undoStack).toEqual([original]);
    },
  );

  it.each(['centerline', 'hybrid'] as const)(
    'keeps %s outer and hole together for a reassigned Fill operation',
    (mode) => {
      const object = strokeTrace(mode);
      const layers = [operation('fill')];
      expect(tracePartGroups(object, 0, layers)).toEqual([[0, 1], [2]]);
      const split = detachTracePartGeometry(object, 0, 1, 'part', layers);
      expect(split?.part.paths[0]?.curves).toEqual(object.paths[0]?.curves?.slice(0, 2));
      expect(split?.remainder?.paths[0]?.curves).toEqual(object.paths[0]?.curves?.slice(2));
      if (split === null) throw new Error('Expected a split');
      expect(isSingleTracePart(split.part, layers)).toBe(true);
      expect(
        splitTracedImage(object, (index) => `piece-${index}`, layers).map(
          (part) => part.paths[0]?.polylines.length,
        ),
      ).toEqual([2, 1]);
    },
  );

  it.each(['global', 'scoped'] as const)(
    'preserves holes for a %s object Fill override on a Line operation',
    (scope) => {
      const object = {
        ...strokeTrace(),
        operationOverride:
          scope === 'global'
            ? { mode: 'fill' as const }
            : { byOperation: { cut: { mode: 'fill' as const } } },
      };
      const layers = [operation('line')];
      const split = detachTracePartGeometry(object, 0, 0, 'part', layers);
      expect(split?.part.paths[0]?.polylines).toHaveLength(2);
      expect(split?.part.operationOverride).toEqual(object.operationOverride);
    },
  );

  it('protects a secondary hidden Fill operation even when the displayed operation is Line', () => {
    const original = strokeTrace();
    const object = {
      ...original,
      paths: original.paths.map((path) => ({ ...path, operationIds: ['cut', 'wash'] })),
    };
    const layers = [operation('line'), { ...operation('fill', 'wash'), visible: false }];
    expect(
      detachTracePartGeometry(object, 0, 1, 'part', layers)?.part.paths[0]?.polylines,
    ).toHaveLength(2);
  });

  it('protects a Fill sub-operation with inherited binding identity and scoped settings', () => {
    const parent = operation('line');
    const layers = [
      {
        ...parent,
        subLayers: [
          {
            id: 'wash',
            label: 'Wash',
            enabled: true,
            settings: { ...captureLayerOperationSettings(parent), mode: 'line' as const },
          },
        ],
      },
    ];
    const object = {
      ...strokeTrace(),
      operationOverride: { byOperation: { 'cut:wash': { mode: 'fill' as const } } },
    };
    expect(tracePartGroups(object, 0, layers)).toEqual([[0, 1], [2]]);
  });

  it('refreshes cached grouping when the same immutable stroke path changes between Line and Fill', () => {
    const object = strokeTrace();
    expect(tracePartGroups(object, 0, [operation('line')])).toEqual([[0], [1], [2]]);
    expect(tracePartGroups(object, 0, [operation('fill')])).toEqual([[0, 1], [2]]);
    expect(tracePartGroups(object, 0, [operation('line')])).toEqual([[0], [1], [2]]);
    const lineOverride = { ...object, operationOverride: { mode: 'line' as const } };
    expect(tracePartGroups(lineOverride, 0, [operation('fill')])).toEqual([[0], [1], [2]]);
  });
});
