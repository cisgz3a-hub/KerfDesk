import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, type Project } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);

function rectangle(id: string, leadStyle: 'arc' | 'line') {
  return {
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 8, heightMm: 5, cornerRadiusMm: 0 },
    }),
    operationIds: ['operation'],
    operationOverride: { byOperation: { operation: { leadInEnabled: true, leadStyle } } },
  };
}

function project(): Project {
  return {
    ...createProject(),
    scene: {
      layers: [createLayer({ id: 'operation', color: '#000000' })],
      objects: [rectangle('arcs', 'arc'), rectangle('lines', 'line')],
    },
  };
}

describe('a bulk lead angle edit across arc and line leads (ADR-626)', () => {
  it('keeps each artwork within its own style range', () => {
    useStore.setState({ project: project() });
    useStore.getState().setObjectsOperationOverrideForOperation(['arcs', 'lines'], 'operation', {
      leadAngleDeg: 150,
    });
    const [arcs, lines] = useStore.getState().project.scene.objects;
    expect(arcs?.operationOverride?.byOperation?.operation).toMatchObject({ leadAngleDeg: 150 });
    expect(lines?.operationOverride?.byOperation?.operation).toMatchObject({ leadAngleDeg: 90 });
  });
});
