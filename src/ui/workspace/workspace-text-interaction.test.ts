import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { useCanvasTextStore } from '../text/canvas-text-store';
import { computeView } from './view-transform';
import {
  handleCanvasDoubleClick,
  projectForCanvasTextDraft,
  workspaceTextPointerHandlers,
} from './workspace-text-interaction';

const VIEW = { zoomFactor: 1.5, panX: 12, panY: -8 };

beforeEach(() => {
  resetStore();
  useCanvasTextStore.getState().close();
  useUiStore.setState({
    toolMode: { kind: 'text' },
    spaceDown: false,
    textDialog: null,
    imageDialog: null,
    modalDepth: 0,
  });
});

afterEach(() => useCanvasTextStore.getState().close());

describe('canvas text pointer routing', () => {
  it('starts at the clicked scene position after CSS scaling, zoom, and pan without mutating history', () => {
    const project = useStore.getState().project;
    const { handlers, fallback } = pointerHarness(project);
    handlers.onPointerDown(pointerAt(project, { x: 76, y: 89 }));

    expect(useCanvasTextStore.getState().session?.position.x).toBeCloseTo(76);
    expect(useCanvasTextStore.getState().session?.position.y).toBeCloseTo(89);
    expect(useCanvasTextStore.getState().session?.state.mode).toBe('add');
    expect(fallback.onPointerDown).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().pendingUndo).toBeNull();
  });

  it('edits an existing rotated and mirrored text object at its actual canvas hit', () => {
    const object = textObject('text');
    const project = projectWithText(object);
    const { handlers } = pointerHarness(project);
    handlers.onPointerDown(pointerAt(project, applyTransform({ x: 8, y: 4 }, object.transform)));

    expect(useCanvasTextStore.getState().session?.original).toBe(object);
    expect(useCanvasTextStore.getState().draft?.transform).toEqual(object.transform);
  });

  it.each(['locked', 'hidden'] as const)('does not edit %s text', (reason) => {
    const object = textObject('text');
    const project = projectWithText(reason === 'locked' ? { ...object, locked: true } : object);
    const current =
      reason === 'hidden'
        ? {
            ...project,
            scene: {
              ...project.scene,
              layers: project.scene.layers.map((layer) => ({ ...layer, visible: false })),
            },
          }
        : project;
    const { handlers } = pointerHarness(current);
    handlers.onPointerDown(pointerAt(current, applyTransform({ x: 8, y: 4 }, object.transform)));

    expect(useCanvasTextStore.getState().session?.state.mode).toBe('add');
  });

  it.each([
    ['preview', true, 0, false],
    ['Space pan', false, 0, true],
    ['middle-button pan', false, 1, false],
    ['right-button pan', false, 2, false],
  ] as const)(
    'preserves %s routing without starting text',
    (_label, previewMode, button, spaceDown) => {
      useUiStore.setState({ spaceDown });
      const project = useStore.getState().project;
      const { handlers, fallback } = pointerHarness(project, previewMode);
      handlers.onPointerDown(pointerAt(project, { x: 80, y: 90 }, button));

      expect(fallback.onPointerDown).toHaveBeenCalledOnce();
      expect(useCanvasTextStore.getState().session).toBeNull();
    },
  );

  it('does not transform or replace the session while outside-click saving is pending', () => {
    const project = useStore.getState().project;
    const { handlers, fallback } = pointerHarness(project);
    useCanvasTextStore.getState().beginAdd({ x: 20, y: 30 });
    const session = useCanvasTextStore.getState().session;
    handlers.onPointerDown(pointerAt(project, { x: 90, y: 90 }));
    handlers.onPointerMove(pointerAt(project, { x: 100, y: 100 }));

    expect(useCanvasTextStore.getState().session).toBe(session);
    expect(fallback.onPointerDown).not.toHaveBeenCalled();
    expect(fallback.onPointerMove).not.toHaveBeenCalled();
  });

  it('does not act through an open modal', () => {
    useUiStore.setState({ modalDepth: 1 });
    const project = useStore.getState().project;
    const { handlers, fallback } = pointerHarness(project);
    handlers.onPointerDown(pointerAt(project, { x: 90, y: 90 }));

    expect(fallback.onPointerDown).not.toHaveBeenCalled();
    expect(useCanvasTextStore.getState().session).toBeNull();
  });
});

describe('canvas text double-click routing', () => {
  it('edits the actual hit instead of a different primary object in a selection', () => {
    const object = textObject('target');
    const other = {
      ...textObject('selected'),
      transform: { ...IDENTITY_TRANSFORM, x: 220, y: 220 },
    };
    const project = projectWithText(object, other);
    const { canvas } = pointerHarness(project);
    useUiStore.setState({ toolMode: { kind: 'select' }, ...VIEW });
    useStore.setState({ selectedObjectId: other.id, additionalSelectedIds: new Set([object.id]) });
    const event = {
      ...pointerAt(project, applyTransform({ x: 8, y: 4 }, object.transform)),
      detail: 2,
      currentTarget: canvas,
    };

    handleCanvasDoubleClick(event);

    expect(useCanvasTextStore.getState().session?.original).toBe(object);
  });

  it('keeps empty-space and node-mode double-clicks out of text editing', () => {
    const object = textObject('text');
    const project = projectWithText(object);
    const { canvas } = pointerHarness(project);
    useStore.setState({ selectedObjectId: object.id });
    useUiStore.setState({ toolMode: { kind: 'select' }, ...VIEW });
    handleCanvasDoubleClick({
      ...pointerAt(project, { x: 300, y: 300 }),
      detail: 2,
      currentTarget: canvas,
    });
    expect(useCanvasTextStore.getState().session).toBeNull();
    useUiStore.setState({ toolMode: { kind: 'node' } });
    handleCanvasDoubleClick({
      ...pointerAt(project, applyTransform({ x: 8, y: 4 }, object.transform)),
      detail: 2,
      currentTarget: canvas,
    });
    expect(useCanvasTextStore.getState().session).toBeNull();
  });
});

describe('canvas text display project', () => {
  it('replaces only the editing object at its original paint order without changing saved geometry', () => {
    const original = textObject('text');
    const foreground = textObject('foreground');
    const project = projectWithText(original, foreground);
    useCanvasTextStore.getState().beginEdit(original);
    const session = useCanvasTextStore.getState().session;
    const draft = {
      ...original,
      content: 'Changed',
      paths: original.paths.map(({ operationIds: _ids, ...path }) => path),
    };
    const display = projectForCanvasTextDraft(project, session, draft, 0);

    expect(display.scene.objects.map((object) => object.id)).toEqual(['text', 'foreground']);
    expect(display.scene.objects[0]).toMatchObject({
      content: 'Changed',
      paths: [{ operationIds: ['text-operation'] }],
    });
    expect(project.scene.objects[0]).toBe(original);
    expect(original.content).toBe('Original');
    expect(useStore.getState().project).toBe(project);
  });

  it('hides the original only while its valid draft is empty', () => {
    const original = textObject('text');
    const project = projectWithText(original);
    useCanvasTextStore.getState().beginEdit(original);
    const session = useCanvasTextStore.getState().session;

    expect(projectForCanvasTextDraft(project, session, null, 0).scene.objects).toHaveLength(0);
    expect(projectForCanvasTextDraft(project, session, null, 1)).toBe(project);
    const replaced = { ...project, scene: { ...project.scene, objects: [{ ...original }] } };
    expect(projectForCanvasTextDraft(replaced, session, null, 0)).toBe(replaced);
  });

  it('never appends an add draft from a previous document', () => {
    const project = useStore.getState().project;
    useCanvasTextStore.getState().beginAdd({ x: 20, y: 20 });
    const session = useCanvasTextStore.getState().session;

    expect(projectForCanvasTextDraft(project, session, textObject('draft'), 1)).toBe(project);
    expect(
      projectForCanvasTextDraft(project, session, textObject('draft'), 0).scene.objects,
    ).toHaveLength(1);
    expect(project.scene.objects).toHaveLength(0);
  });
});

function pointerHarness(project: Project, previewMode = false) {
  useStore.setState({ project });
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 800;
  canvas.getBoundingClientRect = () => ({ left: 20, top: 30, width: 500, height: 400 }) as DOMRect;
  const fallback = {
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    onLostPointerCapture: vi.fn(),
  };
  return {
    canvas,
    fallback,
    handlers: workspaceTextPointerHandlers({
      canvasRef: { current: canvas },
      project,
      previewMode,
      viewState: VIEW,
      handlers: fallback,
    }),
  };
}

function pointerAt(
  project: Project,
  point: Vec2,
  button = 0,
): React.PointerEvent<HTMLCanvasElement> {
  const view = computeView(1000, 800, project.device.bedWidth, project.device.bedHeight, VIEW);
  return {
    button,
    clientX: 20 + (view.offsetX + point.x * view.scale) / 2,
    clientY: 30 + (view.offsetY + point.y * view.scale) / 2,
    preventDefault: vi.fn(),
    defaultPrevented: false,
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

function projectWithText(...objects: TextObject[]): Project {
  const project = {
    ...createProject(),
    scene: {
      objects,
      layers: [createLayer({ id: 'text-operation', color: '#ff0000', mode: 'fill' })],
    },
  };
  useStore.setState({ project });
  return project;
}

function textObject(id: string): TextObject {
  return {
    kind: 'text',
    id,
    content: 'Original',
    fontKey: 'roboto',
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#ff0000',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x: 80, y: 70, rotationDeg: 35, scaleX: 1.5, mirrorX: true },
    operationIds: ['text-operation'],
    paths: [
      {
        color: '#ff0000',
        operationIds: ['text-operation'],
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
}
