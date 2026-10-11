import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { serializeProject } from '../../io/project';
import { validateProjectShape } from '../../io/project/project-shape-validator';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { useToastStore } from './toast-store';

function photoProject(layered: boolean): Project {
  const project = createProject();
  // 4000×4000 RGBA is valid active photo source (64,000,000 decoded bytes).
  // Its canonical Base64 alone exceeds the separate workflow archive budget.
  const rgbaBase64 = 'A'.repeat(Math.floor(64_000_000 / 3) * 4) + 'AA==';
  const photo: RasterImage = {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: `data:image/png;base64,${layered ? 'AAAA' : 'A'.repeat(50_000_000)}`,
    pixelWidth: 4000,
    pixelHeight: 4000,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
    ...(layered
      ? {
          editorDocument: {
            version: 1 as const,
            width: 4000,
            height: 4000,
            activeLayerId: 'paint',
            layers: [
              {
                id: 'paint',
                name: 'Paint',
                isVisible: true,
                opacity: 1,
                blend: 'normal' as const,
                rgbaBase64,
              },
            ],
          },
        }
      : {}),
  };
  return {
    ...project,
    scene: {
      ...project.scene,
      objects: [photo],
      layers: [createLayer({ id: 'image', color: '#808080', mode: 'image' })],
    },
    sheetBook: {
      activeId: 'photo-sheet',
      activeName: 'Photo',
      inactive: [
        { id: 'blank', name: 'Blank', projectJson: serializeProject(project, { compact: true }) },
      ],
    },
  };
}

beforeEach(resetStore);
afterEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

it.each([true, false])(
  'keeps an accepted %s layered photo intact when Add/Switch exceed the archive capacity',
  (layered) => {
    const project = photoProject(layered);
    expect(validateProjectShape(project)).toBeNull();
    useStore.setState({
      project,
      selectedObjectId: 'photo',
      savedName: 'photo.lf2',
      undoStack: [createProject()],
    });
    const before = useStore.getState();
    expect(before.addProjectSheet('New sheet', false)).toBeNull();
    expect(useStore.getState()).toBe(before);
    expect(before.switchProjectSheet('blank')).toBe(false);
    expect(useStore.getState()).toBe(before);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Workflow project archives exceed the 50 million character budget',
    );
  },
  20_000,
);
